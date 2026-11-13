/**
 * Tells the two implementations of makeCircle apart through its interface
 * alone: the wording of its validation messages, the order in which it
 * applies the rules, one rectangle whose intersects they decide
 * differently, the shape of the object they return, and how often they read
 * the caller's fields.
 *
 * Imports: node:test, node:assert/strict, circle.ts, geometry.ts, color.ts, shape.vocab.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeCircle } from "./circle.ts";
import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import { distPolylineToRect, isEmpty, right } from "./shape.vocab.ts";

type Fields = { center: Point; radius: number; color: Color };

const black: Color = { r: 0, g: 0, b: 0, a: 1 };
const unitFields: Fields = { center: { x: 1, y: 2 }, radius: 3, color: black };

/** The message makeCircle throws for fields the spec says it rejects. */
function messageFor(fields: Fields): string {
  try {
    makeCircle(fields);
  } catch (e) {
    assert.ok(e instanceof RangeError, "the spec says a RangeError");
    return e.message;
  }
  throw new Error("makeCircle accepted fields the spec says it rejects");
}

test("zero radius: the exact wording of the positive-radius message", () => {
  assert.equal(
    messageFor({ center: { x: 0, y: 0 }, radius: 0, color: black }),
    "Circle.positive-radius: radius must be greater than 0",
  );
});

test("a non-finite center: the exact wording of the finite-number message", () => {
  assert.equal(
    messageFor({ center: { x: NaN, y: 0 }, radius: 1, color: black }),
    "every number in the fields must be finite",
  );
});

test("a non-finite color channel is reported as the same rule as an out-of-range one", () => {
  const center = { x: 0, y: 0 };
  const nonFinite = messageFor({ center, radius: 1, color: { ...black, r: NaN } });
  const outOfRange = messageFor({ center, radius: 1, color: { ...black, r: 256 } });
  assert.equal(nonFinite, outOfRange, "both break Color.rgb-range, so both name it");
});

test("intersects a rectangle whose right edge rounds down to its left edge", () => {
  // 2 ** 52, where adding 0.25 rounds back to the same double.
  const x = 4503599627370496;
  const c = makeCircle({ center: { x, y: 0 }, radius: 4, color: black });
  const r: Rectangle = { x, y: -0.5, width: 0.25, height: 1 };
  assert.ok(r.width >= 0 && r.height >= 0, "r holds Rectangle.non-negative-size");
  assert.equal(isEmpty(r), false, "r is not empty: its width is 0.25");
  assert.equal(right(r), r.x, "r's right edge rounds down to its left edge");
  assert.equal(distPolylineToRect([c.center], r), 0, "the center itself lies on r");
  assert.equal(c.intersects(r), true, "Circle.exact-intersects: a distance below the radius intersects");
});

test("the circle, its center, its color and its bounding box are frozen", () => {
  const c = makeCircle(unitFields);
  assert.equal(Object.isFrozen(c), true, "the circle");
  assert.equal(Object.isFrozen(c.center), true, "its center");
  assert.equal(Object.isFrozen(c.color), true, "its color");
  assert.equal(Object.isFrozen(c.boundingBox()), true, "its bounding box");
});

test("the circle is a plain object, not an instance of a class", () => {
  const c = makeCircle(unitFields);
  assert.equal(Object.getPrototypeOf(c), Object.prototype);
});

test("the circle has no own property beyond the interface's members", () => {
  const c = makeCircle(unitFields);
  const members = ["kind", "center", "radius", "color", "boundingBox", "contains", "intersects"];
  assert.deepEqual(Object.keys(c).filter((k) => !members.includes(k)), []);
});

test("contains still works when it is called apart from the circle", () => {
  const c = makeCircle({ center: { x: 0, y: 0 }, radius: 2, color: black });
  const contains = c.contains;
  assert.equal(contains({ x: 0, y: 0 }), true, "the center is in the disk");
});

test("makeCircle reads the caller's center.x exactly once", () => {
  let reads = 0;
  const center: Point = {
    get x() {
      reads += 1;
      return 3;
    },
    y: 4,
  };
  const c = makeCircle({ center, radius: 1, color: black });
  assert.equal(c.center.x, 3, "the copy holds what the getter returned");
  assert.equal(reads, 1);
});
