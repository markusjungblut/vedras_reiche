import type { TerritorySizeMap } from "./territory-size.js";

export const REFERENCE_BOARD_AREA = 2_500;

/** Linear scale for rules expressed as a number of raster-cell steps. */
export function getMapLinearScale(map: TerritorySizeMap): number {
  return Math.sqrt((map.width * map.height) / REFERENCE_BOARD_AREA);
}

/** Keeps zero as a semantic "no spatial reach" value. */
export function scaleGridDepth(baseDepth: number, map: TerritorySizeMap): number {
  if (!Number.isSafeInteger(baseDepth) || baseDepth < 0) throw new RangeError("Grid depth must be a non-negative integer.");
  return baseDepth === 0 ? 0 : Math.max(1, Math.round(baseDepth * getMapLinearScale(map)));
}
