import assert from "node:assert/strict";
import test from "node:test";

import {
  createGameState, createGridMap, getPointOfInterestTerritory, PointOfInterestType,
  reconcileMapBoundFeatures, resolveBorderTransferTopology,
} from "../dist/index.js";

function mapWith(cells) {
  return createGridMap({ width: 8, height: 6, format: "A5" }, Object.fromEntries(
    cells.map(({ x, y, territoryId }) => [`${x},${y}`, territoryId]),
  ));
}

function bridgeMap(mainArea = 10) {
  const main = Array.from({ length: mainArea }, (_, index) => ({
    x: 3 + index % 5, y: 1 + Math.floor(index / 5), territoryId: "B",
  }));
  return mapWith([
    { x: 2, y: 0, territoryId: "A" },
    { x: 2, y: 1, territoryId: "B" },
    { x: 1, y: 1, territoryId: "B" },
    ...main,
  ]);
}

test("a direct bridge transfer annexes every smaller disconnected donor component", () => {
  const map = bridgeMap();
  const resolved = resolveBorderTransferTopology(map, "A", "B", [{ x: 2, y: 1 }]);

  assert.equal(resolved.valid, true);
  assert.deepEqual(resolved.directTransferCells, [{ x: 2, y: 1 }]);
  assert.deepEqual(resolved.annexedDisconnectedCells, [{ x: 1, y: 1 }]);
  assert.equal(resolved.allTransferCells.length, 2);
  assert.equal(resolved.retainedDonorCells.length, 10);
  assert.equal(resolved.map.cells["2,1"], "A");
  assert.equal(resolved.map.cells["1,1"], "A");
  assert.equal(resolved.map.cells["3,1"], "B");
  assert.equal(map.cells["1,1"], "B");
});

test("the topology resolver rejects duplicate or foreign direct-transfer cells", () => {
  const map = bridgeMap();
  assert.equal(resolveBorderTransferTopology(map, "A", "B", [{ x: 2, y: 1 }, { x: 2, y: 1 }]).reason, "INVALID_DIRECT_TRANSFER");
  assert.equal(resolveBorderTransferTopology(map, "A", "B", [{ x: 2, y: 0 }]).reason, "INVALID_DIRECT_TRANSFER");
});

test("several disconnected remnants are annexed while the unique largest remains", () => {
  const map = mapWith([
    { x: 2, y: 1, territoryId: "A" },
    { x: 2, y: 2, territoryId: "B" },
    { x: 1, y: 2, territoryId: "B" },
    { x: 2, y: 3, territoryId: "B" },
    ...Array.from({ length: 10 }, (_, index) => ({ x: 3 + index % 5, y: 1 + Math.floor(index / 5), territoryId: "B" })),
  ]);
  const resolved = resolveBorderTransferTopology(map, "A", "B", [{ x: 2, y: 2 }]);

  assert.equal(resolved.valid, true);
  assert.equal(resolved.retainedDonorCells.length, 10);
  assert.deepEqual(new Set(resolved.annexedDisconnectedCells.map((cell) => `${cell.x},${cell.y}`)), new Set(["1,2", "2,3"]));
});

test("equal largest donor components and a retained area below the minimum are rejected", () => {
  const equalMainComponents = mapWith([
    { x: 2, y: 1, territoryId: "A" }, { x: 2, y: 2, territoryId: "B" },
    ...Array.from({ length: 10 }, (_, index) => ({ x: 3 + index % 5, y: 1 + Math.floor(index / 5), territoryId: "B" })),
    ...[
      { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 4 }, { x: 1, y: 4 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 },
    ].map(({ x, y }) => ({ x, y, territoryId: "B" })),
  ]);
  const ambiguous = resolveBorderTransferTopology(equalMainComponents, "A", "B", [{ x: 2, y: 2 }]);
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.reason, "AMBIGUOUS_RETAINED_COMPONENT");

  const tooSmall = resolveBorderTransferTopology(bridgeMap(9), "A", "B", [{ x: 2, y: 1 }]);
  assert.equal(tooSmall.valid, false);
  assert.equal(tooSmall.reason, "BELOW_MINIMUM_AREA");
});

test("cell-bound POIs and settlements follow annexed cells while the donor keeps its identity", () => {
  const topology = resolveBorderTransferTopology(bridgeMap(), "A", "B", [{ x: 2, y: 1 }]);
  assert.equal(topology.valid, true);
  const initial = createGameState({ gameId: "topology-features", players: [{ id: "P" }, { id: "Q" }], startPlayerId: "P" });
  const state = reconcileMapBoundFeatures({
    ...initial,
    map: topology.map,
    territories: [
      { id: "A", ownerId: "P", card: { suit: "HEARTS", activationNumber: 1 } },
      { id: "B", ownerId: "Q", card: { suit: "SPADES", activationNumber: 2 }, settlement: "SETTLEMENT",
        settlementFeature: { id: "settlement", kind: "SETTLEMENT", position: { x: 1, y: 1 } } },
    ],
    pointsOfInterest: [{ id: "poi", type: PointOfInterestType.Landmark, position: { x: 1, y: 1 } }],
  });

  assert.equal(getPointOfInterestTerritory(state, state.pointsOfInterest[0]), "A");
  assert.equal(state.territories.find((territory) => territory.id === "A").settlementFeature.position.x, 1);
  assert.equal(state.territories.find((territory) => territory.id === "B").card.suit, "SPADES");
});
