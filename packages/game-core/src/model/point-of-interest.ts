import type { PointOfInterestId, TerritoryId } from "./ids.js";
import type { GridCell } from "../map/grid-map.js";

export enum PointOfInterestType {
  Landmark = "LANDMARK",
  Junction = "JUNCTION",
  Fortress = "FORTRESS",
  Relic = "RELIC",
}

export interface PointOfInterest {
  readonly id: PointOfInterestId;
  readonly type: PointOfInterestType;
  readonly position: GridCell;
  /** @deprecated The owning territory is derived from position and GameState.map. */
  readonly territoryId?: TerritoryId;
}
