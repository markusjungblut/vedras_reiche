import type { PointOfInterestId, TerritoryId } from "./ids.js";

export enum PointOfInterestType {
  Landmark = "LANDMARK",
  Junction = "JUNCTION",
  Fortress = "FORTRESS",
  Relic = "RELIC",
}

/** Position is deliberately omitted until the map geometry is specified. */
export interface PointOfInterest {
  readonly id: PointOfInterestId;
  readonly type: PointOfInterestType;
  readonly territoryId: TerritoryId;
}
