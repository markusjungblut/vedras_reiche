import type { PlayerId } from "../model/ids.js";
import type { TerritoryId } from "../model/ids.js";
import type { Suit } from "../model/territory-card.js";

export enum GameActionType {
  StartAuction = "START_AUCTION",
  StartWar = "START_WAR",
  ActivateTerritory = "ACTIVATE_TERRITORY",
}

export type ActivationChoice =
  | { readonly type: "DIAMOND_NEUTRAL_BORDER"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "DIAMOND_MARK_BORDER"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "CLUB_BUILD_SETTLEMENT"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "CLUB_UPGRADE_CITY"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "CLUB_ADD_ACTIVATION_NUMBER"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "CLUB_ADD_SECOND_SUIT"; readonly targetTerritoryId: TerritoryId; readonly suit: Suit }
  | { readonly type: "HEART_GLOBAL_INFLUENCE" }
  | { readonly type: "HEART_LOCAL_INFLUENCE"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "SPADE_STORE" };

export interface ActivateTerritoryAction {
  readonly type: GameActionType.ActivateTerritory;
  readonly playerId: PlayerId;
  readonly territoryId: TerritoryId;
  readonly selectedSuit?: Suit;
  readonly choice: ActivationChoice;
}

/** Rule-specific targets and bids are intentionally deferred. */
export interface StartAuctionAction {
  readonly type: GameActionType.StartAuction;
  readonly actorId: PlayerId;
}

/** Rule-specific targets and combat choices are intentionally deferred. */
export interface StartWarAction {
  readonly type: GameActionType.StartWar;
  readonly actorId: PlayerId;
}

export type GameAction = StartAuctionAction | StartWarAction | ActivateTerritoryAction;
