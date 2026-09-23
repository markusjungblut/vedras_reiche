import type { TerritoryId } from "../model/ids.js";
import { getMinimumTerritoryArea } from "../rules/territory-size.js";
import {
  areCellsOrthogonallyConnected, fromCellKey, getGridCellTerritory,
  getOrthogonalNeighbors, getTerritoryCells, toCellKey,
  type GridCell, type GridMapState, type SharedBorder,
} from "./grid-map.js";

export interface BorderAdvanceValidation {
  readonly valid: boolean;
  readonly reason?: "OUTSIDE_CORRIDOR" | "DUPLICATE_CELL" | "INVALID_DIRECT_TRANSFER" | "BELOW_MINIMUM_AREA" | "TERRITORY_DISCONNECTED" | "AMBIGUOUS_RETAINED_COMPONENT";
  readonly corridor: readonly GridCell[];
  readonly directTransferCells?: readonly GridCell[];
  readonly annexedDisconnectedCells?: readonly GridCell[];
  readonly map?: GridMapState;
}

export interface BorderAdvanceLimitation {
  readonly determinate: true;
  readonly limitedByMinimumArea: boolean;
  readonly limitedByGeometry: boolean;
  readonly limitedByTopology: boolean;
}

export interface BorderTransferResolution {
  readonly valid: boolean;
  readonly directTransferCells: readonly GridCell[];
  readonly annexedDisconnectedCells: readonly GridCell[];
  readonly allTransferCells: readonly GridCell[];
  readonly retainedDonorCells: readonly GridCell[];
  readonly reason?: "INVALID_DIRECT_TRANSFER" | "BELOW_MINIMUM_AREA" | "TERRITORY_DISCONNECTED" | "AMBIGUOUS_RETAINED_COMPONENT";
  readonly map?: GridMapState;
}

function connectedComponents(cells: readonly GridCell[]): GridCell[][] {
  const remaining = new Map(cells.map((cell) => [toCellKey(cell), cell]));
  const components: GridCell[][] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as GridCell;
    const component: GridCell[] = [];
    const queue = [start];
    remaining.delete(toCellKey(start));
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index]!;
      component.push(cell);
      for (const neighbor of [
        { x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
        { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 },
      ]) {
        const key = toCellKey(neighbor);
        const candidate = remaining.get(key);
        if (candidate !== undefined) {
          remaining.delete(key);
          queue.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Resolves a direct border transfer without mutating state. A donor may retain
 * only one unambiguous main component; every smaller disconnected remainder is
 * annexed by the recipient.
 */
export function resolveBorderTransferTopology(
  map: GridMapState, winnerId: TerritoryId, loserId: TerritoryId, directTransferCells: readonly GridCell[],
): BorderTransferResolution {
  const directKeys = new Set(directTransferCells.map(toCellKey));
  const base = { valid: false as const, directTransferCells, annexedDisconnectedCells: [] as GridCell[],
    allTransferCells: [...directTransferCells], retainedDonorCells: [] as GridCell[] };
  if (directKeys.size !== directTransferCells.length ||
      directTransferCells.some((cell) => getGridCellTerritory(map, cell) !== loserId)) {
    return { ...base, reason: "INVALID_DIRECT_TRANSFER" };
  }
  const donorCells = getTerritoryCells(map, loserId);
  const retainedCandidates = donorCells.filter((cell) => !directKeys.has(toCellKey(cell)));
  const components = connectedComponents(retainedCandidates);
  const largestArea = Math.max(0, ...components.map((component) => component.length));
  const largest = components.filter((component) => component.length === largestArea);
  if (largest.length !== 1) return { ...base, reason: "AMBIGUOUS_RETAINED_COMPONENT" };
  const retainedDonorCells = largest[0]!;
  if (retainedDonorCells.length < getMinimumTerritoryArea(map)) {
    return { ...base, retainedDonorCells, reason: "BELOW_MINIMUM_AREA" };
  }
  const annexedDisconnectedCells = components.filter((component) => component !== retainedDonorCells).flat();
  const allTransferCells = [...directTransferCells, ...annexedDisconnectedCells];
  const cells = { ...map.cells };
  for (const cell of allTransferCells) cells[toCellKey(cell)] = winnerId;
  const changed = { ...map, cells };
  if (!areCellsOrthogonallyConnected(getTerritoryCells(changed, winnerId))) {
    return { valid: false, directTransferCells, annexedDisconnectedCells, allTransferCells, retainedDonorCells,
      reason: "TERRITORY_DISCONNECTED" };
  }
  return { valid: true, directTransferCells, annexedDisconnectedCells, allTransferCells, retainedDonorCells, map: changed };
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
  const topology = resolveBorderTransferTopology(map, winnerId, loserId, claimedCells);
  if (!topology.valid || topology.map === undefined) {
    return { valid: false, ...(topology.reason === undefined ? {} : { reason: topology.reason }), corridor, directTransferCells: claimedCells,
      annexedDisconnectedCells: topology.annexedDisconnectedCells };
  }
  return { valid: true, corridor, map: topology.map, directTransferCells: topology.directTransferCells,
    annexedDisconnectedCells: topology.annexedDisconnectedCells };
}

/**
 * Produces a large legal default for an interactive border move. The core still
 * validates the submitted selection, while clients can start from a usable
 * maximum-front proposal and remove individual cells.
 */
export function getMaximumLegalBorderAdvance(
  map: GridMapState, winnerId: TerritoryId, loserId: TerritoryId,
  originalBorder: SharedBorder, maximumDepth: number,
): GridCell[] {
  let candidate = getCellsWithinBorderDepth(map, loserId, originalBorder, maximumDepth);
  while (candidate.length > 0 && !validateBorderAdvance(map, winnerId, loserId, originalBorder, maximumDepth, candidate).valid) {
    let fallback: GridCell[] | undefined;
    for (let index = 0; index < candidate.length; index += 1) {
      const reduced = candidate.filter((_, currentIndex) => currentIndex !== index);
      if (validateBorderAdvance(map, winnerId, loserId, originalBorder, maximumDepth, reduced).valid) return reduced;
      fallback ??= reduced;
    }
    candidate = fallback ?? [];
  }
  return candidate;
}

/**
 * Assesses the complete original front independently of the winner's selected
 * cells. The BFS corridor is the rule-defined theoretical full advance.
 */
export function assessBorderAdvanceLimitation(
  map: GridMapState, winnerId: TerritoryId, loserId: TerritoryId,
  originalBorder: SharedBorder, maximumDepth: number, _claimedCells: readonly GridCell[],
): BorderAdvanceLimitation {
  const completeFront = getCellsWithinBorderDepth(map, loserId, originalBorder, maximumDepth);
  const topology = resolveBorderTransferTopology(map, winnerId, loserId, completeFront);
  return {
    determinate: true,
    limitedByMinimumArea: topology.reason === "BELOW_MINIMUM_AREA",
    limitedByGeometry: topology.reason === "TERRITORY_DISCONNECTED",
    limitedByTopology: topology.reason === "AMBIGUOUS_RETAINED_COMPONENT",
  };
}
