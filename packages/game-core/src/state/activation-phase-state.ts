import type { PlayerId, TerritoryId } from "../model/ids.js";
import type { Suit } from "../model/territory-card.js";

/** State for the one activation number currently being resolved. */
export interface ActivationPhaseState {
  readonly pendingTerritoryIds: readonly TerritoryId[];
  readonly resolvedTerritoryIds: readonly TerritoryId[];
  /** Territory ids which have completed an activation in this round. */
  readonly activatedTerritoryIdsThisRound: readonly TerritoryId[];
  /** Number of rolls that have already happened in this activation phase. */
  readonly nextActivationIndex: number;
  /** The number whose captured candidates are currently being resolved. */
  readonly currentActivationNumber?: number;
}

/** ♦ activation paused until its neutral-border geometry has been resolved. */
export interface PendingDiamondBorderChange {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly sourceTerritoryId: TerritoryId;
  readonly neutralTerritoryId: TerritoryId;
  readonly selectedSuit?: Suit;
}

/** A ♠ activation remains available until used in a war or the round ends. */
export interface SpadeActivation {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly sourceTerritoryId: TerritoryId;
  readonly status: "AVAILABLE" | "USED";
}
