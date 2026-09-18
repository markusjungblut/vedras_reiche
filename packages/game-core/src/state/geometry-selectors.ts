import type { GameState } from "./game-state.js";
import type { GridCell } from "../map/grid-map.js";
import {
  areTerritoriesAdjacent,
  getAdjacentTerritoryIds as getMapAdjacentTerritoryIds,
  getTerritoryArea as getMapTerritoryArea,
  getTerritoryCells,
} from "../map/grid-map.js";
import type { PointOfInterest } from "../model/point-of-interest.js";
import type { SettlementFeature } from "../model/territory.js";
import type { PointOfInterestId, TerritoryId } from "../model/ids.js";

export function getStateTerritoryCells(state: GameState, territoryId: TerritoryId): GridCell[] {
  return state.map ? getTerritoryCells(state.map, territoryId) : [];
}

export function getStateTerritoryArea(state: GameState, territoryId: TerritoryId): number {
  if (state.map) return getMapTerritoryArea(state.map, territoryId);
  return state.territories.find((territory) => territory.id === territoryId)?.area ?? 0;
}

export function getStateAdjacentTerritoryIds(state: GameState, territoryId: TerritoryId): TerritoryId[] {
  if (state.map) return getMapAdjacentTerritoryIds(state.map, territoryId);
  return state.territories.find((territory) => territory.id === territoryId)?.adjacentTerritoryIds
    ? [...state.territories.find((territory) => territory.id === territoryId)!.adjacentTerritoryIds!]
    : [];
}

export function areStateTerritoriesAdjacent(state: GameState, first: TerritoryId, second: TerritoryId): boolean {
  if (state.map) return areTerritoriesAdjacent(state.map, first, second);
  const left = state.territories.find((territory) => territory.id === first);
  const right = state.territories.find((territory) => territory.id === second);
  return Boolean(left?.adjacentTerritoryIds?.includes(second) || right?.adjacentTerritoryIds?.includes(first));
}

export function getPointOfInterestTerritory(
  state: GameState,
  poiOrId: PointOfInterest | PointOfInterestId,
): TerritoryId | undefined {
  const poi = typeof poiOrId === "string"
    ? state.pointsOfInterest.find((candidate) => candidate.id === poiOrId)
    : poiOrId;
  if (poi === undefined) return undefined;
  if (state.map) return state.map.cells[`${poi.position.x},${poi.position.y}`] ?? undefined;
  return poi.territoryId;
}

export function getSettlementTerritory(
  state: GameState,
  positionOrFeature: GridCell | SettlementFeature,
): TerritoryId | undefined {
  if (!state.map) return undefined;
  const position = "position" in positionOrFeature ? positionOrFeature.position : positionOrFeature;
  return state.map.cells[`${position.x},${position.y}`] ?? undefined;
}
