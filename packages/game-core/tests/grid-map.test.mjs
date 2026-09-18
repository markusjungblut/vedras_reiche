import assert from "node:assert/strict";
import test from "node:test";

import {
  areTerritoriesAdjacent,
  createGameViewForPlayer,
  createGameState,
  createGridMap,
  determineSplitRoles,
  DomainErrorCode,
  GameActionType,
  GamePhase,
  getAdjacentTerritoryIds,
  getMinimumTerritoryArea,
  getPointOfInterestTerritory,
  getSettlementTerritory,
  getSharedBorderLength,
  getTerritoryArea,
  isTerritoryConnected,
  openNormalAuction,
  proposeTerritorySplit,
  resolveTerritorySplit,
  chooseSplitPart,
  submitNormalAuctionBid,
  Suit,
  validateTerritorySplit,
} from "../dist/index.js";

test("raster area, orthogonal adjacency and shared borders are derived from cells", () => {
  const map = createGridMap({ width: 3, height: 3, format: "A5" }, {
    "0,0": "A", "1,0": "A", "0,1": "A", "1,1": "B", "2,1": "B", "2,2": "C",
  });
  assert.equal(getTerritoryArea(map, "A"), 3);
  assert.equal(areTerritoriesAdjacent(map, "A", "B"), true);
  assert.equal(getSharedBorderLength(map, "A", "B"), 2);
  assert.deepEqual(getAdjacentTerritoryIds(map, "A"), ["B"]);
  assert.equal(areTerritoriesAdjacent(map, "A", "C"), false);
  const thirtySeven = createGridMap({ width: 10, height: 4 }, Object.fromEntries(
    Array.from({ length: 37 }, (_, index) => [`${index % 10},${Math.floor(index / 10)}`, "T"])));
  assert.equal(getTerritoryArea(thirtySeven, "T"), 37);
});

test("connectedness excludes diagonal-only contact", () => {
  const connected = createGridMap({ width: 2, height: 2 }, { "0,0": "A", "1,0": "A", "1,1": "A" });
  const diagonal = createGridMap({ width: 2, height: 2 }, { "0,0": "A", "1,1": "A" });
  assert.equal(isTerritoryConnected(connected, "A"), true);
  assert.equal(isTerritoryConnected(diagonal, "A"), false);
  const corner = createGridMap({ width: 2, height: 2 }, { "0,0": "A", "1,1": "B" });
  assert.equal(areTerritoriesAdjacent(corner, "A", "B"), false);
  const side = createGridMap({ width: 2, height: 1 }, { "0,0": "A", "1,0": "B" });
  assert.equal(areTerritoriesAdjacent(side, "A", "B"), true);
  assert.equal(getSharedBorderLength(side, "A", "B"), 1);
});

test("positions keep POIs and settlements on their cells as ownership changes", () => {
  const map = createGridMap({ width: 2, height: 1 }, { "0,0": "A", "1,0": "B" });
  const poi = { id: "relic", type: "RELIC", position: { x: 1, y: 0 } };
  const feature = { id: "village", kind: "SETTLEMENT", position: { x: 1, y: 0 } };
  const state = { map, pointsOfInterest: [poi] };
  assert.equal(getPointOfInterestTerritory(state, poi), "B");
  assert.equal(getSettlementTerritory(state, feature), "B");
  const moved = { ...state, map: { ...map, cells: { ...map.cells, "1,0": "A" } } };
  assert.equal(getPointOfInterestTerritory(moved, poi), "A");
  assert.equal(getSettlementTerritory(moved, feature), "A");
  assert.deepEqual(poi.position, { x: 1, y: 0 });
});

test("split validation derives the exact complement and minimum size", () => {
  const cells = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
    `${index % 8},${Math.floor(index / 8)}`, "A",
  ]));
  const map = createGridMap({ width: 8, height: 5, format: "A4" }, cells);
  const partA = Array.from({ length: 20 }, (_, index) => ({ x: index % 8, y: Math.floor(index / 8) }));
  const valid = validateTerritorySplit(map, "A", partA, getMinimumTerritoryArea("A4"));
  assert.equal(valid.valid, true);
  assert.equal(valid.partBCells.length, 20);
  const invalid = validateTerritorySplit(map, "A", partA.slice(0, 19), 20);
  assert.equal(invalid.valid, false);
  const islands = Array.from({ length: 16 }, (_, index) => ({ x: index % 8, y: index < 8 ? 0 : 4 }));
  assert.equal(validateTerritorySplit(map, "A", islands, 10).reason, "PART_NOT_CONNECTED");
  assert.equal(validateTerritorySplit(map, "A", [...partA, { x: 8, y: 0 }], 20).reason, "CELL_NOT_IN_ORIGINAL");
  assert.equal(validateTerritorySplit(map, "A", [...partA, partA[0]], 20).reason, "DUPLICATE_CELL");
});

test("player game view keeps opponent bid values out of the active auction", () => {
  const state = {
    gameId: "view", phase: "ACTION_PHASE", round: 1, maxRounds: 9,
    players: [{ id: "A", secretFactionSuit: Suit.Hearts }, { id: "B", secretFactionSuit: Suit.Spades }], territories: [], pointsOfInterest: [], borderMarks: [],
    startPlayerId: "A", activationNumbers: [], pendingDiamondBorderChanges: [], spadeActivations: [], events: [],
    auction: {
      id: "auction", kind: "NORMAL", territoryId: "T", eligiblePlayerIds: ["A", "B"], status: "BIDDING",
      submittedBids: { A: { kind: "NORMAL", basicBid: 3, globalInfluence: 2, localInfluence: 1 } },
    },
  };
  const viewA = createGameViewForPlayer(state, "A");
  const viewB = createGameViewForPlayer(state, "B");
  assert.equal(viewA.auction.submittedBids.A.basicBid, 3);
  assert.deepEqual(viewB.auction.submittedBids.A, { submitted: true });
  assert.equal(JSON.stringify(viewB.auction).includes("globalInfluence"), false);
  assert.equal(viewA.players[1].secretFactionSuit, undefined);
  assert.equal(viewB.players[0].secretFactionSuit, undefined);
  assert.equal(viewB.players[1].secretFactionSuit, Suit.Spades);
});

test("start and normal auction split roles use the same clockwise reference rule", () => {
  assert.deepEqual(determineSplitRoles(["A", "B", "C", "D"], "A", ["A", "C"]), {
    dividerPlayerId: "A", firstChooserPlayerId: "C",
  });
  assert.deepEqual(determineSplitRoles(["A", "B", "C", "D"], "A", ["B", "D"]), {
    dividerPlayerId: "B", firstChooserPlayerId: "D",
  });
  assert.deepEqual(determineSplitRoles(["A", "B", "C", "D"], "C", ["A", "B"]), {
    dividerPlayerId: "A", firstChooserPlayerId: "B",
  });
});

test("normal auction cut-and-choose mutates the authoritative map", () => {
  const cells = {};
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < 8; x += 1) {
    cells[`${x},${y}`] = x === 0 && y === 0 ? "home" : "X";
  }
  const map = createGridMap({ width: 8, height: 5, format: "A5" }, cells);
  let state = {
    ...createGameState({
      gameId: "geometry-split",
      players: ["A", "B", "C"].map((id) => ({ id, globalInfluence: 6, availableBasicBids: [1, 2, 3] })),
      startPlayerId: "A",
    }),
    phase: GamePhase.ActionPhase,
    round: 1,
    activePlayerId: "A",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
    map,
    pointsOfInterest: [{ id: "poi", type: "RELIC", position: { x: 6, y: 4 } }],
    territories: [
      { id: "home", ownerId: "A", card: { suit: Suit.Spades, activationNumber: 1 } },
      { id: "X", ownerId: null, card: { suit: Suit.Hearts, activationNumber: 5 }, localInfluenceByPlayerId: {},
        settlement: "SETTLEMENT", settlementFeature: { id: "hut", kind: "SETTLEMENT", position: { x: 6, y: 4 } } },
    ],
  };
  const timestamp = "2026-09-18T12:00:00.000Z";
  state = openNormalAuction(state, { type: GameActionType.OpenAuction, playerId: "A", territoryId: "X" }, timestamp).state;
  for (const [playerId, basicBid] of [["A", 3], ["B", 3], ["C", 1]]) {
    state = submitNormalAuctionBid(state, {
      type: GameActionType.SubmitAuctionBid,
      playerId,
      auctionId: state.auction.id,
      bid: { kind: "NORMAL", basicBid, globalInfluence: 0, localInfluence: 0 },
    }, timestamp).state;
  }
  assert.deepEqual([state.pendingSplit.dividerPlayerId, state.pendingSplit.firstChooserPlayerId], ["A", "B"]);
  assert.throws(() => resolveTerritorySplit(state, {
    type: GameActionType.ResolveTerritorySplit,
    splitId: state.pendingSplit.id,
    resolution: "SPLIT_NOT_POSSIBLE",
  }, { nextInt: () => 0 }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  const partA = Object.keys(cells).filter((key) => cells[key] === "X").slice(0, 20)
    .map((key) => { const [x, y] = key.split(",").map(Number); return { x, y }; });
  assert.throws(() => proposeTerritorySplit(state, { type: GameActionType.ProposeTerritorySplit,
    splitId: state.pendingSplit.id, playerId: "B", partACells: partA, originalCardPart: "A",
  }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  assert.throws(() => proposeTerritorySplit(state, { type: GameActionType.ProposeTerritorySplit,
    splitId: state.pendingSplit.id, playerId: "A", partACells: partA.slice(0, 9), originalCardPart: "A",
  }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  state = proposeTerritorySplit(state, {
    type: GameActionType.ProposeTerritorySplit,
    splitId: state.pendingSplit.id,
    playerId: "A",
    partACells: partA,
    originalCardPart: "A",
  }, timestamp).state;
  assert.equal(state.pendingSplit.stage, "AWAITING_CHOICE");
  const beforeForged = JSON.stringify(state);
  assert.throws(() => resolveTerritorySplit(state, {
    type: GameActionType.ResolveTerritorySplit,
    splitId: state.pendingSplit.id,
    resolution: "LEGAL_SPLIT",
    originalCardPart: { ...state.territories[1], ownerId: "A" },
    newCardPart: { id: "forged", ownerId: "B", card: { suit: Suit.Clubs, activationNumber: 2 } },
    dividerPlayerId: "A", firstChooserPlayerId: "B",
  }, { nextInt: () => 0 }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  assert.equal(JSON.stringify(state), beforeForged);
  assert.throws(() => chooseSplitPart(state, {
    type: GameActionType.ChooseSplitPart, splitId: state.pendingSplit.id,
    playerId: "C", chosenPart: "A",
  }, { nextInt: () => 0 }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  const stale = { ...state, map: { ...state.map, cells: { ...state.map.cells, "1,0": "home" } } };
  assert.throws(() => chooseSplitPart(stale, {
    type: GameActionType.ChooseSplitPart, splitId: state.pendingSplit.id,
    playerId: "B", chosenPart: "B",
  }, { nextInt: () => 0 }, timestamp), (error) => error.code === DomainErrorCode.InvalidSplitResolution);
  const resolved = chooseSplitPart(state, {
    type: GameActionType.ChooseSplitPart,
    splitId: state.pendingSplit.id,
    playerId: "B",
    chosenPart: "B",
  }, { nextInt: () => 0 }, timestamp).state;
  assert.equal(resolved.pendingSplit, undefined);
  assert.equal(resolved.territories.length, 3);
  assert.equal(getTerritoryArea(resolved.map, "X"), 20);
  const newTerritory = resolved.territories.find((territory) => territory.id !== "home" && territory.id !== "X");
  assert.equal(getTerritoryArea(resolved.map, newTerritory.id), 19);
  assert.equal(newTerritory.ownerId, "B");
  assert.deepEqual(getAdjacentTerritoryIds(resolved.map, "home"), ["X"]);
  assert.deepEqual(getAdjacentTerritoryIds(resolved.map, newTerritory.id), ["X"]);
  assert.deepEqual(getAdjacentTerritoryIds(resolved.map, "X"), ["home", newTerritory.id].sort());
  assert.equal(getPointOfInterestTerritory(resolved, "poi"), newTerritory.id);
  assert.equal(getSettlementTerritory(resolved, newTerritory.settlementFeature), newTerritory.id);
  assert.equal(resolved.territories.find((territory) => territory.id === "X").settlementFeature, undefined);
});
