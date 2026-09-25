import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction, createGameState, createGridMap, createGameViewForPlayer,
  DomainErrorCode, GameActionType, GameEventType, GamePhase,
  getCellsWithinBorderDepth, getPointOfInterestTerritory, getSharedBorder,
  getTerritoryArea, PointOfInterestType, Suit, validateBorderAdvance,
  assessBorderAdvanceLimitation, canTerritoryParticipateInWar, canTerritoryStartWar,
  getLargeTerritoryThreshold, getMaximumLegalBorderAdvance,
  getPotentialWarTargets, isLargeTerritory,
} from "../dist/index.js";

const timestamp = "2026-09-18T15:00:00.000Z";
class Dice {
  constructor(...values) { this.values = values; }
  nextInt(min, max) {
    const value = this.values.shift();
    assert.ok(value >= min && value <= max, `unexpected draw ${value} in ${min}–${max}`);
    return value;
  }
}

function fixture({ a = 40, b = 40, format = "A4", weakA = false, weakB = false,
  markPlayer, spades = [{ id: "default", playerId: "P", sourceTerritoryId: "A", status: "AVAILABLE" }], fortresses = [] } = {}) {
  const height = 5;
  const widthA = Math.ceil(a / height);
  const widthB = Math.ceil(b / height);
  const width = widthA + widthB;
  const cells = {};
  let leftCount = 0, rightCount = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < widthA && leftCount++ < a) cells[`${x},${y}`] = "A";
    if (x >= widthA && rightCount++ < b) cells[`${x},${y}`] = "B";
  }
  const setup = createGameState({ gameId: "war-test", players: [{ id: "P", name: "P" }, { id: "Q", name: "Q" }], startPlayerId: "P" });
  return {
    ...setup, phase: GamePhase.ActionPhase, round: 1, activePlayerId: "P",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
    map: createGridMap({ width, height, format }, cells),
    territories: [
      { id: "A", ownerId: "P", card: { suit: Suit.Spades, activationNumber: 2 }, ...(weakA ? { weakened: true } : {}) },
      { id: "B", ownerId: "Q", card: { suit: Suit.Clubs, activationNumber: 3, additionalSuit: Suit.Hearts }, ...(weakB ? { weakened: true } : {}) },
    ],
    pointsOfInterest: fortresses.map((position, index) => ({ id: `F${index}`, type: PointOfInterestType.Fortress, position })),
    spadeActivations: spades,
    borderMarks: markPlayer ? [{ id: "mark", territoryIds: ["A", "B"], playerId: markPlayer }] : [],
  };
}

function act(state, action, random = new Dice()) {
  return applyAction(state, action, { randomSource: random, timestamp });
}
function start(state) { return act(state, { type: GameActionType.StartWar, playerId: "P", attackerTerritoryId: "A", defenderTerritoryId: "B" }).state; }
function fight(state, dice, aSpade = null, bSpade = null) {
  let next = state;
  if (!Object.hasOwn(next.pendingWar.spadeChoices, "P")) {
    next = act(next, { type: GameActionType.SetWarSpadeChoice, warId: next.pendingWar.id,
      playerId: "P", spadeActivationId: aSpade }, new Dice(...dice)).state;
  }
  if (next.pendingWar && !Object.hasOwn(next.pendingWar.spadeChoices, "Q")) {
    next = act(next, { type: GameActionType.SetWarSpadeChoice, warId: next.pendingWar.id,
      playerId: "Q", spadeActivationId: bSpade }, new Dice(...dice)).state;
  }
  return next;
}

function largeWarFixture({ attackerWidth = 50, markPlayer } = {}) {
  const cells = {};
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 100; x += 1) cells[`${x},${y}`] = x < attackerWidth ? "A" : "B";
  const setup = createGameState({ gameId: "large-war", players: [{ id: "P", name: "P" }, { id: "Q", name: "Q" }], startPlayerId: "P" });
  return {
    ...setup, phase: GamePhase.ActionPhase, round: 1, activePlayerId: "P",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
    map: createGridMap({ width: 100, height: 100 }, cells),
    territories: [
      { id: "A", ownerId: "P", card: { suit: Suit.Spades, activationNumber: 2 } },
      { id: "B", ownerId: "Q", card: { suit: Suit.Clubs, activationNumber: 3 } },
    ],
    spadeActivations: [{ id: "default", playerId: "P", sourceTerritoryId: "A", status: "AVAILABLE" }],
    borderMarks: markPlayer ? [{ id: "mark", territoryIds: ["A", "B"], playerId: markPlayer }] : [],
  };
}

test("a war with no legal spade effects resolves the choices automatically", () => {
  const started = act(fixture({ spades: [] }), { type: GameActionType.StartWar, playerId: "P", attackerTerritoryId: "A", defenderTerritoryId: "B" }, new Dice(4, 3));
  assert.equal(started.state.pendingWar?.stage, "AWAITING_BORDER_ADVANCE");
  assert.equal(started.state.events.filter((event) => event.type === GameEventType.WarSpadeChoiceLocked).length, 2);
});

test("combat has no attacker bonus, ties lock both territories and consume the mark", () => {
  const initial = fixture({ markPlayer: "P" });
  const started = start(initial);
  assert.equal(started.pendingWar.attackerArea, 40);
  assert.equal(started.pendingWar.defenderArea, 40);
  assert.equal(started.pendingWar.originalSharedBorder.segments.length, 5);
  assert.equal(started.borderMarks.length, 0);
  assert.ok(started.territories.every((territory) => territory.participatedInWarThisRound));
  assert.throws(() => start(started), (error) => error.code === DomainErrorCode.NotActivePlayer || error.code === DomainErrorCode.InvalidPhase);
  const tied = fight(started, [3, 3]);
  assert.equal(tied.pendingWar, undefined);
  assert.equal(tied.map.cells["8,0"], "B");
  assert.equal(tied.territories[1].ownerId, "Q");
  assert.equal(tied.events.some((event) => event.type === GameEventType.ActionCompleted), true);
});

test("normal win uses the compact fixture's scaled corridor and a completed border move ends the action", () => {
  const fought = fight(start(fixture()), [5, 3]);
  assert.equal(fought.pendingWar.stage, "AWAITING_BORDER_ADVANCE");
  assert.equal(fought.pendingWar.maximumDepth, 1);
  assert.equal(fought.pendingWar.combat.difference, 2);
  const war = fought.pendingWar;
  const corridor = getCellsWithinBorderDepth(fought.map, "B", war.originalSharedBorder, war.maximumDepth);
  const defaultAdvance = getMaximumLegalBorderAdvance(fought.map, "A", "B", war.originalSharedBorder, war.maximumDepth);
  assert.equal(corridor.length, 5);
  assert.ok(defaultAdvance.length > 0);
  assert.equal(validateBorderAdvance(fought.map, "A", "B", war.originalSharedBorder, war.maximumDepth, defaultAdvance).valid, true);
  const invalid = { type: GameActionType.ProposeBorderAdvance, warId: war.id, playerId: "P", claimedCells: [{ x: 10, y: 0 }] };
  assert.throws(() => act(fought, invalid), (error) => error.code === DomainErrorCode.CellOutsideWarCorridor);
  assert.equal(fought.map.cells["10,0"], "B");
  const resolved = act(fought, { ...invalid, claimedCells: [{ x: 8, y: 0 }] }).state;
  assert.equal(resolved.map.cells["8,0"], "A");
  assert.equal(resolved.pendingWar, undefined);
  assert.equal(resolved.events.filter((event) => event.type === GameEventType.ActionCompleted).length, 1);
  assert.equal(resolved.territories.find((territory) => territory.id === "B").weakened, undefined);
});

test("normal, strong, and ♦-marked wars use scaled grid depths on a 100 by 100 map", () => {
  assert.equal(fight(start(largeWarFixture()), [5, 3]).pendingWar.maximumDepth, 4);
  assert.equal(fight(start(largeWarFixture({ markPlayer: "P" })), [5, 3]).pendingWar.maximumDepth, 6);
  assert.equal(fight(start(largeWarFixture({ attackerWidth: 25 })), [6, 3]).pendingWar.maximumDepth, 8);
});

test("neutral ♦ accepts a connected six-cell deep transfer on a 100 by 100 map", () => {
  const base = largeWarFixture();
  const state = {
    ...base,
    phase: GamePhase.ActivationPhase,
    activationNumbers: [2],
    activation: { pendingTerritoryIds: ["A"], resolvedTerritoryIds: [] },
    territories: base.territories.map((territory) => territory.id === "A"
      ? { ...territory, card: { suit: Suit.Diamonds, activationNumber: 2 } }
      : { ...territory, ownerId: null }),
  };
  const pending = act(state, { type: GameActionType.ActivateTerritory, playerId: "P", territoryId: "A",
    choice: { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: "B" } }).state;
  const effect = pending.pendingDiamondBorderChanges[0];
  const resolved = act(pending, { type: GameActionType.ResolveNeutralDiamond, effectId: effect.id, playerId: "P",
    claimedCells: [{ x: 50, y: 0 }, { x: 51, y: 0 }, { x: 52, y: 0 }, { x: 53, y: 0 }, { x: 54, y: 0 }, { x: 55, y: 0 }] }).state;
  assert.deepEqual([50, 51, 52, 53, 54, 55].map((x) => resolved.map.cells[`${x},0`]), ["A", "A", "A", "A", "A", "A"]);
});

function warEligibilityState({ width = 50, height = 50, area = 150, participationCount = 0, initiatedCount = 0 } = {}) {
  const cells = {};
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    cells[`${x},${y}`] = y * width + x < area ? "A" : "B";
  }
  const setup = createGameState({ gameId: "war-eligibility", players: [{ id: "P", name: "P" }, { id: "Q", name: "Q" }], startPlayerId: "P" });
  return {
    ...setup,
    map: createGridMap({ width, height }, cells),
    territories: [
      { id: "A", ownerId: "P", warParticipationCountThisRound: participationCount, warsInitiatedThisRound: initiatedCount },
      { id: "B", ownerId: "Q" },
    ],
    spadeActivations: [{ id: "default", playerId: "P", sourceTerritoryId: "A", status: "AVAILABLE" }],
  };
}

test("large territory threshold is six percent of the current map area", () => {
  assert.equal(getLargeTerritoryThreshold({ width: 50, height: 50 }), 150);
  assert.equal(isLargeTerritory(warEligibilityState({ area: 149 }), "A"), false);
  assert.equal(isLargeTerritory(warEligibilityState({ area: 150 }), "A"), true);
  assert.equal(isLargeTerritory(warEligibilityState({ area: 151 }), "A"), true);
  assert.equal(getLargeTerritoryThreshold({ width: 100, height: 50 }), 300);
  assert.equal(isLargeTerritory(warEligibilityState({ width: 100, height: 50, area: 299 }), "A"), false);
  assert.equal(isLargeTerritory(warEligibilityState({ width: 100, height: 50, area: 300 }), "A"), true);
});

test("war participation dynamically permits one extra defense only for current large territories", () => {
  const largeAfterAttack = warEligibilityState({ area: 150, participationCount: 1, initiatedCount: 1 });
  assert.deepEqual(canTerritoryStartWar(largeAfterAttack, "A"), { allowed: false, reason: "LARGE_TERRITORY_INITIATOR_LIMIT" });
  assert.deepEqual(canTerritoryParticipateInWar(largeAfterAttack, "A"), { allowed: true });
  assert.deepEqual(getPotentialWarTargets(largeAfterAttack, "Q"), [{ attackerTerritoryId: "B", defenderTerritoryId: "A" }]);
  const attackAgain = { ...largeAfterAttack, phase: GamePhase.ActionPhase, activePlayerId: "P",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false } };
  assert.throws(() => start(attackAgain), (error) => error.code === DomainErrorCode.LargeTerritoryInitiatorLimitReached);

  const afterTwoWars = { ...largeAfterAttack, territories: largeAfterAttack.territories.map((territory) => territory.id === "A"
    ? { ...territory, warParticipationCountThisRound: 2 } : territory) };
  assert.deepEqual(canTerritoryParticipateInWar(afterTwoWars, "A"), { allowed: false, reason: "LARGE_TERRITORY_LIMIT" });

  const normalAfterOneWar = warEligibilityState({ area: 149, participationCount: 1 });
  assert.deepEqual(canTerritoryParticipateInWar(normalAfterOneWar, "A"), { allowed: false, reason: "NORMAL_TERRITORY_LIMIT" });
  const normalAttackAgain = { ...normalAfterOneWar, phase: GamePhase.ActionPhase, activePlayerId: "P",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false } };
  assert.throws(() => start(normalAttackAgain), (error) => error.code === DomainErrorCode.TerritoryAlreadyInWar);

  const shrunkLarge = warEligibilityState({ area: 145, participationCount: 1 });
  assert.deepEqual(canTerritoryParticipateInWar(shrunkLarge, "A"), { allowed: false, reason: "NORMAL_TERRITORY_LIMIT" });
  const grownTerritory = warEligibilityState({ area: 155, participationCount: 1 });
  assert.deepEqual(canTerritoryParticipateInWar(grownTerritory, "A"), { allowed: true });
});

test("starting a war records participation and initiation counts", () => {
  const base = warEligibilityState({ area: 150 });
  const state = { ...base, phase: GamePhase.ActionPhase, activePlayerId: "P",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false } };
  const started = start(state);
  const attacker = started.territories.find((territory) => territory.id === "A");
  const defender = started.territories.find((territory) => territory.id === "B");
  assert.equal(attacker.warParticipationCountThisRound, 1);
  assert.equal(attacker.warsInitiatedThisRound, 1);
  assert.equal(defender.warParticipationCountThisRound, 1);
  assert.equal(defender.warsInitiatedThisRound, 0);
});

test("empty gain is legal at minimum area; claiming a cell there is rejected", () => {
  const fought = fight(start(fixture({ b: 20 })), [5, 3]);
  const warId = fought.pendingWar.id;
  assert.throws(() => act(fought, { type: GameActionType.ProposeBorderAdvance, warId, playerId: "P",
    claimedCells: [{ x: 8, y: 0 }] }), (error) => error.code === DomainErrorCode.MinimumTerritorySizeViolated);
  const resolved = act(fought, { type: GameActionType.ProposeBorderAdvance, warId, playerId: "P", claimedCells: [] }).state;
  assert.equal(getTerritoryArea(resolved.map, "B"), 20);
  const limitation = assessBorderAdvanceLimitation(fought.map, "A", "B", fought.pendingWar.originalSharedBorder, 2, []);
  assert.deepEqual(limitation, { determinate: true, limitedByMinimumArea: true, limitedByGeometry: false, limitedByTopology: false });
});

function mapFromCells(width, height, entries) {
  return createGridMap({ width, height, format: "A4" }, Object.fromEntries(entries.map(({ x, y, territoryId }) => [`${x},${y}`, territoryId])));
}

test("complete front depth weakens only when it would reduce the loser below twenty cells", () => {
  const minLimited = mapFromCells(9, 3, [
    ...Array.from({ length: 3 }, (_, y) => ({ x: 0, y, territoryId: "A" })),
    ...Array.from({ length: 24 }, (_, offset) => ({ x: 1 + offset % 8, y: Math.floor(offset / 8), territoryId: "B" })),
  ]);
  const minBorder = getSharedBorder(minLimited, "A", "B");
  assert.deepEqual(assessBorderAdvanceLimitation(minLimited, "A", "B", minBorder, 2, []), {
    determinate: true, limitedByMinimumArea: true, limitedByGeometry: false, limitedByTopology: false,
  });

  const exactMinimum = mapFromCells(10, 3, [
    ...Array.from({ length: 3 }, (_, y) => ({ x: 0, y, territoryId: "A" })),
    ...Array.from({ length: 26 }, (_, offset) => ({ x: 1 + offset % 9, y: Math.floor(offset / 9), territoryId: "B" })),
  ]);
  const exactBorder = getSharedBorder(exactMinimum, "A", "B");
  assert.deepEqual(assessBorderAdvanceLimitation(exactMinimum, "A", "B", exactBorder, 2, []), {
    determinate: true, limitedByMinimumArea: false, limitedByGeometry: false, limitedByTopology: false,
  });
});

test("a geometrically disconnected full front does not weaken the loser", () => {
  const map = mapFromCells(6, 9, [
    ...Array.from({ length: 9 }, (_, y) => ({ x: 0, y, territoryId: "A" })),
    ...Array.from({ length: 9 }, (_, y) => [{ x: 1, y, territoryId: "B" }, { x: 2, y, territoryId: "B" }]).flat(),
    ...Array.from({ length: 12 }, (_, offset) => ({ x: 3 + offset % 3, y: Math.floor(offset / 3), territoryId: "B" })),
    ...Array.from({ length: 12 }, (_, offset) => ({ x: 3 + offset % 3, y: 5 + Math.floor(offset / 3), territoryId: "B" })),
  ]);
  const limitation = assessBorderAdvanceLimitation(map, "A", "B", getSharedBorder(map, "A", "B"), 2, []);
  assert.deepEqual(limitation, { determinate: true, limitedByMinimumArea: false, limitedByGeometry: false, limitedByTopology: true });
});

test("a compact ♦-marked border uses its scaled depth even when the winner claims only one cell", () => {
  const plain = fight(start(fixture({ b: 30 })), [5, 3]);
  const plainLimitation = assessBorderAdvanceLimitation(plain.map, "A", "B", plain.pendingWar.originalSharedBorder, plain.pendingWar.maximumDepth, []);
  assert.equal(plainLimitation.limitedByMinimumArea, false);

  const marked = fight(start(fixture({ b: 30, markPlayer: "P" })), [5, 3]);
  assert.equal(marked.pendingWar.maximumDepth, 1);
  const resolved = act(marked, { type: GameActionType.ProposeBorderAdvance, warId: marked.pendingWar.id,
    playerId: "P", claimedCells: [{ x: 8, y: 0 }] }).state;
  assert.equal(resolved.territories.find((territory) => territory.id === "B").weakened, undefined);
  assert.equal(resolved.map.cells["8,0"], "A");
});

test("border gain moves cell-bound POIs and preserves multiple settlements", () => {
  const base = fixture();
  const initial = { ...base,
    pointsOfInterest: [{ id: "poi", type: PointOfInterestType.Landmark, position: { x: 8, y: 0 } }],
    territories: base.territories.map((territory) => ({ ...territory,
      settlement: "SETTLEMENT", settlementFeature: { id: `s-${territory.id}`, kind: "SETTLEMENT",
        position: territory.id === "A" ? { x: 0, y: 0 } : { x: 8, y: 0 } } })),
  };
  const fought = fight(start(initial), [5, 3]);
  const resolved = act(fought, { type: GameActionType.ProposeBorderAdvance, warId: fought.pendingWar.id,
    playerId: "P", claimedCells: [{ x: 8, y: 0 }] }).state;
  assert.equal(getPointOfInterestTerritory(resolved, resolved.pointsOfInterest[0]), "A");
  assert.equal(resolved.territories.find((territory) => territory.id === "A").settlementFeatures.length, 2);
  assert.equal(resolved.territories.find((territory) => territory.id === "B").settlementFeature, undefined);
});

test("spade bonuses use geometry, only one effect per player, and fortresses stack", () => {
  const state = fixture({
    spades: [
      { id: "local", playerId: "P", sourceTerritoryId: "A", status: "AVAILABLE" },
      { id: "far", playerId: "P", sourceTerritoryId: "far", status: "AVAILABLE" },
      { id: "def", playerId: "Q", sourceTerritoryId: "B", status: "AVAILABLE" },
    ],
    fortresses: [{ x: 8, y: 0 }, { x: 9, y: 0 }],
  });
  const started = start(state);
  const first = act(started, { type: GameActionType.SetWarSpadeChoice, warId: started.pendingWar.id,
    playerId: "P", spadeActivationId: "local" }).state;
  const opponentView = createGameViewForPlayer(first, "Q");
  assert.equal(opponentView.pendingWar.spadeChoices.P, "LOCKED");
  assert.equal(JSON.stringify(opponentView.pendingWar.spadeChoices).includes("local"), false);
  assert.equal(createGameViewForPlayer(first, "P").pendingWar.spadeChoices.P, "local");
  assert.throws(() => act(first, { type: GameActionType.SetWarSpadeChoice, warId: started.pendingWar.id,
    playerId: "P", spadeActivationId: "far" }), (error) => error.code === DomainErrorCode.SpadeChoiceAlreadyLocked);
  const fought = act(first, { type: GameActionType.SetWarSpadeChoice, warId: started.pendingWar.id,
    playerId: "Q", spadeActivationId: "def" }, new Dice(4, 4)).state;
  assert.equal(fought.pendingWar.combat.attackerSpadeBonus, 2);
  assert.equal(fought.pendingWar.combat.defenderSpadeBonus, 2);
  assert.equal(fought.pendingWar.combat.defenderFortressBonus, 2);
  assert.equal(fought.spadeActivations.find((effect) => effect.id === "local").status, "USED");
  assert.equal(fought.spadeActivations.find((effect) => effect.id === "far").status, "AVAILABLE");
  assert.equal(fought.pendingWar.combat.winnerTerritoryId, "B");
  const far = fight(start(fixture({ spades: [{ id: "far", playerId: "P", sourceTerritoryId: "far", status: "AVAILABLE" }] })), [4, 4], "far");
  assert.equal(far.pendingWar.combat.attackerSpadeBonus, 1);
});

test("weakened loser is conquered at difference one and weakened winner recovers", () => {
  const conquered = fight(start(fixture({ weakB: true })), [5, 4]);
  assert.equal(conquered.pendingWar, undefined);
  assert.equal(conquered.territories.find((territory) => territory.id === "B").ownerId, "P");
  assert.equal(getTerritoryArea(conquered.map, "A"), 40);
  assert.equal(getTerritoryArea(conquered.map, "B"), 40);
  assert.equal(conquered.territories.find((territory) => territory.id === "B").card.additionalSuit, Suit.Hearts);
  const recovered = fight(start(fixture({ weakA: true })), [5, 4]);
  assert.equal(recovered.territories.find((territory) => territory.id === "A").weakened, false);
});

test("strong advance and marked depths scale down on compact fixtures", () => {
  for (const [markPlayer, expected] of [[undefined, 1], ["P", 1], ["Q", 1]]) {
    const fought = fight(start(fixture({ a: 19, b: 40, format: "A5", markPlayer })), [6, 1]);
    assert.equal(fought.pendingWar.combat.outcome, "STRONG_ADVANCE");
    assert.equal(fought.pendingWar.maximumDepth, expected);
  }
  for (const [markPlayer, expected] of [["P", 1], ["Q", 1]]) {
    const fought = fight(start(fixture({ markPlayer })), [5, 3]);
    assert.equal(fought.pendingWar.maximumDepth, expected);
  }
});

test("A4 and A5 breakthrough thresholds include exactly twice the minimum area", () => {
  for (const [format, threshold] of [["A4", 40], ["A5", 20]]) {
    const cut = fight(start(fixture({ a: threshold, b: threshold, format })), [6, 1]);
    assert.equal(cut.pendingWar.stage, "AWAITING_CUT_DIVISION");
    const conquered = fight(start(fixture({ a: threshold, b: threshold - 1, format })), [6, 1]);
    assert.equal(conquered.pendingWar, undefined);
    assert.equal(conquered.territories.find((territory) => territory.id === "B").ownerId, "P");
  }
  const equalHalf = fight(start(fixture({ a: 20, b: 40, format: "A5" })), [6, 1]);
  assert.equal(equalHalf.pendingWar.combat.outcome, "CUT_AND_CHOOSE");
});

test("defender can win, and a weakened attacker is conquered symmetrically", () => {
  const fought = fight(start(fixture({ weakA: true })), [3, 4]);
  assert.equal(fought.pendingWar, undefined);
  assert.equal(fought.territories.find((territory) => territory.id === "A").ownerId, "Q");
  assert.equal(getTerritoryArea(fought.map, "A"), 40);
});

test("war cut keeps the losing territory label and card, then allocates the next regular label", () => {
  const base = fixture({ fortresses: [{ x: 8, y: 0 }] });
  const state = {
    ...base,
    nextTerritoryDisplayNumber: 14,
    map: { ...base.map, cells: Object.fromEntries(Object.entries(base.map.cells).map(([key, id]) => [key,
      id === "A" ? "G07" : id === "B" ? "G08" : id])) },
    territories: base.territories.map((territory) => {
      const id = territory.id === "A" ? "G07" : territory.id === "B" ? "G08" : territory.id;
      return id === "G08" ? { ...territory, id, settlement: "SETTLEMENT",
        settlementFeature: { id: "s", kind: "SETTLEMENT", position: { x: 8, y: 0 } } } : { ...territory, id };
    }),
    spadeActivations: base.spadeActivations.map((activation) => ({ ...activation,
      sourceTerritoryId: activation.sourceTerritoryId === "A" ? "G07" : activation.sourceTerritoryId })),
  };
  let fought = act(state, { type: GameActionType.StartWar, playerId: "P", attackerTerritoryId: "G07", defenderTerritoryId: "G08" }).state;
  fought = fight(fought, [6, 1]);
  const warId = fought.pendingWar.id;
  const partA = [];
  for (let y = 0; y < 5; y++) for (let x = 8; x < 12; x++) partA.push({ x, y });
  fought = act(fought, { type: GameActionType.ProposeWarCut, warId, playerId: "P", partACells: partA }).state;
  const chosen = act(fought, { type: GameActionType.ChooseWarCut, warId, playerId: "Q", chosenPart: "B" }).state;
  const newPart = chosen.territories.find((territory) => territory.id === "G14");
  assert.equal(chosen.territories.find((territory) => territory.id === "G08").ownerId, "Q");
  assert.equal(chosen.territories.find((territory) => territory.id === "G08").card.additionalSuit, Suit.Hearts);
  assert.ok(newPart);
  assert.equal(newPart.ownerId, "P");
  assert.equal(newPart.card.additionalSuit, undefined);
  assert.notEqual(`${newPart.card.suit}:${newPart.card.activationNumber}`, `${state.territories.find((territory) => territory.id === "G08").card.suit}:${state.territories.find((territory) => territory.id === "G08").card.activationNumber}`);
  assert.equal(newPart.participatedInWarThisRound, true);
  assert.equal(newPart.warParticipationLockedThisRound, true);
  assert.deepEqual(canTerritoryParticipateInWar(chosen, newPart.id), { allowed: false, reason: "NORMAL_TERRITORY_LIMIT" });
  assert.equal(getPointOfInterestTerritory(chosen, chosen.pointsOfInterest[0]), newPart.id);
  assert.equal(newPart.settlementFeature.position.x, 8);
  assert.equal(chosen.pendingWar, undefined);
});

test("marked cut permits one-cell correction toward the marker", () => {
  const state = fixture({ b: 48, markPlayer: "P" });
  let fought = fight(start(state), [6, 1]);
  const warId = fought.pendingWar.id;
  const partA = [];
  for (let y = 0; y < 5; y++) for (let x = 8; x < 13; x++) partA.push({ x, y });
  fought = act(fought, { type: GameActionType.ProposeWarCut, warId, playerId: "P", partACells: partA }).state;
  fought = act(fought, { type: GameActionType.ChooseWarCut, warId, playerId: "Q", chosenPart: "B" }).state;
  assert.equal(fought.pendingWar.stage, "AWAITING_DIAMOND_CORRECTION");
  const corrected = act(fought, { type: GameActionType.ResolveDiamondCorrection, warId, playerId: "P",
    claimedCells: [{ x: 13, y: 0 }] }).state;
  const newId = corrected.territories.find((territory) => /^G\d+$/.test(territory.id)).id;
  assert.equal(corrected.map.cells["13,0"], newId);
  assert.equal(corrected.pendingWar, undefined);
  assert.equal(corrected.borderMarks.length, 0);
});

test("a losing diamond marker corrects the cut toward the losing player", () => {
  let fought = fight(start(fixture({ b: 48, markPlayer: "Q" })), [6, 1]);
  const warId = fought.pendingWar.id;
  const partA = [];
  for (let y = 0; y < 5; y++) for (let x = 8; x < 13; x++) partA.push({ x, y });
  fought = act(fought, { type: GameActionType.ProposeWarCut, warId, playerId: "P", partACells: partA }).state;
  fought = act(fought, { type: GameActionType.ChooseWarCut, warId, playerId: "Q", chosenPart: "B" }).state;
  const corrected = act(fought, { type: GameActionType.ResolveDiamondCorrection, warId, playerId: "Q",
    claimedCells: [{ x: 12, y: 0 }] }).state;
  assert.equal(corrected.map.cells["12,0"], "B");
  assert.equal(corrected.pendingWar, undefined);
});

test("war cut duplicates only the printed card when all 48 cards are used", () => {
  const base = fixture();
  const used = new Set(base.territories.map((territory) => `${territory.card.suit}:${territory.card.activationNumber}`));
  const ghosts = [];
  for (const suit of Object.values(Suit)) for (let number = 1; number <= 12; number++) {
    if (!used.has(`${suit}:${number}`)) ghosts.push({ id: `ghost-${suit}-${number}`, ownerId: null,
      card: { suit, activationNumber: number } });
  }
  let fought = fight(start({ ...base, territories: [...base.territories, ...ghosts] }), [6, 1]);
  const warId = fought.pendingWar.id;
  const partA = [];
  for (let y = 0; y < 5; y++) for (let x = 8; x < 12; x++) partA.push({ x, y });
  fought = act(fought, { type: GameActionType.ProposeWarCut, warId, playerId: "P", partACells: partA }).state;
  const chosen = act(fought, { type: GameActionType.ChooseWarCut, warId, playerId: "Q", chosenPart: "B" }).state;
  const newCard = chosen.territories.find((territory) => /^G\d+$/.test(territory.id)).card;
  assert.equal(newCard.suit, base.territories[1].card.suit);
  assert.equal(newCard.activationNumber, base.territories[1].card.activationNumber);
  assert.equal(newCard.additionalSuit, undefined);
});

test("neutral diamond pauses activation until a validated geometric change", () => {
  const base = fixture();
  const state = { ...base, phase: GamePhase.ActivationPhase,
    activationNumbers: [2, 5, 9],
    activation: { pendingTerritoryIds: ["A"], resolvedTerritoryIds: [] },
    territories: base.territories.map((territory) => territory.id === "B" ? { ...territory, ownerId: null } : territory) };
  const activated = act(state, { type: GameActionType.ActivateTerritory, playerId: "P", territoryId: "A",
    choice: { type: "SPADE_STORE" } }).state;
  assert.equal(activated.pendingDiamondBorderChanges.length, 0);
  const diamond = { ...state, territories: state.territories.map((territory) => territory.id === "A"
    ? { ...territory, card: { suit: Suit.Diamonds, activationNumber: 2 } } : territory) };
  const pending = act(diamond, { type: GameActionType.ActivateTerritory, playerId: "P", territoryId: "A",
    choice: { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: "B" } }).state;
  assert.equal(pending.activation.pendingTerritoryIds.length, 1);
  assert.throws(() => act(pending, { type: GameActionType.ActivateTerritory, playerId: "P", territoryId: "A",
    choice: { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: "B" } }), (error) => error.code === DomainErrorCode.InvalidPhase);
  const effect = pending.pendingDiamondBorderChanges[0];
  assert.throws(() => act(pending, { type: GameActionType.ResolveNeutralDiamond, effectId: effect.id, playerId: "P",
    claimedCells: [{ x: 10, y: 0 }] }), (error) => error.code === DomainErrorCode.InvalidDiamondNeutralChange);
  const resolved = act(pending, { type: GameActionType.ResolveNeutralDiamond, effectId: effect.id, playerId: "P",
    claimedCells: [{ x: 8, y: 0 }] }).state;
  assert.equal(resolved.map.cells["8,0"], "A");
  assert.equal(resolved.map.cells["9,0"], "B");
  assert.equal(resolved.pendingDiamondBorderChanges.length, 0);
  assert.equal(resolved.phase, GamePhase.ActionPhase);
});

test("border validator rejects ambiguous retained main components without mutating input", () => {
  const map = fixture({ a: 40, b: 40 }).map;
  const border = getSharedBorder(map, "A", "B");
  const cells = getCellsWithinBorderDepth(map, "B", border, 8);
  assert.equal(cells.length, 40);
  const row = Array.from({ length: 8 }, (_, i) => ({ x: 8 + i, y: 2 }));
  const validation = validateBorderAdvance(map, "A", "B", border, 8, row);
  assert.equal(validation.valid, false);
  assert.equal(validation.reason, "AMBIGUOUS_RETAINED_COMPONENT");
  assert.equal(map.cells["8,2"], "B");
});
