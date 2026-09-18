import type { AuctionBid, AuctionState } from "../auctions/auction-state.js";
import type { GameState } from "../state/game-state.js";
import type { PlayerId } from "../model/ids.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";

export type VisibleAuctionBid = AuctionBid | { readonly submitted: true };

export interface PlayerAuctionView extends Omit<AuctionState, "submittedBids"> {
  readonly submittedBids: Readonly<Partial<Record<PlayerId, VisibleAuctionBid>>>;
}

export interface PlayerGameView extends Omit<GameState, "auction" | "players"> {
  readonly players: GameState["players"];
  readonly auction?: PlayerAuctionView;
}

/**
 * Projects a state for one player. Opponent bid values are absent while the
 * auction is still collecting bids; a submitted marker is retained instead.
 */
export function createGameViewForPlayer(
  state: GameState,
  viewerPlayerId: PlayerId,
): PlayerGameView {
  if (!state.players.some((player) => player.id === viewerPlayerId)) {
    throw new DomainError(DomainErrorCode.InvalidPlayerOrder);
  }
  const players = state.players.map((player) => {
    if (player.id === viewerPlayerId) return player;
    const { secretFactionSuit: _secretFactionSuit, ...publicPlayer } = player;
    return publicPlayer;
  });
  const auction = state.auction;
  if (auction === undefined) {
    const { auction: _auction, ...withoutAuction } = state;
    return { ...withoutAuction, players };
  }
  const submittedBids: Partial<Record<PlayerId, VisibleAuctionBid>> = {};
  for (const [playerId, bid] of Object.entries(auction.submittedBids)) {
    if (playerId === viewerPlayerId && bid !== undefined) submittedBids[playerId] = bid;
    else if (bid !== undefined) submittedBids[playerId] = { submitted: true };
  }
  return {
    ...state,
    players,
    auction: { ...auction, submittedBids },
  };
}
