import type { PlayerId, TerritoryId } from "../model/ids.js";

export interface ActionPhaseState {
  readonly completedPlayerIds: readonly PlayerId[];
  readonly auctionsOpenedByActivePlayer: 0 | 1 | 2;
  readonly secondAuctionAvailable: boolean;
}

/** AP4 will resolve the war and complete this player's basic action. */
export interface PendingWar {
  readonly playerId: PlayerId;
  readonly attackerTerritoryId: TerritoryId;
  readonly defenderTerritoryId: TerritoryId;
}
