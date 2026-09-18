import type { PlayerId } from "../model/ids.js";
import type { TerritoryId } from "../model/ids.js";
import type { Suit } from "../model/territory-card.js";
import type { Territory } from "../model/territory.js";
import type { NormalAuctionBid, StartAuctionBid } from "../auctions/auction-state.js";

export enum GameActionType {
  BeginStartAuctions = "BEGIN_START_AUCTIONS",
  OpenNextStartAuction = "OPEN_NEXT_START_AUCTION",
  OpenAuction = "OPEN_AUCTION",
  SubmitAuctionBid = "SUBMIT_AUCTION_BID",
  ResolveTerritorySplit = "RESOLVE_TERRITORY_SPLIT",
  EndActionTurn = "END_ACTION_TURN",
  ForfeitAction = "FORFEIT_ACTION",
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

export interface BeginStartAuctionsAction {
  readonly type: GameActionType.BeginStartAuctions;
  /** Last player to act during setup, needed to derive the first auctioneer (§8). */
  readonly lastSetupPlayerId: PlayerId;
}

/** Opens the next still-neutral territory in the fixed display order. */
export interface OpenNextStartAuctionAction {
  readonly type: GameActionType.OpenNextStartAuction;
}

export interface OpenAuctionAction {
  readonly type: GameActionType.OpenAuction;
  readonly playerId: PlayerId;
  readonly territoryId: TerritoryId;
}

export interface SubmitAuctionBidAction {
  readonly type: GameActionType.SubmitAuctionBid;
  readonly playerId: PlayerId;
  readonly auctionId: string;
  readonly bid: StartAuctionBid | NormalAuctionBid;
}

export type ResolveTerritorySplitAction =
  | {
      readonly type: GameActionType.ResolveTerritorySplit;
      readonly splitId: string;
      readonly resolution: "SPLIT_NOT_POSSIBLE";
    }
  | {
      readonly type: GameActionType.ResolveTerritorySplit;
      readonly splitId: string;
      readonly resolution: "LEGAL_SPLIT";
      /** Geometry is supplied and validated by a future map resolver. */
      readonly originalCardPart: Territory;
      readonly newCardPart: Territory;
      readonly dividerPlayerId: PlayerId;
      readonly firstChooserPlayerId: PlayerId;
    };

export interface EndActionTurnAction {
  readonly type: GameActionType.EndActionTurn;
  readonly playerId: PlayerId;
}

export interface ForfeitAction {
  readonly type: GameActionType.ForfeitAction;
  readonly playerId: PlayerId;
}

export interface StartWarAction {
  readonly type: GameActionType.StartWar;
  readonly playerId: PlayerId;
  readonly attackerTerritoryId: TerritoryId;
  readonly defenderTerritoryId: TerritoryId;
}

export type GameAction =
  | BeginStartAuctionsAction
  | OpenNextStartAuctionAction
  | OpenAuctionAction
  | SubmitAuctionBidAction
  | ResolveTerritorySplitAction
  | EndActionTurnAction
  | ForfeitAction
  | StartWarAction
  | ActivateTerritoryAction;
