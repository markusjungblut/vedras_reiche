import type { PlayerId, TerritoryId } from "../model/ids.js";
import type { Suit } from "../model/territory-card.js";

/** The matching territories are captured when the phase begins; later ♣ numbers apply next round. */
export interface ActivationPhaseState {
  readonly pendingTerritoryIds: readonly TerritoryId[];
  readonly resolvedTerritoryIds: readonly TerritoryId[];
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
