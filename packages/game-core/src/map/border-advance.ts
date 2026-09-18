import type { TerritoryId } from "../model/ids.js";
import { getMinimumTerritoryArea } from "../rules/territory-size.js";
import {
  areCellsOrthogonallyConnected, fromCellKey, getGridCellTerritory,
  getOrthogonalNeighbors, getTerritoryCells, toCellKey,
  type GridCell, type GridMapState, type SharedBorder,
} from "./grid-map.js";

export interface BorderAdvanceValidation {
  readonly valid: boolean;
  readonly reason?: "OUTSIDE_CORRIDOR" | "DUPLICATE_CELL" | "BELOW_MINIMUM_AREA" | "TERRITORY_DISCONNECTED";
  readonly corridor: readonly GridCell[];
  readonly map?: GridMapState;
}

/** Depth is measured only through the original losing territory, from its original shared front. */
export function getCellsWithinBorderDepth(
  map: GridMapState, loserId: TerritoryId, border: SharedBorder, maximumDepth: number,
): GridCell[] {
  if (maximumDepth < 1) return [];
  const seeds = border.segments.map((segment) =>
    border.territoryAId === loserId ? segment.cell : segment.neighbor);
  const depth = new Map<string, number>();
  const queue: GridCell[] = [];
  for (const cell of seeds) {
    if (getGridCellTerritory(map, cell) !== loserId) continue;
    const key = toCellKey(cell);
    if (!depth.has(key)) { depth.set(key, 1); queue.push(cell); }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index]!;
    const nextDepth = depth.get(toCellKey(cell))! + 1;
    if (nextDepth > maximumDepth) continue;
    for (const neighbor of getOrthogonalNeighbors(map, cell)) {
      const key = toCellKey(neighbor);
      if (getGridCellTerritory(map, neighbor) !== loserId || depth.has(key)) continue;
      depth.set(key, nextDepth);
      queue.push(neighbor);
    }
  }
  return [...depth.keys()].map(fromCellKey);
}

/** A proposal changes only the two incident territories. Empty proposals are legal. */
export function validateBorderAdvance(
  map: GridMapState, winnerId: TerritoryId, loserId: TerritoryId,
  originalBorder: SharedBorder, maximumDepth: number, claimedCells: readonly GridCell[],
): BorderAdvanceValidation {
  const corridor = getCellsWithinBorderDepth(map, loserId, originalBorder, maximumDepth);
  if (winnerId === loserId) return { valid: false, reason: "OUTSIDE_CORRIDOR", corridor };
  const allowed = new Set(corridor.map(toCellKey));
  const keys = claimedCells.map(toCellKey);
  if (new Set(keys).size !== keys.length) return { valid: false, reason: "DUPLICATE_CELL", corridor };
  if (keys.some((key) => !allowed.has(key) || map.cells[key] !== loserId)) {
    return { valid: false, reason: "OUTSIDE_CORRIDOR", corridor };
  }
  const cells = { ...map.cells };
  for (const key of keys) cells[key] = winnerId;
  const changed = { ...map, cells };
  const minimumArea = getMinimumTerritoryArea(map.format);
  if (getTerritoryCells(changed, loserId).length < minimumArea ||
      getTerritoryCells(changed, winnerId).length < minimumArea) {
    return { valid: false, reason: "BELOW_MINIMUM_AREA", corridor };
  }
  if (!areCellsOrthogonallyConnected(getTerritoryCells(changed, loserId)) ||
      !areCellsOrthogonallyConnected(getTerritoryCells(changed, winnerId))) {
    return { valid: false, reason: "TERRITORY_DISCONNECTED", corridor };
  }
  return { valid: true, corridor, map: changed };
}

/** The rule's "entire front" has no unique raster construction. No weakening is inferred here. */
export function assessBorderAdvanceLimitation(
  _map: GridMapState, _winnerId: TerritoryId, _loserId: TerritoryId,
  _originalBorder: SharedBorder, _maximumDepth: number, _claimedCells: readonly GridCell[],
): { readonly limitedByMinimumArea: null; readonly limitedByGeometry: null; readonly determinate: false } {
  return { limitedByMinimumArea: null, limitedByGeometry: null, determinate: false };
}
