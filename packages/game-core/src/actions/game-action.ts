import type { PlayerId } from "../model/ids.js";
import type { TerritoryId } from "../model/ids.js";
import type { Suit } from "../model/territory-card.js";
import type { GridCell } from "../map/grid-map.js";
import type { GridMapConfig } from "../map/grid-map.js";
import type { SetupBorderEdge } from "../map/setup-regions.js";
import type { PointOfInterestType } from "../model/point-of-interest.js";
import type { NormalAuctionBid, StartAuctionBid } from "../auctions/auction-state.js";

export enum GameActionType {
  BeginMapCreation = "BEGIN_MAP_CREATION",
  CommitSetupBoundaryDraft = "COMMIT_SETUP_BOUNDARY_DRAFT",
  CorrectSetupBorders = "CORRECT_SETUP_BORDERS",
  PlaceSetupPointOfInterest = "PLACE_SETUP_POINT_OF_INTEREST",
  FinalizeMapCreation = "FINALIZE_MAP_CREATION",
  BeginStartAuctions = "BEGIN_START_AUCTIONS",
  OpenNextStartAuction = "OPEN_NEXT_START_AUCTION",
  OpenAuction = "OPEN_AUCTION",
  SubmitAuctionBid = "SUBMIT_AUCTION_BID",
  ResolveTerritorySplit = "RESOLVE_TERRITORY_SPLIT",
  EndActionTurn = "END_ACTION_TURN",
  ForfeitAction = "FORFEIT_ACTION",
  StartWar = "START_WAR",
  ActivateTerritory = "ACTIVATE_TERRITORY",
  ProposeTerritorySplit = "PROPOSE_TERRITORY_SPLIT",
  ChooseSplitPart = "CHOOSE_SPLIT_PART",
  SetWarSpadeChoice = "SET_WAR_SPADE_CHOICE",
  ProposeBorderAdvance = "PROPOSE_BORDER_ADVANCE",
  ProposeWarCut = "PROPOSE_WAR_CUT",
  ChooseWarCut = "CHOOSE_WAR_CUT",
  ResolveDiamondCorrection = "RESOLVE_DIAMOND_CORRECTION",
  ResolveNeutralDiamond = "RESOLVE_NEUTRAL_DIAMOND",
  ChooseLargestRealm = "CHOOSE_LARGEST_REALM",
  StartRound = "START_ROUND",
  RollNextActivationNumber = "ROLL_NEXT_ACTIVATION_NUMBER",
}

export interface BeginMapCreationAction {
  readonly type: GameActionType.BeginMapCreation;
  readonly firstPlayerId: PlayerId;
  readonly map: GridMapConfig;
}

/** Commits one or more new boundary segments as one normal map-drawing turn. */
export interface CommitSetupBoundaryDraftAction {
  readonly type: GameActionType.CommitSetupBoundaryDraft;
  readonly playerId: PlayerId;
  readonly edges: readonly SetupBorderEdge[];
}

/** A correction changes shape only and must preserve the setup-region count. */
export interface CorrectSetupBordersAction {
  readonly type: GameActionType.CorrectSetupBorders;
  readonly playerId: PlayerId;
  readonly addEdges?: readonly SetupBorderEdge[];
  readonly removeEdges?: readonly SetupBorderEdge[];
}

export interface PlaceSetupPointOfInterestAction {
  readonly type: GameActionType.PlaceSetupPointOfInterest;
  readonly playerId: PlayerId;
  readonly poiType: PointOfInterestType;
  readonly position: GridCell;
}

export interface FinalizeMapCreationAction {
  readonly type: GameActionType.FinalizeMapCreation;
  readonly playerId: PlayerId;
}

export type ActivationChoice =
  | { readonly type: "DIAMOND_NEUTRAL_BORDER"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "DIAMOND_MARK_BORDER"; readonly targetTerritoryId: TerritoryId }
  | { readonly type: "CLUB_BUILD_SETTLEMENT"; readonly targetTerritoryId: TerritoryId; readonly position?: GridCell }
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
  readonly lastSetupPlayerId?: PlayerId;
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

export interface ResolveTerritorySplitAction {
  readonly type: GameActionType.ResolveTerritorySplit;
  readonly splitId: string;
  /** Only demonstrably impossible raster partitions may use this action. */
  readonly resolution: "SPLIT_NOT_POSSIBLE";
}

export interface ProposeTerritorySplitAction {
  readonly type: GameActionType.ProposeTerritorySplit;
  readonly splitId: string;
  readonly playerId: PlayerId;
  readonly partACells: readonly GridCell[];
  readonly originalCardPart: "A" | "B";
}

export interface ChooseSplitPartAction {
  readonly type: GameActionType.ChooseSplitPart;
  readonly splitId: string;
  readonly playerId: PlayerId;
  readonly chosenPart: "A" | "B";
}

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

export interface SetWarSpadeChoiceAction {
  readonly type: GameActionType.SetWarSpadeChoice;
  readonly warId: string;
  readonly playerId: PlayerId;
  readonly spadeActivationId: string | null;
}

export interface ProposeBorderAdvanceAction {
  readonly type: GameActionType.ProposeBorderAdvance;
  readonly warId: string;
  readonly playerId: PlayerId;
  readonly claimedCells: readonly GridCell[];
}

export interface ProposeWarCutAction {
  readonly type: GameActionType.ProposeWarCut;
  readonly warId: string;
  readonly playerId: PlayerId;
  readonly partACells: readonly GridCell[];
}

export interface ChooseWarCutAction {
  readonly type: GameActionType.ChooseWarCut;
  readonly warId: string;
  readonly playerId: PlayerId;
  readonly chosenPart: "A" | "B";
}

export interface ResolveDiamondCorrectionAction {
  readonly type: GameActionType.ResolveDiamondCorrection;
  readonly warId: string;
  readonly playerId: PlayerId;
  readonly claimedCells: readonly GridCell[];
}

export interface ResolveNeutralDiamondAction {
  readonly type: GameActionType.ResolveNeutralDiamond;
  readonly effectId: string;
  readonly playerId: PlayerId;
  readonly claimedCells: readonly GridCell[];
}

export interface ChooseLargestRealmAction {
  readonly type: GameActionType.ChooseLargestRealm;
  readonly playerId: PlayerId;
  readonly componentId: string;
}

/** Starts the next round through the same authoritative action dispatcher. */
export interface StartRoundAction {
  readonly type: GameActionType.StartRound;
}

/** The core rolls the number; the client only authorizes the round's start player. */
export interface RollNextActivationNumberAction {
  readonly type: GameActionType.RollNextActivationNumber;
  readonly playerId: PlayerId;
}

export type GameAction =
  | BeginMapCreationAction
  | CommitSetupBoundaryDraftAction
  | CorrectSetupBordersAction
  | PlaceSetupPointOfInterestAction
  | FinalizeMapCreationAction
  | BeginStartAuctionsAction
  | OpenNextStartAuctionAction
  | OpenAuctionAction
  | SubmitAuctionBidAction
  | ResolveTerritorySplitAction
  | ProposeTerritorySplitAction
  | ChooseSplitPartAction
  | EndActionTurnAction
  | ForfeitAction
  | StartWarAction
  | SetWarSpadeChoiceAction
  | ProposeBorderAdvanceAction
  | ProposeWarCutAction
  | ChooseWarCutAction
  | ResolveDiamondCorrectionAction
  | ResolveNeutralDiamondAction
  | ChooseLargestRealmAction
  | StartRoundAction
  | RollNextActivationNumberAction
  | ActivateTerritoryAction;
