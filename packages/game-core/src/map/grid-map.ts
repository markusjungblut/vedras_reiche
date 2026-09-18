import type { TerritoryId } from "../model/ids.js";
import { getMinimumTerritoryArea } from "../rules/territory-size.js";

/** A single orthogonal paper-map cell. */
export interface GridCell {
  readonly x: number;
  readonly y: number;
}

/** Stable, serialisable cell identifier used by GridMapState. */
export type CellKey = `${number},${number}`;

export type MapFormat = "A4" | "A5";

export interface GridMapConfig {
  readonly width: number;
  readonly height: number;
  readonly format?: MapFormat;
}

/** The map is the only authoritative source for territory geometry. */
export interface GridMapState {
  readonly width: number;
  readonly height: number;
  readonly format?: MapFormat;
  readonly cells: Readonly<Record<string, TerritoryId | null>>;
}

export type GridEdgeOrientation = "HORIZONTAL" | "VERTICAL";

/** One unit-length side of a grid cell. */
export interface GridEdge {
  readonly cell: GridCell;
  readonly neighbor: GridCell;
  readonly orientation: GridEdgeOrientation;
}

export interface SharedBorder {
  readonly territoryAId: TerritoryId;
  readonly territoryBId: TerritoryId;
  readonly segments: readonly GridEdge[];
}

export interface TerritorySplitValidation {
  readonly valid: boolean;
  readonly reason?: "UNKNOWN_TERRITORY" | "EMPTY_PART" | "CELL_NOT_IN_ORIGINAL" |
    "DUPLICATE_CELL" | "PART_NOT_CONNECTED" | "BELOW_MINIMUM_AREA";
  readonly partACells: readonly GridCell[];
  readonly partBCells: readonly GridCell[];
  readonly minimumArea: number;
}

const DIRECTIONS = [
  { dx: 0, dy: -1, orientation: "HORIZONTAL" as const },
  { dx: 0, dy: 1, orientation: "HORIZONTAL" as const },
  { dx: -1, dy: 0, orientation: "VERTICAL" as const },
  { dx: 1, dy: 0, orientation: "VERTICAL" as const },
];

function assertCoordinate(value: number, label: string): void {
  if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer.`);
}

export function toCellKey(cell: GridCell | number, y?: number): CellKey {
  const xValue = typeof cell === "number" ? cell : cell.x;
  const yValue = typeof cell === "number" ? y : cell.y;
  if (yValue === undefined) throw new RangeError("Cell y must be provided.");
  assertCoordinate(xValue, "Cell x");
  assertCoordinate(yValue, "Cell y");
  return `${xValue},${yValue}` as CellKey;
}

export function fromCellKey(key: string): GridCell {
  const parts = key.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) {
    throw new RangeError(`Invalid cell key: ${key}`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  assertCoordinate(x, "Cell x");
  assertCoordinate(y, "Cell y");
  if (toCellKey(x, y) !== key) throw new RangeError(`Invalid canonical cell key: ${key}`);
  return { x, y };
}

export function isCellInsideMap(map: GridMapState | GridMapConfig, cell: GridCell): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.y) &&
    cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
}

function assertMapConfig(config: GridMapConfig): void {
  if (!Number.isInteger(config.width) || config.width <= 0 ||
      !Number.isInteger(config.height) || config.height <= 0) {
    throw new RangeError("Grid map width and height must be positive integers.");
  }
}

export function createGridMap(
  config: GridMapConfig,
  cells: Readonly<Record<string, TerritoryId | null>> = {},
): GridMapState {
  assertMapConfig(config);
  const result: Record<string, TerritoryId | null> = {};
  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) result[toCellKey(x, y)] = null;
  }
  for (const [key, territoryId] of Object.entries(cells)) {
    const cell = fromCellKey(key);
    if (!isCellInsideMap(config, cell)) throw new RangeError(`Cell ${key} is outside the map.`);
    result[key] = territoryId;
  }
  return {
    width: config.width,
    height: config.height,
    ...(config.format === undefined ? {} : { format: config.format }),
    cells: result,
  };
}

export function getGridCellTerritory(map: GridMapState, cell: GridCell): TerritoryId | null | undefined {
  if (!isCellInsideMap(map, cell)) return undefined;
  return map.cells[toCellKey(cell)];
}

export function withGridCellTerritory(
  map: GridMapState,
  cell: GridCell,
  territoryId: TerritoryId | null,
): GridMapState {
  if (!isCellInsideMap(map, cell)) throw new RangeError("Cell is outside the map.");
  return { ...map, cells: { ...map.cells, [toCellKey(cell)]: territoryId } };
}

export function getOrthogonalNeighbors(map: GridMapState, cell: GridCell): GridCell[] {
  return DIRECTIONS
    .map(({ dx, dy }) => ({ x: cell.x + dx, y: cell.y + dy }))
    .filter((neighbor) => isCellInsideMap(map, neighbor));
}

export function getTerritoryCells(map: GridMapState, territoryId: TerritoryId): GridCell[] {
  return Object.entries(map.cells)
    .filter(([, value]) => value === territoryId)
    .map(([key]) => fromCellKey(key));
}

export function getTerritoryArea(map: GridMapState, territoryId: TerritoryId): number {
  return getTerritoryCells(map, territoryId).length;
}

export function isTerritoryConnected(map: GridMapState, territoryId: TerritoryId): boolean {
  return areCellsOrthogonallyConnected(getTerritoryCells(map, territoryId));
}

/** Checks a cell set independently of any temporary map ownership labels. */
export function areCellsOrthogonallyConnected(cells: readonly GridCell[]): boolean {
  if (cells.length === 0) return false;
  const remaining = new Set(cells.map(toCellKey));
  const queue = [cells[0]!];
  remaining.delete(toCellKey(cells[0]!));
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { dx, dy } of DIRECTIONS) {
      const key = toCellKey(current.x + dx, current.y + dy);
      if (remaining.delete(key)) queue.push({ x: current.x + dx, y: current.y + dy });
    }
  }
  return remaining.size === 0;
}

function edgeFor(cell: GridCell, neighbor: GridCell): GridEdge {
  return {
    cell,
    neighbor,
    orientation: cell.x === neighbor.x ? "HORIZONTAL" : "VERTICAL",
  };
}

export function getSharedBorder(
  map: GridMapState,
  territoryAId: TerritoryId,
  territoryBId: TerritoryId,
): SharedBorder {
  if (territoryAId === territoryBId) {
    return { territoryAId, territoryBId, segments: [] };
  }
  const segments: GridEdge[] = [];
  for (const cell of getTerritoryCells(map, territoryAId)) {
    for (const neighbor of getOrthogonalNeighbors(map, cell)) {
      if (getGridCellTerritory(map, neighbor) === territoryBId) {
        segments.push(edgeFor(cell, neighbor));
      }
    }
  }
  segments.sort((left, right) => toCellKey(left.cell).localeCompare(toCellKey(right.cell)));
  return { territoryAId, territoryBId, segments };
}

export function getSharedBorderLength(
  map: GridMapState,
  territoryAId: TerritoryId,
  territoryBId: TerritoryId,
): number {
  return getSharedBorder(map, territoryAId, territoryBId).segments.length;
}

export function areTerritoriesAdjacent(
  map: GridMapState,
  territoryAId: TerritoryId,
  territoryBId: TerritoryId,
): boolean {
  return territoryAId !== territoryBId && getSharedBorderLength(map, territoryAId, territoryBId) > 0;
}

export function getAdjacentTerritoryIds(map: GridMapState, territoryId: TerritoryId): TerritoryId[] {
  const adjacent = new Set<TerritoryId>();
  for (const cell of getTerritoryCells(map, territoryId)) {
    for (const neighbor of getOrthogonalNeighbors(map, cell)) {
      const other = getGridCellTerritory(map, neighbor);
      if (other !== null && other !== undefined && other !== territoryId) adjacent.add(other);
    }
  }
  return [...adjacent].sort();
}

/** Naming alias used by later war and scoring work packages. */
export function getAdjacentTerritories(map: GridMapState, territoryId: TerritoryId): TerritoryId[] {
  return getAdjacentTerritoryIds(map, territoryId);
}

export function replaceTerritoryCells(
  map: GridMapState,
  territoryId: TerritoryId,
  cells: readonly GridCell[],
): GridMapState {
  const wanted = new Set(cells.map(toCellKey));
  const next: Record<string, TerritoryId | null> = { ...map.cells };
  for (const [key, value] of Object.entries(next)) if (value === territoryId) next[key] = null;
  for (const key of wanted) {
    const cell = fromCellKey(key);
    if (!isCellInsideMap(map, cell)) throw new RangeError(`Cell ${key} is outside the map.`);
    next[key] = territoryId;
  }
  return { ...map, cells: next };
}

function invalidSplit(
  reason: TerritorySplitValidation["reason"],
  partA: readonly GridCell[],
  partB: readonly GridCell[],
  minimumArea: number,
): TerritorySplitValidation {
  return {
    valid: false,
    ...(reason === undefined ? {} : { reason }),
    partACells: partA,
    partBCells: partB,
    minimumArea,
  };
}

/** Validates a cut-and-choose partition without mutating the map. */
export function validateTerritorySplit(
  map: GridMapState,
  originalTerritoryId: TerritoryId,
  partACells: readonly GridCell[],
  minimumArea = getMinimumTerritoryArea(map.format),
): TerritorySplitValidation {
  const originalCells = getTerritoryCells(map, originalTerritoryId);
  const originalKeys = new Set(originalCells.map(toCellKey));
  if (originalCells.length === 0) return invalidSplit("UNKNOWN_TERRITORY", [], [], minimumArea);
  const keys = partACells.map(toCellKey);
  if (new Set(keys).size !== keys.length) return invalidSplit("DUPLICATE_CELL", partACells, [], minimumArea);
  if (keys.some((key) => !originalKeys.has(key))) {
    return invalidSplit("CELL_NOT_IN_ORIGINAL", partACells, [], minimumArea);
  }
  const partAKeys = new Set(keys);
  const partBKeys = originalCells.map(toCellKey).filter((key) => !partAKeys.has(key));
  const partB = partBKeys.map(fromCellKey);
  if (partAKeys.size === 0 || partB.length === 0) {
    return invalidSplit("EMPTY_PART", partACells, partB, minimumArea);
  }
  if (!areCellsOrthogonallyConnected(partACells) || !areCellsOrthogonallyConnected(partB)) {
    return invalidSplit("PART_NOT_CONNECTED", partACells, partB, minimumArea);
  }
  if (partACells.length < minimumArea || partB.length < minimumArea) {
    return invalidSplit("BELOW_MINIMUM_AREA", partACells, partB, minimumArea);
  }
  return { valid: true, partACells, partBCells: partB, minimumArea };
}

/** Applies a validated partition, retaining the original ID for part A. */
export function applyTerritorySplitToMap(
  map: GridMapState,
  originalTerritoryId: TerritoryId,
  newTerritoryId: TerritoryId,
  partACells: readonly GridCell[],
): GridMapState {
  if (newTerritoryId === originalTerritoryId || getTerritoryArea(map, newTerritoryId) > 0) {
    throw new RangeError("The new territory ID is already occupied on the map.");
  }
  const validation = validateTerritorySplit(map, originalTerritoryId, partACells);
  if (!validation.valid) throw new RangeError(`Invalid territory split: ${validation.reason}`);
  const cells: Record<string, TerritoryId | null> = { ...map.cells };
  for (const cell of validation.partACells) cells[toCellKey(cell)] = originalTerritoryId;
  for (const cell of validation.partBCells) cells[toCellKey(cell)] = newTerritoryId;
  return { ...map, cells };
}
