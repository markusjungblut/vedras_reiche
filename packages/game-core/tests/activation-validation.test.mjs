import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainErrorCode,
  GameActionType,
  Suit,
  activateTerritory,
  createGameState,
  startRound,
} from "../dist/index.js";

const timestamp = "2026-09-17T12:00:00.000Z";

function makeState() {
  const setup = createGameState({
    gameId: "validation",
    players: [{ id: "A", globalInfluence: 6 }, { id: "B", globalInfluence: 6 }],
    startPlayerId: "A",
  });
  const territories = [
    { id: "a-heart", ownerId: "A", area: 20, adjacentTerritoryIds: [], card: { suit: Suit.Hearts, activationNumber: 5 } },
    { id: "a-spade", ownerId: "A", area: 20, adjacentTerritoryIds: [], card: { suit: Suit.Spades, activationNumber: 9 } },
    { id: "a-unmatched", ownerId: "A", area: 20, adjacentTerritoryIds: [], card: { suit: Suit.Clubs, activationNumber: 2 } },
    { id: "b-heart", ownerId: "B", area: 20, adjacentTerritoryIds: [], card: { suit: Suit.Hearts, activationNumber: 5 } },
  ];
  const dice = { values: [0, 3, 1, 5, 1, 6, 4], nextInt() { return this.values.shift(); } };
  return startRound({ ...setup, territories }, dice, timestamp).state;
}

function action(playerId, territoryId, choice, selectedSuit) {
  return {
    type: GameActionType.ActivateTerritory,
    playerId,
    territoryId,
    choice,
    ...(selectedSuit === undefined ? {} : { selectedSuit }),
  };
}

function run(state, candidate) {
  return activateTerritory(state, candidate, { randomSource: { nextInt: () => 1 }, timestamp });
}

function rejectsWithoutMutation(state, candidate, code) {
  const before = structuredClone(state);
  assert.throws(() => run(state, candidate), (error) => error.code === code);
  assert.deepEqual(state, before);
}

test("activation action validates phase, current player, ownership and pending status", () => {
  const state = makeState();
  rejectsWithoutMutation(state,
    action("B", "b-heart", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.NotActivePlayer);
  rejectsWithoutMutation(state,
    action("A", "b-heart", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.TerritoryNotOwned);
  rejectsWithoutMutation(state,
    action("A", "a-unmatched", { type: "CLUB_BUILD_SETTLEMENT", targetTerritoryId: "a-unmatched" }),
    DomainErrorCode.TerritoryNotActivated);
  rejectsWithoutMutation(state,
    action("A", "missing", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.TerritoryNotFound);

  const afterFirst = run(state, action("A", "a-heart", { type: "HEART_GLOBAL_INFLUENCE" })).state;
  rejectsWithoutMutation(afterFirst,
    action("A", "a-heart", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.TerritoryAlreadyActivated);
  rejectsWithoutMutation({ ...state, phase: "ACTION_PHASE" },
    action("A", "a-heart", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.InvalidPhase);
});

test("symbol selection and effect targets are validated before an activation is consumed", () => {
  const state = makeState();
  rejectsWithoutMutation(state,
    action("A", "a-heart", { type: "HEART_GLOBAL_INFLUENCE" }, Suit.Diamonds),
    DomainErrorCode.InvalidSuitSelection);
  rejectsWithoutMutation(state,
    action("A", "a-heart", { type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: "a-spade" }),
    DomainErrorCode.InvalidLocalInfluenceTarget);

  const twoSuitState = {
    ...state,
    territories: state.territories.map((territory) => territory.id === "a-heart"
      ? { ...territory, card: { ...territory.card, additionalSuit: Suit.Clubs } }
      : territory),
  };
  rejectsWithoutMutation(twoSuitState,
    action("A", "a-heart", { type: "HEART_GLOBAL_INFLUENCE" }),
    DomainErrorCode.InvalidSuitSelection);

  const selectedSecondSuit = run(twoSuitState,
    action("A", "a-heart", {
      type: "CLUB_BUILD_SETTLEMENT", targetTerritoryId: "a-heart",
    }, Suit.Clubs));
  assert.equal(selectedSecondSuit.state.territories[0].settlement, "SETTLEMENT");
  assert.equal(selectedSecondSuit.state.players[0].globalInfluence, 6);
});
