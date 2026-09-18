import assert from "node:assert/strict";
import test from "node:test";

import {
  createGameState, DomainErrorCode, GameActionType, GameEventType, GamePhase, Suit,
} from "../dist/index.js";
import { openNormalAuction, submitNormalAuctionBid } from "../dist/auctions/normal-auctions.js";
import { resolveTerritorySplit } from "../dist/auctions/resolve-split.js";
import { beginStartAuctions, openNextStartAuction, submitStartAuctionBid } from "../dist/auctions/start-auctions.js";
import { finishCurrentBasicAction } from "../dist/state/action-phase.js";

const timestamp = "2026-09-18T12:00:00.000Z";
const random = { nextInt: () => 0 };
const originalCard = { suit: Suit.Hearts, activationNumber: 5 };
const newCard = { suit: Suit.Spades, activationNumber: 7 };

function normalSplit() {
  const setup = createGameState({
    gameId: "split-normal",
    players: ["A", "B", "C"].map((id) => ({
      id, globalInfluence: 6, availableBasicBids: [1, 2, 3],
    })),
    startPlayerId: "A",
  });
  const base = {
    ...setup,
    phase: GamePhase.ActionPhase,
    round: 1,
    activePlayerId: "A",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
    territories: [
      { id: "home", ownerId: "A", area: 20, adjacentTerritoryIds: ["X"] },
      { id: "X", ownerId: null, area: 20, adjacentTerritoryIds: ["home"], card: originalCard,
        localInfluenceByPlayerId: { A: 1, B: 2, C: 3 } },
    ],
  };
  let state = openNormalAuction(base, {
    type: GameActionType.OpenAuction, playerId: "A", territoryId: "X",
  }, timestamp).state;
  for (const [playerId, basicBid, globalInfluence, localInfluence] of [
    ["A", 2, 1, 1], ["B", 1, 1, 2], ["C", 1, 0, 0],
  ]) {
    state = submitNormalAuctionBid(state, {
      type: GameActionType.SubmitAuctionBid,
      playerId, auctionId: state.auction.id,
      bid: { kind: "NORMAL", basicBid, globalInfluence, localInfluence },
    }, timestamp).state;
  }
  assert.ok(state.pendingSplit);
  return state;
}

function startSplit() {
  const setup = createGameState({
    gameId: "split-start",
    players: [{ id: "A" }, { id: "B" }],
    startPlayerId: "A",
  });
  let state = beginStartAuctions({
    ...setup,
    territories: Array.from({ length: 6 }, (_, index) => ({
      id: `T${index}`, ownerId: null, area: 20, adjacentTerritoryIds: [],
      card: index === 0 ? originalCard : { suit: Suit.Clubs, activationNumber: index },
    })),
  }, "B", random, timestamp).state;
  state = openNextStartAuction(state, timestamp).state;
  for (const playerId of ["A", "B"]) {
    state = submitStartAuctionBid(state, {
      type: GameActionType.SubmitAuctionBid,
      auctionId: state.auction.id,
      playerId,
      bid: { kind: "START", value: 1 },
    }, random, timestamp).state;
  }
  assert.ok(state.pendingSplit);
  return state;
}

function legalAction(state, ownerOfOriginal = "A", ownerOfNew = "B") {
  const original = state.territories.find((territory) => territory.id === state.pendingSplit.originalTerritoryId);
  return {
    type: GameActionType.ResolveTerritorySplit,
    splitId: state.pendingSplit.id,
    resolution: "LEGAL_SPLIT",
    originalCardPart: { ...original, ownerId: ownerOfOriginal, area: 10, adjacentTerritoryIds: ["new"] },
    newCardPart: { id: "new", ownerId: ownerOfNew, area: 10, adjacentTerritoryIds: [original.id], card: newCard },
    dividerPlayerId: state.pendingSplit.dividerPlayerId ?? "A",
    firstChooserPlayerId: state.pendingSplit.firstChooserPlayerId ?? "B",
  };
}

function rejectsWithoutMutation(state, action, code) {
  const before = structuredClone(state);
  assert.throws(() => resolveTerritorySplit(state, action, random, timestamp), (error) => error.code === code);
  assert.deepEqual(state, before);
}

test("normal legal split pays both winners only after resolution and clears local influence", () => {
  const pending = normalSplit();
  assert.equal(pending.players[0].globalInfluence, 6);
  assert.equal(pending.players[1].globalInfluence, 6);
  assert.equal(pending.territories[1].localInfluenceByPlayerId.A, 1);
  assert.throws(() => finishCurrentBasicAction(pending, timestamp),
    (error) => error.code === DomainErrorCode.AuctionAlreadyActive);

  const resolved = resolveTerritorySplit(pending, legalAction(pending), random, timestamp);
  assert.equal(resolved.state.pendingSplit, undefined);
  assert.equal(resolved.state.territories.find((territory) => territory.id === "X").ownerId, "A");
  assert.equal(resolved.state.territories.find((territory) => territory.id === "new").ownerId, "B");
  assert.deepEqual(resolved.state.territories.find((territory) => territory.id === "X").localInfluenceByPlayerId, {});
  assert.deepEqual(resolved.state.territories.find((territory) => territory.id === "new").localInfluenceByPlayerId, {});
  assert.equal(resolved.state.players[0].globalInfluence, 5);
  assert.equal(resolved.state.players[1].globalInfluence, 5);
  assert.equal(resolved.state.players[2].globalInfluence, 6);
  assert.deepEqual(resolved.state.players[0].availableBasicBids, [1, 3]);
  assert.deepEqual(resolved.state.players[1].availableBasicBids, [2, 3]);
  assert.deepEqual(resolved.state.players[2].availableBasicBids, [1, 2, 3]);
  assert.ok(resolved.events.some((event) => event.type === GameEventType.LocalInfluenceCleared));
  assert.equal(resolved.state.activePlayerId, "A");
  assert.deepEqual(resolved.state.actionPhase.completedPlayerIds, []);
});

test("impossible normal split keeps neutral territory and charges no one", () => {
  const pending = normalSplit();
  const resolved = resolveTerritorySplit(pending, {
    type: GameActionType.ResolveTerritorySplit,
    splitId: pending.pendingSplit.id,
    resolution: "SPLIT_NOT_POSSIBLE",
  }, random, timestamp);
  assert.equal(resolved.state.pendingSplit, undefined);
  assert.equal(resolved.state.territories.find((territory) => territory.id === "X").ownerId, null);
  assert.equal(resolved.state.territories.length, pending.territories.length);
  assert.deepEqual(resolved.state.players, pending.players);
  assert.deepEqual(resolved.state.territories[1].localInfluenceByPlayerId,
    pending.territories[1].localInfluenceByPlayerId);
});

test("split resolution rejects mismatched IDs, roles, ownership and lost original card", () => {
  const pending = normalSplit();
  const action = legalAction(pending);
  rejectsWithoutMutation(pending, { ...action, splitId: "wrong" }, DomainErrorCode.PendingSplitRequired);
  rejectsWithoutMutation(pending, { ...action, newCardPart: { ...action.newCardPart, id: "home" } },
    DomainErrorCode.InvalidSplitResolution);
  rejectsWithoutMutation(pending, { ...action, newCardPart: { ...action.newCardPart, ownerId: "A" } },
    DomainErrorCode.InvalidSplitResolution);
  rejectsWithoutMutation(pending, { ...action, firstChooserPlayerId: "A" },
    DomainErrorCode.InvalidSplitResolution);
  rejectsWithoutMutation(pending, { ...action, originalCardPart: { ...action.originalCardPart, card: newCard } },
    DomainErrorCode.InvalidSplitResolution);
  const cardless = {
    ...pending,
    territories: pending.territories.map((territory) => territory.id === "X"
      ? { ...territory, card: undefined } : territory),
  };
  const cardlessAction = legalAction(cardless);
  rejectsWithoutMutation(cardless, cardlessAction, DomainErrorCode.InvalidSplitResolution);
  rejectsWithoutMutation(pending, { ...action, newCardPart: { ...action.newCardPart, card: undefined } },
    DomainErrorCode.InvalidSplitResolution);
  rejectsWithoutMutation(pending, { ...action, newCardPart: { ...action.newCardPart, card: originalCard } },
    DomainErrorCode.InvalidSplitResolution);
});

test("new split part duplicates the old card only when all 48 printed cards are in play", () => {
  const pending = normalSplit();
  const printedCards = Object.values(Suit).flatMap((suit) =>
    Array.from({ length: 12 }, (_, index) => ({ suit, activationNumber: index + 1 })))
    .filter((card) => card.suit !== originalCard.suit || card.activationNumber !== originalCard.activationNumber);
  const fullDeckState = {
    ...pending,
    territories: [
      ...pending.territories,
      ...printedCards.map((card, index) => ({
        id: `used-${index}`, ownerId: null, area: 10, adjacentTerritoryIds: [], card,
      })),
    ],
  };
  const duplicateOriginal = legalAction(fullDeckState);
  const resolved = resolveTerritorySplit(fullDeckState, {
    ...duplicateOriginal,
    newCardPart: { ...duplicateOriginal.newCardPart, card: originalCard },
  }, random, timestamp);
  assert.equal(resolved.state.territories.find((territory) => territory.id === "new").card.suit, originalCard.suit);
  rejectsWithoutMutation(fullDeckState, duplicateOriginal, DomainErrorCode.InvalidSplitResolution);
});

test("start auction legal split awards both tied players and advances to round two", () => {
  const pending = startSplit();
  const action = legalAction(pending);
  const resolved = resolveTerritorySplit(pending, action, random, timestamp);
  assert.equal(resolved.state.pendingSplit, undefined);
  assert.equal(resolved.state.auction, undefined);
  assert.equal(resolved.state.startAuctions.round, 2);
  assert.equal(resolved.state.territories.find((territory) => territory.id === pending.pendingSplit.originalTerritoryId).ownerId, "A");
  assert.equal(resolved.state.territories.find((territory) => territory.id === "new").ownerId, "B");
  assert.ok(resolved.events.some((event) => event.type === GameEventType.StartAuctionRoundStarted && event.payload.round === 2));
  assert.equal(new Set(resolved.state.events.map((event) => event.id)).size, resolved.state.events.length);
});

test("impossible start split leaves start bids consumed and continues the display", () => {
  const pending = startSplit();
  const availableBefore = pending.startAuctions.availableBidsByPlayerId;
  const resolved = resolveTerritorySplit(pending, {
    type: GameActionType.ResolveTerritorySplit,
    splitId: pending.pendingSplit.id,
    resolution: "SPLIT_NOT_POSSIBLE",
  }, random, timestamp);
  assert.equal(resolved.state.pendingSplit, undefined);
  assert.equal(resolved.state.auction, undefined);
  assert.equal(resolved.state.territories.find((territory) => territory.id === pending.pendingSplit.originalTerritoryId).ownerId, null);
  assert.deepEqual(resolved.state.startAuctions.availableBidsByPlayerId, availableBefore);
  assert.equal(resolved.state.startAuctions.round, 1);
  const next = openNextStartAuction(resolved.state, timestamp);
  assert.ok(next.state.auction);
});
