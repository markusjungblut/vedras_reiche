import type { PlayerId, TerritoryId } from "../model/ids.js";
import type { GridCell, SharedBorder } from "../map/grid-map.js";

export interface ActionPhaseState {
  readonly completedPlayerIds: readonly PlayerId[];
  readonly auctionsOpenedByActivePlayer: 0 | 1 | 2;
  readonly secondAuctionAvailable: boolean;
  readonly currentActionKind?: "AUCTION" | "WAR";
}

export interface CombatResult {
  readonly attackerRoll: number;
  readonly defenderRoll: number;
  readonly attackerSpadeBonus: number;
  readonly defenderSpadeBonus: number;
  readonly defenderFortressBonus: number;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly difference: number;
  readonly winnerTerritoryId?: TerritoryId;
  readonly loserTerritoryId?: TerritoryId;
  readonly outcome: "TIE" | "BORDER_ADVANCE" | "STRONG_ADVANCE" | "CONQUEST" | "CUT_AND_CHOOSE";
}

export interface PendingWar {
  readonly id: string;
  readonly attackerPlayerId: PlayerId;
  readonly defenderPlayerId: PlayerId;
  readonly attackerTerritoryId: TerritoryId;
  readonly defenderTerritoryId: TerritoryId;
  readonly stage: "AWAITING_COMBAT_CHOICES" | "AWAITING_BORDER_ADVANCE" |
    "AWAITING_CUT_DIVISION" | "AWAITING_CUT_CHOICE" | "AWAITING_DIAMOND_CORRECTION";
  readonly attackerArea: number;
  readonly defenderArea: number;
  readonly originalSharedBorder: SharedBorder;
  readonly borderMark?: { readonly id: string; readonly playerId: PlayerId };
  readonly spadeChoices: Readonly<Partial<Record<PlayerId, string | null>>>;
  readonly combat?: CombatResult;
  readonly maximumDepth?: number;
  readonly proposal?: { readonly partACells: readonly GridCell[]; readonly partBCells: readonly GridCell[] };
  readonly cutTerritoryIds?: readonly [TerritoryId, TerritoryId];
}
