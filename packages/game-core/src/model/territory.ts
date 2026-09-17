import type { PlayerId, PointOfInterestId, TerritoryId } from "./ids.js";
import type { TerritoryCard } from "./territory-card.js";

export enum SettlementKind {
  Settlement = "SETTLEMENT",
  City = "CITY",
}

/** Geometry and exact border placement are deferred to the map package. */
export interface Territory {
  readonly id: TerritoryId;
  readonly ownerId: PlayerId | null;
  /** Abstract area value; the map's grid geometry is not represented here. */
  readonly area: number;
  readonly adjacentTerritoryIds: readonly TerritoryId[];
  readonly card?: TerritoryCard;
  readonly pointOfInterestIds?: readonly PointOfInterestId[];
  readonly settlement?: SettlementKind;
  readonly weakened?: boolean;
  readonly participatedInWarThisRound?: boolean;
  readonly localInfluenceByPlayerId?: Readonly<Record<PlayerId, number>>;
}
