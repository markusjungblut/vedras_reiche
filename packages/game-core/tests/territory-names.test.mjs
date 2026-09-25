import assert from "node:assert/strict";
import test from "node:test";

import { allocateNextTerritoryId, createGameState, territoryDisplayId } from "../dist/index.js";

test("territory labels are monotonic across saved counters and historical splits", () => {
  const state = {
    ...createGameState({ gameId: "territory-labels", players: [{ id: "P" }, { id: "Q" }], startPlayerId: "P" }),
    nextTerritoryDisplayNumber: 8,
    territories: [
      { id: "G01", ownerId: "P", area: 20, adjacentTerritoryIds: [] },
      { id: "G12", ownerId: null, area: 20, adjacentTerritoryIds: [] },
    ],
    events: [{ payload: { newTerritoryId: "G13" } }],
  };

  assert.equal(territoryDisplayId(7), "G07");
  assert.deepEqual(allocateNextTerritoryId(state), { territoryId: "G14", nextTerritoryDisplayNumber: 15 });
  const afterFirstSplit = { ...state, nextTerritoryDisplayNumber: 15, territories: [
    ...state.territories,
    { id: "G14", ownerId: "P", area: 20, adjacentTerritoryIds: [] },
  ] };
  assert.deepEqual(allocateNextTerritoryId(afterFirstSplit), { territoryId: "G15", nextTerritoryDisplayNumber: 16 });
});
