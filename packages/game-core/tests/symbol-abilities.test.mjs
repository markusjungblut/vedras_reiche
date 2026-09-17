import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainErrorCode,
  GameActionType,
  SettlementKind,
  Suit,
  createGameState,
  getDiamondTargets,
} from "../dist/index.js";
import {
  applySymbolAbility,
  getCanonicalBorderId,
} from "../dist/activation/apply-symbol-ability.js";

const randomSource = { nextInt: () => 1 };

function territory(id, ownerId, suit, adjacentTerritoryIds = []) {
  return {
    id,
    ownerId,
    area: 20,
    adjacentTerritoryIds,
    card: { suit, activationNumber: 5 },
  };
}

function stateWith(sourceSuit, overrides = {}) {
  const base = createGameState({
    gameId: "abilities",
    players: [{ id: "A", globalInfluence: 6 }, { id: "B", globalInfluence: 6 }],
    startPlayerId: "A",
  });
  return {
    ...base,
    territories: [
      territory("source", "A", sourceSuit, ["own", "neutral", "enemy"]),
      territory("own", "A", Suit.Diamonds, ["source"]),
      territory("neutral", null, Suit.Clubs, ["source"]),
      territory("enemy", "B", Suit.Spades, ["source"]),
      territory("far", null, Suit.Hearts),
    ],
    ...overrides,
  };
}

function action(choice, overrides = {}) {
  return {
    type: GameActionType.ActivateTerritory,
    playerId: "A",
    territoryId: "source",
    choice,
    ...overrides,
  };
}

function apply(state, choice, suit, extra = {}, actionOverrides = {}) {
  return applySymbolAbility(
    state,
    action(choice, actionOverrides),
    suit,
    { randomSource, effectId: "effect-1", ...extra },
  );
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

test("diamond stores a neutral border change without changing abstract area", () => {
  const original = stateWith(Suit.Diamonds);
  assert.deepEqual(getDiamondTargets(original, "source"), {
    neutralTerritoryIds: ["neutral"],
    opponentTerritoryIds: ["enemy"],
  });
  const { state, event } = apply(original, {
    type: "DIAMOND_NEUTRAL_BORDER",
    targetTerritoryId: "neutral",
  }, Suit.Diamonds);

  assert.deepEqual(state.pendingDiamondBorderChanges, [{
    id: "effect-1",
    playerId: "A",
    sourceTerritoryId: "source",
    neutralTerritoryId: "neutral",
  }]);
  assert.deepEqual(state.territories, original.territories);
  assert.deepEqual(original.pendingDiamondBorderChanges, []);
  assert.equal(event.type, "DIAMOND_NEUTRAL_BORDER_CHANGE_PENDING");
  expectCode(() => apply(original, {
    type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: "far",
  }, Suit.Diamonds), DomainErrorCode.InvalidBorderTarget);
});

test("diamond marks one opponent border regardless of ID orientation", () => {
  const original = stateWith(Suit.Diamonds);
  const choice = { type: "DIAMOND_MARK_BORDER", targetTerritoryId: "enemy" };
  const { state, event } = apply(original, choice, Suit.Diamonds);

  assert.equal(getCanonicalBorderId("source", "enemy"), getCanonicalBorderId("enemy", "source"));
  assert.equal(state.borderMarks[0].id, getCanonicalBorderId("source", "enemy"));
  assert.equal(event.type, "DIAMOND_BORDER_MARKED");
  expectCode(() => apply(state, choice, Suit.Diamonds), DomainErrorCode.BorderAlreadyMarked);
  expectCode(() => apply(original, {
    type: "DIAMOND_MARK_BORDER", targetTerritoryId: "own",
  }, Suit.Diamonds), DomainErrorCode.InvalidBorderTarget);
});

test("club builds a settlement and upgrades it to a city on adjacent own territory", () => {
  const original = stateWith(Suit.Clubs);
  const built = apply(original, {
    type: "CLUB_BUILD_SETTLEMENT", targetTerritoryId: "own",
  }, Suit.Clubs);
  assert.equal(built.state.territories[1].settlement, SettlementKind.Settlement);
  assert.equal(original.territories[1].settlement, undefined);
  assert.equal(built.event.type, "CLUB_SETTLEMENT_CREATED");

  const upgraded = apply(built.state, {
    type: "CLUB_UPGRADE_CITY", targetTerritoryId: "own",
  }, Suit.Clubs);
  assert.equal(upgraded.state.territories[1].settlement, SettlementKind.City);
  assert.equal(upgraded.event.type, "CLUB_CITY_CREATED");
  expectCode(() => apply(upgraded.state, {
    type: "CLUB_UPGRADE_CITY", targetTerritoryId: "own",
  }, Suit.Clubs), DomainErrorCode.InvalidDevelopmentTarget);
  expectCode(() => apply(original, {
    type: "CLUB_BUILD_SETTLEMENT", targetTerritoryId: "enemy",
  }, Suit.Clubs), DomainErrorCode.InvalidDevelopmentTarget);
});

test("club redraws a repeated activation number and keeps only the valid number", () => {
  const draws = [5, 9];
  const cardSource = {
    drawAndReplace(source) {
      assert.equal(source, randomSource);
      return { suit: Suit.Spades, activationNumber: draws.shift() };
    },
  };
  const original = stateWith(Suit.Clubs);
  const { state, event } = apply(original, {
    type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "own",
  }, Suit.Clubs, { cardSource });

  assert.equal(state.territories[1].card.additionalActivationNumber, 9);
  assert.equal(state.territories[1].card.additionalSuit, undefined);
  assert.equal(event.payload.activationNumber, 9);
  assert.equal(draws.length, 0);
  expectCode(() => apply(original, {
    type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "own",
  }, Suit.Clubs), DomainErrorCode.CardSourceRequired);
  expectCode(() => apply(original, {
    type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "own",
  }, Suit.Clubs, { cardSource: { drawAndReplace: () => ({ suit: Suit.Hearts, activationNumber: 13 }) } }),
  DomainErrorCode.InvalidDrawnCard);
});

test("club second suit is distinct and mutually exclusive with second number", () => {
  const original = stateWith(Suit.Clubs);
  const withSuit = apply(original, {
    type: "CLUB_ADD_SECOND_SUIT", targetTerritoryId: "own", suit: Suit.Hearts,
  }, Suit.Clubs).state;
  assert.equal(withSuit.territories[1].card.additionalSuit, Suit.Hearts);

  expectCode(() => apply(original, {
    type: "CLUB_ADD_SECOND_SUIT", targetTerritoryId: "own", suit: Suit.Diamonds,
  }, Suit.Clubs), DomainErrorCode.InvalidSuitSelection);
  expectCode(() => apply(withSuit, {
    type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: "own",
  }, Suit.Clubs), DomainErrorCode.SecondSpecializationAlreadyExists);

  const withNumber = {
    ...original,
    territories: original.territories.map((entry) => entry.id === "own"
      ? { ...entry, card: { ...entry.card, additionalActivationNumber: 9 } }
      : entry),
  };
  expectCode(() => apply(withNumber, {
    type: "CLUB_ADD_SECOND_SUIT", targetTerritoryId: "own", suit: Suit.Hearts,
  }, Suit.Clubs), DomainErrorCode.SecondSpecializationAlreadyExists);
});

test("heart adds exactly one global or two local influence", () => {
  const original = stateWith(Suit.Hearts);
  const global = apply(original, { type: "HEART_GLOBAL_INFLUENCE" }, Suit.Hearts);
  assert.equal(global.state.players[0].globalInfluence, 7);
  assert.equal(global.event.payload.amount, 1);
  assert.equal(original.players[0].globalInfluence, 6);

  const local = apply(original, {
    type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: "neutral",
  }, Suit.Hearts);
  assert.equal(local.state.territories[2].localInfluenceByPlayerId.A, 2);
  assert.equal(local.event.payload.amount, 2);
  expectCode(() => apply(local.state, {
    type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: "neutral",
  }, Suit.Hearts), DomainErrorCode.InvalidLocalInfluenceTarget);
  expectCode(() => apply(original, {
    type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: "enemy",
  }, Suit.Hearts), DomainErrorCode.InvalidLocalInfluenceTarget);
  expectCode(() => apply(original, {
    type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: "far",
  }, Suit.Hearts), DomainErrorCode.InvalidLocalInfluenceTarget);
});

test("spade stores an available round effect with source and player", () => {
  const original = stateWith(Suit.Spades);
  const { state, event } = apply(original, { type: "SPADE_STORE" }, Suit.Spades);
  assert.deepEqual(state.spadeActivations, [{
    id: "effect-1", playerId: "A", sourceTerritoryId: "source", status: "AVAILABLE",
  }]);
  assert.equal(event.type, "SPADE_ACTIVATION_STORED");
  expectCode(() => apply(state, { type: "SPADE_STORE" }, Suit.Spades),
    DomainErrorCode.InvalidActivationChoice);
});

test("an unavailable suit or mismatched choice never applies an effect", () => {
  const original = stateWith(Suit.Hearts);
  expectCode(() => apply(original, { type: "SPADE_STORE" }, Suit.Spades),
    DomainErrorCode.InvalidSuitSelection);
  expectCode(() => apply(original, { type: "SPADE_STORE" }, Suit.Hearts),
    DomainErrorCode.InvalidActivationChoice);
  assert.equal(original.spadeActivations.length, 0);
  assert.equal(original.players[0].globalInfluence, 6);
});
