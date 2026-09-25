import type { AuctionBid, AuctionState, StartAuctionsState } from "../auctions/auction-state.js";
import type { GameState } from "../state/game-state.js";
import type { PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { Suit } from "../model/territory-card.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { PendingWar } from "../state/action-phase-state.js";
import { GamePhase } from "../state/game-phase.js";

export type VisibleAuctionBid = AuctionBid | { readonly submitted: true };
export type PublicPlayerView = Pick<Player, "id" | "name" | "globalInfluence" | "availableBasicBids" | "turnStatus">;

export type PlayerInputStatus = "ACTION_REQUIRED" | "OPTIONAL_DECISION" | "SUBMITTED" | "WAITING" | "PROCESSING";
export type PlayerInputAction =
  | "ACTIVATION" | "ACTIVATION_ROLL" | "START_BID" | "NORMAL_BID" | "BASIC_ACTION"
  | "SPLIT_DIVISION" | "SPLIT_CHOICE" | "WAR_SPADE_CHOICE" | "BORDER_ADVANCE"
  | "WAR_CUT_DIVISION" | "WAR_CUT_CHOICE" | "DIAMOND_CORRECTION" | "LARGEST_REALM";

/**
 * A semantic, player-specific interaction state. It lets clients describe the
 * current turn without deriving rules or exposing another player's choices.
 */
export interface PlayerInputState {
  readonly status: PlayerInputStatus;
  readonly action?: PlayerInputAction;
  readonly activePlayerId?: PlayerId;
  readonly submittedBidCount?: number;
  readonly requiredBidCount?: number;
}

export interface PlayerAuctionView extends Omit<AuctionState, "submittedBids"> {
  readonly submittedBids: Readonly<Partial<Record<PlayerId, VisibleAuctionBid>>>;
}

export interface PlayerStartAuctionsView extends Omit<StartAuctionsState, "availableBidsByPlayerId"> {
  /** Only the requesting player can inspect their remaining start bid values. */
  readonly availableBidsByPlayerId: Readonly<Partial<Record<PlayerId, readonly number[]>>>;
}

export interface PlayerGameView extends Omit<GameState, "auction" | "players" | "pendingWar" | "spadeActivations" | "events" | "startAuctions"> {
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
  readonly startAuctions?: PlayerStartAuctionsView;
  readonly pendingWar?: Omit<PendingWar, "spadeChoices"> & {
    readonly spadeChoices: Readonly<Partial<Record<PlayerId, string | null | "LOCKED">>>;
  };
  readonly playerInput: PlayerInputState;
}

function waiting(activePlayerId?: PlayerId): PlayerInputState {
  return { status: "WAITING", ...(activePlayerId === undefined ? {} : { activePlayerId }) };
}

function playerInputFor(state: GameState, viewerPlayerId: PlayerId): PlayerInputState {
  const split = state.pendingSplit;
  if (split !== undefined) {
    if (split.stage === "AWAITING_DIVISION") {
      return split.dividerPlayerId === viewerPlayerId
        ? { status: "ACTION_REQUIRED", action: "SPLIT_DIVISION", activePlayerId: split.dividerPlayerId }
        : waiting(split.dividerPlayerId);
    }
    return split.firstChooserPlayerId === viewerPlayerId
      ? { status: "ACTION_REQUIRED", action: "SPLIT_CHOICE", activePlayerId: split.firstChooserPlayerId }
      : waiting(split.firstChooserPlayerId);
  }
  const war = state.pendingWar;
  if (war !== undefined) {
    if (war.stage === "AWAITING_COMBAT_CHOICES") {
      if (war.attackerPlayerId !== viewerPlayerId && war.defenderPlayerId !== viewerPlayerId) return waiting();
      return Object.hasOwn(war.spadeChoices, viewerPlayerId)
        ? { status: "SUBMITTED", action: "WAR_SPADE_CHOICE" }
        : { status: "OPTIONAL_DECISION", action: "WAR_SPADE_CHOICE" };
    }
    const winnerId = war.combat?.winnerTerritoryId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId;
    if (war.stage === "AWAITING_BORDER_ADVANCE") {
      return winnerId === viewerPlayerId
        ? { status: "ACTION_REQUIRED", action: "BORDER_ADVANCE", activePlayerId: winnerId }
        : waiting(winnerId);
    }
    if (war.stage === "AWAITING_CUT_DIVISION") {
      return winnerId === viewerPlayerId
        ? { status: "ACTION_REQUIRED", action: "WAR_CUT_DIVISION", activePlayerId: winnerId }
        : waiting(winnerId);
    }
    if (war.stage === "AWAITING_CUT_CHOICE") {
      const chooserId = state.territories.find((territory) => territory.id === war.combat?.loserTerritoryId)?.ownerId;
      return chooserId === viewerPlayerId
        ? { status: "ACTION_REQUIRED", action: "WAR_CUT_CHOICE", activePlayerId: chooserId }
        : waiting(chooserId ?? undefined);
    }
    const correctorId = war.borderMark?.playerId;
    return correctorId === viewerPlayerId
      ? { status: "ACTION_REQUIRED", action: "DIAMOND_CORRECTION", activePlayerId: correctorId }
      : waiting(correctorId);
  }
  const diamond = state.pendingDiamondBorderChanges[0];
  if (diamond !== undefined) {
    return diamond.playerId === viewerPlayerId
      ? { status: "ACTION_REQUIRED", action: "DIAMOND_CORRECTION", activePlayerId: diamond.playerId }
      : waiting(diamond.playerId);
  }
  const auction = state.auction;
  if (auction !== undefined) {
    const submittedBidCount = Object.keys(auction.submittedBids).length;
    const requiredBidCount = auction.eligiblePlayerIds.length;
    if (!auction.eligiblePlayerIds.includes(viewerPlayerId)) {
      return { ...waiting(), submittedBidCount, requiredBidCount };
    }
    return auction.submittedBids[viewerPlayerId] === undefined
      ? { status: "ACTION_REQUIRED", action: auction.kind === "START" ? "START_BID" : "NORMAL_BID", submittedBidCount, requiredBidCount }
      : { status: "SUBMITTED", action: auction.kind === "START" ? "START_BID" : "NORMAL_BID", submittedBidCount, requiredBidCount };
  }
  if (state.phase === GamePhase.ActivationPhase) {
    const awaitingRoll = state.activation !== undefined && state.activation.pendingTerritoryIds.length === 0 &&
      state.pendingDiamondBorderChanges.length === 0 && state.activationNumbers.length < 3 &&
      state.activePlayerId === state.startPlayerId;
    if (awaitingRoll) {
      return viewerPlayerId === state.startPlayerId
        ? { status: "ACTION_REQUIRED", action: "ACTIVATION_ROLL", activePlayerId: state.startPlayerId }
        : waiting(state.startPlayerId);
    }
    return state.activePlayerId === viewerPlayerId
      ? { status: "ACTION_REQUIRED", action: "ACTIVATION", activePlayerId: viewerPlayerId }
      : waiting(state.activePlayerId);
  }
  if (state.phase === GamePhase.ActionPhase) {
    return state.activePlayerId === viewerPlayerId
      ? { status: "ACTION_REQUIRED", action: "BASIC_ACTION", activePlayerId: viewerPlayerId }
      : waiting(state.activePlayerId);
  }
  const scoringPlayerIds = state.scoring?.pendingLargestRealmPlayerIds ?? [];
  if (scoringPlayerIds.includes(viewerPlayerId)) {
    return { status: "ACTION_REQUIRED", action: "LARGEST_REALM", activePlayerId: viewerPlayerId };
  }
  return { status: "PROCESSING" };
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
  const { pendingWar: _pendingWar, spadeActivations: _spadeActivations, events: _events, startAuctions: _startAuctions, ...withoutWar } = state;
  const privateFields = {
    ...(viewerSecretFactionSuit === undefined ? {} : { viewerSecretFactionSuit }),
    ...(revealedFactionSuitsByPlayerId === undefined ? {} : { revealedFactionSuitsByPlayerId }),
    spadeActivations: state.spadeActivations.filter((effect) => effect.playerId === viewerPlayerId),
    events,
  };
  const playerInput = playerInputFor(state, viewerPlayerId);
  const startAuctions = state.startAuctions === undefined ? undefined : {
    ...state.startAuctions,
    availableBidsByPlayerId: {
      [viewerPlayerId]: state.startAuctions.availableBidsByPlayerId[viewerPlayerId] ?? [],
    },
  };
  if (auction === undefined) {
    const { auction: _auction, ...withoutAuction } = withoutWar;
    return { ...withoutAuction, ...privateFields, players, playerInput,
      ...(startAuctions === undefined ? {} : { startAuctions }), ...(pendingWar === undefined ? {} : { pendingWar }) };
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
    playerInput,
    ...(startAuctions === undefined ? {} : { startAuctions }),
    ...(pendingWar === undefined ? {} : { pendingWar }),
    auction: { ...auction, submittedBids },
  };
}
