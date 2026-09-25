import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainErrorCode,
  GameActionType,
  GameEventType,
  GamePhase,
  Suit,
  applyAction,
  createGameState,
  createGameViewForPlayer,
  createTerritoryCard,
  getAvailableActivationTerritoryIds,
  startRound,
} from "../dist/index.js";

const timestamp = "2026-09-25T12:00:00.000Z";

class SequenceRandomSource {
  constructor(values) { this.values = [...values]; }
  nextInt(min, max) {
    assert.ok(this.values.length > 0, `Unexpected random draw in [${min}, ${max}]`);
    const value = this.values.shift();
    assert.ok(Number.isInteger(value) && value >= min && value <= max);
    return value;
  }
  assertConsumed() { assert.deepEqual(this.values, []); }
}

function territory(id, ownerId, suit, activationNumber, adjacentTerritoryIds = []) {
  return { id, ownerId, area: 20, adjacentTerritoryIds, card: createTerritoryCard(suit, activationNumber) };
}

function readyForFirstRound(state) {
  return { ...state, phase: GamePhase.RoundReady, startAuctions: {
    round: 2, displayTerritoryIds: [], firstDisplayTerritoryIds: [], nextDisplayIndex: 0,
    auctioneerPlayerId: state.players[0].id, awardedPlayerIds: state.players.map((player) => player.id), availableBidsByPlayerId: {},
  } };
}

function roll(state, playerId, dice) {
  return applyAction(state, { type: GameActionType.RollNextActivationNumber, playerId }, { randomSource: new SequenceRandomSource(dice), timestamp });
}

function activate(state, playerId, territoryId, choice, cardSource) {
  return applyAction(state, { type: GameActionType.ActivateTerritory, playerId, territoryId, choice }, {
    randomSource: new SequenceRandomSource([]), timestamp, ...(cardSource === undefined ? {} : { cardSource }),
  });
}

test("START_ROUND creates no future activation numbers and the dispatcher rolls only on request", () => {
  const state = readyForFirstRound(createGameState({ gameId: "sequential-start", players: [{ id: "A" }, { id: "B" }], startPlayerId: "A" }));
  const random = new SequenceRandomSource([0]);
  const started = applyAction(state, { type: GameActionType.StartRound }, { randomSource: random, timestamp });
  random.assertConsumed();
  assert.equal(started.state.phase, GamePhase.ActivationPhase);
  assert.deepEqual(started.state.activationNumbers, []);
  assert.equal(started.state.activation.nextActivationIndex, 0);
  assert.equal(createGameViewForPlayer(started.state, "B").activationNumbers.length, 0);

  const rolled = roll(started.state, "A", [2, 4]);
  assert.deepEqual(rolled.state.activationNumbers, [4]);
  assert.equal(rolled.state.activation.nextActivationIndex, 1);
  assert.equal(rolled.events[0].type, GameEventType.ActivationNumberRolled);
  assert.deepEqual(createGameViewForPlayer(rolled.state, "B").activationNumbers, [4]);
});

test("each roll captures current candidates, respects player order, and blocks the next roll while resolving", () => {
  const setup = { ...createGameState({ gameId: "ordered-step", players: ["A", "B", "C"].map((id) => ({ id, globalInfluence: 8 })), startPlayerId: "A" }),
    territories: [
      territory("A1", "A", Suit.Hearts, 6), territory("A2", "A", Suit.Spades, 6),
      territory("B1", "B", Suit.Hearts, 6), territory("C1", "C", Suit.Hearts, 6),
    ] };
  const started = startRound(readyForFirstRound(setup), new SequenceRandomSource([0]), timestamp);
  let state = roll(started.state, "A", [3, 4]).state;
  assert.deepEqual(state.activationNumbers, [6]);
  assert.deepEqual(getAvailableActivationTerritoryIds(state), ["A1", "A2"]);
  assert.equal(state.activePlayerId, "A");
  assert.throws(() => roll(state, "A", [4, 1]), (error) => error.code === DomainErrorCode.InvalidPhase);

  state = activate(state, "A", "A2", { type: "SPADE_STORE" }).state;
  assert.equal(state.activePlayerId, "A");
  assert.deepEqual(getAvailableActivationTerritoryIds(state), ["A1"]);
  state = activate(state, "A", "A1", { type: "HEART_GLOBAL_INFLUENCE" }).state;
  assert.equal(state.activePlayerId, "B");
  state = activate(state, "B", "B1", { type: "HEART_GLOBAL_INFLUENCE" }).state;
  assert.equal(state.activePlayerId, "C");
  state = activate(state, "C", "C1", { type: "HEART_GLOBAL_INFLUENCE" }).state;
  assert.deepEqual(state.activationNumbers, [6]);
  assert.deepEqual(state.activation.activatedTerritoryIdsThisRound, ["A2", "A1", "B1", "C1"]);
  assert.equal(state.activePlayerId, "A");
});

test("club second numbers affect only later steps, never past or currently captured steps", () => {
  const base = { ...createGameState({ gameId: "club-timing", players: ["A", "B"].map((id) => ({ id, globalInfluence: 8 })), startPlayerId: "A" }),
    territories: [territory("club", "A", Suit.Clubs, 4, ["target"]), territory("target", "A", Suit.Hearts, 10, ["club"])] };
  const started = startRound(readyForFirstRound(base), new SequenceRandomSource([0]), timestamp);
  let state = roll(started.state, "A", [2, 4]).state;
  state = activate(state, "A", "club", { type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "target" }, {
    drawAndReplace: () => createTerritoryCard(Suit.Spades, 7),
  }).state;
  assert.equal(state.territories.find((item) => item.id === "target").card.additionalActivationNumber, 7);
  assert.deepEqual(state.activationNumbers, [4]);
  state = roll(state, "A", [4, 1]).state;
  assert.deepEqual(state.activationNumbers, [4, 7]);
  assert.deepEqual(state.activation.pendingTerritoryIds, ["target"]);
  state = activate(state, "A", "target", { type: "HEART_GLOBAL_INFLUENCE" }).state;

  const sameNumberBase = { ...base, gameId: "club-current-step" };
  const sameNumberStarted = startRound(readyForFirstRound(sameNumberBase), new SequenceRandomSource([0]), timestamp);
  let sameNumber = roll(sameNumberStarted.state, "A", [2, 4]).state;
  sameNumber = activate(sameNumber, "A", "club", { type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "target" }, {
    drawAndReplace: () => createTerritoryCard(Suit.Spades, 4),
  }).state;
  assert.deepEqual(sameNumber.activation.pendingTerritoryIds, []);
  assert.equal(sameNumber.activation.activatedTerritoryIdsThisRound.includes("target"), false);

  const pastStarted = startRound(readyForFirstRound({ ...base, gameId: "club-past-step" }), new SequenceRandomSource([0]), timestamp);
  let past = roll(pastStarted.state, "A", [4, 1]).state;
  past = roll(past, "A", [2, 4]).state;
  past = activate(past, "A", "club", { type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "target" }, {
    drawAndReplace: () => createTerritoryCard(Suit.Spades, 7),
  }).state;
  assert.equal(past.activation.activatedTerritoryIdsThisRound.includes("target"), false);
});

test("repeated values reroll one step at a time and an activated territory cannot return", () => {
  const setup = { ...createGameState({ gameId: "unique-and-once", players: ["A", "B"].map((id) => ({ id, globalInfluence: 8 })), startPlayerId: "A" }),
    territories: [{ ...territory("A", "A", Suit.Hearts, 4), card: { ...createTerritoryCard(Suit.Hearts, 4), additionalActivationNumber: 9 } }] };
  const started = startRound(readyForFirstRound(setup), new SequenceRandomSource([0]), timestamp);
  let state = roll(started.state, "A", [2, 4]).state;
  state = activate(state, "A", "A", { type: "HEART_GLOBAL_INFLUENCE" }).state;
  const duplicateThenNine = new SequenceRandomSource([2, 4, 5, 1]);
  state = applyAction(state, { type: GameActionType.RollNextActivationNumber, playerId: "A" }, { randomSource: duplicateThenNine, timestamp }).state;
  duplicateThenNine.assertConsumed();
  assert.deepEqual(state.activationNumbers, [4, 9]);
  assert.deepEqual(state.activation.pendingTerritoryIds, []);
  assert.equal(state.activation.activatedTerritoryIdsThisRound.filter((id) => id === "A").length, 1);
});
