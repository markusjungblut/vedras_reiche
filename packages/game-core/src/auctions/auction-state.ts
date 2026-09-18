import type { PlayerId, TerritoryId } from "../model/ids.js";

export interface StartAuctionBid {
  readonly kind: "START";
  readonly value: number;
}

export interface NormalAuctionBid {
  readonly kind: "NORMAL";
  readonly basicBid: 1 | 2 | 3;
  readonly globalInfluence: number;
  readonly localInfluence: number;
}

export type AuctionBid = StartAuctionBid | NormalAuctionBid;

/** Bid values remain internal until every eligible player has submitted. */
export interface AuctionState {
  readonly id: string;
  readonly kind: "START" | "NORMAL";
  readonly territoryId: TerritoryId;
  readonly openerPlayerId?: PlayerId;
  readonly auctioneerPlayerId?: PlayerId;
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly submittedBids: Readonly<Partial<Record<PlayerId, AuctionBid>>>;
  readonly status: "BIDDING";
}

export interface StartAuctionsState {
  readonly round: 1 | 2;
  readonly displayTerritoryIds: readonly TerritoryId[];
  readonly firstDisplayTerritoryIds: readonly TerritoryId[];
  /** Index where the next scan of the fixed display order begins. */
  readonly nextDisplayIndex: number;
  readonly auctioneerPlayerId: PlayerId;
  readonly awardedPlayerIds: readonly PlayerId[];
  readonly availableBidsByPlayerId: Readonly<Record<PlayerId, readonly number[]>>;
}

export interface PendingTerritorySplit {
  readonly id: string;
  readonly auctionId: string;
  readonly auctionKind: "START" | "NORMAL";
  readonly originalTerritoryId: TerritoryId;
  readonly reason: "TWO_HIGHEST_BIDDERS";
  readonly tiedPlayerIds: readonly [PlayerId, PlayerId];
  readonly bids: Readonly<Record<PlayerId, AuctionBid>>;
  readonly openerPlayerId?: PlayerId;
  readonly auctioneerPlayerId?: PlayerId;
  readonly dividerPlayerId?: PlayerId;
  readonly firstChooserPlayerId?: PlayerId;
}
