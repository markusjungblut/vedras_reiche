import type { TerritoryId } from "../model/ids.js";
import type { Territory } from "../model/territory.js";
import { getStateTerritoryArea, type GeometryReadState } from "../state/geometry-selectors.js";
import { getLargeTerritoryThreshold } from "./territory-size.js";

export type WarParticipationReadState = GeometryReadState;

export type WarParticipationBlockReason =
  | "NORMAL_TERRITORY_LIMIT"
  | "LARGE_TERRITORY_LIMIT"
  | "LARGE_TERRITORY_INITIATOR_LIMIT";

export interface WarParticipationCheck {
  readonly allowed: boolean;
  readonly reason?: WarParticipationBlockReason;
}

/** Reads legacy snapshots as one completed participation until their next round reset. */
export function getWarParticipationCount(territory: Territory): number {
  const count = territory.warParticipationCountThisRound;
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : territory.participatedInWarThisRound ? 1 : 0;
}

export function getWarsInitiatedCount(territory: Territory): number {
  const count = territory.warsInitiatedThisRound;
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function isLargeTerritory(state: WarParticipationReadState, territoryId: TerritoryId): boolean {
  if (state.map === undefined) return false;
  return getStateTerritoryArea(state, territoryId) >= getLargeTerritoryThreshold(state.map);
}

export function getWarParticipationLimit(state: WarParticipationReadState, territoryId: TerritoryId): number {
  return isLargeTerritory(state, territoryId) ? 2 : 1;
}

export function canTerritoryParticipateInWar(state: WarParticipationReadState, territoryId: TerritoryId): WarParticipationCheck {
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (territory === undefined) return { allowed: false, reason: "NORMAL_TERRITORY_LIMIT" };
  if (territory.warParticipationLockedThisRound) return { allowed: false, reason: "NORMAL_TERRITORY_LIMIT" };
  if (getWarParticipationCount(territory) < getWarParticipationLimit(state, territoryId)) return { allowed: true };
  return { allowed: false, reason: isLargeTerritory(state, territoryId) ? "LARGE_TERRITORY_LIMIT" : "NORMAL_TERRITORY_LIMIT" };
}

export function canTerritoryStartWar(state: WarParticipationReadState, territoryId: TerritoryId): WarParticipationCheck {
  const participation = canTerritoryParticipateInWar(state, territoryId);
  if (!participation.allowed) return participation;
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (territory !== undefined && getWarsInitiatedCount(territory) >= 1) {
    return { allowed: false, reason: "LARGE_TERRITORY_INITIATOR_LIMIT" };
  }
  return { allowed: true };
}

export function recordWarParticipation(territory: Territory, initiated: boolean): Territory {
  return {
    ...territory,
    participatedInWarThisRound: true,
    warParticipationCountThisRound: getWarParticipationCount(territory) + 1,
    warsInitiatedThisRound: getWarsInitiatedCount(territory) + (initiated ? 1 : 0),
  };
}

/** Cut-and-choose creates new territories, which retain the legacy round lock. */
export function lockTerritoryAfterWarCut(territory: Territory): Territory {
  return {
    ...territory,
    participatedInWarThisRound: true,
    warParticipationCountThisRound: getWarParticipationCount(territory),
    warsInitiatedThisRound: getWarsInitiatedCount(territory),
    warParticipationLockedThisRound: true,
  };
}
