import type { ActionResult } from "../actions/action-result.js";
import type { StartWarAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId } from "../model/ids.js";
import { getPlayerOrderFromStartPlayer } from "../rules/player-order.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";

export interface PotentialBasicActions {
  readonly canOpenAuction: boolean;
  readonly canStartWar: boolean;
}

/** Logical adjacency only; AP4 will validate the remaining war rules. */
export function getPotentialBasicActions(state: GameState, playerId: PlayerId): PotentialBasicActions {
  let canOpenAuction = false;
  let canStartWar = false;
  for (const territory of state.territories) {
    if (territory.ownerId !== playerId) continue;
    for (const neighbor of state.territories) {
      if (neighbor.id === territory.id ||
          !(territory.adjacentTerritoryIds.includes(neighbor.id) ||
            neighbor.adjacentTerritoryIds.includes(territory.id))) continue;
      if (neighbor.ownerId === null) canOpenAuction = true;
      else if (neighbor.ownerId !== playerId) canStartWar = true;
    }
  }
  return { canOpenAuction, canStartWar };
}

function advancePastUnavailablePlayers(
  state: GameState,
  descriptions: EventDescription[],
): GameState {
  if (state.actionPhase === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const order = getPlayerOrderFromStartPlayer(state.players.map((player) => player.id), state.startPlayerId);
  const completed = [...state.actionPhase.completedPlayerIds];
  let next = order.find((playerId) => !completed.includes(playerId));
  while (next !== undefined) {
    const potential = getPotentialBasicActions(state, next);
    if (potential.canOpenAuction || potential.canStartWar) break;
    completed.push(next);
    descriptions.push({
      type: GameEventType.ActionForfeited,
      actorId: next,
      payload: { round: state.round, playerId: next, reason: "NO_LEGAL_BASIC_ACTION" },
    });
    next = order.find((playerId) => !completed.includes(playerId));
  }

  if (next === undefined) {
    descriptions.push(
      { type: GameEventType.ActionPhaseFinished, payload: { round: state.round } },
      { type: GameEventType.RoundFinished, payload: { round: state.round } },
    );
    const finalRound = state.round === state.maxRounds;
    if (finalRound) descriptions.push({ type: GameEventType.ScoringStarted, payload: { round: state.round } });
    return {
      ...state,
      phase: finalRound ? GamePhase.Scoring : GamePhase.RoundReady,
      activePlayerId: undefined,
      actionPhase: {
        completedPlayerIds: completed,
        auctionsOpenedByActivePlayer: 0,
        secondAuctionAvailable: false,
      },
      spadeActivations: [],
    };
  }

  return {
    ...state,
    activePlayerId: next,
    actionPhase: {
      completedPlayerIds: completed,
      auctionsOpenedByActivePlayer: 0,
      secondAuctionAvailable: false,
    },
  };
}

/** Called only when all territory activations are resolved. */
export function beginActionPhase(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActivationPhase ||
      state.activation?.pendingTerritoryIds.length !== 0 ||
      state.auction !== undefined || state.pendingSplit !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const descriptions: EventDescription[] = [
    { type: GameEventType.ActionPhaseStarted, payload: { round: state.round, startPlayerId: state.startPlayerId } },
  ];
  const provisional: GameState = {
    ...state,
    phase: GamePhase.ActionPhase,
    activePlayerId: state.startPlayerId,
    actionPhase: {
      completedPlayerIds: [],
      auctionsOpenedByActivePlayer: 0,
      secondAuctionAvailable: false,
    },
  };
  const advanced = advancePastUnavailablePlayers(provisional, descriptions);
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...advanced, events: [...state.events, ...events] }, events };
}

/** Completes the opener's one basic action after every pending auction step is resolved. */
export function finishCurrentBasicAction(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined ||
      state.activePlayerId === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.AuctionAlreadyActive);
  }
  const playerId = state.activePlayerId;
  if (state.actionPhase.completedPlayerIds.includes(playerId)) {
    throw new DomainError(DomainErrorCode.ActionAlreadyCompleted);
  }
  if (state.actionPhase.auctionsOpenedByActivePlayer === 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const descriptions: EventDescription[] = [
    { type: GameEventType.ActionCompleted, actorId: playerId, payload: { round: state.round, playerId } },
  ];
  const provisional: GameState = {
    ...state,
    actionPhase: {
      ...state.actionPhase,
      completedPlayerIds: [...state.actionPhase.completedPlayerIds, playerId],
    },
  };
  const advanced = advancePastUnavailablePlayers(provisional, descriptions);
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...advanced, events: [...state.events, ...events] }, events };
}

/** For a player who has neither an auction target nor a potential war target. */
export function forfeitCurrentBasicAction(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.activePlayerId === undefined ||
      state.actionPhase === undefined || state.auction !== undefined ||
      state.pendingSplit !== undefined || state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const playerId = state.activePlayerId;
  const potential = getPotentialBasicActions(state, playerId);
  if (potential.canOpenAuction || potential.canStartWar) {
    throw new DomainError(DomainErrorCode.LegalActionAvailable);
  }
  const descriptions: EventDescription[] = [
    { type: GameEventType.ActionForfeited, actorId: playerId, payload: { round: state.round, playerId, reason: "NO_LEGAL_BASIC_ACTION" } },
  ];
  const provisional: GameState = {
    ...state,
    actionPhase: {
      ...state.actionPhase,
      completedPlayerIds: [...state.actionPhase.completedPlayerIds, playerId],
    },
  };
  const advanced = advancePastUnavailablePlayers(provisional, descriptions);
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...advanced, events: [...state.events, ...events] }, events };
}

/** Slim handoff for AP4; no combat result is computed here. */
export function startPendingWar(state: GameState, action: StartWarAction, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined ||
      state.activePlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.NotActivePlayer);
  }
  if (state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined ||
      state.actionPhase.auctionsOpenedByActivePlayer !== 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const attacker = state.territories.find((territory) => territory.id === action.attackerTerritoryId);
  const defender = state.territories.find((territory) => territory.id === action.defenderTerritoryId);
  if (attacker?.ownerId !== action.playerId || defender?.ownerId === null ||
      defender?.ownerId === undefined || defender.ownerId === action.playerId ||
      !(attacker.adjacentTerritoryIds.includes(defender.id) ||
        defender.adjacentTerritoryIds.includes(attacker.id))) {
    throw new DomainError(DomainErrorCode.InvalidBorderTarget);
  }
  const events = createEvents(state, timestamp, [{
    type: GameEventType.WarStarted,
    actorId: action.playerId,
    payload: {
      playerId: action.playerId,
      attackerTerritoryId: attacker.id,
      defenderTerritoryId: defender.id,
      status: "PENDING_AP4",
    },
  }]);
  return {
    state: {
      ...state,
      pendingWar: {
        playerId: action.playerId,
        attackerTerritoryId: attacker.id,
        defenderTerritoryId: defender.id,
      },
      events: [...state.events, ...events],
    },
    events,
  };
}
