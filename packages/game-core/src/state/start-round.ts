import type { ActionResult } from "../actions/action-result.js";
import type { RollNextActivationNumberAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId } from "../model/ids.js";
import { getActivatedTerritories } from "../rules/activated-territories.js";
import { rollActivationNumber } from "../rules/activation-numbers.js";
import { getNextPlayer, getPlayerOrderFromStartPlayer, selectInitialStartPlayer } from "../rules/player-order.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import { beginActionPhase } from "./action-phase.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";

/**
 * Begins a round only after start auctions or the previous full action phase is complete.
 */
export function startRound(
  state: GameState,
  randomSource: RandomSource,
  timestamp: string,
): ActionResult {
  const firstRound = state.round === 0;
  if (state.phase !== GamePhase.RoundReady ||
      state.auction !== undefined || state.pendingSplit !== undefined || state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (firstRound) {
    if (state.startAuctions?.round !== 2 ||
        state.startAuctions.awardedPlayerIds.length !== state.players.length) {
      throw new DomainError(DomainErrorCode.InvalidStartAuctionState);
    }
  } else if (state.actionPhase?.completedPlayerIds.length !== state.players.length) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.round >= state.maxRounds) {
    throw new DomainError(DomainErrorCode.MaxRoundsReached);
  }

  const playerOrder = state.players.map((player) => player.id);
  const startPlayerId = firstRound
    ? selectInitialStartPlayer(playerOrder, randomSource)
    : getNextPlayer(playerOrder, state.startPlayerId);
  const territories = state.territories.map((territory) =>
    territory.participatedInWarThisRound || territory.warParticipationCountThisRound !== undefined || territory.warsInitiatedThisRound !== undefined || territory.warParticipationLockedThisRound
      ? { ...territory, participatedInWarThisRound: false, warParticipationCountThisRound: 0, warsInitiatedThisRound: 0, warParticipationLockedThisRound: false }
      : territory,
  );
  const nextRound = state.round + 1;
  const descriptions: EventDescription[] = [
    {
      type: firstRound ? GameEventType.StartPlayerSelected : GameEventType.StartPlayerRotated,
      payload: firstRound
        ? { playerId: startPlayerId }
        : { previousPlayerId: state.startPlayerId, playerId: startPlayerId },
    },
    { type: GameEventType.RoundStarted, payload: { round: nextRound, startPlayerId } },
    { type: GameEventType.ActivationPhaseStarted, payload: { round: nextRound } },
  ];
  const events = createEvents(state, timestamp, descriptions);
  const nextState: GameState = {
    ...state,
    phase: GamePhase.ActivationPhase,
    round: nextRound,
    startPlayerId,
    territories,
    activationNumbers: [],
    activation: { pendingTerritoryIds: [], resolvedTerritoryIds: [], activatedTerritoryIdsThisRound: [], nextActivationIndex: 0 },
    actionPhase: {
      completedPlayerIds: [],
      auctionsOpenedByActivePlayer: 0,
      secondAuctionAvailable: false,
    },
    spadeActivations: [],
    lastWarResult: undefined,
    events: [...state.events, ...events],
    activePlayerId: startPlayerId,
  };
  return { state: nextState, events };
}

function activatedThisRound(state: GameState): readonly string[] {
  return state.activation?.activatedTerritoryIdsThisRound ?? state.activation?.resolvedTerritoryIds ?? [];
}

/** Finds the next owner with a captured candidate, clockwise from the start player. */
export function getNextActivationResolverPlayer(
  state: Pick<GameState, "players" | "startPlayerId" | "territories">,
  pendingTerritoryIds: readonly string[],
  afterPlayerId?: PlayerId,
): PlayerId | undefined {
  const order = getPlayerOrderFromStartPlayer(state.players.map((player) => player.id), state.startPlayerId);
  const startIndex = afterPlayerId === undefined ? 0 : (order.indexOf(afterPlayerId) + 1) % order.length;
  for (let offset = 0; offset < order.length; offset += 1) {
    const playerId = order[(startIndex + offset) % order.length]!;
    if (state.territories.some((territory) => territory.ownerId === playerId && pendingTerritoryIds.includes(territory.id))) return playerId;
  }
  return undefined;
}

/** Rolls one number and freezes the set of territories that may resolve for it. */
export function rollNextActivationNumber(
  state: GameState,
  action: RollNextActivationNumberAction,
  randomSource: RandomSource,
  timestamp: string,
): ActionResult {
  const activation = state.activation;
  if (state.phase !== GamePhase.ActivationPhase || activation === undefined ||
      state.activePlayerId !== state.startPlayerId || action.playerId !== state.startPlayerId ||
      activation.pendingTerritoryIds.length !== 0 || state.pendingDiamondBorderChanges.length !== 0 ||
      state.activationNumbers.length >= 3) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  let activationNumber = rollActivationNumber(randomSource);
  while (state.activationNumbers.includes(activationNumber)) activationNumber = rollActivationNumber(randomSource);
  const activationNumbers = [...state.activationNumbers, activationNumber];
  const pendingTerritoryIds = getActivatedTerritories(state, [activationNumber], activatedThisRound(state));
  const nextActivationIndex = activationNumbers.length;
  const activePlayerId = getNextActivationResolverPlayer(state, pendingTerritoryIds) ?? state.startPlayerId;
  const events = createEvents(state, timestamp, [{
    type: GameEventType.ActivationNumberRolled,
    actorId: action.playerId,
    payload: { round: state.round, activationNumber, index: nextActivationIndex - 1, activationNumbers, pendingTerritoryIds },
  }]);
  const rolledState: GameState = {
    ...state,
    activationNumbers,
    activation: { ...activation, pendingTerritoryIds, nextActivationIndex, currentActivationNumber: activationNumber,
      activatedTerritoryIdsThisRound: activatedThisRound(state) },
    activePlayerId,
    events: [...state.events, ...events],
  };
  if (pendingTerritoryIds.length === 0) {
    const completed = completeActivationStep(rolledState, timestamp);
    return { state: completed.state, events: [...events, ...completed.events] };
  }
  return { state: rolledState, events };
}

/** Moves to the next roll only after the frozen set for the current number has resolved. */
export function completeActivationStep(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.ActivationPhase || state.activation === undefined ||
      state.activation.pendingTerritoryIds.length !== 0 || state.pendingDiamondBorderChanges.length !== 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.activationNumbers.length < 3) {
    const { currentActivationNumber: _currentActivationNumber, ...waitingActivation } = state.activation;
    return { state: { ...state, activePlayerId: state.startPlayerId, activation: waitingActivation }, events: [] };
  }
  const events = createEvents(state, timestamp, [{ type: GameEventType.ActivationPhaseFinished, payload: { round: state.round } }]);
  const { currentActivationNumber: _currentActivationNumber, ...completedActivation } = state.activation;
  const completed = { ...state, activePlayerId: state.startPlayerId,
    activation: completedActivation, events: [...state.events, ...events] };
  const actionPhase = beginActionPhase(completed, timestamp);
  return { state: actionPhase.state, events: [...events, ...actionPhase.events] };
}
