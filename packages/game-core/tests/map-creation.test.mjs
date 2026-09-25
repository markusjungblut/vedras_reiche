import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSetupPartitionChange,
  applyAction,
  commitSetupBoundaryDraft,
  createGameState,
  createGameViewForPlayer,
  deriveSetupRegions,
  DomainError,
  DomainErrorCode,
  GameActionType,
  GamePhase,
  getSetupMapValidationIssues,
  getSetupPoiRequirements,
  getStartingTerritoryCount,
  MapCreationStage,
  PointOfInterestType,
  Suit,
  DIGITAL_MAP_CONFIG,
  getMinimumTerritoryArea,
  getBreakthroughThreshold,
} from "../dist/index.js";

const timestamp = "2026-09-21T12:00:00.000Z";

class SequenceRandomSource {
  constructor(values = []) { this.values = [...values]; }
  nextInt(min, max) {
    const value = this.values.length > 0 ? this.values.shift() : min;
    assert.ok(Number.isInteger(value) && value >= min && value <= max);
    return value;
  }
}

function context(random = new SequenceRandomSource()) {
  return { randomSource: random, timestamp };
}

function started(playerCount = 2) {
  const players = Array.from({ length: playerCount }, (_, index) => ({ id: "P" + (index + 1), name: "P" + (index + 1) }));
  let state = createGameState({ gameId: "map-" + playerCount, players, startPlayerId: "P1" });
  state = applyAction(state, { type: GameActionType.BeginMapCreation, firstPlayerId: "P1", map: DIGITAL_MAP_CONFIG }, context()).state;
  return state;
}

function vertical(cut, yStart = 0, yEnd = 50) {
  return Array.from({ length: yEnd - yStart }, (_, index) => ({
    from: { x: cut - 1, y: yStart + index }, to: { x: cut, y: yStart + index },
  }));
}

function horizontal(cut, xStart = 0, xEnd = 50) {
  return Array.from({ length: xEnd - xStart }, (_, index) => ({
    from: { x: xStart + index, y: cut - 1 }, to: { x: xStart + index, y: cut },
  }));
}

function box(x, y, width, height) {
  return [
    ...horizontal(y, x, x + width),
    ...horizontal(y + height, x, x + width),
    ...vertical(x, y, y + height),
    ...vertical(x + width, y, y + height),
  ];
}

function assertCompletePartition(map, borders, expectedAreas) {
  const regions = deriveSetupRegions(map, borders);
  const cells = regions.flatMap((region) => region.cells);
  assert.equal(cells.length, map.width * map.height, "every map cell belongs to a setup region");
  assert.equal(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size, map.width * map.height,
    "no map cell belongs to more than one setup region");
  assert.equal(regions.reduce((sum, region) => sum + region.cells.length, 0), map.width * map.height);
  if (expectedAreas !== undefined) assert.deepEqual(regions.map((region) => region.cells.length).sort((a, b) => a - b), expectedAreas);
  return regions;
}

function jaggedVerticalBarrier() {
  // A wall from the top edge to the bottom edge with one leftward kink at y = 16.
  // Each item remains an edge between two cells; the kink itself owns no cell.
  return [...vertical(25, 0, 16), ...horizontal(16, 24, 25), ...vertical(24, 16, 50)];
}

function commit(state, edges) {
  return applyAction(state, {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: state.mapCreation.activePlayerId,
    edges,
  }, context()).state;
}

function poiTypeForStage(stage) {
  return {
    [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
    [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
    [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
    [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
  }[stage];
}

function placeRequiredPois(state) {
  while (state.mapCreation && poiTypeForStage(state.mapCreation.stage)) {
    const type = poiTypeForStage(state.mapCreation.stage);
    const position = Object.keys(state.map.cells)
      .map((key) => { const [x, y] = key.split(",").map(Number); return { x, y }; })
      .find((cell) => !state.pointsOfInterest.some((poi) => poi.position.x === cell.x && poi.position.y === cell.y));
    state = applyAction(state, {
      type: GameActionType.PlaceSetupPointOfInterest,
      playerId: state.mapCreation.activePlayerId,
      poiType: type,
      position,
    }, context()).state;
  }
  return state;
}

test("starts with one fully assigned 50 by 50 setup region", () => {
  const state = started();
  assert.equal(state.phase, GamePhase.MapCreation);
  assert.equal(state.mapCreation.regionCount, 1);
  assert.equal(Object.values(state.map.cells).filter((id) => id === null).length, 0);
  assert.equal(Object.values(state.map.cells).filter((id) => id === "R01").length, 2500);
  assertCompletePartition(state.map, state.mapCreation.borders, [2500]);
});

test("player views project the current and safely known next map-creation input", () => {
  const state = started();
  assert.deepEqual(createGameViewForPlayer(state, "P1").playerInput, {
    status: "ACTION_REQUIRED", action: "SETUP_BOUNDARY", activePlayerId: "P1",
  });
  assert.deepEqual(createGameViewForPlayer(state, "P2").playerInput, {
    status: "WAITING", activePlayerId: "P1", nextAction: "SETUP_BOUNDARY",
  });
});

test("a vertical center border from edge to edge creates two 1250-cell regions", () => {
  const state = started();
  assertCompletePartition(state.map, { edgeKeys: vertical(25).map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`) }, [1250, 1250]);
  const committed = commit(state, vertical(25));
  assert.equal(committed.mapCreation.regionCount, 2);
  assert.equal(committed.mapCreation.stage, MapCreationStage.DrawTerritories);
  assertCompletePartition(committed.map, committed.mapCreation.borders, [1250, 1250]);
});

test("a horizontal center border from edge to edge creates two 1250-cell regions", () => {
  const state = commit(started(), horizontal(25));
  assert.equal(state.mapCreation.regionCount, 2);
  assert.equal(state.mapCreation.stage, MapCreationStage.DrawTerritories);
  assertCompletePartition(state.map, state.mapCreation.borders, [1250, 1250]);
});

test("POI milestones start after completed drawing turns for two, four, and six players", () => {
  for (const playerCount of [2, 4, 6]) {
    let state = started(playerCount);
    for (let turn = 1; turn <= playerCount; turn += 1) state = commit(state, vertical(turn * 5));
    assert.equal(state.mapCreation.regionCount, playerCount + 1);
    assert.equal(state.mapCreation.stage, MapCreationStage.PlaceLandmarks);
    assert.equal(state.mapCreation.activePlayerId, "P1");
  }
});

test("the second POI milestone follows the fourth completed drawing turn for two players", () => {
  let state = started(2);
  state = commit(state, vertical(10));
  state = commit(state, vertical(20));
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceLandmarks);
  state = placeRequiredPois(state);
  state = commit(state, vertical(30));
  assert.equal(state.mapCreation.stage, MapCreationStage.DrawTerritories);
  state = commit(state, vertical(40));
  assert.equal(state.mapCreation.regionCount, 5);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceJunctions);
});

test("a closed 10 by 10 border loop creates 100 and 2400-cell regions", () => {
  const state = commit(started(), box(10, 10, 10, 10));
  assert.equal(state.mapCreation.regionCount, 2);
  assertCompletePartition(state.map, state.mapCreation.borders, [100, 2400]);
});

test("an incomplete edge path remains one complete region", () => {
  const state = started();
  assertCompletePartition(state.map, { edgeKeys: vertical(25, 0, 25).map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`) }, [2500]);
});

test("a split below the minimum setup size is rejected", () => {
  const state = started();
  assert.throws(() => commit(state, box(10, 10, 4, 4)),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.MinimumTerritorySizeViolated);
  assert.equal(state.mapCreation.regionCount, 1);
});

test("several draft strokes can together make one split", () => {
  const state = commit(started(), [...vertical(25, 0, 25), ...vertical(25, 25, 50)]);
  assert.equal(state.mapCreation.regionCount, 2);
  assertCompletePartition(state.map, state.mapCreation.borders, [1250, 1250]);
});

test("committing a split drops open draft branches instead of preserving ghost borders", () => {
  const state = commit(started(), [
    ...vertical(25),
    ...horizontal(10, 25, 28),
    ...horizontal(20, 30, 33),
    ...horizontal(35, 35, 38),
  ]);
  assert.equal(state.mapCreation.regionCount, 2);
  assert.equal(state.mapCreation.borders.edgeKeys.length, 50);
  assert.deepEqual(state.mapCreation.borders.edgeKeys, vertical(25).map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`).sort());
  const next = placeRequiredPois(state);
  assert.throws(() => commit(next, horizontal(10, 25, 28)),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.equal(next.mapCreation.regionCount, 2);
});

test("minimum territory size and breakthrough threshold follow the configured board area", () => {
  assert.equal(getMinimumTerritoryArea({ width: 50, height: 50 }), 25);
  assert.equal(getMinimumTerritoryArea({ width: 100, height: 50 }), 50);
  assert.equal(getMinimumTerritoryArea({ width: 50, height: 25 }), 13);
  assert.equal(getBreakthroughThreshold({ width: 50, height: 50 }), 50);
  assert.equal(getBreakthroughThreshold({ width: 100, height: 50 }), 100);
  assert.equal(getBreakthroughThreshold({ width: 50, height: 25 }), 26);
});

test("a three-way draft is rejected without consuming the setup turn", () => {
  const state = started();
  const edges = [...vertical(16), ...vertical(33)];
  assertCompletePartition(state.map, { edgeKeys: edges.map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`) }, [800, 850, 850]);
  assert.throws(() => commit(state, edges),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.equal(state.mapCreation.regionCount, 1);
  assert.equal(state.mapCreation.activePlayerId, "P1");
});

test("one draft cannot split two existing regions", () => {
  let state = commit(started(), vertical(25));
  state = placeRequiredPois(state);
  const edges = horizontal(25);
  assertCompletePartition(state.map, { edgeKeys: [...state.mapCreation.borders.edgeKeys,
    ...edges.map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`)] }, [625, 625, 625, 625]);
  assert.throws(() => commit(state, edges),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.equal(state.mapCreation.regionCount, 2);
});

test("a real one-cell loop is recognized as geometry and then rejected by the minimum size rule", () => {
  const state = started();
  const edges = box(10, 10, 1, 1);
  const edgeKeys = edges.map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`);
  assertCompletePartition(state.map, { edgeKeys }, [1, 2499]);
  assert.throws(() => commit(state, edges),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.MinimumTerritorySizeViolated);
  assert.equal(state.mapCreation.regionCount, 1);
});

test("a kinked edge path creates no artificial one-cell line region", () => {
  const state = started();
  const edges = jaggedVerticalBarrier();
  const edgeKeys = edges.map((edge) => `${edge.from.x},${edge.from.y}|${edge.to.x},${edge.to.y}`);
  const regions = assertCompletePartition(state.map, { edgeKeys });
  assert.equal(regions.length, 2);
  assert.equal(regions.some((region) => region.cells.length === 1), false);
  const committed = commit(state, edges);
  assert.equal(committed.mapCreation.regionCount, 2);
  assertCompletePartition(committed.map, committed.mapCreation.borders);
});

test("a correction preserves the region count while a normal draft does not accept it", () => {
  let state = commit(started(), vertical(25));
  state = placeRequiredPois(state);
  const partial = vertical(10, 0, 10);
  assert.throws(() => commit(state, partial),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.throws(() => applyAction(state, {
    type: GameActionType.CorrectSetupBorders,
    playerId: state.mapCreation.activePlayerId,
    addEdges: partial,
  }, context()), (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidMapCreationState);
  state = { ...state, mapCreation: { ...state.mapCreation, stage: MapCreationStage.ReadyToFinalize } };
  state = applyAction(state, {
    type: GameActionType.CorrectSetupBorders,
    playerId: state.mapCreation.activePlayerId,
    addEdges: partial,
  }, context()).state;
  assert.equal(state.mapCreation.regionCount, 2);
});

test("POIs can be placed on any setup cell, stay cell-bound after a split, and cannot overlap", () => {
  let state = commit(started(), vertical(25));
  state = commit(state, horizontal(25, 0, 25));
  const position = { x: 49, y: 49 };
  state = applyAction(state, {
    type: GameActionType.PlaceSetupPointOfInterest,
    playerId: state.mapCreation.activePlayerId,
    poiType: PointOfInterestType.Landmark,
    position,
  }, context()).state;
  assert.deepEqual(state.pointsOfInterest[0].position, position);
  assert.throws(() => applyAction(state, {
    type: GameActionType.PlaceSetupPointOfInterest,
    playerId: state.mapCreation.activePlayerId,
    poiType: PointOfInterestType.Landmark,
    position,
  }, context()), (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidPoiPlacement);
  state = commit(state, horizontal(25, 25, 50));
  assert.deepEqual(state.pointsOfInterest[0].position, position);
  assert.equal(state.map.cells["49,49"], "R04");
});

test("partition analysis identifies exactly one split source", () => {
  const state = started();
  const before = deriveSetupRegions(state.map, state.mapCreation.borders);
  const after = deriveSetupRegions(state.map, { edgeKeys: vertical(25).map((edge) => {
    const first = edge.from.x < edge.to.x ? edge.from : edge.to;
    const second = first === edge.from ? edge.to : edge.from;
    return first.x + "," + first.y + "|" + second.x + "," + second.y;
  }) });
  const change = analyzeSetupPartitionChange(before, after);
  assert.equal(change.regionCountDelta, 1);
  assert.equal(change.validSingleSplit, true);
  assert.equal(change.resultingRegionIds.length, 2);
});

test("the complete partition finalizes into stable territories and preserves prior game flow", () => {
  let state = started();
  let stateBeforeFinalBoundary;
  const steps = [
    vertical(12),
    vertical(6),
    vertical(25),
    horizontal(17, 0, 6),
    horizontal(17, 6, 12),
    horizontal(17, 12, 25),
    horizontal(17, 25, 50),
    horizontal(34, 0, 6),
    horizontal(34, 6, 12),
    horizontal(34, 12, 25),
    horizontal(34, 25, 50),
  ];
  for (const [index, edges] of steps.entries()) {
    if (index === steps.length - 1) stateBeforeFinalBoundary = state;
    state = commit(state, edges);
    state = placeRequiredPois(state);
  }
  assert.equal(state.mapCreation, undefined);
  assert.equal(Object.values(state.map.cells).filter((value) => value === null).length, 0);
  assert.equal(getSetupMapValidationIssues(state).length, 0);
  assert.equal(state.phase, GamePhase.StartAuctions);
  assert.equal(state.territories.length, 12);
  assert.equal(state.map.cells["0,0"], "G01");
  assert.equal(state.territories.every((territory) => territory.card !== undefined && territory.ownerId === null), true);
  assert.deepEqual(Object.values(Suit).map((suit) => state.territories.filter((territory) => territory.card.suit === suit).length), [3, 3, 3, 3]);
  assert.ok(state.auction);

  assert.ok(stateBeforeFinalBoundary);
  let reviewed = commitSetupBoundaryDraft(stateBeforeFinalBoundary, {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: stateBeforeFinalBoundary.mapCreation.activePlayerId,
    edges: steps.at(-1),
  }, timestamp).state;
  assert.equal(reviewed.mapCreation.stage, MapCreationStage.ReadyToFinalize);
  reviewed = applyAction(reviewed, {
    type: GameActionType.FinalizeMapCreation,
    playerId: reviewed.mapCreation.activePlayerId,
  }, context()).state;
  assert.equal(reviewed.phase, GamePhase.StartAuctions);
  assert.ok(reviewed.auction);
});

test("setup totals and POI requirements remain defined for every supported player count", () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(getStartingTerritoryCount), [12, 16, 20, 24, 28]);
  assert.deepEqual(getSetupPoiRequirements(3), { LANDMARK: 2, JUNCTION: 1, FORTRESS: 1, RELIC: 2 });
});
