import type { ActionResult } from "../actions/action-result.js";
import type { SubmitAuctionBidAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { getNextPlayer, determineSplitRoles } from "../rules/player-order.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import type { AuctionBid, StartAuctionsState } from "./auction-state.js";

function result(state: GameState, timestamp: string, descriptions: readonly EventDescription[]): ActionResult {
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...state, events: [...state.events, ...events] }, events };
}

function requireStartAuctions(state: GameState): StartAuctionsState {
  if (state.phase !== GamePhase.StartAuctions || !state.startAuctions) {
    throw new DomainError(DomainErrorCode.InvalidPhase, "Start auctions are not active.");
  }
  return state.startAuctions;
}

function fullBidSet(playerCount: number): number[] {
  return Array.from({ length: playerCount + 1 }, (_, value) => value);
}

function bidSets(playerIds: readonly PlayerId[]): Record<PlayerId, readonly number[]> {
  return Object.fromEntries(playerIds.map((id) => [id, fullBidSet(playerIds.length)]));
}

function randomDisplay(
  state: GameState,
  excludedIds: readonly TerritoryId[],
  random: RandomSource,
): TerritoryId[] {
  const excluded = new Set(excludedIds);
  const pool = state.territories
    .filter((territory) => territory.ownerId === null && !excluded.has(territory.id))
    .map((territory) => territory.id);
  if (new Set(pool).size !== pool.length) {
    throw new DomainError(DomainErrorCode.InvalidStartAuctionState,
      "Neutral territory IDs must be unique.");
  }
  const needed = state.players.length + 1;
  if (pool.length < needed) {
    throw new DomainError(DomainErrorCode.NoEligibleStartTerritory,
      `Start auction display needs ${needed} eligible neutral territories.`);
  }
  const display: TerritoryId[] = [];
  for (let index = 0; index < needed; index += 1) {
    const drawnIndex = random.nextInt(0, pool.length - 1);
    if (!Number.isInteger(drawnIndex) || drawnIndex < 0 || drawnIndex >= pool.length) {
      throw new RangeError("Random source returned an invalid territory index.");
    }
    display.push(pool.splice(drawnIndex, 1)[0]!);
  }
  return display;
}

function roundDescriptions(round: 1 | 2, display: readonly TerritoryId[]): EventDescription[] {
  return [
    { type: GameEventType.StartAuctionRoundStarted, payload: { round } },
    { type: GameEventType.StartAuctionDisplayCreated, payload: { round, territoryIds: display } },
  ];
}

/** Starts §8 with the clockwise successor of the last setup actor as auctioneer. */
export function beginStartAuctions(
  state: GameState,
  lastSetupPlayerId: PlayerId,
  random: RandomSource,
  timestamp: string,
): ActionResult {
  if (state.phase !== GamePhase.Setup || state.startAuctions || state.auction || state.pendingSplit) {
    throw new DomainError(DomainErrorCode.InvalidPhase, "Start auctions can begin only after setup.");
  }
  if (!state.players.some((player) => player.id === lastSetupPlayerId)) {
    throw new DomainError(DomainErrorCode.InvalidPlayerOrder, "Last setup actor is not seated.");
  }
  if (state.territories.some((territory) => territory.ownerId !== null)) {
    throw new DomainError(DomainErrorCode.InvalidStartAuctionState,
      "No player may own a territory before the start auctions.");
  }
  const display = randomDisplay(state, [], random);
  const playerIds = state.players.map((player) => player.id);
  return result({
    ...state,
    phase: GamePhase.StartAuctions,
    startAuctions: {
      round: 1,
      displayTerritoryIds: display,
      firstDisplayTerritoryIds: display,
      nextDisplayIndex: 0,
      auctioneerPlayerId: getNextPlayer(playerIds, lastSetupPlayerId),
      awardedPlayerIds: [],
      availableBidsByPlayerId: bidSets(playerIds),
    },
  }, timestamp, roundDescriptions(1, display));
}

/** Scans the fixed display, wrapping to its first still-neutral territory. */
export function openNextStartAuction(state: GameState, timestamp: string): ActionResult {
  const start = requireStartAuctions(state);
  if (state.auction || state.pendingSplit) {
    throw new DomainError(DomainErrorCode.AuctionAlreadyActive);
  }
  if (start.awardedPlayerIds.length === state.players.length) {
    throw new DomainError(DomainErrorCode.InvalidStartAuctionState, "This start auction round has ended.");
  }
  const display = start.displayTerritoryIds;
  let displayIndex = -1;
  for (let offset = 0; offset < display.length; offset += 1) {
    const index = (start.nextDisplayIndex + offset) % display.length;
    const territory = state.territories.find((item) => item.id === display[index]);
    if (territory?.ownerId === null) {
      displayIndex = index;
      break;
    }
  }
  if (displayIndex < 0) {
    throw new DomainError(DomainErrorCode.NoEligibleStartTerritory);
  }
  const territoryId = display[displayIndex]!;
  const eligiblePlayerIds = state.players
    .map((player) => player.id)
    .filter((id) => !start.awardedPlayerIds.includes(id));
  const auctionId = `${state.gameId}:start-auction:${start.round}:${state.events.length + 1}`;
  return result({
    ...state,
    startAuctions: { ...start, nextDisplayIndex: (displayIndex + 1) % display.length },
    auction: {
      id: auctionId,
      kind: "START",
      territoryId,
      auctioneerPlayerId: start.auctioneerPlayerId,
      eligiblePlayerIds,
      submittedBids: {},
      status: "BIDDING",
    },
  }, timestamp, [{
    type: GameEventType.AuctionOpened,
    actorId: start.auctioneerPlayerId,
    payload: { auctionId, kind: "START", round: start.round, territoryId, eligiblePlayerIds },
  }]);
}

function successorAuctioneer(state: GameState, start: StartAuctionsState): PlayerId {
  return getNextPlayer(state.players.map((player) => player.id), start.auctioneerPlayerId);
}

function finishResolvedAuction(
  state: GameState,
  awardedPlayerIds: readonly PlayerId[],
  random: RandomSource,
  timestamp: string,
  descriptions: readonly EventDescription[],
): ActionResult {
  const start = requireStartAuctions(state);
  const nextAwarded = [...start.awardedPlayerIds, ...awardedPlayerIds];
  if (new Set(nextAwarded).size !== nextAwarded.length) {
    throw new DomainError(DomainErrorCode.InvalidStartAuctionState, "A player cannot win twice in one start round.");
  }
  const nextStart: StartAuctionsState = {
    ...start,
    auctioneerPlayerId: successorAuctioneer(state, start),
    awardedPlayerIds: nextAwarded,
  };
  let nextState: GameState = { ...state, auction: undefined, pendingSplit: undefined, startAuctions: nextStart };
  if (nextAwarded.length === state.players.length && start.round === 1) {
    for (const player of state.players) {
      if (state.territories.filter((territory) => territory.ownerId === player.id).length !== 1) {
        throw new DomainError(DomainErrorCode.InvalidStartAuctionState,
          "Every player must own exactly one territory after start auction round one.");
      }
    }
    const display = randomDisplay(state, start.firstDisplayTerritoryIds, random);
    const playerIds = state.players.map((player) => player.id);
    nextState = { ...nextState,
      startAuctions: {
        round: 2,
        displayTerritoryIds: display,
        firstDisplayTerritoryIds: start.firstDisplayTerritoryIds,
        nextDisplayIndex: 0,
        auctioneerPlayerId: nextStart.auctioneerPlayerId,
        awardedPlayerIds: [],
        availableBidsByPlayerId: bidSets(playerIds),
      },
    };
    return result(nextState, timestamp, [...descriptions, ...roundDescriptions(2, display)]);
  }
  if (nextAwarded.length === state.players.length && start.round === 2) {
    for (const player of state.players) {
      if (state.territories.filter((territory) => territory.ownerId === player.id).length !== 2) {
        throw new DomainError(DomainErrorCode.InvalidStartAuctionState,
          "Every player must own exactly two territories after start auctions.");
      }
    }
    nextState = {
      ...nextState,
      phase: GamePhase.RoundReady,
      players: state.players.map((player) => ({
        ...player,
        globalInfluence: 6,
        availableBasicBids: [1, 2, 3],
      })),
    };
  }
  return result(nextState, timestamp, descriptions);
}

function refreshedBids(
  start: StartAuctionsState,
  bids: Readonly<Record<PlayerId, AuctionBid>>,
  playerCount: number,
  eligiblePlayerIds: readonly PlayerId[],
  awardedPlayerIds: readonly PlayerId[],
): { readonly available: Readonly<Record<PlayerId, readonly number[]>>; readonly descriptions: EventDescription[] } {
  const available: Record<PlayerId, readonly number[]> = { ...start.availableBidsByPlayerId };
  const descriptions: EventDescription[] = [];
  for (const id of eligiblePlayerIds) {
    const bid = bids[id];
    if (bid?.kind !== "START") {
      throw new DomainError(DomainErrorCode.InvalidAuctionTarget, "Expected a start bid.");
    }
    const remaining = (available[id] ?? []).filter((value) => value !== bid.value);
    if (remaining.length === 0 && !awardedPlayerIds.includes(id)) {
      available[id] = fullBidSet(playerCount);
      descriptions.push({ type: GameEventType.StartBidRefreshed, actorId: id,
        payload: { playerId: id, round: start.round } });
    } else {
      available[id] = remaining;
    }
  }
  return { available, descriptions };
}

/** Records one private bid; reveals and resolves only when every eligible player has bid. */
export function submitStartAuctionBid(
  state: GameState,
  action: SubmitAuctionBidAction,
  random: RandomSource,
  timestamp: string,
): ActionResult {
  const start = requireStartAuctions(state);
  const auction = state.auction;
  if (!auction || auction.id !== action.auctionId || auction.kind !== "START" || auction.status !== "BIDDING" || state.pendingSplit) {
    throw new DomainError(DomainErrorCode.AuctionNotBidding);
  }
  if (!auction.eligiblePlayerIds.includes(action.playerId)) {
    throw new DomainError(DomainErrorCode.NotEligibleBidder);
  }
  if (auction.submittedBids[action.playerId]) {
    throw new DomainError(DomainErrorCode.BidAlreadySubmitted);
  }
  if (action.bid.kind !== "START" || !Number.isInteger(action.bid.value) ||
      action.bid.value < 0 || action.bid.value > state.players.length ||
      !start.availableBidsByPlayerId[action.playerId]?.includes(action.bid.value)) {
    throw new DomainError(DomainErrorCode.InvalidBid, "Start bid must be currently available in 0..P.");
  }
  const submittedBids = { ...auction.submittedBids, [action.playerId]: action.bid };
  const bidSubmitted: EventDescription = {
    type: GameEventType.AuctionBidSubmitted,
    actorId: action.playerId,
    payload: { auctionId: auction.id, playerId: action.playerId },
  };
  if (!auction.eligiblePlayerIds.every((id) => submittedBids[id])) {
    return result({ ...state, auction: { ...auction, submittedBids } }, timestamp, [bidSubmitted]);
  }
  const bids = submittedBids as Readonly<Record<PlayerId, AuctionBid>>;
  const values = auction.eligiblePlayerIds.map((id) => {
    const bid = bids[id];
    if (bid?.kind !== "START") throw new DomainError(DomainErrorCode.InvalidBid);
    return bid.value;
  });
  const highest = Math.max(...values);
  const tiedPlayerIds = auction.eligiblePlayerIds.filter((id) => {
    const bid = bids[id];
    return bid?.kind === "START" && bid.value === highest;
  });
  const consumed = refreshedBids(start, bids, state.players.length, auction.eligiblePlayerIds,
    highest === 0 || tiedPlayerIds.length >= 3 ? [] : tiedPlayerIds);
  const reveal: EventDescription = { type: GameEventType.AuctionBidsRevealed,
    payload: { auctionId: auction.id, bids } };
  const baseDescriptions = [bidSubmitted, reveal, ...consumed.descriptions];
  const consumedState: GameState = { ...state,
    startAuctions: { ...start, availableBidsByPlayerId: consumed.available },
    auction: { ...auction, submittedBids },
  };
  if (highest === 0 || tiedPlayerIds.length >= 3) {
    const reason = highest === 0 ? "ALL_ZERO" : "THREE_OR_MORE_HIGHEST";
    const tieDescriptions: EventDescription[] = highest === 0 ? [] : [{
      type: GameEventType.AuctionTiedMultiplePlayers,
      payload: { auctionId: auction.id, territoryId: auction.territoryId,
        playerIds: tiedPlayerIds, reason },
    }];
    return finishResolvedAuction(consumedState, [], random, timestamp,
      [...baseDescriptions, ...tieDescriptions,
        { type: GameEventType.AuctionResolved, payload: { auctionId: auction.id, result: reason } }]);
  }
  if (tiedPlayerIds.length === 2) {
    const roles = determineSplitRoles(
      state.players.map((player) => player.id),
      start.auctioneerPlayerId,
      [tiedPlayerIds[0]!, tiedPlayerIds[1]!],
    );
    const splitId = `${auction.id}:split`;
    return result({ ...consumedState,
      pendingSplit: {
        id: splitId,
        auctionId: auction.id,
        auctionKind: "START",
        originalTerritoryId: auction.territoryId,
        reason: "TWO_HIGHEST_BIDDERS",
        tiedPlayerIds: [tiedPlayerIds[0]!, tiedPlayerIds[1]!],
        bids,
        auctioneerPlayerId: start.auctioneerPlayerId,
        ...roles,
        stage: "AWAITING_DIVISION",
      },
    }, timestamp, [...baseDescriptions,
      { type: GameEventType.AuctionTiedTwoPlayers,
        payload: { auctionId: auction.id, territoryId: auction.territoryId, tiedPlayerIds } },
      { type: GameEventType.TerritorySplitRequired,
        payload: { splitId, auctionId: auction.id, territoryId: auction.territoryId,
          dividerPlayerId: roles.dividerPlayerId, firstChooserPlayerId: roles.firstChooserPlayerId } },
    ]);
  }
  const winnerId = tiedPlayerIds[0]!;
  const territory = state.territories.find((item) => item.id === auction.territoryId);
  if (!territory || territory.ownerId !== null) {
    throw new DomainError(DomainErrorCode.InvalidAuctionTarget);
  }
  const wonState: GameState = { ...consumedState,
    territories: state.territories.map((item) => item.id === territory.id
      ? { ...item, ownerId: winnerId } : item),
  };
  return finishResolvedAuction(wonState, [winnerId], random, timestamp, [...baseDescriptions,
    { type: GameEventType.AuctionWon, actorId: winnerId,
      payload: { auctionId: auction.id, territoryId: territory.id, winnerId } },
    { type: GameEventType.TerritoryOwnerChanged,
      payload: { territoryId: territory.id, previousOwnerId: null, ownerId: winnerId } },
    { type: GameEventType.AuctionResolved,
      payload: { auctionId: auction.id, result: "WON", winnerId } },
  ]);
}

/** Completes a pending split after the map resolver has supplied validated geometry. */
export function completeStartAuctionAfterSplit(
  state: GameState,
  awardedPlayerIds: readonly PlayerId[],
  random: RandomSource,
  timestamp: string,
): ActionResult {
  const start = requireStartAuctions(state);
  const split = state.pendingSplit;
  if (!split || split.auctionKind !== "START" || !state.auction ||
      state.auction.id !== split.auctionId) {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  if (!(awardedPlayerIds.length === 0 ||
      (awardedPlayerIds.length === 2 &&
        awardedPlayerIds.every((id) => split.tiedPlayerIds.includes(id)) &&
        new Set(awardedPlayerIds).size === 2))) {
    throw new DomainError(DomainErrorCode.InvalidSplitResolution);
  }
  if (awardedPlayerIds.length === 0) {
    const territory = state.territories.find((item) => item.id === split.originalTerritoryId);
    if (!territory || territory.ownerId !== null) {
      throw new DomainError(DomainErrorCode.InvalidSplitResolution,
        "An unsplit territory must remain neutral.");
    }
  } else {
    const original = state.territories.find((item) => item.id === split.originalTerritoryId);
    if (!original || !awardedPlayerIds.includes(original.ownerId ?? "")) {
      throw new DomainError(DomainErrorCode.InvalidSplitResolution,
        "The original card part must belong to one of the tied players.");
    }
    for (const id of awardedPlayerIds) {
      if (start.awardedPlayerIds.includes(id) ||
          state.territories.filter((territory) => territory.ownerId === id).length !== start.round) {
        throw new DomainError(DomainErrorCode.InvalidSplitResolution);
      }
    }
  }
  const available = { ...start.availableBidsByPlayerId };
  const refreshDescriptions: EventDescription[] = [];
  if (awardedPlayerIds.length === 0) {
    for (const id of split.tiedPlayerIds) {
      if (available[id]?.length === 0) {
        available[id] = fullBidSet(state.players.length);
        refreshDescriptions.push({ type: GameEventType.StartBidRefreshed, actorId: id,
          payload: { playerId: id, round: start.round } });
      }
    }
  }
  return finishResolvedAuction({ ...state,
    startAuctions: { ...start, availableBidsByPlayerId: available },
  }, awardedPlayerIds, random, timestamp, [...refreshDescriptions, {
    type: GameEventType.AuctionResolved,
    payload: { auctionId: split.auctionId,
      result: awardedPlayerIds.length === 0 ? "SPLIT_NOT_POSSIBLE" : "SPLIT_WON",
      winnerIds: awardedPlayerIds },
  }]);
}
