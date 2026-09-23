import assert from "node:assert/strict";
import test from "node:test";
import { getCellLabelAnchor, getCellLabelAnchorAwayFromPoints } from "../.test-dist/map/territory-label-anchor.js";

const shapes = {
  rectangle: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  lShape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  uShape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  narrow: [{ x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }],
  concave: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
};

test("every setup-label anchor stays inside rectangular and concave regions", () => {
  for (const [name, cells] of Object.entries(shapes)) {
    const anchor = getCellLabelAnchor(cells);
    assert.ok(anchor, name);
    assert.equal(cells.some((cell) => cell.x + .5 === anchor.x && cell.y + .5 === anchor.y), true, name);
  }
});

test("a narrow territory moves its label away from a strategic point", () => {
  const anchor = getCellLabelAnchorAwayFromPoints(shapes.narrow, [{ x: 4, y: 0 }]);
  assert.ok(anchor);
  assert.deepEqual({ x: anchor.x, y: anchor.y }, { x: 4.5, y: 3.5 });
});
