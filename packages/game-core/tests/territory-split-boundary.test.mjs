import assert from "node:assert/strict";
import test from "node:test";

import {
  createGridMap, deriveTerritorySplitFromBoundary, getMinimumTerritoryArea, validateTerritorySplit,
} from "../dist/index.js";

function rectangleMap() {
  return createGridMap({ width: 8, height: 5, format: "A4" }, Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`${index % 8},${Math.floor(index / 8)}`, "G08"]),
  ));
}

test("a raster boundary derives the same legal two-way split used by war proposals", () => {
  const map = rectangleMap();
  const boundary = Array.from({ length: 5 }, (_, y) => ({ from: { x: 3, y }, to: { x: 4, y } }));
  const split = deriveTerritorySplitFromBoundary(map, "G08", boundary);

  assert.equal(split.valid, true);
  assert.equal(split.partACells.length, 20);
  assert.equal(split.partBCells.length, 20);
  assert.equal(validateTerritorySplit(map, "G08", split.partACells, getMinimumTerritoryArea(map)).valid, true);
});

test("an incomplete or external boundary cannot become a war split proposal", () => {
  const map = rectangleMap();
  const incomplete = deriveTerritorySplitFromBoundary(map, "G08", [{
    from: { x: 3, y: 0 }, to: { x: 4, y: 0 },
  }]);
  assert.deepEqual(incomplete, { valid: false, reason: "NOT_EXACTLY_TWO_PARTS", partACells: [], partBCells: [] });

  const external = deriveTerritorySplitFromBoundary(map, "G08", [{
    from: { x: 3, y: 0 }, to: { x: 4, y: 0 },
  }, { from: { x: -1, y: 0 }, to: { x: 0, y: 0 } }]);
  assert.equal(external.valid, false);
  assert.equal(external.reason, "BOUNDARY_OUTSIDE_TERRITORY");
});
