import type { PlayerId, TerritoryId } from "../model/ids.js";

/** A connected, currently controlled realm. Its ID is derived from sorted territory IDs. */
export interface RealmComponent {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly territoryIds: readonly TerritoryId[];
  readonly area: number;
}

/** Intermediate state retained while players resolve tied largest realms. */
export interface ScoringState {
  readonly realmComponents: readonly RealmComponent[];
  readonly largestRealmCandidateIdsByPlayerId: Readonly<Partial<Record<PlayerId, readonly string[]>>>;
  readonly selectedLargestRealmComponentIdByPlayerId: Readonly<Partial<Record<PlayerId, string>>>;
  readonly pendingLargestRealmPlayerIds: readonly PlayerId[];
}

/** The complete, territory-level audit trail for one controlled territory. */
export interface TerritoryScoreBreakdown {
  readonly territoryId: TerritoryId;
  readonly baseArea: number;
  readonly isFrontTerritory: boolean;
  readonly frontTerritoryEnemyNeighborCount: number;
  readonly frontTerritoryBonusPercent: number;
  readonly factionBonusPercent: number;
  readonly largestRealmBonusPercent: number;
  readonly developmentBonusPercent: number;
  readonly landmarkBonusPercent: number;
  readonly hubBonusPercent: number;
  readonly relicBonusPercent: number;
  readonly totalBonusPercent: number;
  /** Exact points scaled by 100, avoiding binary floating point rounding. */
  readonly scoreHundredths: number;
}

export interface PlayerScore {
  readonly playerId: PlayerId;
  readonly territoryScores: readonly TerritoryScoreBreakdown[];
  /** Exact subtotal from controlled territory areas and their additive bonuses. */
  readonly territoryScoreHundredths: number;
  /** Global influence still held when final scoring begins. */
  readonly remainingGlobalInfluence: number;
  /** Exact fixed score from remaining global influence. */
  readonly remainingGlobalInfluenceScoreHundredths: number;
  readonly totalScoreHundredths: number;
  readonly controlledTerritoryCount: number;
  readonly controlledArea: number;
  readonly activeRelicCount: number;
  readonly largestRealmTerritoryIds: readonly TerritoryId[];
}

/** Immutable final result retained after a game reaches FINISHED. */
export interface GameResult {
  readonly playerResults: readonly PlayerScore[];
  readonly winnerPlayerIds: readonly PlayerId[];
}
