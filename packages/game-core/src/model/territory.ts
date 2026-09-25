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
  /** Persisted counter; older snapshots with only the legacy flag count as one participation. */
  readonly warParticipationCountThisRound?: number;
  /** A territory may start at most one war per round, even while it is large. */
  readonly warsInitiatedThisRound?: number;
  /** Cut-and-choose parts retain the pre-existing round lock after their creation. */
  readonly warParticipationLockedThisRound?: boolean;
  /** @deprecated Use warParticipationCountThisRound for rules. Kept for persisted legacy rooms and simple UI hints. */
  readonly participatedInWarThisRound?: boolean;
  readonly localInfluenceByPlayerId?: Readonly<Record<PlayerId, number>>;
}
