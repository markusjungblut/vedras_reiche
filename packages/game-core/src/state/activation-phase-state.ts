import type { PlayerId, TerritoryId } from "../model/ids.js";

/** The matching territories are captured when the phase begins; later ♣ numbers apply next round. */
export interface ActivationPhaseState {
  readonly pendingTerritoryIds: readonly TerritoryId[];
  readonly resolvedTerritoryIds: readonly TerritoryId[];
}

/** Geometry-dependent ♦ effect waiting for an actual map implementation. */
export interface PendingDiamondBorderChange {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly sourceTerritoryId: TerritoryId;
  readonly neutralTerritoryId: TerritoryId;
}

/** A ♠ activation remains available until used in a war or the round ends. */
export interface SpadeActivation {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly sourceTerritoryId: TerritoryId;
  readonly status: "AVAILABLE" | "USED";
}
