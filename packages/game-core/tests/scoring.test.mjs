import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAction,
  beginScoring,
  chooseLargestRealm,
  createGameState,
  createGridMap,
  createTerritoryCard,
  createGameViewForPlayer,
  finishCurrentBasicAction,
  formatRoundedScoreHundredths,
  formatScoreHundredths,
  GameActionType,
  GameEventType,
  GamePhase,
  PointOfInterestType,
  SettlementKind,
  Suit,
} from "../dist/index.js";

const timestamp = "2026-09-18T16:00:00.000Z";

function territory(id, ownerId, suit = Suit.Hearts, extra = {}) {
  return { id, ownerId, card: createTerritoryCard(suit, 7), ...extra };
}

function stateFromRows({ rows, territories, players = [{ id: "anna", secretFactionSuit: Suit.Hearts }], pointsOfInterest = [] }) {
  const gamePlayers = players.length >= 2 ? players : [...players, { id: "ben" }];
  const width = Math.max(...rows.map((row) => row.length));
  const cells = {};
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < width; x += 1) cells[`${x},${y}`] = rows[y]?.[x] && rows[y][x] !== "." ? rows[y][x] : null;
  }
  return {
    ...createGameState({ gameId: "score-test", players: gamePlayers, startPlayerId: gamePlayers[0].id }),
    phase: GamePhase.Scoring,
    territories,
    map: createGridMap({ width, height: rows.length, format: "A5" }, cells),
    pointsOfInterest,
  };
}

function playerResult(state, playerId = "anna") {
  return state.result.playerResults.find((result) => result.playerId === playerId);
}

function territoryScore(state, territoryId, playerId = "anna") {
  return playerResult(state, playerId).territoryScores.find((score) => score.territoryId === territoryId);
}

test("scoring adds territory bonuses once and keeps exact hundredths", () => {
  const rows = Array.from({ length: 10 }, () => "A".repeat(10));
  const state = stateFromRows({
    rows,
    territories: [territory("A", "anna", Suit.Hearts, {
      settlementFeatures: [{ id: "city", kind: SettlementKind.City, position: { x: 0, y: 0 } }],
    })],
    pointsOfInterest: [{ id: "landmark", type: PointOfInterestType.Landmark, position: { x: 1, y: 1 } }],
  });
  const scored = beginScoring(state, timestamp).state;
  const score = territoryScore(scored, "A");
  assert.equal(scored.phase, GamePhase.Finished);
  assert.equal(score.baseArea, 100);
  assert.equal(score.totalBonusPercent, 125);
  assert.equal(score.scoreHundredths, 22500);
  assert.equal(formatScoreHundredths(score.scoreHundredths), "225");
});

test("faction scoring considers only the card's original suit", () => {
  const state = stateFromRows({ rows: ["A"], players: [{ id: "anna", secretFactionSuit: Suit.Clubs }],
    territories: [{ ...territory("A", "anna", Suit.Diamonds), card: { suit: Suit.Diamonds, activationNumber: 7, additionalSuit: Suit.Clubs } }],
  });
  const score = territoryScore(beginScoring(state, timestamp).state, "A");
  assert.equal(score.factionBonusPercent, 0);
  assert.equal(score.largestRealmBonusPercent, 25);
});

test("an exact quarter bonus keeps twenty-three cells at 28,75 points", () => {
  const state = stateFromRows({ rows: ["A".repeat(23)], players: [{ id: "anna", secretFactionSuit: Suit.Spades }],
    territories: [territory("A", "anna", Suit.Diamonds)],
  });
  const score = territoryScore(beginScoring(state, timestamp).state, "A");
  assert.equal(score.totalBonusPercent, 25);
  assert.equal(score.scoreHundredths, 2875);
  assert.equal(formatScoreHundredths(score.scoreHundredths), "28,75");
  assert.equal(formatRoundedScoreHundredths(score.scoreHundredths), "29");
});

test("the geometrically largest realm receives the bonus on each of its territories", () => {
  const state = stateFromRows({
    rows: [`${"A".repeat(30)}${"B".repeat(25)}.${"C".repeat(40)}`],
    territories: [territory("A", "anna"), territory("B", "anna"), territory("C", "anna")],
  });
  const scored = beginScoring(state, timestamp).state;
  assert.equal(territoryScore(scored, "A").largestRealmBonusPercent, 25);
  assert.equal(territoryScore(scored, "B").largestRealmBonusPercent, 25);
  assert.equal(territoryScore(scored, "C").largestRealmBonusPercent, 0);
});

test("tied largest realms wait for the owner's valid choice", () => {
  const state = stateFromRows({
    rows: [`${"A".repeat(60)}.${"B".repeat(60)}`],
    territories: [territory("A", "anna"), territory("B", "anna")],
  });
  const waiting = beginScoring(state, timestamp);
  assert.equal(waiting.state.phase, GamePhase.Scoring);
  assert.deepEqual(waiting.state.scoring.pendingLargestRealmPlayerIds, ["anna"]);
  const candidates = waiting.state.scoring.largestRealmCandidateIdsByPlayerId.anna;
  assert.equal(candidates.length, 2);
  const completed = chooseLargestRealm(waiting.state, { type: GameActionType.ChooseLargestRealm, playerId: "anna", componentId: candidates[0] }, timestamp).state;
  assert.equal(completed.phase, GamePhase.Finished);
  const selected = completed.scoring.realmComponents.find((component) => component.id === candidates[0]);
  for (const territoryId of selected.territoryIds) assert.equal(territoryScore(completed, territoryId).largestRealmBonusPercent, 25);
  const unselectedId = selected.territoryIds[0] === "A" ? "B" : "A";
  assert.equal(territoryScore(completed, unselectedId).largestRealmBonusPercent, 0);
  assert.ok(completed.events.some((event) => event.type === GameEventType.LargestRealmChoiceRequired));
  assert.ok(completed.events.some((event) => event.type === GameEventType.LargestRealmSelected));
});

function hubState(hubCount, threeNeighbors) {
  const rows = threeNeighbors
    ? ["BBCDD", "BAAAD", "BAAAD"]
    : [".......", ".".repeat(7), ".BCDE..", ".FAAG..", ".HAAI..", ".JKKL..", "......."];
  const territoryIds = new Set(rows.join("").split("").filter((id) => id !== "."));
  const pointsOfInterest = Array.from({ length: hubCount }, (_, index) => ({ id: `hub-${index}`, type: PointOfInterestType.Junction,
    position: threeNeighbors ? { x: 2, y: 1 } : { x: 2, y: 3 } }));
  return stateFromRows({ rows, territories: [...territoryIds].map((id) => territory(id, id === "A" ? "anna" : null)), pointsOfInterest });
}

test("each hub caps its adjacent-territory bonus at fifty percent", () => {
  const scored = beginScoring(hubState(1, false), timestamp).state;
  assert.equal(territoryScore(scored, "A").hubBonusPercent, 50);
});

test("multiple hubs stack their individually capped bonuses", () => {
  const scored = beginScoring(hubState(2, true), timestamp).state;
  assert.equal(territoryScore(scored, "A").hubBonusPercent, 60);
});

test("relics activate only after their owner controls at least two", () => {
  const base = stateFromRows({ rows: ["AB"], territories: [territory("A", "anna"), territory("B", "anna")],
    pointsOfInterest: [{ id: "relic-a", type: PointOfInterestType.Relic, position: { x: 0, y: 0 } }],
  });
  assert.equal(territoryScore(beginScoring(base, timestamp).state, "A").relicBonusPercent, 0);
  const twoRelics = { ...base, pointsOfInterest: [...base.pointsOfInterest,
    { id: "relic-b", type: PointOfInterestType.Relic, position: { x: 1, y: 0 } }] };
  const scored = beginScoring(twoRelics, timestamp).state;
  assert.equal(territoryScore(scored, "A").relicBonusPercent, 25);
  assert.equal(territoryScore(scored, "B").relicBonusPercent, 25);
});

test("a city replaces settlement scoring and unowned territory never scores", () => {
  const state = stateFromRows({ rows: ["AN"], territories: [
    territory("A", "anna", Suit.Spades),
    territory("N", null, Suit.Hearts, { settlementFeatures: [
      { id: "settlement", kind: SettlementKind.Settlement, position: { x: 0, y: 0 } },
      { id: "city", kind: SettlementKind.City, position: { x: 0, y: 0 } },
    ] }),
  ], pointsOfInterest: [
    { id: "moved-landmark", type: PointOfInterestType.Landmark, position: { x: 0, y: 0 }, territoryId: "N" },
    { id: "neutral-landmark", type: PointOfInterestType.Landmark, position: { x: 1, y: 0 } },
    { id: "neutral-relic-a", type: PointOfInterestType.Relic, position: { x: 1, y: 0} },
    { id: "neutral-relic-b", type: PointOfInterestType.Relic, position: { x: 1, y: 0} },
  ] });
  const scored = beginScoring(state, timestamp).state;
  assert.equal(territoryScore(scored, "A").developmentBonusPercent, 50);
  assert.equal(territoryScore(scored, "A").landmarkBonusPercent, 25);
  assert.equal(playerResult(scored).territoryScores.length, 1);
  assert.equal(playerResult(scored).totalScoreHundredths, territoryScore(scored, "A").scoreHundredths);
});

test("exact ties retain all winners without a tie-breaker", () => {
  const state = stateFromRows({ rows: ["AA.BB.C"], players: [
    { id: "anna", secretFactionSuit: Suit.Hearts }, { id: "ben", secretFactionSuit: Suit.Hearts }, { id: "clara", secretFactionSuit: Suit.Hearts },
  ], territories: [territory("A", "anna"), territory("B", "ben"), territory("C", "clara") ] });
  const scored = beginScoring(state, timestamp).state;
  assert.deepEqual(scored.result.winnerPlayerIds, ["anna", "ben"]);
  assert.equal(playerResult(scored, "clara").totalScoreHundredths < playerResult(scored, "anna").totalScoreHundredths, true);
});

test("final player views contain results and reveal all factions", () => {
  const state = stateFromRows({ rows: ["A"], players: [
    { id: "anna", secretFactionSuit: Suit.Hearts }, { id: "ben", secretFactionSuit: Suit.Spades },
  ], territories: [territory("A", "anna")], });
  const finished = beginScoring(state, timestamp).state;
  const view = createGameViewForPlayer(finished, "anna");
  assert.ok(view.result);
  assert.equal(view.players.find((player) => player.id === "ben").secretFactionSuit, Suit.Spades);
});

test("the final basic action completes scoring and blocks every later game action", () => {
  const base = stateFromRows({ rows: ["A.B.C"], players: [{ id: "anna"}, { id: "ben" }, { id: "clara" }],
    territories: [territory("A", "anna"), territory("B", "ben"), territory("C", "clara")],
  });
  const actionState = { ...base, phase: GamePhase.ActionPhase, round: 1, maxRounds: 1, startPlayerId: "anna", activePlayerId: "anna",
    actionPhase: { completedPlayerIds: ["ben", "clara"], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false, currentActionKind: "WAR" },
  };
  const completed = finishCurrentBasicAction(actionState, timestamp).state;
  assert.equal(completed.phase, GamePhase.Finished);
  assert.ok(completed.events.some((event) => event.type === GameEventType.ScoringCompleted));
  assert.ok(completed.events.some((event) => event.type === GameEventType.GameFinished));
  const before = structuredClone(completed);
  assert.throws(() => applyAction(completed, { type: GameActionType.ForfeitAction, playerId: "anna" }, { timestamp, randomSource: { nextInt: () => 1 } }),
    (error) => error.code === "GAME_ALREADY_FINISHED");
  assert.deepEqual(completed, before);
});
