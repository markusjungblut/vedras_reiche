import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSetupPartitionChange,
  applyAction,
  beginStartAuctions,
  createGameState,
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
  while (poiTypeForStage(state.mapCreation.stage)) {
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
  assert.equal(deriveSetupRegions(state.map, state.mapCreation.borders)[0].cells.length, 2500);
});

test("a border from edge to edge creates exactly two setup regions", () => {
  const state = commit(started(), vertical(25));
  assert.equal(state.mapCreation.regionCount, 2);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceLandmarks);
  assert.deepEqual(deriveSetupRegions(state.map, state.mapCreation.borders).map((region) => region.cells.length), [1250, 1250]);
});

test("a closed border loop creates one additional region", () => {
  const state = commit(started(), box(10, 10, 5, 5));
  assert.equal(state.mapCreation.regionCount, 2);
  assert.deepEqual(deriveSetupRegions(state.map, state.mapCreation.borders).map((region) => region.cells.length).sort((a, b) => a - b), [25, 2475]);
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
});

test("a three-way draft is rejected without consuming the setup turn", () => {
  const state = started();
  assert.throws(() => commit(state, [...vertical(16), ...vertical(33)]),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.equal(state.mapCreation.regionCount, 1);
  assert.equal(state.mapCreation.activePlayerId, "P1");
});

test("one draft cannot split two existing regions", () => {
  let state = commit(started(), vertical(25));
  state = placeRequiredPois(state);
  assert.throws(() => commit(state, horizontal(25)),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  assert.equal(state.mapCreation.regionCount, 2);
});

test("a correction preserves the region count while a normal draft does not accept it", () => {
  let state = commit(started(), vertical(25));
  state = placeRequiredPois(state);
  const partial = vertical(10, 0, 10);
  assert.throws(() => commit(state, partial),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupBoundaryDraft);
  state = applyAction(state, {
    type: GameActionType.CorrectSetupBorders,
    playerId: state.mapCreation.activePlayerId,
    addEdges: partial,
  }, context()).state;
  assert.equal(state.mapCreation.regionCount, 2);
});

test("POIs can be placed on any setup cell, stay cell-bound after a split, and cannot overlap", () => {
  let state = commit(started(), vertical(25));
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
  assert.equal(state.map.cells["49,49"], "R03");
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
  for (const edges of steps) {
    state = commit(state, edges);
    state = placeRequiredPois(state);
  }
  assert.equal(state.mapCreation.regionCount, getStartingTerritoryCount(2));
  assert.equal(state.mapCreation.stage, MapCreationStage.ReadyToFinalize);
  assert.equal(Object.values(state.map.cells).filter((value) => value === null).length, 0);
  assert.equal(getSetupMapValidationIssues(state).length, 0);
  state = applyAction(state, {
    type: GameActionType.FinalizeMapCreation,
    playerId: state.mapCreation.activePlayerId,
  }, context(new SequenceRandomSource())).state;
  assert.equal(state.phase, GamePhase.Setup);
  assert.equal(state.territories.length, 12);
  assert.equal(state.map.cells["0,0"], "G01");
  assert.equal(state.territories.every((territory) => territory.card !== undefined && territory.ownerId === null), true);
  assert.deepEqual(Object.values(Suit).map((suit) => state.territories.filter((territory) => territory.card.suit === suit).length), [3, 3, 3, 3]);
  state = beginStartAuctions(state, undefined, new SequenceRandomSource(), timestamp).state;
  assert.equal(state.phase, GamePhase.StartAuctions);
});

test("setup totals and POI requirements remain defined for every supported player count", () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(getStartingTerritoryCount), [12, 16, 20, 24, 28]);
  assert.deepEqual(getSetupPoiRequirements(3), { LANDMARK: 2, JUNCTION: 1, FORTRESS: 1, RELIC: 2 });
});
