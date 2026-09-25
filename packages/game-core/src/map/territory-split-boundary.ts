import type { TerritoryId } from "../model/ids.js";
import { getOrthogonalNeighbors, getTerritoryCells, toCellKey, type GridCell, type GridMapState } from "./grid-map.js";
import type { SetupBorderEdge } from "./setup-regions.js";

export type TerritoryBoundarySplitReason = "NO_BOUNDARY" | "BOUNDARY_OUTSIDE_TERRITORY" | "NOT_EXACTLY_TWO_PARTS";

export interface TerritoryBoundarySplit {
  readonly valid: boolean;
  readonly reason?: TerritoryBoundarySplitReason;
  readonly partACells: readonly GridCell[];
  readonly partBCells: readonly GridCell[];
}

function compareCells(left: GridCell, right: GridCell): number {
  return left.y - right.y || left.x - right.x;
}

/**
 * Turns a locally drawn raster boundary into the two pieces of one territory.
 * It deliberately does not apply game rules such as the minimum territory size;
 * callers validate the returned partition with validateTerritorySplit.
 */
export function deriveTerritorySplitFromBoundary(
  map: GridMapState,
  territoryId: TerritoryId,
  boundary: readonly SetupBorderEdge[],
): TerritoryBoundarySplit {
  const original = getTerritoryCells(map, territoryId);
  const originalKeys = new Set(original.map(toCellKey));
  if (boundary.length === 0) return { valid: false, reason: "NO_BOUNDARY", partACells: [], partBCells: [] };
  const blocked = new Set<string>();
  for (const edge of boundary) {
    const from = toCellKey(edge.from);
    const to = toCellKey(edge.to);
    if (!originalKeys.has(from) || !originalKeys.has(to)) {
      return { valid: false, reason: "BOUNDARY_OUTSIDE_TERRITORY", partACells: [], partBCells: [] };
    }
    blocked.add([from, to].sort().join("|"));
  }

  const remaining = new Set(originalKeys);
  const parts: GridCell[][] = [];
  while (remaining.size > 0) {
    const seed = [...remaining].sort()[0]!;
    const queue = [seed];
    const cells: GridCell[] = [];
    remaining.delete(seed);
    for (let index = 0; index < queue.length; index += 1) {
      const key = queue[index]!;
      const cell = original.find((candidate) => toCellKey(candidate) === key)!;
      cells.push(cell);
      for (const neighbor of getOrthogonalNeighbors(map, cell)) {
        const neighborKey = toCellKey(neighbor);
        if (!remaining.has(neighborKey) || !originalKeys.has(neighborKey)) continue;
        if (blocked.has([key, neighborKey].sort().join("|"))) continue;
        remaining.delete(neighborKey);
        queue.push(neighborKey);
      }
    }
    parts.push(cells.sort(compareCells));
  }
  if (parts.length !== 2) return { valid: false, reason: "NOT_EXACTLY_TWO_PARTS", partACells: [], partBCells: [] };
  parts.sort((left, right) => compareCells(left[0]!, right[0]!));
  return { valid: true, partACells: parts[0]!, partBCells: parts[1]! };
}
