import type { PlayerId } from "../model/ids.js";
import { PointOfInterestType } from "../model/point-of-interest.js";

export enum MapCreationStage {
  DrawTerritories = "DRAW_TERRITORIES",
  PlaceLandmarks = "PLACE_LANDMARKS",
  PlaceJunctions = "PLACE_JUNCTIONS",
  PlaceFortresses = "PLACE_FORTRESSES",
  PlaceRelics = "PLACE_RELICS",
  ReadyToFinalize = "READY_TO_FINALIZE",
}

export interface MapCreationState {
  readonly firstPlayerId: PlayerId;
  readonly activePlayerId: PlayerId;
  readonly targetTerritoryCount: number;
  readonly createdTerritoryCount: number;
  readonly stage: MapCreationStage;
  readonly placedPoiCounts: Readonly<Record<PointOfInterestType, number>>;
  readonly lastSetupPlayerId?: PlayerId;
}
