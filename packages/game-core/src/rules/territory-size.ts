import type { MapFormat } from "../map/grid-map.js";

/** Minimum territory area from the rulebook, in paper-map cells. */
export function getMinimumTerritoryArea(format: MapFormat = "A4"): number {
  return format === "A5" ? 10 : 20;
}
