import type { MapFormat } from "../map/grid-map.js";

/** Canonical dimensions for a normal digital game. */
export const DIGITAL_BOARD_WIDTH = 50;
export const DIGITAL_BOARD_HEIGHT = 50;
export const DIGITAL_MIN_TERRITORY_AREA = 20;
export const DIGITAL_BREAKTHROUGH_THRESHOLD = DIGITAL_MIN_TERRITORY_AREA * 2;

export const DIGITAL_MAP_CONFIG = {
  width: DIGITAL_BOARD_WIDTH,
  height: DIGITAL_BOARD_HEIGHT,
} as const;

/**
 * The executable digital profile has no paper format and always uses 20 cells.
 * Explicit A4/A5 values remain available for paper-rule utilities and fixtures.
 */
export function getMinimumTerritoryArea(format?: MapFormat): number {
  return format === "A5" ? 10 : DIGITAL_MIN_TERRITORY_AREA;
}

/** Keeps the breakthrough threshold coupled to the applicable minimum area. */
export function getBreakthroughThreshold(format?: MapFormat): number {
  return getMinimumTerritoryArea(format) * 2;
}
