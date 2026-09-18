import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAction,
  beginStartAuctions,
  createGameState,
  createGameViewForPlayer,
  createGridMap,
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
} from "../dist/index.js";

const timestamp = "2026-09-18T12:00:00.000Z";

class SequenceRandomSource {
  constructor(values = []) { this.values = [...values]; }
  nextInt(min, max) {
    const value = this.values.length > 0 ? this.values.shift() : min;
    assert.ok(Number.isInteger(value) && value >= min && value <= max, `Unexpected draw ${value} in [${min}, ${max}]`);
    return value;
  }
}

function context(random = new SequenceRandomSource()) {
  return { randomSource: random, timestamp };
}

function setup(playerCount = 3, width = 20, height = 8) {
  const players = Array.from({ length: playerCount }, (_, index) => ({ id: `P${index + 1}`, name: `P${index + 1}` }));
  let state = createGameState({ gameId: `map-${playerCount}`, players, startPlayerId: players[0].id });
  state = applyAction(state, { type: GameActionType.BeginMapCreation, firstPlayerId: players[0].id,
    map: { format: "A5", width, height } }, context()).state;
  return state;
}

function cellsForBlock(index) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return Array.from({ length: 10 }, (_, item) => ({ x: col * 5 + (item % 5), y: row * 2 + Math.floor(item / 5) }));
}

function createBlock(state, index) {
  return applyAction(state, { type: GameActionType.CreateSetupTerritory,
    playerId: state.mapCreation.activePlayerId, cells: cellsForBlock(index) }, context()).state;
}

function placeRequiredPois(state) {
  const stageType = {
    [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
    [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
    [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
    [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
  };
  while (stageType[state.mapCreation.stage]) {
    const type = stageType[state.mapCreation.stage];
    state = applyAction(state, { type: GameActionType.PlaceSetupPointOfInterest,
      playerId: state.mapCreation.activePlayerId, poiType: type, position: { x: 0, y: 0 } }, context()).state;
  }
  return state;
}

test("starting territory and POI requirements cover every supported player count", () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(getStartingTerritoryCount), [12, 16, 20, 24, 28]);
  assert.deepEqual(getSetupPoiRequirements(2), { LANDMARK: 1, JUNCTION: 1, FORTRESS: 1, RELIC: 2 });
  assert.deepEqual(getSetupPoiRequirements(3), { LANDMARK: 2, JUNCTION: 1, FORTRESS: 1, RELIC: 2 });
  assert.deepEqual(getSetupPoiRequirements(4), { LANDMARK: 2, JUNCTION: 1, FORTRESS: 2, RELIC: 3 });
  assert.deepEqual(getSetupPoiRequirements(5), { LANDMARK: 3, JUNCTION: 2, FORTRESS: 2, RELIC: 3 });
  assert.deepEqual(getSetupPoiRequirements(6), { LANDMARK: 3, JUNCTION: 2, FORTRESS: 3, RELIC: 4 });
});

test("three-player drawing pauses at every POI checkpoint and preserves the turn cursor", () => {
  let state = setup();
  for (let index = 0; index < 3; index += 1) state = createBlock(state, index);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceLandmarks);
  assert.equal(state.mapCreation.activePlayerId, "P1");
  state = placeRequiredPois(state);
  for (let index = 3; index < 6; index += 1) state = createBlock(state, index);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceJunctions);
  state = placeRequiredPois(state);
  for (let index = 6; index < 9; index += 1) state = createBlock(state, index);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceFortresses);
  state = placeRequiredPois(state);
  for (let index = 9; index < 12; index += 1) state = createBlock(state, index);
  assert.equal(state.mapCreation.stage, MapCreationStage.PlaceRelics);
  state = placeRequiredPois(state);
  for (let index = 12; index < 16; index += 1) state = createBlock(state, index);
  assert.equal(state.mapCreation.stage, MapCreationStage.ReadyToFinalize);
  assert.equal(state.mapCreation.createdTerritoryCount, 16);
  assert.deepEqual(state.mapCreation.placedPoiCounts, { LANDMARK: 2, JUNCTION: 1, FORTRESS: 1, RELIC: 2 });
});

test("invalid setup territory is rejected without mutating state", () => {
  const state = setup(2, 12, 12);
  const diagonal = Array.from({ length: 10 }, (_, index) => ({ x: index, y: index }));
  assert.throws(() => applyAction(state, { type: GameActionType.CreateSetupTerritory,
    playerId: "P1", cells: diagonal }, context()), (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidSetupTerritory);
  const tooSmall = Array.from({ length: 9 }, (_, index) => ({ x: index, y: 0 }));
  assert.throws(() => applyAction(state, { type: GameActionType.CreateSetupTerritory,
    playerId: "P1", cells: tooSmall }, context()), (error) => error instanceof DomainError && error.code === DomainErrorCode.MinimumTerritorySizeViolated);
  assert.equal(state.territories.length, 0);
  assert.equal(state.map.cells["0,0"], null);
});

test("a fifty-cell territory can be split into two connected twenty-five-cell setup territories", () => {
  let state = setup(2, 10, 5);
  const cells = Array.from({ length: 50 }, (_, index) => ({ x: index % 10, y: Math.floor(index / 10) }));
  state = applyAction(state, { type: GameActionType.CreateSetupTerritory, playerId: "P1", cells }, context()).state;
  state = applyAction(state, { type: GameActionType.SplitSetupTerritory, playerId: "P2", territoryId: "G01",
    partACells: cells.filter((cell) => cell.x < 5) }, context()).state;
  assert.equal(state.territories.length, 2);
  assert.equal(state.mapCreation.createdTerritoryCount, 2);
  assert.equal(state.mapCreation.activePlayerId, "P1");
  assert.equal(Object.values(state.map.cells).filter((id) => id === "G01").length, 25);
  assert.equal(Object.values(state.map.cells).filter((id) => id === "G02").length, 25);
});

test("final map validation rejects a territory with only one side neighbor; corner contact does not help", () => {
  const players = [{ id: "P1" }, { id: "P2" }];
  const map = createGridMap({ format: "A5", width: 24, height: 5 }, Object.fromEntries(Array.from({ length: 12 }, (_, territory) =>
    Array.from({ length: 10 }, (_, cell) => [`${territory * 2 + cell % 2},${Math.floor(cell / 2)}`, `G${String(territory + 1).padStart(2, "0")}`])).flat()));
  const state = {
    ...createGameState({ gameId: "single-neighbor", players, startPlayerId: "P1" }),
    phase: GamePhase.MapCreation,
    map,
    activePlayerId: "P1",
    territories: Array.from({ length: 12 }, (_, index) => ({ id: `G${String(index + 1).padStart(2, "0")}`, ownerId: null })),
    mapCreation: { firstPlayerId: "P1", activePlayerId: "P1", targetTerritoryCount: 12, createdTerritoryCount: 12,
      stage: MapCreationStage.ReadyToFinalize,
      placedPoiCounts: { LANDMARK: 1, JUNCTION: 1, FORTRESS: 1, RELIC: 2 }, lastSetupPlayerId: "P2" },
  };
  assert.ok(getSetupMapValidationIssues(state).some((issue) => issue.territoryId === "G01" && issue.code === "TOO_FEW_NEIGHBORS"));
  assert.throws(() => applyAction(state, { type: GameActionType.FinalizeMapCreation, playerId: "P1" }, context()),
    (error) => error instanceof DomainError && error.code === DomainErrorCode.InvalidMapCreation);
});

test("a full three-player setup assigns cards, private factions, and passes its stored setup actor into start auctions", () => {
  let state = setup();
  for (let index = 0; index < 16; index += 1) {
    state = createBlock(state, index);
    state = placeRequiredPois(state);
  }
  assert.equal(state.mapCreation.stage, MapCreationStage.ReadyToFinalize);
  const random = new SequenceRandomSource();
  state = applyAction(state, { type: GameActionType.FinalizeMapCreation, playerId: state.mapCreation.activePlayerId }, context(random)).state;
  assert.equal(state.phase, GamePhase.Setup);
  assert.equal(state.territories.length, 16);
  assert.equal(state.territories.every((territory) => territory.ownerId === null && territory.card !== undefined), true);
  assert.deepEqual(Object.values(Suit).map((suit) => state.territories.filter((territory) => territory.card.suit === suit).length), [4, 4, 4, 4]);
  assert.equal(new Set(state.territories.map((territory) => `${territory.card.suit}:${territory.card.activationNumber}`)).size, 16);
  assert.equal(new Set(state.players.map((player) => player.secretFactionSuit)).size, 3);
  const view = createGameViewForPlayer(state, "P1");
  assert.notEqual(view.players[0].secretFactionSuit, undefined);
  assert.equal(view.players[1].secretFactionSuit, undefined);
  state = beginStartAuctions(state, undefined, new SequenceRandomSource(), timestamp).state;
  assert.equal(state.phase, GamePhase.StartAuctions);
  assert.equal(state.startAuctions.auctioneerPlayerId, "P2");
});

test("four and six players receive faction groups required by setup", () => {
  for (const playerCount of [4, 6]) {
    let state = setup(playerCount, 20, playerCount === 4 ? 10 : 14);
    const target = getStartingTerritoryCount(playerCount);
    for (let index = 0; index < target; index += 1) {
      state = createBlock(state, index);
      state = placeRequiredPois(state);
    }
    state = applyAction(state, { type: GameActionType.FinalizeMapCreation, playerId: state.mapCreation.activePlayerId }, context()).state;
    assert.equal(new Set(state.players.slice(0, 4).map((player) => player.secretFactionSuit)).size, 4);
    if (playerCount === 4) {
      assert.deepEqual(Object.values(Suit).map((suit) => state.territories.filter((territory) => territory.card.suit === suit).length), [5, 5, 5, 5]);
      assert.equal(new Set(state.territories.map((territory) => `${territory.card.suit}:${territory.card.activationNumber}`)).size, 20);
    }
    if (playerCount === 6) assert.equal(new Set(state.players.slice(4).map((player) => player.secretFactionSuit)).size, 2);
  }
});
