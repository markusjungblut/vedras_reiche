import assert from "node:assert/strict";
import test from "node:test";

import {
  Suit,
  createGameState,
  createTerritoryCard,
  getActivatedTerritories,
  getNextPlayer,
  getPlayerOrderFromStartPlayer,
  rollActivationNumber,
  rollActivationNumbers,
  selectInitialStartPlayer,
} from "../dist/index.js";

class SequenceRandomSource {
  constructor(values) {
    this.values = [...values];
    this.calls = [];
  }

  nextInt(min, max) {
    this.calls.push([min, max]);
    assert.notEqual(this.values.length, 0, "Random sequence exhausted");
    return this.values.shift();
  }
}

test("initial start player uses injected randomness and clockwise order wraps", () => {
  const order = Object.freeze(["A", "B", "C", "D"]);
  const random = new SequenceRandomSource([2]);

  assert.equal(selectInitialStartPlayer(order, random), "C");
  assert.deepEqual(random.calls, [[0, 3]]);
  assert.deepEqual(getPlayerOrderFromStartPlayer(order, "C"), ["C", "D", "A", "B"]);
  assert.equal(getNextPlayer(order, "D"), "A");
  assert.deepEqual(order, ["A", "B", "C", "D"]);
});

test("player order helpers reject unknown or duplicate seats", () => {
  assert.throws(() => getNextPlayer(["A", "B"], "C"), /not in player order/);
  assert.throws(() => getPlayerOrderFromStartPlayer(["A", "B"], "C"), /not in player order/);
  assert.throws(() => getNextPlayer(["A", "A"], "A"), /distinct players/);
  assert.throws(() => selectInitialStartPlayer([], new SequenceRandomSource([])), /distinct players/);
});

test("two W6 choose the lower or higher value of a numbered pair", () => {
  const random = new SequenceRandomSource([1, 3, 1, 4, 6, 1, 6, 6]);
  assert.deepEqual(
    Array.from({ length: 4 }, () => rollActivationNumber(random)),
    [1, 2, 11, 12],
  );
  assert.deepEqual(random.calls, Array.from({ length: 8 }, () => [1, 6]));
});

test("three activation numbers retain roll order", () => {
  const random = new SequenceRandomSource([1, 2, 3, 2, 6, 6]);
  assert.deepEqual(rollActivationNumbers(random), [1, 5, 12]);
  assert.equal(random.values.length, 0);
});

test("duplicate activation number is rerolled until three distinct values appear", () => {
  const random = new SequenceRandomSource([3, 2, 3, 3, 3, 4, 1, 2]);
  assert.deepEqual(rollActivationNumbers(random), [5, 6, 1]);
  assert.equal(random.values.length, 0);
});

test("an invalid die result is rejected", () => {
  assert.throws(() => rollActivationNumber(new SequenceRandomSource([0])), RangeError);
});

test("only controlled matching territories activate, including by second number, once each", () => {
  const base = createGameState({
    gameId: "activation-helper-test",
    players: [{ id: "A" }, { id: "B" }],
    startPlayerId: "A",
  });
  const card = createTerritoryCard(Suit.Hearts, 5);
  const state = {
    ...base,
    territories: [
      { id: "neutral", ownerId: null, area: 4, adjacentTerritoryIds: [], card },
      { id: "orphaned-owner", ownerId: "missing-player", area: 4, adjacentTerritoryIds: [], card },
      { id: "primary", ownerId: "A", area: 4, adjacentTerritoryIds: [], card },
      {
        id: "secondary",
        ownerId: "B",
        area: 4,
        adjacentTerritoryIds: [],
        card: { suit: Suit.Clubs, activationNumber: 3, additionalActivationNumber: 8 },
      },
      {
        id: "both",
        ownerId: "A",
        area: 4,
        adjacentTerritoryIds: [],
        card: { suit: Suit.Spades, activationNumber: 5, additionalActivationNumber: 8 },
      },
      { id: "unmatched", ownerId: "A", area: 4, adjacentTerritoryIds: [], card: createTerritoryCard(Suit.Diamonds, 2) },
      { id: "no-card", ownerId: "A", area: 4, adjacentTerritoryIds: [] },
    ],
  };

  assert.deepEqual(getActivatedTerritories(state, [5, 8, 12]), ["primary", "secondary", "both"]);
  assert.deepEqual(getActivatedTerritories(state, [8]), ["secondary", "both"]);
  assert.deepEqual(getActivatedTerritories(state, []), []);
  assert.equal(state.territories[0].ownerId, null);
});
