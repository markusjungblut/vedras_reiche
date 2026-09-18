import assert from "node:assert/strict";
import test from "node:test";

import {
  GameActionType, GameEventType, GamePhase, Suit,
  createGameState, createTerritoryCard, startRound,
} from "../dist/index.js";
import {
  beginStartAuctions,
  completeStartAuctionAfterSplit,
  openNextStartAuction,
  submitStartAuctionBid,
} from "../dist/auctions/start-auctions.js";
import { resolveTerritorySplit } from "../dist/auctions/resolve-split.js";

const timestamp = "2026-09-18T12:00:00.000Z";

class SequenceRandomSource {
  constructor(values) { this.values = [...values]; }
  nextInt(min, max) {
    assert.ok(this.values.length > 0, `Unexpected random draw in [${min}, ${max}]`);
    const value = this.values.shift();
    assert.ok(Number.isInteger(value) && value >= min && value <= max);
    return value;
  }
}

function makeSetup(ids = ["A", "B"], territoryCount = 8) {
  return {
    ...createGameState({
      gameId: `start-${ids.join("")}`,
      players: ids.map((id) => ({ id })),
      startPlayerId: ids[0],
    }),
    territories: Array.from({ length: territoryCount }, (_, index) => ({
      id: `t${index + 1}`,
      ownerId: null,
      area: 4,
      adjacentTerritoryIds: [],
    })),
  };
}

function bid(state, playerId, value, random = new SequenceRandomSource([])) {
  return submitStartAuctionBid(state, {
    type: GameActionType.SubmitAuctionBid,
    playerId,
    auctionId: state.auction.id,
    bid: { kind: "START", value },
  }, random, timestamp);
}

function open(state) { return openNextStartAuction(state, timestamp).state; }

test("two start auction rounds use disjoint P+1 displays and end with two territories per player", () => {
  const random = new SequenceRandomSource(Array(6).fill(0));
  let state = beginStartAuctions(makeSetup(), "B", random, timestamp).state;
  assert.equal(state.phase, GamePhase.StartAuctions);
  assert.deepEqual(state.startAuctions.displayTerritoryIds, ["t1", "t2", "t3"]);
  assert.equal(state.startAuctions.auctioneerPlayerId, "A");
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.A, [0, 1, 2]);

  state = open(state);
  assert.equal(state.auction.territoryId, "t1");
  const firstBid = bid(state, "A", 1);
  assert.equal(firstBid.events[0].type, GameEventType.AuctionBidSubmitted);
  assert.deepEqual(firstBid.events[0].payload, {
    auctionId: state.auction.id, playerId: "A",
  });
  assert.equal(firstBid.events.some((event) => event.type === GameEventType.AuctionBidsRevealed), false);
  state = bid(firstBid.state, "B", 0).state;
  assert.equal(state.territories[0].ownerId, "A");
  assert.equal(state.startAuctions.auctioneerPlayerId, "B");
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.A, [0, 2]);
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.B, [1, 2]);

  state = open(state);
  assert.deepEqual(state.auction.eligiblePlayerIds, ["B"]);
  assert.equal(state.auction.territoryId, "t2");
  state = bid(state, "B", 1, random).state;
  assert.equal(state.startAuctions.round, 2);
  assert.deepEqual(state.startAuctions.displayTerritoryIds, ["t4", "t5", "t6"]);
  assert.equal(state.territories[1].ownerId, "B");
  assert.equal(state.startAuctions.auctioneerPlayerId, "A");
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.A, [0, 1, 2]);
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.B, [0, 1, 2]);

  state = open(state);
  state = bid(state, "A", 2).state;
  state = bid(state, "B", 1).state;
  state = open(state);
  state = bid(state, "B", 2).state;
  assert.equal(state.phase, GamePhase.RoundReady);
  assert.equal(state.startAuctions.round, 2);
  assert.deepEqual(state.startAuctions.awardedPlayerIds, ["A", "B"]);
  assert.equal(state.auction, undefined);
  assert.deepEqual(state.players.map((player) => player.globalInfluence), [6, 6]);
  assert.deepEqual(state.players.map((player) => player.availableBasicBids), [[1, 2, 3], [1, 2, 3]]);
  assert.deepEqual(state.players.map((player) => state.territories
    .filter((territory) => territory.ownerId === player.id).length), [2, 2]);
  assert.deepEqual(random.values, []);
  const round = startRound(state, new SequenceRandomSource([0, 1, 1, 2, 1, 3, 1]), timestamp);
  assert.equal(round.state.round, 1);
  assert.equal(round.events.some((event) => event.type === GameEventType.RoundStarted), true);
});

test("all zero and later non-awards rotate the auctioneer and wrap the fixed display", () => {
  let state = beginStartAuctions(makeSetup(), "B", new SequenceRandomSource([0, 0, 0]), timestamp).state;
  state = open(state);
  state = bid(state, "A", 0).state;
  let resolution = bid(state, "B", 0);
  state = resolution.state;
  assert.equal(state.territories[0].ownerId, null);
  assert.equal(state.startAuctions.auctioneerPlayerId, "B");
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.A, [1, 2]);
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.B, [1, 2]);
  assert.equal(resolution.events.some((event) => event.type === GameEventType.AuctionBidsRevealed), true);
  state = open(state);
  assert.equal(state.auction.territoryId, "t2");
  state = bid(state, "A", 1).state;
  state = bid(state, "B", 1).state;
  assert.equal(state.pendingSplit.dividerPlayerId, "B");
  assert.equal(state.pendingSplit.firstChooserPlayerId, "A");
  state = completeStartAuctionAfterSplit(state, [], new SequenceRandomSource([]), timestamp).state;
  assert.equal(state.startAuctions.auctioneerPlayerId, "A");
  state = open(state);
  assert.equal(state.auction.territoryId, "t3");
  state = bid(state, "A", 2).state;
  state = bid(state, "B", 2).state;
  state = completeStartAuctionAfterSplit(state, [], new SequenceRandomSource([]), timestamp).state;
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.A, [0, 1, 2]);
  assert.deepEqual(state.startAuctions.availableBidsByPlayerId.B, [0, 1, 2]);
  assert.equal(state.events.filter((event) => event.type === GameEventType.StartBidRefreshed).length, 2);
  state = open(state);
  assert.equal(state.auction.territoryId, "t1");
});

test("three highest bidders leave territory neutral and consume bids", () => {
  let state = beginStartAuctions(makeSetup(["A", "B", "C"], 9), "A",
    new SequenceRandomSource([0, 0, 0, 0]), timestamp).state;
  assert.equal(state.startAuctions.auctioneerPlayerId, "B");
  state = open(state);
  state = bid(state, "A", 3).state;
  state = bid(state, "B", 3).state;
  const resolution = bid(state, "C", 3);
  state = resolution.state;
  assert.equal(state.pendingSplit, undefined);
  assert.equal(state.territories[0].ownerId, null);
  assert.equal(state.startAuctions.auctioneerPlayerId, "C");
  for (const id of ["A", "B", "C"]) {
    assert.deepEqual(state.startAuctions.availableBidsByPlayerId[id], [0, 1, 2]);
  }
  assert.equal(resolution.events.some((event) => event.type === GameEventType.AuctionTiedMultiplePlayers), true);
});

test("split roles follow auctioneer and clockwise order, and successful split awards both", () => {
  let state = beginStartAuctions(makeSetup(["A", "B", "C", "D"], 12), "B",
    new SequenceRandomSource([0, 0, 0, 0, 0]), timestamp).state;
  assert.equal(state.startAuctions.auctioneerPlayerId, "C");
  state = open(state);
  for (const [id, value] of [["A", 4], ["B", 4], ["C", 1], ["D", 0]]) {
    state = bid(state, id, value).state;
  }
  assert.equal(state.pendingSplit.dividerPlayerId, "A");
  assert.equal(state.pendingSplit.firstChooserPlayerId, "B");
  assert.deepEqual(state.pendingSplit.tiedPlayerIds, ["A", "B"]);
  const splitTerritory = state.territories.find((territory) => territory.id === "t1");
  state = {
    ...state,
    territories: [
      ...state.territories.map((territory) => territory.id === "t1"
        ? { ...territory, ownerId: "A" } : territory),
      { ...splitTerritory, id: "split-t1", ownerId: "B" },
    ],
  };
  state = completeStartAuctionAfterSplit(state, ["A", "B"], new SequenceRandomSource([]), timestamp).state;
  assert.equal(state.pendingSplit, undefined);
  assert.equal(state.auction, undefined);
  assert.equal(state.startAuctions.auctioneerPlayerId, "D");
  assert.deepEqual(state.startAuctions.awardedPlayerIds, ["A", "B"]);
  state = open(state);
  assert.deepEqual(state.auction.eligiblePlayerIds, ["C", "D"]);
});

test("a legal two-player split can complete round one and immediately draw round two", () => {
  const random = new SequenceRandomSource(Array(6).fill(0));
  let state = beginStartAuctions(makeSetup(), "B", random, timestamp).state;
  state = open(state);
  state = bid(state, "A", 2).state;
  state = bid(state, "B", 2).state;
  assert.equal(state.pendingSplit.auctionKind, "START");
  const original = state.territories.find((territory) => territory.id === "t1");
  state = {
    ...state,
    territories: [
      ...state.territories.map((territory) => territory.id === "t1"
        ? { ...territory, ownerId: "A" } : territory),
      { ...original, id: "split-t1", ownerId: "B" },
    ],
  };
  const resolution = completeStartAuctionAfterSplit(state, ["A", "B"], random, timestamp);
  state = resolution.state;
  assert.equal(state.startAuctions.round, 2);
  assert.deepEqual(state.startAuctions.displayTerritoryIds, ["t4", "t5", "t6"]);
  assert.deepEqual(state.startAuctions.awardedPlayerIds, []);
  assert.equal(state.pendingSplit, undefined);
  assert.equal(resolution.events.some((event) => event.type === GameEventType.StartAuctionRoundStarted), true);
  assert.deepEqual(random.values, []);
});

test("split resolution keeps the start auction pending until controlled map parts arrive", () => {
  const random = new SequenceRandomSource(Array(6).fill(0));
  const setup = makeSetup();
  setup.territories[0] = {
    ...setup.territories[0], card: createTerritoryCard(Suit.Clubs, 12),
  };
  let state = beginStartAuctions(setup, "B", random, timestamp).state;
  state = open(state);
  state = bid(state, "A", 2).state;
  state = bid(state, "B", 2).state;
  const original = state.territories.find((territory) => territory.id === "t1");
  const resolution = {
    type: GameActionType.ResolveTerritorySplit,
    splitId: state.pendingSplit.id,
    resolution: "LEGAL_SPLIT",
    originalCardPart: { ...original, ownerId: "A" },
    newCardPart: { ...original, id: "split-t1", ownerId: "B",
      card: createTerritoryCard(Suit.Hearts, 11) },
    dividerPlayerId: state.pendingSplit.dividerPlayerId,
    firstChooserPlayerId: state.pendingSplit.firstChooserPlayerId,
  };
  const pendingSnapshot = structuredClone(state);
  assert.throws(() => resolveTerritorySplit(state, {
    ...resolution,
    dividerPlayerId: resolution.firstChooserPlayerId,
  }, random, timestamp));
  assert.deepEqual(state, pendingSnapshot);
  const result = resolveTerritorySplit(state, resolution, random, timestamp);
  assert.equal(result.state.startAuctions.round, 2);
  assert.equal(result.state.pendingSplit, undefined);
  assert.equal(result.state.territories.find((territory) => territory.id === "t1").ownerId, "A");
  assert.equal(result.state.territories.find((territory) => territory.id === "split-t1").ownerId, "B");
  assert.equal(result.events.some((event) => event.type === GameEventType.TerritorySplitResolved), true);
});

test("invalid and duplicate start bids leave the input state unchanged", () => {
  let state = beginStartAuctions(makeSetup(), "B", new SequenceRandomSource([0, 0, 0]), timestamp).state;
  state = open(state);
  const frozen = structuredClone(state);
  for (const bad of [
    { playerId: "outsider", value: 1 },
    { playerId: "A", value: -1 },
    { playerId: "A", value: 3 },
    { playerId: "A", value: 1.5 },
  ]) {
    assert.throws(() => bid(state, bad.playerId, bad.value));
    assert.deepEqual(state, frozen);
  }
  state = bid(state, "A", 1).state;
  const afterFirst = structuredClone(state);
  assert.throws(() => bid(state, "A", 2));
  assert.deepEqual(state, afterFirst);
});
