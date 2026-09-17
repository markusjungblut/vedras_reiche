import assert from "node:assert/strict";
import test from "node:test";

import {
  GameActionType,
  GameEventType,
  GamePhase,
  SettlementKind,
  Suit,
  activateTerritory,
  createGameState,
  createTerritoryCard,
  getAvailableActivationTerritoryIds,
  getCanonicalBorderId,
  startRound,
} from "../dist/index.js";

const timestamp = "2026-09-17T12:00:00.000Z";

class SequenceRandomSource {
  constructor(values) {
    this.values = [...values];
  }

  nextInt(min, max) {
    assert.ok(this.values.length > 0, `Unexpected random draw in [${min}, ${max}]`);
    const value = this.values.shift();
    assert.ok(Number.isInteger(value) && value >= min && value <= max);
    return value;
  }

  assertConsumed() {
    assert.deepEqual(this.values, []);
  }
}

function territory(id, ownerId, suit, activationNumber, adjacentTerritoryIds = []) {
  return {
    id,
    ownerId,
    area: 4,
    adjacentTerritoryIds,
    ...(suit === undefined ? {} : { card: createTerritoryCard(suit, activationNumber) }),
  };
}

function activate(state, playerId, territoryId, choice) {
  return activateTerritory(
    state,
    { type: GameActionType.ActivateTerritory, playerId, territoryId, choice },
    { randomSource: new SequenceRandomSource([]), timestamp },
  );
}

test("three players complete an activation phase in player-chosen territory order", () => {
  const setup = {
    ...createGameState({
      gameId: "three-player-flow",
      players: [
        { id: "A", globalInfluence: 4 },
        { id: "B", globalInfluence: 4 },
        { id: "C", globalInfluence: 4 },
      ],
      startPlayerId: "A",
    }),
    territories: [
      territory("b-club", "B", Suit.Clubs, 2, ["a-diamond"]),
      territory("b-spade", "B", Suit.Spades, 5),
      territory("c-heart", "C", Suit.Hearts, 5, ["neutral"]),
      territory("a-diamond", "A", Suit.Diamonds, 9, ["b-club"]),
      territory("neutral", null, Suit.Clubs, 9, ["c-heart"]),
    ],
  };
  // Index 1 selects B; the three W6 pairs yield 2, 5, and 9.
  const dice = new SequenceRandomSource([1, 1, 5, 3, 1, 5, 2]);
  let result = startRound(setup, dice, timestamp);
  dice.assertConsumed();

  assert.equal(result.state.round, 1);
  assert.equal(result.state.maxRounds, 9);
  assert.equal(result.state.startPlayerId, "B");
  assert.equal(result.state.activePlayerId, "B");
  assert.equal(result.state.phase, GamePhase.ActivationPhase);
  assert.deepEqual(result.state.activationNumbers, [2, 5, 9]);
  assert.deepEqual(getAvailableActivationTerritoryIds(result.state), ["b-club", "b-spade"]);
  assert.equal(result.state.activation.pendingTerritoryIds.includes("neutral"), false);
  assert.ok(result.events.some((event) => event.type === GameEventType.StartPlayerSelected));
  assert.ok(result.events.some((event) => event.type === GameEventType.ActivationPhaseStarted));

  // B chooses the second listed territory first; the engine must keep B active.
  result = activate(result.state, "B", "b-spade", { type: "SPADE_STORE" });
  assert.equal(result.state.activePlayerId, "B");
  assert.deepEqual(getAvailableActivationTerritoryIds(result.state), ["b-club"]);
  assert.deepEqual(result.state.spadeActivations.map(({ playerId, sourceTerritoryId, status }) =>
    ({ playerId, sourceTerritoryId, status })), [
    { playerId: "B", sourceTerritoryId: "b-spade", status: "AVAILABLE" },
  ]);

  result = activate(result.state, "B", "b-club", {
    type: "CLUB_BUILD_SETTLEMENT",
    targetTerritoryId: "b-club",
  });
  assert.equal(result.state.activePlayerId, "C");
  assert.equal(result.state.territories.find(({ id }) => id === "b-club").settlement,
    SettlementKind.Settlement);

  result = activate(result.state, "C", "c-heart", {
    type: "HEART_LOCAL_INFLUENCE",
    targetTerritoryId: "neutral",
  });
  assert.equal(result.state.activePlayerId, "A");
  assert.equal(result.state.territories.find(({ id }) => id === "neutral")
    .localInfluenceByPlayerId.C, 2);

  result = activate(result.state, "A", "a-diamond", {
    type: "DIAMOND_MARK_BORDER",
    targetTerritoryId: "b-club",
  });
  assert.equal(result.state.phase, GamePhase.ActionPhase);
  assert.equal(result.state.activePlayerId, undefined);
  assert.deepEqual(getAvailableActivationTerritoryIds(result.state), []);
  assert.deepEqual(result.state.activation.pendingTerritoryIds, []);
  assert.deepEqual(result.state.activation.resolvedTerritoryIds,
    ["b-spade", "b-club", "c-heart", "a-diamond"]);
  assert.equal(new Set(result.state.activation.resolvedTerritoryIds).size, 4);
  assert.equal(result.state.borderMarks.length, 1);
  assert.equal(result.state.borderMarks[0].id, getCanonicalBorderId("a-diamond", "b-club"));
  assert.deepEqual(result.events.slice(-2).map(({ type }) => type), [
    GameEventType.ActivationPhaseFinished,
    GameEventType.ActionPhaseStarted,
  ]);
  assert.equal(result.state.spadeActivations[0].status, "AVAILABLE");
  assert.equal(setup.territories[0].settlement, undefined);
  assert.deepEqual(setup.borderMarks, []);
});

test("next round rotates the start player, expires spade effects, and skips an empty activation phase", () => {
  const setup = {
    ...createGameState({
      gameId: "round-transition",
      players: [{ id: "A" }, { id: "B" }, { id: "C" }],
      startPlayerId: "C",
    }),
    territories: [territory("spade", "B", Suit.Spades, 2)],
  };
  const firstDice = new SequenceRandomSource([1, 1, 5, 3, 1, 5, 2]);
  const roundOne = startRound(setup, firstDice, timestamp);
  firstDice.assertConsumed();
  const afterSpade = activate(roundOne.state, "B", "spade", { type: "SPADE_STORE" }).state;

  assert.equal(afterSpade.phase, GamePhase.ActionPhase);
  assert.equal(afterSpade.startPlayerId, "B");
  assert.equal(afterSpade.spadeActivations.length, 1);
  assert.equal(afterSpade.spadeActivations[0].status, "AVAILABLE");

  // Round two rolls 3, 5, 7; no controlled territory matches.
  const secondDice = new SequenceRandomSource([2, 1, 3, 1, 4, 1]);
  const roundTwo = startRound(afterSpade, secondDice, timestamp);
  secondDice.assertConsumed();
  assert.equal(roundTwo.state.round, 2);
  assert.equal(roundTwo.state.startPlayerId, "C");
  assert.deepEqual(roundTwo.state.activationNumbers, [3, 5, 7]);
  assert.deepEqual(roundTwo.state.spadeActivations, []);
  assert.deepEqual(roundTwo.state.activation.pendingTerritoryIds, []);
  assert.equal(roundTwo.state.phase, GamePhase.ActionPhase);
  assert.equal(roundTwo.state.activePlayerId, undefined);
  assert.deepEqual(getAvailableActivationTerritoryIds(roundTwo.state), []);
  assert.deepEqual(roundTwo.events.map(({ type }) => type), [
    GameEventType.StartPlayerRotated,
    GameEventType.RoundStarted,
    GameEventType.ActivationNumbersRolled,
    GameEventType.ActivationPhaseStarted,
    GameEventType.ActivationPhaseFinished,
    GameEventType.ActionPhaseStarted,
  ]);
});

test("a Club number gained during activation can first activate its territory next round", () => {
  const setup = {
    ...createGameState({
      gameId: "club-next-round",
      players: [{ id: "A" }, { id: "B" }],
      startPlayerId: "B",
    }),
    territories: [
      territory("club", "A", Suit.Clubs, 5, ["target"]),
      territory("target", "A", Suit.Hearts, 2, ["club"]),
    ],
  };
  const firstDice = new SequenceRandomSource([0, 3, 1, 5, 1, 6, 4]);
  const firstRound = startRound(setup, firstDice, timestamp);
  assert.deepEqual(firstRound.state.activation.pendingTerritoryIds, ["club"]);

  const afterClub = activateTerritory(
    firstRound.state,
    {
      type: GameActionType.ActivateTerritory,
      playerId: "A",
      territoryId: "club",
      choice: { type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "target" },
    },
    {
      randomSource: new SequenceRandomSource([]),
      cardSource: { drawAndReplace: () => createTerritoryCard(Suit.Spades, 9) },
      timestamp,
    },
  );
  assert.equal(afterClub.state.territories[1].card.additionalActivationNumber, 9);
  assert.equal(afterClub.state.phase, GamePhase.ActionPhase);
  assert.deepEqual(afterClub.state.activation.resolvedTerritoryIds, ["club"]);

  const secondDice = new SequenceRandomSource([5, 1, 1, 1, 2, 1]);
  const secondRound = startRound(afterClub.state, secondDice, timestamp);
  assert.deepEqual(secondRound.state.activationNumbers, [9, 1, 3]);
  assert.deepEqual(secondRound.state.activation.pendingTerritoryIds, ["target"]);
  assert.equal(secondRound.state.activePlayerId, "A");
});
