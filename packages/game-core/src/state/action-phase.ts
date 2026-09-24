import type { ActionResult } from "../actions/action-result.js";
import type { StartWarAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { getPlayerOrderFromStartPlayer } from "../rules/player-order.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";
import { areStateTerritoriesAdjacent } from "./geometry-selectors.js";
import { getSharedBorder, getTerritoryArea } from "../map/grid-map.js";
import { beginScoring } from "../scoring/scoring.js";

export interface PotentialBasicActions {
  readonly canOpenAuction: boolean;
  readonly canStartWar: boolean;
}

export type ActionTargetReadState = Pick<GameState, "map" | "territories">;

/** Returns legal neutral targets for an opener without deciding the action itself. */
export function getPotentialAuctionTerritoryIds(state: ActionTargetReadState, playerId: PlayerId): TerritoryId[] {
  const own = state.territories.filter((territory) => territory.ownerId === playerId);
  return state.territories
    .filter((target) => target.ownerId === null && own.some((source) =>
      areStateTerritoriesAdjacent(state, source.id, target.id)))
    .map((territory) => territory.id);
}

export interface PotentialWarTarget {
  readonly attackerTerritoryId: TerritoryId;
  readonly defenderTerritoryId: TerritoryId;
}

/** Returns only pairs which may still fight in this round. */
export function getPotentialWarTargets(state: ActionTargetReadState, playerId: PlayerId): PotentialWarTarget[] {
  const own = state.territories.filter((territory) => territory.ownerId === playerId && !territory.participatedInWarThisRound);
  const opponents = state.territories.filter((territory) => territory.ownerId !== null && territory.ownerId !== playerId && !territory.participatedInWarThisRound);
  return own.flatMap((attacker) => opponents
    .filter((defender) => areStateTerritoriesAdjacent(state, attacker.id, defender.id))
    .map((defender) => ({ attackerTerritoryId: attacker.id, defenderTerritoryId: defender.id })));
}

export function getPotentialBasicActions(state: ActionTargetReadState, playerId: PlayerId): PotentialBasicActions {
  return {
    canOpenAuction: getPotentialAuctionTerritoryIds(state, playerId).length > 0,
    canStartWar: getPotentialWarTargets(state, playerId).length > 0,
  };
}

function actionPhaseFor(state: GameState) {
  return state.actionPhase ?? {
    completedPlayerIds: [],
    auctionsOpenedByActivePlayer: 0 as const,
    secondAuctionAvailable: false,
  };
}

function playerHasPendingActivation(state: GameState, playerId: PlayerId): boolean {
  const pending = new Set(state.activation?.pendingTerritoryIds ?? []);
  return state.territories.some((territory) => territory.ownerId === playerId && pending.has(territory.id));
}

function finalizeAdvancedState(
  previous: GameState,
  advanced: GameState,
  timestamp: string,
  descriptions: readonly EventDescription[],
): ActionResult {
  const events = createEvents(previous, timestamp, descriptions);
  const withEvents: GameState = { ...advanced, events: [...previous.events, ...events] };
  if (withEvents.phase !== GamePhase.Scoring) return { state: withEvents, events };
  const scoring = beginScoring(withEvents, timestamp);
  return { state: scoring.state, events: [...events, ...scoring.events] };
}

/**
 * Completes a player's regular action and hands the turn to the next player's
 * personal activation. A player without a matching card immediately receives
 * their regular action instead.
 */
function advanceToNextPlayer(
  state: GameState,
  timestamp: string,
  descriptions: readonly EventDescription[],
): ActionResult {
  const actionPhase = actionPhaseFor(state);
  const order = getPlayerOrderFromStartPlayer(state.players.map((player) => player.id), state.startPlayerId);
  const nextPlayerId = order.find((playerId) => !actionPhase.completedPlayerIds.includes(playerId));
  if (nextPlayerId === undefined) {
    const finalRound = state.round === state.maxRounds;
    const next = {
      ...state,
      phase: finalRound ? GamePhase.Scoring : GamePhase.RoundReady,
      activePlayerId: undefined,
      actionPhase: {
        completedPlayerIds: actionPhase.completedPlayerIds,
        auctionsOpenedByActivePlayer: 0 as const,
        secondAuctionAvailable: false,
      },
      spadeActivations: [],
    };
    return finalizeAdvancedState(state, next, timestamp, [
      ...descriptions,
      { type: GameEventType.ActionPhaseFinished, payload: { round: state.round } },
      { type: GameEventType.RoundFinished, payload: { round: state.round } },
      ...(finalRound ? [{ type: GameEventType.ScoringStarted, payload: { round: state.round } }] : []),
    ]);
  }

  const next = {
    ...state,
    phase: GamePhase.ActivationPhase,
    activePlayerId: nextPlayerId,
    actionPhase: {
      completedPlayerIds: actionPhase.completedPlayerIds,
      auctionsOpenedByActivePlayer: 0 as const,
      secondAuctionAvailable: false,
    },
  };
  const transitioned = finalizeAdvancedState(state, next, timestamp, descriptions);
  if (playerHasPendingActivation(transitioned.state, nextPlayerId)) return transitioned;
  const action = beginActionPhase(transitioned.state, timestamp);
  return { state: action.state, events: [...transitioned.events, ...action.events] };
}

/**
 * Starts the active player's regular action after only that player's pending
 * activations have resolved. The shared round action state remains intact
 * while players alternate between activation and basic action.
 */
export function beginActionPhase(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActivationPhase || state.activePlayerId === undefined ||
      state.pendingDiamondBorderChanges.length !== 0 || state.auction !== undefined || state.pendingSplit !== undefined ||
      playerHasPendingActivation(state, state.activePlayerId)) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const playerId = state.activePlayerId;
  const actionPhase = actionPhaseFor(state);
  if (actionPhase.completedPlayerIds.includes(playerId)) throw new DomainError(DomainErrorCode.ActionAlreadyCompleted);
  const provisional: GameState = {
    ...state,
    phase: GamePhase.ActionPhase,
    actionPhase: {
      completedPlayerIds: actionPhase.completedPlayerIds,
      auctionsOpenedByActivePlayer: 0,
      secondAuctionAvailable: false,
    },
  };
  const descriptions: EventDescription[] = [
    { type: GameEventType.ActionPhaseStarted, actorId: playerId, payload: { round: state.round, playerId } },
  ];
  const potential = getPotentialBasicActions(provisional, playerId);
  if (potential.canOpenAuction || potential.canStartWar) return finalizeAdvancedState(state, provisional, timestamp, descriptions);
  const completed: GameState = {
    ...provisional,
    actionPhase: {
      ...provisional.actionPhase!,
      completedPlayerIds: [...actionPhase.completedPlayerIds, playerId],
    },
  };
  return advanceToNextPlayer(completed, timestamp, [...descriptions, {
    type: GameEventType.ActionForfeited,
    actorId: playerId,
    payload: { round: state.round, playerId, reason: "NO_LEGAL_BASIC_ACTION" },
  }]);
}

/** Completes the active player's regular action after all resulting choices resolve. */
export function finishCurrentBasicAction(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined || state.activePlayerId === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.AuctionAlreadyActive);
  }
  const playerId = state.activePlayerId;
  if (state.actionPhase.completedPlayerIds.includes(playerId)) throw new DomainError(DomainErrorCode.ActionAlreadyCompleted);
  if (state.actionPhase.currentActionKind === undefined && state.actionPhase.auctionsOpenedByActivePlayer === 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const completed: GameState = {
    ...state,
    actionPhase: {
      ...state.actionPhase,
      completedPlayerIds: [...state.actionPhase.completedPlayerIds, playerId],
    },
  };
  return advanceToNextPlayer(completed, timestamp, [{
    type: GameEventType.ActionCompleted,
    actorId: playerId,
    payload: { round: state.round, playerId },
  }]);
}

/** For a player who has neither an auction target nor a potential war target. */
export function forfeitCurrentBasicAction(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.activePlayerId === undefined || state.actionPhase === undefined ||
      state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const playerId = state.activePlayerId;
  const potential = getPotentialBasicActions(state, playerId);
  if (potential.canOpenAuction || potential.canStartWar) throw new DomainError(DomainErrorCode.LegalActionAvailable);
  const completed: GameState = {
    ...state,
    actionPhase: {
      ...state.actionPhase,
      completedPlayerIds: [...state.actionPhase.completedPlayerIds, playerId],
    },
  };
  return advanceToNextPlayer(completed, timestamp, [{
    type: GameEventType.ActionForfeited,
    actorId: playerId,
    payload: { round: state.round, playerId, reason: "NO_LEGAL_BASIC_ACTION" },
  }]);
}

export function startPendingWar(state: GameState, action: StartWarAction, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined || state.activePlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.NotActivePlayer);
  }
  if (state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined ||
      state.actionPhase.auctionsOpenedByActivePlayer !== 0 || state.actionPhase.currentActionKind !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const attacker = state.territories.find((territory) => territory.id === action.attackerTerritoryId);
  const defender = state.territories.find((territory) => territory.id === action.defenderTerritoryId);
  if (attacker?.ownerId !== action.playerId || defender?.ownerId === null || defender?.ownerId === undefined ||
      defender.ownerId === action.playerId || !areStateTerritoriesAdjacent(state, attacker.id, defender.id)) {
    throw new DomainError(DomainErrorCode.InvalidWarTarget);
  }
  if (attacker.participatedInWarThisRound || defender.participatedInWarThisRound || state.map === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryAlreadyInWar);
  }
  const mark = state.borderMarks.find((item) => item.territoryIds.includes(attacker.id) && item.territoryIds.includes(defender.id));
  const warId = `${state.gameId}:war:${state.events.length + 1}`;
  const events = createEvents(state, timestamp, [{
    type: GameEventType.WarStarted,
    actorId: action.playerId,
    payload: { playerId: action.playerId, attackerTerritoryId: attacker.id, defenderPlayerId: defender.ownerId,
      defenderTerritoryId: defender.id, warId },
  }]);
  return {
    state: {
      ...state,
      pendingWar: {
        id: warId,
        attackerPlayerId: action.playerId,
        defenderPlayerId: defender.ownerId,
        attackerTerritoryId: attacker.id,
        defenderTerritoryId: defender.id,
        stage: "AWAITING_COMBAT_CHOICES",
        attackerArea: getTerritoryArea(state.map, attacker.id),
        defenderArea: getTerritoryArea(state.map, defender.id),
        originalSharedBorder: getSharedBorder(state.map, attacker.id, defender.id),
        ...(mark === undefined ? {} : { borderMark: { id: mark.id, playerId: mark.playerId } }),
        spadeChoices: {},
      },
      borderMarks: mark === undefined ? state.borderMarks : state.borderMarks.filter((item) => item.id !== mark.id),
      territories: state.territories.map((territory) => territory.id === attacker.id || territory.id === defender.id
        ? { ...territory, participatedInWarThisRound: true } : territory),
      actionPhase: { ...state.actionPhase, currentActionKind: "WAR" },
      events: [...state.events, ...events],
    },
    events,
  };
}
