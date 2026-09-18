import type { ActionResult } from "../actions/action-result.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { getActivatedTerritories } from "../rules/activated-territories.js";
import { getNextPlayer, getPlayerOrderFromStartPlayer, selectInitialStartPlayer } from "../rules/player-order.js";
import { rollActivationNumbers } from "../rules/activation-numbers.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";
import { beginActionPhase } from "./action-phase.js";

function firstPlayerWithPendingTerritory(
  state: GameState,
  pendingTerritoryIds: readonly TerritoryId[],
  startPlayerId: PlayerId,
): PlayerId | undefined {
  const pending = new Set(pendingTerritoryIds);
  const owners = new Set(
    state.territories.filter((territory) => pending.has(territory.id)).map((territory) => territory.ownerId),
  );
  const order = getPlayerOrderFromStartPlayer(state.players.map((player) => player.id), startPlayerId);
  return order.find((playerId) => owners.has(playerId));
}

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
  const activationNumbers = rollActivationNumbers(randomSource);
  const territories = state.territories.map((territory) =>
    territory.participatedInWarThisRound
      ? { ...territory, participatedInWarThisRound: false }
      : territory,
  );
  const provisionalState: GameState = { ...state, territories };
  const pendingTerritoryIds = getActivatedTerritories(provisionalState, activationNumbers);
  const activePlayerId = firstPlayerWithPendingTerritory(provisionalState, pendingTerritoryIds, startPlayerId);
  const nextRound = state.round + 1;
  const descriptions: EventDescription[] = [
    {
      type: firstRound ? GameEventType.StartPlayerSelected : GameEventType.StartPlayerRotated,
      payload: firstRound
        ? { playerId: startPlayerId }
        : { previousPlayerId: state.startPlayerId, playerId: startPlayerId },
    },
    { type: GameEventType.RoundStarted, payload: { round: nextRound, startPlayerId } },
    { type: GameEventType.ActivationNumbersRolled, payload: { round: nextRound, activationNumbers } },
    { type: GameEventType.ActivationPhaseStarted, payload: { round: nextRound, pendingTerritoryIds } },
  ];

  if (activePlayerId === undefined) {
    descriptions.push({ type: GameEventType.ActivationPhaseFinished, payload: { round: nextRound } });
  }

  const newEvents = createEvents(state, timestamp, descriptions);
  const nextState: GameState = {
    ...state,
    phase: GamePhase.ActivationPhase,
    round: nextRound,
    startPlayerId,
    territories,
    activationNumbers,
    activation: { pendingTerritoryIds, resolvedTerritoryIds: [] },
    spadeActivations: [],
    lastWarResult: undefined,
    events: [...state.events, ...newEvents],
    ...(activePlayerId === undefined ? { activePlayerId: undefined } : { activePlayerId }),
  };

  if (activePlayerId === undefined) {
    const actionPhase = beginActionPhase(nextState, timestamp);
    return { state: actionPhase.state, events: [...newEvents, ...actionPhase.events] };
  }
  return { state: nextState, events: newEvents };
}
