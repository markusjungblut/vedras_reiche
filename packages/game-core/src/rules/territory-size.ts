/** Every grid map provides exactly the dimensions needed by this rule. */
export interface TerritorySizeMap {
  readonly width: number;
  readonly height: number;
  readonly format?: "A4" | "A5";
}

/** Canonical dimensions for a normal digital game. */
export const DIGITAL_BOARD_WIDTH = 50;
export const DIGITAL_BOARD_HEIGHT = 50;
export const DIGITAL_MIN_TERRITORY_AREA = Math.ceil(DIGITAL_BOARD_WIDTH * DIGITAL_BOARD_HEIGHT * .01);
export const DIGITAL_BREAKTHROUGH_THRESHOLD = DIGITAL_MIN_TERRITORY_AREA * 2;

export const DIGITAL_MAP_CONFIG = {
  width: DIGITAL_BOARD_WIDTH,
  height: DIGITAL_BOARD_HEIGHT,
} as const;

/** One percent of the current board, rounded up to a complete grid cell. */
export function getMinimumTerritoryArea(map: TerritorySizeMap): number {
  if (map.format === "A4") return 20;
  if (map.format === "A5") return 10;
  return Math.ceil(map.width * map.height * .01);
}

/** Keeps the breakthrough threshold coupled to the applicable minimum area. */
export function getBreakthroughThreshold(map: TerritorySizeMap): number {
  return getMinimumTerritoryArea(map) * 2;
}
