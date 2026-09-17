import type { ActionResult } from "../actions/action-result.js";
import { GameActionType, type ActivateTerritoryAction, type GameAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { getPlayerOrderFromStartPlayer } from "../rules/player-order.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import type { CardSource } from "../utils/card-source.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import { applySymbolAbility } from "./apply-symbol-ability.js";

export interface ActivationContext {
  readonly randomSource: RandomSource;
  readonly cardSource?: CardSource;
  readonly timestamp: string;
}

function nextPlayerWithPending(
  state: GameState,
  pendingTerritoryIds: readonly TerritoryId[],
): PlayerId | undefined {
  const pending = new Set(pendingTerritoryIds);
  const owners = new Set(
    state.territories.filter((territory) => pending.has(territory.id)).map((territory) => territory.ownerId),
  );
  const order = getPlayerOrderFromStartPlayer(
    state.players.map((player) => player.id),
    state.startPlayerId,
  );
  return order.find((playerId) => owners.has(playerId));
}

export function activateTerritory(
  state: GameState,
  action: ActivateTerritoryAction,
  context: ActivationContext,
): ActionResult {
  if (state.phase !== GamePhase.ActivationPhase || state.activation === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.activePlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.NotActivePlayer);
  }

  const territory = state.territories.find((candidate) => candidate.id === action.territoryId);
  if (territory === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  if (territory.ownerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.TerritoryNotOwned);
  }
  if (state.activation.resolvedTerritoryIds.includes(action.territoryId)) {
    throw new DomainError(DomainErrorCode.TerritoryAlreadyActivated);
  }
  if (!state.activation.pendingTerritoryIds.includes(action.territoryId) || territory.card === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotActivated);
  }

  const { suit, additionalSuit } = territory.card;
  if (additionalSuit !== undefined && action.selectedSuit === undefined) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }
  const selectedSuit = action.selectedSuit ?? suit;
  if (selectedSuit !== suit && selectedSuit !== additionalSuit) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }

  const effectId = `${state.gameId}:event:${state.events.length + 2}`;
  const effect = applySymbolAbility(state, action, selectedSuit, {
    randomSource: context.randomSource,
    ...(context.cardSource === undefined ? {} : { cardSource: context.cardSource }),
    effectId,
  });
  const pendingTerritoryIds = state.activation.pendingTerritoryIds.filter((id) => id !== action.territoryId);
  const resolvedTerritoryIds = [...state.activation.resolvedTerritoryIds, action.territoryId];
  const activePlayerId = nextPlayerWithPending(effect.state, pendingTerritoryIds);
  const finished = activePlayerId === undefined;
  const descriptions: EventDescription[] = [
    {
      type: GameEventType.TerritoryActivationStarted,
      actorId: action.playerId,
      payload: { playerId: action.playerId, territoryId: action.territoryId, selectedSuit },
    },
    effect.event,
    {
      type: GameEventType.TerritoryActivated,
      actorId: action.playerId,
      payload: { playerId: action.playerId, territoryId: action.territoryId, selectedSuit },
    },
  ];
  if (finished) {
    descriptions.push(
      { type: GameEventType.ActivationPhaseFinished, payload: { round: state.round } },
      { type: GameEventType.ActionPhaseStarted, payload: { round: state.round } },
    );
  }
  const newEvents = createEvents(state, context.timestamp, descriptions);
  const nextState: GameState = {
    ...effect.state,
    phase: finished ? GamePhase.ActionPhase : GamePhase.ActivationPhase,
    activation: { pendingTerritoryIds, resolvedTerritoryIds },
    activePlayerId,
    events: [...state.events, ...newEvents],
  };
  return { state: nextState, events: newEvents };
}

/** Only activation is executable in AP2; auction and war actions remain placeholders. */
export function applyAction(
  state: GameState,
  action: GameAction,
  context: ActivationContext,
): ActionResult {
  if (action.type === GameActionType.ActivateTerritory) {
    return activateTerritory(state, action, context);
  }
  throw new DomainError(DomainErrorCode.UnsupportedAction);
}
