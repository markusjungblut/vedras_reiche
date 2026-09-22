import assert from "node:assert/strict";
import test from "node:test";

import { mapScreenPointToLocal } from "../dist/index.js";

class AffineMatrix {
  constructor(a, b, c, d, e, f) { Object.assign(this, { a, b, c, d, e, f }); }
  inverse() {
    const determinant = this.a * this.d - this.b * this.c;
    return new AffineMatrix(this.d / determinant, -this.b / determinant, -this.c / determinant, this.a / determinant,
      (this.c * this.f - this.d * this.e) / determinant, (this.b * this.e - this.a * this.f) / determinant);
  }
}

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  matrixTransform(matrix) {
    return new Point(matrix.a * this.x + matrix.c * this.y + matrix.e, matrix.b * this.x + matrix.d * this.y + matrix.f);
  }
}

function local(x, y, matrix) {
  return mapScreenPointToLocal(new Point(x, y), matrix);
}

function assertPoint(actual, x, y) {
  assert.ok(Math.abs(actual.x - x) < 1e-9, `x ${actual.x} should equal ${x}`);
  assert.ok(Math.abs(actual.y - y) < 1e-9, `y ${actual.y} should equal ${y}`);
}

test("screen-to-SVG conversion follows the element transform for square and rectangular boards", () => {
  const square50 = new AffineMatrix(4, 0, 0, 4, 20, 30);
  assertPoint(local(20.4, 30.4, square50), .1, .1);
  assertPoint(local(120, 130, square50), 25, 25);
  assertPoint(local(219.6, 229.6, square50), 49.9, 49.9);

  const wide100x50 = new AffineMatrix(2, 0, 0, 2, 10, 15);
  assertPoint(local(10.2, 15.2, wide100x50), .1, .1);
  assertPoint(local(110, 65, wide100x50), 50, 25);
  assertPoint(local(209.8, 114.8, wide100x50), 99.9, 49.9);
});

test("screen-to-SVG conversion preserves letterboxing from a mismatched container", () => {
  // A 100 × 50 SVG is centered vertically inside a 100 × 100 container.
  const letterboxed100x50 = new AffineMatrix(1, 0, 0, 1, 0, 25);
  assertPoint(local(.1, 25.1, letterboxed100x50), .1, .1);
  assertPoint(local(50, 50, letterboxed100x50), 50, 25);
  assertPoint(local(99.9, 74.9, letterboxed100x50), 99.9, 49.9);
});
