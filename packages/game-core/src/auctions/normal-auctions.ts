import type { ActionResult } from "../actions/action-result.js";
import type { OpenAuctionAction, SubmitAuctionBidAction } from "../actions/game-action.js";
import type { AuctionState, NormalAuctionBid, PendingTerritorySplit } from "./auction-state.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import { getPotentialAuctionTerritoryIds } from "../state/action-phase.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import { determineSplitRoles } from "../rules/player-order.js";

const BASIC_BIDS = [1, 2, 3] as const;

function isNormalBid(bid: SubmitAuctionBidAction["bid"]): bid is NormalAuctionBid {
  return bid.kind === "NORMAL";
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function bidValue(bid: NormalAuctionBid): number {
  return bid.basicBid + bid.globalInfluence + bid.localInfluence;
}

function appendEvents(
  state: GameState,
  timestamp: string,
  nextState: GameState,
  descriptions: readonly EventDescription[],
): ActionResult {
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...nextState, events: [...state.events, ...events] }, events };
}

/** Opens an auction as the active player's basic action. Every player must bid. */
export function openNormalAuction(
  state: GameState,
  action: OpenAuctionAction,
  timestamp: string,
): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.activePlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.NotActivePlayer);
  }
  if (state.actionPhase.completedPlayerIds.includes(action.playerId)) {
    throw new DomainError(DomainErrorCode.ActionAlreadyCompleted);
  }
  if (state.auction !== undefined) {
    throw new DomainError(DomainErrorCode.AuctionAlreadyActive);
  }
  if (state.pendingSplit !== undefined) {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  if (state.pendingWar !== undefined) {
    throw new DomainError(DomainErrorCode.PendingWarRequired);
  }
  const { auctionsOpenedByActivePlayer, secondAuctionAvailable } = state.actionPhase;
  if (state.actionPhase.currentActionKind === "WAR") throw new DomainError(DomainErrorCode.InvalidPhase);
  if (auctionsOpenedByActivePlayer !== 0 &&
      !(auctionsOpenedByActivePlayer === 1 && secondAuctionAvailable)) {
    throw new DomainError(DomainErrorCode.SecondAuctionUnavailable);
  }

  const target = state.territories.find((territory) => territory.id === action.territoryId);
  if (target === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  if (target.ownerId !== null || !getPotentialAuctionTerritoryIds(state, action.playerId).includes(target.id)) {
    throw new DomainError(DomainErrorCode.InvalidAuctionTarget);
  }

  const auction: AuctionState = {
    id: `${state.gameId}:auction:${state.events.length + 1}`,
    kind: "NORMAL",
    territoryId: target.id,
    openerPlayerId: action.playerId,
    eligiblePlayerIds: state.players.map((player) => player.id),
    submittedBids: {},
    status: "BIDDING",
  };
  return appendEvents(state, timestamp, {
    ...state,
    auction,
    actionPhase: {
      ...state.actionPhase,
      currentActionKind: "AUCTION",
      auctionsOpenedByActivePlayer: auctionsOpenedByActivePlayer === 0 ? 1 : 2,
      secondAuctionAvailable: false,
    },
  }, [{
    type: GameEventType.AuctionOpened,
    actorId: action.playerId,
    payload: {
      auctionId: auction.id,
      kind: auction.kind,
      territoryId: target.id,
      openerPlayerId: action.playerId,
      eligiblePlayerIds: auction.eligiblePlayerIds,
    },
  }]);
}

function validateBid(state: GameState, action: SubmitAuctionBidAction): NormalAuctionBid {
  if (!isNormalBid(action.bid) || !BASIC_BIDS.includes(action.bid.basicBid)) {
    throw new DomainError(DomainErrorCode.InvalidBid);
  }
  const bidder = state.players.find((player) => player.id === action.playerId);
  if (bidder === undefined) {
    throw new DomainError(DomainErrorCode.NotEligibleBidder);
  }
  if (!bidder.availableBasicBids?.includes(action.bid.basicBid)) {
    throw new DomainError(DomainErrorCode.BasicBidUnavailable);
  }
  if (!isNonNegativeInteger(action.bid.globalInfluence) ||
      !isNonNegativeInteger(action.bid.localInfluence)) {
    throw new DomainError(DomainErrorCode.InvalidBid);
  }
  if (!Number.isSafeInteger(bidValue(action.bid))) {
    throw new DomainError(DomainErrorCode.InvalidBid);
  }
  if (bidder.globalInfluence === undefined ||
      action.bid.globalInfluence > bidder.globalInfluence) {
    throw new DomainError(DomainErrorCode.InsufficientGlobalInfluence);
  }
  const territory = state.territories.find((candidate) => candidate.id === state.auction?.territoryId);
  if (territory === undefined || territory.ownerId !== null) {
    throw new DomainError(DomainErrorCode.InvalidAuctionTarget);
  }
  if (action.bid.localInfluence > (territory.localInfluenceByPlayerId?.[action.playerId] ?? 0)) {
    throw new DomainError(DomainErrorCode.InsufficientLocalInfluence);
  }
  return action.bid;
}

function spendWinnerBid(
  player: Player,
  bid: NormalAuctionBid,
): { player: Player; refreshed: boolean } {
  // Validation guarantees both resources are initialized before this function runs.
  const available = player.availableBasicBids!.filter((value) => value !== bid.basicBid);
  const refreshed = available.length === 0;
  return {
    player: {
      ...player,
      globalInfluence: player.globalInfluence! - bid.globalInfluence,
      availableBasicBids: refreshed ? [...BASIC_BIDS] : available,
    },
    refreshed,
  };
}

/** An unresolved highest tie consumes only its participating basic bids. */
function exhaustTiedBasicBids(
  players: readonly Player[], tiedPlayerIds: readonly PlayerId[], bids: Readonly<Record<PlayerId, NormalAuctionBid>>,
): { readonly players: readonly Player[]; readonly refreshedPlayerIds: readonly PlayerId[] } {
  const refreshedPlayerIds: PlayerId[] = [];
  const nextPlayers = players.map((player) => {
    if (!tiedPlayerIds.includes(player.id)) return player;
    const remaining = player.availableBasicBids!.filter((value) => value !== bids[player.id]!.basicBid);
    const refreshed = remaining.length === 0;
    if (refreshed) refreshedPlayerIds.push(player.id);
    return { ...player, availableBasicBids: refreshed ? [...BASIC_BIDS] : remaining };
  });
  return { players: nextPlayers, refreshedPlayerIds };
}

/** Submits one hidden bid and resolves atomically when the final player has bid. */
export function submitNormalAuctionBid(
  state: GameState,
  action: SubmitAuctionBidAction,
  timestamp: string,
): ActionResult {
  if (state.phase !== GamePhase.ActionPhase || state.actionPhase === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const auction = state.auction;
  if (auction === undefined || auction.id !== action.auctionId || auction.kind !== "NORMAL") {
    throw new DomainError(DomainErrorCode.AuctionNotFound);
  }
  if (auction.status !== "BIDDING") {
    throw new DomainError(DomainErrorCode.AuctionNotBidding);
  }
  if (!auction.eligiblePlayerIds.includes(action.playerId)) {
    throw new DomainError(DomainErrorCode.NotEligibleBidder);
  }
  if (Object.hasOwn(auction.submittedBids, action.playerId)) {
    throw new DomainError(DomainErrorCode.BidAlreadySubmitted);
  }
  const bid = validateBid(state, action);
  const submittedBids = { ...auction.submittedBids, [action.playerId]: bid };
  const descriptions: EventDescription[] = [{
    type: GameEventType.AuctionBidSubmitted,
    actorId: action.playerId,
    payload: { auctionId: auction.id, playerId: action.playerId },
  }];
  if (!auction.eligiblePlayerIds.every((playerId) => submittedBids[playerId] !== undefined)) {
    return appendEvents(state, timestamp, { ...state, auction: { ...auction, submittedBids } }, descriptions);
  }

  const bids = Object.fromEntries(auction.eligiblePlayerIds.map((playerId) => {
    const submitted = submittedBids[playerId];
    if (submitted?.kind !== "NORMAL") {
      throw new DomainError(DomainErrorCode.InvalidBid);
    }
    return [playerId, submitted];
  })) as Record<PlayerId, NormalAuctionBid>;
  const highest = Math.max(...Object.values(bids).map(bidValue));
  const tiedPlayerIds = auction.eligiblePlayerIds.filter((playerId) => bidValue(bids[playerId]!) === highest);
  descriptions.push({
    type: GameEventType.AuctionBidsRevealed,
    payload: { auctionId: auction.id, territoryId: auction.territoryId, bids },
  });
  const { auction: _auction, ...withoutAuction } = state;

  if (tiedPlayerIds.length === 1) {
    const winnerId = tiedPlayerIds[0]!;
    const winningBid = bids[winnerId]!;
    let refreshed = false;
    const players = state.players.map((player) => {
      if (player.id !== winnerId) return player;
      const result = spendWinnerBid(player, winningBid);
      refreshed = result.refreshed;
      return result.player;
    });
    const target = state.territories.find((territory) => territory.id === auction.territoryId)!;
    const localInfluenceCleared = target.localInfluenceByPlayerId ?? {};
    const hasLocalInfluence = Object.values(localInfluenceCleared).some((amount) => amount > 0);
    const territories = state.territories.map((territory) => territory.id === auction.territoryId
      ? { ...territory, ownerId: winnerId, localInfluenceByPlayerId: {} }
      : territory);
    descriptions.push(
      { type: GameEventType.AuctionWon, actorId: winnerId, payload: { auctionId: auction.id, territoryId: auction.territoryId, playerId: winnerId, value: highest } },
      { type: GameEventType.TerritoryOwnerChanged, actorId: winnerId, payload: { territoryId: auction.territoryId, previousOwnerId: null, ownerId: winnerId } },
      { type: GameEventType.BasicBidExhausted, actorId: winnerId, payload: { auctionId: auction.id, playerId: winnerId, basicBid: winningBid.basicBid } },
      { type: GameEventType.GlobalInfluenceSpent, actorId: winnerId, payload: { auctionId: auction.id, playerId: winnerId, amount: winningBid.globalInfluence } },
    );
    if (winningBid.localInfluence > 0) descriptions.push({ type: GameEventType.LocalInfluenceSpent, actorId: winnerId,
      payload: { auctionId: auction.id, territoryId: auction.territoryId, playerId: winnerId, amount: winningBid.localInfluence } });
    if (hasLocalInfluence) descriptions.push({ type: GameEventType.LocalInfluenceCleared,
      payload: { territoryId: auction.territoryId, influenceByPlayerId: localInfluenceCleared } });
    if (refreshed) {
      descriptions.push({ type: GameEventType.BasicBidsRefreshed, actorId: winnerId, payload: { playerId: winnerId, availableBasicBids: BASIC_BIDS } });
    }
    return appendEvents(state, timestamp, { ...withoutAuction, players, territories }, descriptions);
  }

  if (tiedPlayerIds.length === 2) {
    const roles = determineSplitRoles(
      state.players.map((player) => player.id),
      auction.openerPlayerId!,
      [tiedPlayerIds[0]!, tiedPlayerIds[1]!],
    );
    const pendingSplit: PendingTerritorySplit = {
      id: `${auction.id}:split`,
      auctionId: auction.id,
      auctionKind: "NORMAL",
      originalTerritoryId: auction.territoryId,
      reason: "TWO_HIGHEST_BIDDERS",
      tiedPlayerIds: [tiedPlayerIds[0]!, tiedPlayerIds[1]!],
      bids,
      ...(auction.openerPlayerId === undefined ? {} : { openerPlayerId: auction.openerPlayerId }),
      ...roles,
      stage: "AWAITING_DIVISION",
    };
    descriptions.push(
      { type: GameEventType.AuctionTiedTwoPlayers, payload: { auctionId: auction.id, territoryId: auction.territoryId, playerIds: tiedPlayerIds, value: highest } },
      { type: GameEventType.TerritorySplitRequired, payload: {
        splitId: pendingSplit.id, auctionId: auction.id, territoryId: auction.territoryId,
        playerIds: tiedPlayerIds, dividerPlayerId: roles.dividerPlayerId,
        firstChooserPlayerId: roles.firstChooserPlayerId,
      } },
    );
    return appendEvents(state, timestamp, { ...withoutAuction, pendingSplit }, descriptions);
  }

  descriptions.push({
    type: GameEventType.AuctionTiedMultiplePlayers,
    payload: { auctionId: auction.id, territoryId: auction.territoryId, playerIds: tiedPlayerIds, value: highest },
  });
  const exhausted = exhaustTiedBasicBids(state.players, tiedPlayerIds, bids);
  for (const playerId of tiedPlayerIds) {
    descriptions.push({ type: GameEventType.BasicBidExhausted, actorId: playerId,
      payload: { auctionId: auction.id, playerId, basicBid: bids[playerId]!.basicBid, reason: "UNRESOLVED_HIGHEST_TIE" } });
    if (exhausted.refreshedPlayerIds.includes(playerId)) {
      descriptions.push({ type: GameEventType.BasicBidsRefreshed, actorId: playerId,
        payload: { playerId, availableBasicBids: BASIC_BIDS } });
    }
  }
  descriptions.push({ type: GameEventType.AuctionResolved,
    payload: { auctionId: auction.id, result: "UNRESOLVED_HIGHEST_TIE", tiedPlayerIds } });
  const secondAuctionAvailable = state.actionPhase.auctionsOpenedByActivePlayer === 1;
  if (secondAuctionAvailable) {
    descriptions.push({ type: GameEventType.SecondAuctionAvailable, payload: { previousAuctionId: auction.id } });
  }
  return appendEvents(state, timestamp, {
    ...withoutAuction,
    players: exhausted.players,
    actionPhase: { ...state.actionPhase, secondAuctionAvailable },
  }, descriptions);
}
