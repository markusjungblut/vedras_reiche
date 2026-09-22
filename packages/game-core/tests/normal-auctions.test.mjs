import assert from "node:assert/strict";
import test from "node:test";

import { createGameState, DomainErrorCode, GameActionType, GameEventType, GamePhase } from "../dist/index.js";
import { openNormalAuction, submitNormalAuctionBid } from "../dist/auctions/normal-auctions.js";

const timestamp = "2026-09-18T10:00:00.000Z";

function stateWith(players = ["A", "B", "C"]) {
  const setup = createGameState({
    gameId: "normal-test",
    players: players.map((id) => ({ id, globalInfluence: 6, availableBasicBids: [1, 2, 3] })),
    startPlayerId: "A",
  });
  return {
    ...setup,
    phase: GamePhase.ActionPhase,
    round: 1,
    activePlayerId: "A",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
    territories: [
      { id: "home", ownerId: "A", area: 20, adjacentTerritoryIds: ["X", "Y"] },
      { id: "X", ownerId: null, area: 20, adjacentTerritoryIds: ["home"], localInfluenceByPlayerId: { A: 1, B: 2, C: 3 } },
      { id: "Y", ownerId: null, area: 20, adjacentTerritoryIds: ["home"] },
      { id: "far", ownerId: null, area: 20, adjacentTerritoryIds: [] },
    ],
  };
}

function open(state, territoryId = "X", playerId = "A") {
  return openNormalAuction(state, { type: GameActionType.OpenAuction, playerId, territoryId }, timestamp);
}

function submit(state, playerId, basicBid, globalInfluence = 0, localInfluence = 0, overrides = {}) {
  return submitNormalAuctionBid(state, {
    type: GameActionType.SubmitAuctionBid,
    auctionId: state.auction.id,
    playerId,
    bid: { kind: "NORMAL", basicBid, globalInfluence, localInfluence },
    ...overrides,
  }, timestamp);
}

function rejectsWithoutMutation(state, fn, code) {
  const before = structuredClone(state);
  assert.throws(fn, (error) => error.code === code);
  assert.deepEqual(state, before);
}

test("only the active player may open an adjacent neutral auction; all players participate", () => {
  const base = stateWith();
  rejectsWithoutMutation(base, () => open(base, "X", "B"), DomainErrorCode.NotActivePlayer);
  rejectsWithoutMutation(base, () => open(base, "home"), DomainErrorCode.InvalidAuctionTarget);
  rejectsWithoutMutation(base, () => open(base, "far"), DomainErrorCode.InvalidAuctionTarget);
  rejectsWithoutMutation(base, () => open(base, "missing"), DomainErrorCode.TerritoryNotFound);
  rejectsWithoutMutation({ ...base, phase: GamePhase.ActivationPhase },
    () => open({ ...base, phase: GamePhase.ActivationPhase }), DomainErrorCode.InvalidPhase);
  const opened = open(base);
  assert.deepEqual(opened.state.auction.eligiblePlayerIds, ["A", "B", "C"]);
  assert.equal(opened.state.actionPhase.auctionsOpenedByActivePlayer, 1);
  rejectsWithoutMutation(opened.state, () => open(opened.state), DomainErrorCode.AuctionAlreadyActive);
  rejectsWithoutMutation({ ...base, actionPhase: { ...base.actionPhase, auctionsOpenedByActivePlayer: 1 } },
    () => open({ ...base, actionPhase: { ...base.actionPhase, auctionsOpenedByActivePlayer: 1 } }),
    DomainErrorCode.SecondAuctionUnavailable);
});

test("submitted bids remain hidden in events until every eligible player bids", () => {
  const opened = open(stateWith()).state;
  const first = submit(opened, "A", 2, 1, 1);
  assert.deepEqual(first.events.map((event) => event.type), [GameEventType.AuctionBidSubmitted]);
  assert.deepEqual(first.events[0].payload, { auctionId: opened.auction.id, playerId: "A" });
  assert.deepEqual(first.state.auction.submittedBids.A, { kind: "NORMAL", basicBid: 2, globalInfluence: 1, localInfluence: 1 });
  rejectsWithoutMutation(first.state, () => submit(first.state, "A", 1), DomainErrorCode.BidAlreadySubmitted);
  rejectsWithoutMutation(first.state, () => submit(first.state, "B", 1, 0, 0, { auctionId: "wrong" }), DomainErrorCode.AuctionNotFound);
  const second = submit(first.state, "B", 3);
  assert.deepEqual(second.events.map((event) => event.type), [GameEventType.AuctionBidSubmitted]);
  const final = submit(second.state, "C", 1);
  assert.equal(final.events[0].type, GameEventType.AuctionBidSubmitted);
  assert.equal(final.events[1].type, GameEventType.AuctionBidsRevealed);
  assert.deepEqual(final.events[1].payload.bids.A, { kind: "NORMAL", basicBid: 2, globalInfluence: 1, localInfluence: 1 });
  assert.equal(final.state.auction, undefined);
});

test("bid validity checks basic bid and exact territory resources without charging on submit", () => {
  const opened = open(stateWith()).state;
  const unavailable = { ...opened, players: opened.players.map((player) => player.id === "A"
    ? { ...player, availableBasicBids: [2, 3] } : player) };
  rejectsWithoutMutation(unavailable, () => submit(unavailable, "A", 1), DomainErrorCode.BasicBidUnavailable);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 4), DomainErrorCode.InvalidBid);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, -1), DomainErrorCode.InvalidBid);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, 0.5), DomainErrorCode.InvalidBid);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, 7), DomainErrorCode.InsufficientGlobalInfluence);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, 0, -1), DomainErrorCode.InvalidBid);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, 0, 2), DomainErrorCode.InsufficientLocalInfluence);
  rejectsWithoutMutation(opened, () => submit(opened, "A", 1, 0, 0, { bid: { kind: "START", value: 1 } }), DomainErrorCode.InvalidBid);
  const hugeGlobal = { ...opened, players: opened.players.map((player) => player.id === "A"
    ? { ...player, globalInfluence: Number.MAX_SAFE_INTEGER } : player) };
  rejectsWithoutMutation(hugeGlobal,
    () => submit(hugeGlobal, "A", 1, Number.MAX_SAFE_INTEGER), DomainErrorCode.InvalidBid);
  const noResources = { ...opened, players: opened.players.map((player) => player.id === "A"
    ? { id: "A" } : player) };
  rejectsWithoutMutation(noResources, () => submit(noResources, "A", 1), DomainErrorCode.BasicBidUnavailable);
  const noGlobal = { ...opened, players: opened.players.map((player) => player.id === "A"
    ? { id: "A", availableBasicBids: [1, 2, 3] } : player) };
  rejectsWithoutMutation(noGlobal, () => submit(noGlobal, "A", 1), DomainErrorCode.InsufficientGlobalInfluence);
  const submitted = submit(opened, "A", 1, 2, 1).state;
  assert.equal(submitted.players[0].globalInfluence, 6);
  assert.deepEqual(submitted.players[0].availableBasicBids, [1, 2, 3]);
  assert.equal(submitted.territories[1].localInfluenceByPlayerId.A, 1);
});

test("unique winner pays own influence, exhausts own basic bid, and clears all local influence", () => {
  let state = open(stateWith()).state;
  state = submit(state, "A", 2, 1).state;
  state = submit(state, "B", 3, 2, 2).state;
  const final = submit(state, "C", 1);
  const winner = final.state.players.find((player) => player.id === "B");
  const opener = final.state.players.find((player) => player.id === "A");
  assert.equal(final.state.territories.find((territory) => territory.id === "X").ownerId, "B");
  assert.deepEqual(final.state.territories.find((territory) => territory.id === "X").localInfluenceByPlayerId, {});
  assert.equal(winner.globalInfluence, 4);
  assert.deepEqual(winner.availableBasicBids, [1, 2]);
  assert.equal(opener.globalInfluence, 6);
  assert.deepEqual(opener.availableBasicBids, [1, 2, 3]);
  assert.deepEqual(final.state.actionPhase.completedPlayerIds, []);
  assert.equal(final.state.activePlayerId, "A");
  assert.ok(final.events.some((event) => event.type === GameEventType.LocalInfluenceCleared));
});

test("global influence does not create a local-influence clearing event", () => {
  let base = stateWith(["A", "B"]);
  base = { ...base, territories: base.territories.map((territory) => territory.id === "X"
    ? { ...territory, localInfluenceByPlayerId: {} } : territory) };
  let state = open(base).state;
  state = submit(state, "A", 1).state;
  const result = submit(state, "B", 2, 2);
  assert.equal(result.events.some((event) => event.type === GameEventType.LocalInfluenceCleared), false);

  state = open(stateWith(["A", "B"])).state;
  state = submit(state, "A", 1).state;
  const localResult = submit(state, "B", 2, 0, 2);
  assert.equal(localResult.events.some((event) => event.type === GameEventType.LocalInfluenceCleared), true);
});

test("winning with the last available basic bid immediately refreshes all three", () => {
  let base = stateWith();
  base = { ...base, players: base.players.map((player) => player.id === "B"
    ? { ...player, availableBasicBids: [3] } : player) };
  let state = open(base).state;
  state = submit(state, "A", 1).state;
  state = submit(state, "B", 3).state;
  const final = submit(state, "C", 1);
  assert.deepEqual(final.state.players.find((player) => player.id === "B").availableBasicBids, [1, 2, 3]);
  assert.ok(final.events.some((event) => event.type === GameEventType.BasicBidsRefreshed));
});

test("two highest bidders create a pending split with immediate roles and no payment", () => {
  let state = open(stateWith()).state;
  state = submit(state, "A", 2, 2).state;
  state = submit(state, "B", 3, 1).state;
  const final = submit(state, "C", 1);
  assert.equal(final.state.auction, undefined);
  assert.deepEqual(final.state.pendingSplit.tiedPlayerIds, ["A", "B"]);
  assert.equal(final.state.pendingSplit.auctionKind, "NORMAL");
  assert.equal(final.state.pendingSplit.dividerPlayerId, "A");
  assert.equal(final.state.pendingSplit.firstChooserPlayerId, "B");
  assert.equal(final.state.territories.find((territory) => territory.id === "X").ownerId, null);
  assert.equal(final.state.players[0].globalInfluence, 6);
  assert.equal(final.state.players[1].globalInfluence, 6);
  assert.equal(final.state.territories[1].localInfluenceByPlayerId.B, 2);
  rejectsWithoutMutation(final.state, () => open(final.state, "Y"), DomainErrorCode.PendingSplitRequired);
});

test("first three-way tie permits one optional second auction; second tie cannot open a third", () => {
  let state = open(stateWith()).state;
  state = submit(state, "A", 2).state;
  state = submit(state, "B", 2).state;
  const firstTie = submit(state, "C", 2);
  assert.equal(firstTie.state.territories[1].ownerId, null);
  assert.equal(firstTie.state.actionPhase.secondAuctionAvailable, true);
  assert.equal(firstTie.state.players[0].globalInfluence, 6);
  assert.deepEqual(firstTie.state.players[0].availableBasicBids, [1, 2, 3]);
  assert.ok(firstTie.events.some((event) => event.type === GameEventType.SecondAuctionAvailable));
  state = open(firstTie.state, "Y").state;
  assert.equal(state.actionPhase.auctionsOpenedByActivePlayer, 2);
  state = submit(state, "A", 2).state;
  state = submit(state, "B", 2).state;
  const secondTie = submit(state, "C", 2);
  assert.equal(secondTie.state.actionPhase.secondAuctionAvailable, false);
  assert.equal(secondTie.state.territories.find((territory) => territory.id === "Y").ownerId, null);
  rejectsWithoutMutation(secondTie.state, () => open(secondTie.state, "X"), DomainErrorCode.SecondAuctionUnavailable);
});
