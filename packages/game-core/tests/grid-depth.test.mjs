import assert from "node:assert/strict";
import test from "node:test";

import { getMapLinearScale, scaleGridDepth } from "../dist/index.js";

const bases = [1, 2, 3, 4, 5];

test("grid-depth scaling follows the linear square-root factor at the documented reference maps", () => {
  const cases = [
    [{ width: 50, height: 50 }, [1, 2, 3, 4, 5]],
    [{ width: 100, height: 50 }, [1, 3, 4, 6, 7]],
    [{ width: 100, height: 100 }, [2, 4, 6, 8, 10]],
    [{ width: 50, height: 25 }, [1, 1, 2, 3, 4]],
    [{ width: 60, height: 50 }, [1, 2, 3, 4, 5]],
  ];
  for (const [map, expected] of cases) {
    assert.deepEqual(bases.map((base) => scaleGridDepth(base, map)), expected);
  }
  assert.equal(getMapLinearScale({ width: 50, height: 50 }), 1);
  assert.equal(scaleGridDepth(0, { width: 100, height: 100 }), 0);
});
