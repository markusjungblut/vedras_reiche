import type { AuctionBid, AuctionState } from "../auctions/auction-state.js";
import type { GameState } from "../state/game-state.js";
import type { PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { Suit } from "../model/territory-card.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { PendingWar } from "../state/action-phase-state.js";
import { GamePhase } from "../state/game-phase.js";

export type VisibleAuctionBid = AuctionBid | { readonly submitted: true };
export type PublicPlayerView = Pick<Player, "id" | "name" | "globalInfluence" | "availableBasicBids" | "turnStatus">;

export interface PlayerAuctionView extends Omit<AuctionState, "submittedBids"> {
  readonly submittedBids: Readonly<Partial<Record<PlayerId, VisibleAuctionBid>>>;
}

export interface PlayerGameView extends Omit<GameState, "auction" | "players" | "pendingWar" | "spadeActivations" | "events"> {
  /** Never contains a secret faction while the game is running. */
  readonly players: readonly PublicPlayerView[];
  /** The requesting player's faction, separate from the public player list. */
  readonly viewerSecretFactionSuit?: Suit;
  /** Factions become public only after the game has finished. */
  readonly revealedFactionSuitsByPlayerId?: Readonly<Partial<Record<PlayerId, Suit>>>;
  /** Only the requesting player's available ♠ effects are visible before they resolve. */
  readonly spadeActivations: readonly GameState["spadeActivations"][number][];
  /** Private ♠ event metadata is removed for other players. */
  readonly events: GameState["events"];
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
  const players: PublicPlayerView[] = state.players.map((player) => ({
    id: player.id,
    ...(player.name === undefined ? {} : { name: player.name }),
    ...(player.globalInfluence === undefined ? {} : { globalInfluence: player.globalInfluence }),
    ...(player.availableBasicBids === undefined ? {} : { availableBasicBids: player.availableBasicBids }),
    ...(player.turnStatus === undefined ? {} : { turnStatus: player.turnStatus }),
  }));
  const viewerSecretFactionSuit = state.phase === GamePhase.Finished ? undefined
    : state.players.find((player) => player.id === viewerPlayerId)?.secretFactionSuit;
  const revealedFactionSuitsByPlayerId = state.phase !== GamePhase.Finished ? undefined : Object.fromEntries(
    state.players.flatMap((player) => player.secretFactionSuit === undefined ? [] : [[player.id, player.secretFactionSuit]]),
  ) as Readonly<Partial<Record<PlayerId, Suit>>>;
  const war = state.pendingWar;
  const pendingWar = war === undefined ? undefined : war.stage !== "AWAITING_COMBAT_CHOICES" ? war : {
    ...war,
    spadeChoices: Object.fromEntries(Object.entries(war.spadeChoices).map(([id, choice]) =>
      [id, id === viewerPlayerId ? choice : "LOCKED"])),
  };
  const auction = state.auction;
  const privateEventTypes = new Set(["SPADE_ACTIVATION_STORED", "WAR_SPADE_CHOICE_LOCKED"]);
  const events = state.events.flatMap((event) => {
    if (privateEventTypes.has(event.type) && event.actorId !== viewerPlayerId) return [];
    if (event.type === "SPADE_ACTIVATION_USED") {
      const { activationId: _activationId, effectId: _effectId, ...payload } = event.payload;
      return [{ ...event, payload }];
    }
    return [event];
  });
  const { pendingWar: _pendingWar, spadeActivations: _spadeActivations, events: _events, ...withoutWar } = state;
  const privateFields = {
    ...(viewerSecretFactionSuit === undefined ? {} : { viewerSecretFactionSuit }),
    ...(revealedFactionSuitsByPlayerId === undefined ? {} : { revealedFactionSuitsByPlayerId }),
    spadeActivations: state.spadeActivations.filter((effect) => effect.playerId === viewerPlayerId),
    events,
  };
  if (auction === undefined) {
    const { auction: _auction, ...withoutAuction } = withoutWar;
    return { ...withoutAuction, ...privateFields, players, ...(pendingWar === undefined ? {} : { pendingWar }) };
  }
  const submittedBids: Partial<Record<PlayerId, VisibleAuctionBid>> = {};
  for (const [playerId, bid] of Object.entries(auction.submittedBids)) {
    if (playerId === viewerPlayerId && bid !== undefined) submittedBids[playerId] = bid;
    else if (bid !== undefined) submittedBids[playerId] = { submitted: true };
  }
  return {
    ...withoutWar,
    ...privateFields,
    players,
    ...(pendingWar === undefined ? {} : { pendingWar }),
    auction: { ...auction, submittedBids },
  };
}
