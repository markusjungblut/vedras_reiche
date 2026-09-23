import assert from "node:assert/strict";
import test from "node:test";
import { DomainError, DomainErrorCode, GamePhase } from "@vedras/game-core";
import { formatDomainError, getCurrentHelp, getHelpValues, renderRuleHelp, RULE_HELP } from "../.test-dist/help/rule-help.js";
import { loadTutorialProgress, markIntroductionSeen, markTutorialSeen, resetTutorialProgress } from "../.test-dist/help/tutorial-state.js";

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
});

test("domain errors receive understandable neutral messages", () => {
  assert.equal(formatDomainError(new DomainError(DomainErrorCode.MinimumTerritorySizeViolated)),
    "Das Gebiet wäre anschließend kleiner als die erlaubte Mindestgröße.");
  assert.equal(formatDomainError(new DomainError(DomainErrorCode.UnsupportedAction)),
    "Diese Aktion ist im aktuellen Zustand nicht verfügbar.");
});
