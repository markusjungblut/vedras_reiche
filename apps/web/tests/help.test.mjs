import assert from "node:assert/strict";
import test from "node:test";
import { DomainError, DomainErrorCode, GameEventType, GamePhase, Suit } from "@vedras/game-core";
import { formatDomainError, getCurrentHelp, getHelpValues, renderRuleHelp, RULE_HELP } from "../.test-dist/help/rule-help.js";
import { loadTutorialProgress, markIntroductionSeen, markTutorialSeen, resetTutorialProgress } from "../.test-dist/help/tutorial-state.js";
import { getMapColorRegime } from "../.test-dist/ui/map-color-regime.js";
import { getSetupRegionColor } from "../.test-dist/ui/setup-region-colors.js";
import { POINT_OF_INTEREST_PRESENTATIONS, POINT_OF_INTEREST_RULE_SUMMARY } from "../.test-dist/ui/point-of-interest-presentation.js";
import { derivePresentationEvents } from "../.test-dist/presentation/game-presentation.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test("tutorial progress is local, durable, and resettable", () => {
  const memory = new MemoryStorage();
  const introduced = markIntroductionSeen(loadTutorialProgress(memory), memory);
  const progressed = markTutorialSeen(introduced, "activation", memory);
  assert.equal(loadTutorialProgress(memory).introductionSeen, true);
  assert.equal(loadTutorialProgress(memory).seen.activation, true);
  assert.deepEqual(resetTutorialProgress(memory), { introductionSeen: false, seen: {} });
  assert.deepEqual(loadTutorialProgress(memory), { introductionSeen: false, seen: {} });
  assert.equal(progressed.seen.activation, true);
});

test("current help follows public phase state without exposing a faction", () => {
  const state = {
    phase: GamePhase.ActivationPhase,
    activePlayerId: "one",
    players: [{ id: "one", name: "Ava", secretFactionSuit: "SPADES" }],
    pendingSplit: undefined,
    pendingWar: undefined,
    pendingDiamondBorderChanges: [],
    auction: undefined,
  };
  const help = getCurrentHelp(state, "one");
  assert.equal(help.title, "Aktivierung");
  assert.match(help.action, /deiner/);
  assert.deepEqual(help.topicIds, ["activation", "diamonds", "clubs", "hearts", "spades"]);
  assert.doesNotMatch(JSON.stringify(help), /SPADES/);
});

test("help values use the current map instead of a fixed digital threshold", () => {
  const values = getHelpValues({ map: { width: 20, height: 15 } });
  assert.deepEqual(values, {
    minimumTerritoryArea: 3, cutAndChooseThreshold: 6,
    neutralDiamondDepth: 1, normalAdvanceDepth: 1, strongAdvanceDepth: 1,
  });
  assert.match(renderRuleHelp(RULE_HELP.cutAndChoose, values).long, /mindestens 3 Kästchen/);
  assert.match(renderRuleHelp(RULE_HELP.breakthrough, values).long, /bei 6 Kästchen/);
  assert.match(renderRuleHelp(RULE_HELP.borderGains, values).long, /bis zu 1 Kästchen tief/);
  assert.equal(getHelpValues({ map: { width: 50, height: 50 } }).neutralDiamondDepth, 3);
});

test("scoring help explains front territories and remaining influence", () => {
  assert.match(RULE_HELP.frontTerritory.long, /höchstens 3 %/);
  assert.match(RULE_HELP.frontTerritory.long, /\+20 %/);
  assert.match(RULE_HELP.scoring.long, /globale Einfluss ist 10 Punkte wert/);
  assert.match(RULE_HELP.scoring.long, /lokaler Einfluss wird nicht gewertet/);
});

test("map colors switch only with the authoritative phase and POI copy stays shared", () => {
  assert.equal(getMapColorRegime({ phase: GamePhase.MapCreation }), "SETUP_TERRITORIES");
  assert.equal(getMapColorRegime({ phase: GamePhase.Setup }), "SETUP_TERRITORIES");
  assert.equal(getMapColorRegime({ phase: GamePhase.StartAuctions }), "OWNERSHIP");
  assert.equal(getMapColorRegime({ phase: GamePhase.ActivationPhase }), "OWNERSHIP");
  assert.equal(getMapColorRegime({ phase: GamePhase.ActionPhase }), "OWNERSHIP");
  assert.match(POINT_OF_INTEREST_PRESENTATIONS.LANDMARK.shortEffect, /\+25 % Wertung/);
  assert.match(POINT_OF_INTEREST_PRESENTATIONS.JUNCTION.shortEffect, /\+15 %/);
  assert.match(POINT_OF_INTEREST_PRESENTATIONS.JUNCTION.shortEffect, /höchstens \+75 %/);
  assert.match(POINT_OF_INTEREST_PRESENTATIONS.FORTRESS.shortEffect, /\+1 Verteidigung/);
  assert.match(POINT_OF_INTEREST_PRESENTATIONS.RELIC.shortEffect, /zwei Relikte/);
  assert.match(POINT_OF_INTEREST_RULE_SUMMARY, /★ Wahrzeichen/);
  assert.match(RULE_HELP.pois.long, /◆ Relikt/);
  assert.match(RULE_HELP.factions.long, /\+30 %/);
});

test("setup region colors remain distinct beyond the former six-color palette", () => {
  const colors = Array.from({ length: 28 }, (_, index) => getSetupRegionColor(index));
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(getSetupRegionColor("region-7"), getSetupRegionColor("region-7"));
});

test("domain errors receive understandable neutral messages", () => {
  assert.equal(formatDomainError(new DomainError(DomainErrorCode.MinimumTerritorySizeViolated)),
    "Das Gebiet wäre anschließend kleiner als die erlaubte Mindestgröße.");
  assert.equal(formatDomainError(new DomainError(DomainErrorCode.UnsupportedAction)),
    "Diese Aktion ist im aktuellen Zustand nicht verfügbar.");
});

function presentationState({ phase = GamePhase.ActionPhase, ownerId = "anna", cells = { "0,0": "G03", "1,0": "G07", "2,0": "G08" } } = {}) {
  return {
    phase,
    players: [{ id: "anna", name: "Anna" }, { id: "ben", name: "Ben" }],
    territories: [
      { id: "G03", ownerId, card: { suit: Suit.Diamonds, activationNumber: 9 } },
      { id: "G07", ownerId: "anna", card: { suit: Suit.Clubs, activationNumber: 4, additionalActivationNumber: 9 } },
      { id: "G08", ownerId: "ben", card: { suit: Suit.Spades, activationNumber: 11 } },
    ],
    map: { width: 3, height: 1, cells },
    events: [],
    pendingSplit: undefined,
  };
}

function event(id, type, payload) {
  return { id, type, payload, timestamp: "2026-01-01T00:00:00.000Z" };
}

test("presentation reveals only authoritative activation values and pulses matching territories together", () => {
  const previous = presentationState({ phase: GamePhase.RoundReady });
  const current = presentationState({ phase: GamePhase.ActivationPhase });
  const events = derivePresentationEvents(previous, current, [event("roll-1", GameEventType.ActivationNumbersRolled, {
    activationNumbers: [4, 9, 11],
  })]);
  assert.deepEqual(events, [{
    type: "ACTIVATION_ROLL_REVEAL",
    id: "roll-1",
    numbers: [4, 9, 11],
    revealIndex: 0,
    territoryIdsByNumber: { 4: ["G07"], 9: ["G03", "G07"], 11: ["G08"] },
  }]);
});

test("presentation reveals one new authoritative activation number without future values", () => {
  const state = presentationState({ phase: GamePhase.ActivationPhase });
  const events = derivePresentationEvents(state, state, [event("roll-2", GameEventType.ActivationNumberRolled, {
    activationNumber: 9,
    index: 1,
    activationNumbers: [4, 9],
    pendingTerritoryIds: ["G03", "G07"],
  })]);
  assert.deepEqual(events, [{
    type: "ACTIVATION_ROLL_REVEAL",
    id: "roll-2",
    numbers: [4, 9],
    revealIndex: 1,
    territoryIdsByNumber: { 9: ["G03", "G07"] },
  }]);
});

test("presentation confirms only the suit selected by an authoritative activation", () => {
  const state = presentationState();
  const startedOnly = derivePresentationEvents(state, state, [event("start-1", GameEventType.TerritoryActivationStarted, {
    territoryId: "G07", selectedSuit: Suit.Clubs,
  })]);
  const completed = derivePresentationEvents(state, state, [event("activated-1", GameEventType.TerritoryActivated, {
    territoryId: "G07", selectedSuit: Suit.Diamonds,
  })]);
  assert.deepEqual(startedOnly, []);
  assert.equal(completed[0].type, "TERRITORY_SUIT_CONFIRM");
  assert.equal(completed[0].suit, Suit.Diamonds);
  assert.equal(completed[1].type, "ACTIVATION_TERRITORY_PULSE");
});

test("presentation uses one normal-auction wave and marks start-auction gains", () => {
  const previous = presentationState({ ownerId: null });
  const current = presentationState({ ownerId: "anna" });
  const events = derivePresentationEvents(previous, current, [
    event("bids-1", GameEventType.AuctionBidsRevealed, { territoryId: "G03", bids: {
      anna: { kind: "NORMAL", basicBid: 2, globalInfluence: 1, localInfluence: 0 },
      ben: { kind: "NORMAL", basicBid: 1, globalInfluence: 0, localInfluence: 0 },
    } }),
    event("won-1", GameEventType.AuctionWon, { territoryId: "G03", playerId: "anna" }),
    event("owner-1", GameEventType.TerritoryOwnerChanged, { territoryId: "G03", ownerId: "anna" }),
  ]);
  const reveal = events.find((item) => item.type === "AUCTION_RESULT_REVEAL");
  const wave = events.find((item) => item.type === "TERRITORY_GAIN_WAVE");
  assert.deepEqual(reveal.bids, [{ playerId: "anna", value: 3 }, { playerId: "ben", value: 1 }]);
  assert.equal(reveal.winnerId, "anna");
  assert.deepEqual(wave.cellKeys, ["0,0"]);
  assert.equal(wave.kind, "AUCTION");
  assert.equal(wave.previousOwnerIdByCell["0,0"], null);

  const startPrevious = presentationState({ phase: GamePhase.StartAuctions, ownerId: null });
  const startCurrent = presentationState({ phase: GamePhase.StartAuctions, ownerId: "anna" });
  const startWave = derivePresentationEvents(startPrevious, startCurrent, [
    event("start-owner", GameEventType.TerritoryOwnerChanged, { territoryId: "G03", ownerId: "anna" }),
  ]).find((item) => item.type === "TERRITORY_GAIN_WAVE");
  assert.equal(startWave.kind, "START_AUCTION");
});

test("war presentation keeps exact transfer cells and delays the wave until the dice outcome", () => {
  const previous = presentationState();
  const current = presentationState({ cells: { "0,0": "G03", "1,0": "G03", "2,0": "G08" } });
  const events = derivePresentationEvents(previous, current, [
    event("combat-1", GameEventType.CombatRolled, {
      attackerRoll: 6, defenderRoll: 3, attackerSpadeBonus: 1, defenderSpadeBonus: 0,
      defenderFortressBonus: 1, attackerTotal: 7, defenderTotal: 4, outcome: "BORDER_ADVANCE",
    }),
    event("advance-1", GameEventType.BorderAdvanceResolved, {
      directTransferCells: [{ x: 1, y: 0 }],
      annexedDisconnectedCells: [],
    }),
  ]);
  const dice = events.find((item) => item.type === "WAR_DICE_REVEAL");
  const wave = events.find((item) => item.type === "TERRITORY_GAIN_WAVE");
  assert.equal(dice.attackerRoll, 6);
  assert.equal(dice.outcome, "BORDER_ADVANCE");
  assert.deepEqual(wave.cellKeys, ["1,0"]);
  assert.equal(wave.delayMs, 900);
});
