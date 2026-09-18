import type { PlayerId, PointOfInterestId, TerritoryId } from "./ids.js";
import type { TerritoryCard } from "./territory-card.js";
import type { GridCell } from "../map/grid-map.js";

export enum SettlementKind {
  Settlement = "SETTLEMENT",
  City = "CITY",
}

export interface SettlementFeature {
  readonly id: string;
  readonly kind: SettlementKind;
  readonly position: GridCell;
}

export interface Territory {
  readonly id: TerritoryId;
  readonly ownerId: PlayerId | null;
  /** @deprecated Derived from GameState.map when a raster map is present. */
  readonly area?: number;
  /** @deprecated Derived from GameState.map when a raster map is present. */
  readonly adjacentTerritoryIds?: readonly TerritoryId[];
  readonly card?: TerritoryCard;
  readonly pointOfInterestIds?: readonly PointOfInterestId[];
  readonly settlement?: SettlementKind;
  /** Position-aware development; territory ownership is derived from the map. */
  readonly settlementFeature?: SettlementFeature;
  /** All cell-bound developments, including several moved into one territory by a border change. */
  readonly settlementFeatures?: readonly SettlementFeature[];
  readonly weakened?: boolean;
  readonly participatedInWarThisRound?: boolean;
  readonly localInfluenceByPlayerId?: Readonly<Record<PlayerId, number>>;
}
