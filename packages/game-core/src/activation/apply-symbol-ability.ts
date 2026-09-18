import type { ActivateTerritoryAction } from "../actions/game-action.js";
import { GameEventType } from "../events/game-event.js";
import type { EventDescription } from "../events/create-events.js";
import { getCanonicalBorderId, type BorderMark } from "../model/border-mark.js";
import type { TerritoryId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import { Suit } from "../model/territory-card.js";
import { SettlementKind, type Territory } from "../model/territory.js";
import type { GameState } from "../state/game-state.js";
import type { CardSource } from "../utils/card-source.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import { areStateTerritoriesAdjacent } from "../state/geometry-selectors.js";
import { getGridCellTerritory, isCellInsideMap } from "../map/grid-map.js";

export interface SymbolAbilityContext {
  readonly randomSource: RandomSource;
  readonly cardSource?: CardSource;
  readonly effectId: string;
}

export interface SymbolAbilityResult {
  readonly state: GameState;
  readonly event: EventDescription;
}

export { getCanonicalBorderId };

function getSourceTerritory(state: GameState, action: ActivateTerritoryAction): Territory {
  const source = state.territories.find((territory) => territory.id === action.territoryId);
  if (source === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  if (source.ownerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.TerritoryNotOwned);
  }
  if (source.card === undefined) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }
  return source;
}

function getAdjacentTarget(
  state: GameState,
  source: Territory,
  targetId: TerritoryId,
  errorCode: DomainErrorCode,
): Territory {
  const target = state.territories.find((territory) => territory.id === targetId);
  if (target === undefined || !areStateTerritoriesAdjacent(state, source.id, targetId)) {
    throw new DomainError(errorCode);
  }
  return target;
}

function getDevelopmentTarget(
  state: GameState,
  source: Territory,
  targetId: TerritoryId,
  playerId: string,
): Territory {
  const target = state.territories.find((territory) => territory.id === targetId);
  if (
    target === undefined ||
    target.ownerId !== playerId ||
    (targetId !== source.id && !areStateTerritoriesAdjacent(state, source.id, targetId)) ||
    target.card === undefined
  ) {
    throw new DomainError(DomainErrorCode.InvalidDevelopmentTarget);
  }
  return target;
}

function replaceTerritory(state: GameState, updated: Territory): GameState {
  return {
    ...state,
    territories: state.territories.map((territory) =>
      territory.id === updated.id ? updated : territory,
    ),
  };
}

function replacePlayer(state: GameState, updated: Player): GameState {
  return {
    ...state,
    players: state.players.map((player) => player.id === updated.id ? updated : player),
  };
}

function describe(
  type: GameEventType,
  action: ActivateTerritoryAction,
  payload: Readonly<Record<string, unknown>>,
): EventDescription {
  return {
    type,
    actorId: action.playerId,
    payload: { playerId: action.playerId, territoryId: action.territoryId, ...payload },
  };
}

function assertSuitIsOnCard(source: Territory, selectedSuit: Suit): void {
  if (
    source.card === undefined ||
    (selectedSuit !== source.card.suit && selectedSuit !== source.card.additionalSuit)
  ) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }
}

function assertNoSecondSpecialization(target: Territory): void {
  if (
    target.card?.additionalActivationNumber !== undefined ||
    target.card?.additionalSuit !== undefined
  ) {
    throw new DomainError(DomainErrorCode.SecondSpecializationAlreadyExists);
  }
}

function assertEffectIdUnused(state: GameState, effectId: string): void {
  if (
    effectId.length === 0 ||
    state.pendingDiamondBorderChanges.some((effect) => effect.id === effectId) ||
    state.spadeActivations.some((effect) => effect.id === effectId)
  ) {
    throw new DomainError(DomainErrorCode.InvalidActivationChoice);
  }
}

/** Applies exactly one chosen symbol effect, without changing the activation queue or event log. */
export function applySymbolAbility(
  state: GameState,
  action: ActivateTerritoryAction,
  selectedSuit: Suit,
  context: SymbolAbilityContext,
): SymbolAbilityResult {
  const source = getSourceTerritory(state, action);
  assertSuitIsOnCard(source, selectedSuit);

  switch (selectedSuit) {
    case Suit.Diamonds: {
      if (action.choice.type === "DIAMOND_NEUTRAL_BORDER") {
        const target = getAdjacentTarget(
          state, source, action.choice.targetTerritoryId,
          DomainErrorCode.InvalidBorderTarget,
        );
        if (target.ownerId !== null) {
          throw new DomainError(DomainErrorCode.InvalidBorderTarget);
        }
        assertEffectIdUnused(state, context.effectId);
        return {
          state: {
            ...state,
            pendingDiamondBorderChanges: [
              ...state.pendingDiamondBorderChanges,
              {
                id: context.effectId,
                playerId: action.playerId,
                sourceTerritoryId: source.id,
                neutralTerritoryId: target.id,
              },
            ],
          },
          event: describe(GameEventType.DiamondNeutralBorderChangePending, action, {
            targetTerritoryId: target.id,
            effectId: context.effectId,
          }),
        };
      }
      if (action.choice.type === "DIAMOND_MARK_BORDER") {
        const target = getAdjacentTarget(
          state, source, action.choice.targetTerritoryId,
          DomainErrorCode.InvalidBorderTarget,
        );
        if (target.ownerId === null || target.ownerId === action.playerId) {
          throw new DomainError(DomainErrorCode.InvalidBorderTarget);
        }
        const borderId = getCanonicalBorderId(source.id, target.id);
        if (
          state.borderMarks.some((mark) =>
            getCanonicalBorderId(mark.territoryIds[0], mark.territoryIds[1]) === borderId,
          )
        ) {
          throw new DomainError(DomainErrorCode.BorderAlreadyMarked);
        }
        const mark: BorderMark = {
          id: borderId,
          territoryIds: [source.id, target.id].sort() as [TerritoryId, TerritoryId],
          playerId: action.playerId,
        };
        return {
          state: { ...state, borderMarks: [...state.borderMarks, mark] },
          event: describe(GameEventType.DiamondBorderMarked, action, {
            targetTerritoryId: target.id,
            borderId,
          }),
        };
      }
      break;
    }
    case Suit.Clubs: {
      if (
        action.choice.type !== "CLUB_BUILD_SETTLEMENT" &&
        action.choice.type !== "CLUB_UPGRADE_CITY" &&
        action.choice.type !== "CLUB_ADD_ACTIVATION_NUMBER" &&
        action.choice.type !== "CLUB_ADD_SECOND_SUIT"
      ) {
        break;
      }
      const target = getDevelopmentTarget(
        state, source, action.choice.targetTerritoryId, action.playerId,
      );
      const targetCard = target.card;
      if (targetCard === undefined) {
        throw new DomainError(DomainErrorCode.InvalidDevelopmentTarget);
      }
      if (action.choice.type === "CLUB_BUILD_SETTLEMENT") {
        if (target.settlement !== undefined) {
          throw new DomainError(DomainErrorCode.InvalidDevelopmentTarget);
        }
        const position = action.choice.position;
        if (state.map !== undefined && (position === undefined || !isCellInsideMap(state.map, position) ||
            getGridCellTerritory(state.map, position) !== target.id)) {
          throw new DomainError(DomainErrorCode.InvalidDevelopmentTarget);
        }
        return {
          state: replaceTerritory(state, {
            ...target,
            settlement: SettlementKind.Settlement,
            ...(position === undefined ? {} : {
              settlementFeature: { id: `settlement:${target.id}`, kind: SettlementKind.Settlement, position },
            }),
          }),
          event: describe(GameEventType.ClubSettlementCreated, action, {
            targetTerritoryId: target.id,
          }),
        };
      }
      if (action.choice.type === "CLUB_UPGRADE_CITY") {
        if (target.settlement !== SettlementKind.Settlement) {
          throw new DomainError(DomainErrorCode.InvalidDevelopmentTarget);
        }
        return {
          state: replaceTerritory(state, {
            ...target,
            settlement: SettlementKind.City,
            ...(target.settlementFeature === undefined ? {} : {
              settlementFeature: { ...target.settlementFeature, kind: SettlementKind.City },
            }),
          }),
          event: describe(GameEventType.ClubCityCreated, action, {
            targetTerritoryId: target.id,
          }),
        };
      }
      assertNoSecondSpecialization(target);
      if (action.choice.type === "CLUB_ADD_SECOND_SUIT") {
        const additionalSuit = action.choice.suit;
        if (!Object.values(Suit).includes(additionalSuit) || additionalSuit === targetCard.suit) {
          throw new DomainError(DomainErrorCode.InvalidSuitSelection);
        }
        return {
          state: replaceTerritory(state, {
            ...target,
            card: {
              suit: targetCard.suit,
              activationNumber: targetCard.activationNumber,
              additionalSuit,
            },
          }),
          event: describe(GameEventType.ClubSecondSuitAdded, action, {
            targetTerritoryId: target.id,
            suit: additionalSuit,
          }),
        };
      }
      if (context.cardSource === undefined) {
        throw new DomainError(DomainErrorCode.CardSourceRequired);
      }
      let additionalActivationNumber: number;
      do {
        const drawnCard = context.cardSource.drawAndReplace(context.randomSource);
        additionalActivationNumber = drawnCard.activationNumber;
        if (
          !Number.isInteger(additionalActivationNumber) ||
          additionalActivationNumber < 1 || additionalActivationNumber > 12
        ) {
          throw new DomainError(DomainErrorCode.InvalidDrawnCard);
        }
      } while (additionalActivationNumber === targetCard.activationNumber);
      return {
        state: replaceTerritory(state, {
          ...target,
          card: {
            suit: targetCard.suit,
            activationNumber: targetCard.activationNumber,
            additionalActivationNumber,
          },
        }),
        event: describe(GameEventType.ClubActivationNumberAdded, action, {
          targetTerritoryId: target.id,
          activationNumber: additionalActivationNumber,
        }),
      };
    }
    case Suit.Hearts: {
      if (action.choice.type === "HEART_GLOBAL_INFLUENCE") {
        const player = state.players.find((candidate) => candidate.id === action.playerId);
        if (player?.globalInfluence === undefined) {
          throw new DomainError(DomainErrorCode.GlobalInfluenceUnavailable);
        }
        return {
          state: replacePlayer(state, { ...player, globalInfluence: player.globalInfluence + 1 }),
          event: describe(GameEventType.HeartGlobalInfluenceGained, action, { amount: 1 }),
        };
      }
      if (action.choice.type === "HEART_LOCAL_INFLUENCE") {
        const target = getAdjacentTarget(
          state, source, action.choice.targetTerritoryId,
          DomainErrorCode.InvalidLocalInfluenceTarget,
        );
        const current = target.localInfluenceByPlayerId?.[action.playerId] ?? 0;
        if (target.ownerId !== null || !Number.isInteger(current) || current < 0 || current + 2 > 2) {
          throw new DomainError(DomainErrorCode.InvalidLocalInfluenceTarget);
        }
        return {
          state: replaceTerritory(state, {
            ...target,
            localInfluenceByPlayerId: {
              ...target.localInfluenceByPlayerId,
              [action.playerId]: current + 2,
            },
          }),
          event: describe(GameEventType.HeartLocalInfluenceAdded, action, {
            targetTerritoryId: target.id,
            amount: 2,
          }),
        };
      }
      break;
    }
    case Suit.Spades: {
      if (action.choice.type !== "SPADE_STORE") {
        break;
      }
      assertEffectIdUnused(state, context.effectId);
      return {
        state: {
          ...state,
          spadeActivations: [
            ...state.spadeActivations,
            {
              id: context.effectId,
              playerId: action.playerId,
              sourceTerritoryId: source.id,
              status: "AVAILABLE",
            },
          ],
        },
        event: describe(GameEventType.SpadeActivationStored, action, {
          effectId: context.effectId,
        }),
      };
    }
  }

  throw new DomainError(DomainErrorCode.InvalidActivationChoice);
}
