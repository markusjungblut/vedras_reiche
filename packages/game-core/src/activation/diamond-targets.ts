import type { TerritoryId } from "../model/ids.js";
import { Suit } from "../model/territory-card.js";
import type { GameState } from "../state/game-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";

export interface DiamondTargets {
  readonly neutralTerritoryIds: readonly TerritoryId[];
  readonly opponentTerritoryIds: readonly TerritoryId[];
}

/** Logical candidates only; neutral geometry still needs a separate map decision. */
export function getDiamondTargets(state: GameState, sourceTerritoryId: TerritoryId): DiamondTargets {
  const source = state.territories.find((territory) => territory.id === sourceTerritoryId);
  if (source === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  if (source.ownerId === null) {
    throw new DomainError(DomainErrorCode.TerritoryNotOwned);
  }
  if (source.card?.suit !== Suit.Diamonds && source.card?.additionalSuit !== Suit.Diamonds) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }

  const neighbors = state.territories.filter((territory) =>
    source.adjacentTerritoryIds.includes(territory.id),
  );
  return {
    neutralTerritoryIds: neighbors.filter((territory) => territory.ownerId === null).map((territory) => territory.id),
    opponentTerritoryIds: neighbors
      .filter((territory) => territory.ownerId !== null && territory.ownerId !== source.ownerId)
      .map((territory) => territory.id),
  };
}
