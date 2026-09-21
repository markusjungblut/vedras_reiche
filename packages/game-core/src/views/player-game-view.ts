import type { AuctionBid, AuctionState } from "../auctions/auction-state.js";
import type { GameState } from "../state/game-state.js";
import type { PlayerId } from "../model/ids.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { PendingWar } from "../state/action-phase-state.js";
import { GamePhase } from "../state/game-phase.js";

export type VisibleAuctionBid = AuctionBid | { readonly submitted: true };

export interface PlayerAuctionView extends Omit<AuctionState, "submittedBids"> {
  readonly submittedBids: Readonly<Partial<Record<PlayerId, VisibleAuctionBid>>>;
}

export interface PlayerGameView extends Omit<GameState, "auction" | "players" | "pendingWar"> {
  readonly players: GameState["players"];
  readonly auction?: PlayerAuctionView;
  readonly pendingWar?: Omit<PendingWar, "spadeChoices"> & {
    readonly spadeChoices: Readonly<Partial<Record<PlayerId, string | null | "LOCKED">>>;
  };
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
    if (state.phase === GamePhase.Finished || player.id === viewerPlayerId) return player;
    const { secretFactionSuit: _secretFactionSuit, ...publicPlayer } = player;
    return publicPlayer;
  });
  const war = state.pendingWar;
  const pendingWar = war === undefined ? undefined : war.stage !== "AWAITING_COMBAT_CHOICES" ? war : {
    ...war,
    spadeChoices: Object.fromEntries(Object.entries(war.spadeChoices).map(([id, choice]) =>
      [id, id === viewerPlayerId ? choice : "LOCKED"])),
  };
  const auction = state.auction;
  const { pendingWar: _pendingWar, ...withoutWar } = state;
  if (auction === undefined) {
    const { auction: _auction, ...withoutAuction } = withoutWar;
    return { ...withoutAuction, players, ...(pendingWar === undefined ? {} : { pendingWar }) };
  }
  const submittedBids: Partial<Record<PlayerId, VisibleAuctionBid>> = {};
  for (const [playerId, bid] of Object.entries(auction.submittedBids)) {
    if (playerId === viewerPlayerId && bid !== undefined) submittedBids[playerId] = bid;
    else if (bid !== undefined) submittedBids[playerId] = { submitted: true };
  }
  return {
    ...withoutWar,
    players,
    ...(pendingWar === undefined ? {} : { pendingWar }),
    auction: { ...auction, submittedBids },
  };
}
