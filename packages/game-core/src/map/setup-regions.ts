import type { GridCell, GridMapConfig, GridMapState } from "./grid-map.js";
import { isCellInsideMap, toCellKey } from "./grid-map.js";

/** An internal edge blocks travel between two orthogonally adjacent cells during map setup. */
export interface SetupBorderEdge {
  readonly from: GridCell;
  readonly to: GridCell;
}

export type SetupBorderEdgeKey = `${number},${number}|${number},${number}`;
export type SetupRegionId = `R${number}`;

/** The complete setup boundary graph. Map labels are only a derived preview. */
export interface SetupBorderState {
  readonly edgeKeys: readonly SetupBorderEdgeKey[];
}

export interface SetupRegion {
  readonly id: SetupRegionId;
  readonly cells: readonly GridCell[];
}

export interface SetupPartitionChange {
  readonly regionCountDelta: number;
  readonly splitSourceRegionId?: SetupRegionId;
  readonly resultingRegionIds: readonly SetupRegionId[];
  readonly unchangedRegionIds: readonly SetupRegionId[];
  readonly validSingleSplit: boolean;
}

function compareCells(left: GridCell, right: GridCell): number {
  return left.y - right.y || left.x - right.x;
}

function isOrthogonalPair(left: GridCell, right: GridCell): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

export function toSetupBorderEdgeKey(left: GridCell, right: GridCell): SetupBorderEdgeKey {
  if (!isOrthogonalPair(left, right)) throw new RangeError("A setup border must join orthogonally adjacent cells.");
  const [first, second] = compareCells(left, right) <= 0 ? [left, right] : [right, left];
  return `${toCellKey(first)}|${toCellKey(second)}` as SetupBorderEdgeKey;
}

export function setupBorderEdgeFromKey(key: string): SetupBorderEdge {
  const [fromKey, toKey, extra] = key.split("|");
  if (fromKey === undefined || toKey === undefined || extra !== undefined) throw new RangeError(`Invalid setup border edge: ${key}`);
  const [fromX, fromY] = fromKey.split(",").map(Number) as [number, number];
  const [toX, toY] = toKey.split(",").map(Number) as [number, number];
  const from = { x: fromX, y: fromY };
  const to = { x: toX, y: toY };
  if (!Number.isInteger(fromX) || !Number.isInteger(fromY) || !Number.isInteger(toX) || !Number.isInteger(toY) ||
      toSetupBorderEdgeKey(from, to) !== key) throw new RangeError(`Invalid setup border edge: ${key}`);
  return { from, to };
}

export function normalizeSetupBorderEdges(map: GridMapConfig | GridMapState, edges: readonly SetupBorderEdge[]): SetupBorderEdgeKey[] {
  const keys = edges.map((edge) => {
    if (!isCellInsideMap(map, edge.from) || !isCellInsideMap(map, edge.to)) throw new RangeError("A setup border lies outside the map.");
    return toSetupBorderEdgeKey(edge.from, edge.to);
  });
  return [...new Set(keys)].sort();
}

/** Derives all setup regions via orthogonal flood fill in deterministic row-major seed order. */
export function deriveSetupRegions(map: GridMapConfig | GridMapState, borders: SetupBorderState): SetupRegion[] {
  const blocked = new Set(borders.edgeKeys);
  const unvisited = new Set<string>();
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) unvisited.add(toCellKey(x, y));
  const regions: SetupRegion[] = [];
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const seed = { x, y };
    if (!unvisited.delete(toCellKey(seed))) continue;
    const cells: GridCell[] = [];
    const queue: GridCell[] = [seed];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      cells.push(current);
      for (const neighbor of [{ x: current.x, y: current.y - 1 }, { x: current.x - 1, y: current.y }, { x: current.x + 1, y: current.y }, { x: current.x, y: current.y + 1 }]) {
        if (!isCellInsideMap(map, neighbor) || blocked.has(toSetupBorderEdgeKey(current, neighbor))) continue;
        if (unvisited.delete(toCellKey(neighbor))) queue.push(neighbor);
      }
    }
    regions.push({ id: `R${String(regions.length + 1).padStart(2, "0")}` as SetupRegionId, cells });
  }
  return regions;
}

/** Proves a change is exactly one old region becoming two, with all other geometry intact. */
export function analyzeSetupPartitionChange(before: readonly SetupRegion[], after: readonly SetupRegion[]): SetupPartitionChange {
  const parentByCell = new Map<string, SetupRegionId>();
  for (const region of before) for (const cell of region.cells) parentByCell.set(toCellKey(cell), region.id);
  const originalCells = new Map(before.map((region) => [region.id, new Set(region.cells.map(toCellKey))]));
  const descendants = new Map<SetupRegionId, SetupRegionId[]>();
  let crossesOldRegions = false;
  for (const region of after) {
    const parents = new Set(region.cells.map((cell) => parentByCell.get(toCellKey(cell))));
    if (parents.size !== 1 || parents.has(undefined)) { crossesOldRegions = true; continue; }
    const parent = [...parents][0] as SetupRegionId;
    descendants.set(parent, [...(descendants.get(parent) ?? []), region.id]);
  }
  const splitSources = [...descendants.entries()].filter(([, ids]) => ids.length === 2);
  const unchanged = [...descendants.entries()].filter(([id, ids]) => {
    const descendant = after.find((region) => region.id === ids[0]);
    const source = originalCells.get(id);
    return ids.length === 1 && descendant !== undefined && source !== undefined && descendant.cells.length === source.size && descendant.cells.every((cell) => source.has(toCellKey(cell)));
  }).map(([id]) => id);
  const validSingleSplit = !crossesOldRegions && after.length === before.length + 1 && splitSources.length === 1 && descendants.size === before.length &&
    [...descendants.entries()].every(([id, ids]) => ids.length === 2 || (ids.length === 1 && unchanged.includes(id)));
  return { regionCountDelta: after.length - before.length,
    ...(splitSources.length === 1 ? { splitSourceRegionId: splitSources[0]![0], resultingRegionIds: splitSources[0]![1] } : { resultingRegionIds: [] }),
    unchangedRegionIds: unchanged, validSingleSplit };
}

/** Materializes temporary IDs solely for rendering and cell-bound setup features. */
export function materializeSetupRegionMap(map: GridMapState, regions: readonly SetupRegion[]): GridMapState {
  const cells: Record<string, string> = {};
  for (const region of regions) for (const cell of region.cells) cells[toCellKey(cell)] = region.id;
  return { ...map, cells } as GridMapState;
}
