/**
 * Tells two implementations of mapShapeCollection.ts apart.
 *
 * Through the collection's own interface the two agree everywhere I could
 * reach: see REPORT.md for the behavior I probed and found identical. The
 * one test here is about what an add does outside the collection, not about
 * what it reports through ShapeCollectionWriter: one implementation's
 * z-order structure is balanced by a random priority per shape, so every
 * add draws from Math.random, and the other's is balanced by its shape
 * alone and draws nothing.
 *
 * Imports: node:test, node:assert/strict, geometry.ts, shape.ts, mapShapeCollection.ts, modelkit.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { ListIndex } from "./modelkit.ts";

const id = (s: string): ShapeId => s as ShapeId;

/** A shape that covers exactly its bounding box, half-open at its maximum x and y. */
class ProbeBox implements Shape {
  readonly kind = "probe-box";
  readonly box: Rectangle;

  constructor(box: Rectangle) {
    this.box = box;
  }

  boundingBox(): Rectangle {
    return this.box;
  }

  contains(p: Point): boolean {
    return p.x >= this.box.x && p.x < this.box.x + this.box.width &&
      p.y >= this.box.y && p.y < this.box.y + this.box.height;
  }

  intersects(r: Rectangle): boolean {
    return r.width > 0 && r.height > 0 && this.box.width > 0 && this.box.height > 0 &&
      r.x < this.box.x + this.box.width && this.box.x < r.x + r.width &&
      r.y < this.box.y + this.box.height && this.box.y < r.y + r.height;
  }
}

/** A unit box at (n, 0), well inside add's in-range limit. */
const box = (n: number): Shape => new ProbeBox({ x: n, y: 0, width: 1, height: 1 });

// Counts the draws from Math.random over a fixed run of valid adds: twenty
// on top and one directly below a present shape. The counter stands in for
// Math.random only while those adds run, and hands back the real number, so
// the implementation behaves exactly as it does untouched.
test("add draws no random number", () => {
  const col = new MapShapeCollection(new ListIndex());
  const real = Math.random;
  let draws = 0;
  Math.random = () => {
    draws++;
    return real();
  };
  try {
    for (let k = 0; k < 20; k++) col.add(id(`p${k}`), box(k));
    col.add(id("mid"), box(1), id("p10"));
  } finally {
    Math.random = real;
  }
  assert.equal(col.size, 21);
  assert.equal(draws, 0);
});
