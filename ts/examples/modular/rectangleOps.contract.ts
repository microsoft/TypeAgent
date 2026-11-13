// Contract tests for RectangleOps (geometry.ts). Every implementation runs
// this suite. Test names are rule IDs.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Align, Edge, Rectangle, RectangleOps } from "./geometry.ts";
import { cutRect, deepEqual, insetRect, isEmpty, placeRect, splitRect, validRect } from "./geometry.vocab.ts";
import { deepFreeze, point, rect } from "./testkit.ts";

const square = { x: 0, y: 0, width: 10, height: 10 };

/** Rectangles for carving: mostly whole units, some with halves, some empty. */
const carvable: fc.Arbitrary<Rectangle> = fc.record({
  x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }),
  width: fc.integer({ min: 0, max: 120 }), height: fc.integer({ min: 0, max: 120 }), half: fc.nat({ max: 3 }),
}).map(({ x, y, width, height, half }) => ({
  x: half === 1 ? x + 0.5 : x, y, width: half === 2 ? width + 0.5 : width, height: half === 3 ? height + 0.5 : height,
}));
const edge = fc.constantFrom<Edge>("top", "bottom", "left", "right");
const align = fc.constantFrom<Align>("start", "center", "end");
const weights = fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 6 });
const length = fc.integer({ min: 0, max: 140 });

export function rectangleOpsContract(ops: RectangleOps): void {
  describe("RectangleOps", () => {
    test("RectangleOps.contains.half-open", () => {
      assert.equal(ops.contains(square, { x: 0, y: 0 }), true, "top-left corner is inside");
      assert.equal(ops.contains(square, { x: 10, y: 5 }), false, "right edge is outside");
      assert.equal(ops.contains(square, { x: 5, y: 10 }), false, "bottom edge is outside");
      assert.equal(ops.contains({ x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 5 }), false, "empty contains nothing");
      fc.assert(fc.property(rect(), point(), (r, p) =>
        ops.contains(r, p) === (r.x <= p.x && p.x < r.x + r.width && r.y <= p.y && p.y < r.y + r.height)));
    });

    test("RectangleOps.intersects.nonzero-area", () => {
      assert.equal(ops.intersects(square, { x: 5, y: 5, width: 10, height: 10 }), true, "overlap");
      assert.equal(ops.intersects(square, { x: 10, y: 0, width: 10, height: 10 }), false, "shared edge");
      assert.equal(ops.intersects(square, { x: 10, y: 10, width: 10, height: 10 }), false, "shared corner");
      assert.equal(ops.intersects(square, { x: 5, y: 0, width: 0, height: 10 }), false, "empty inside");
      assert.equal(ops.intersects(square, square), true, "itself");
      // Empty as computed: 2^52 + 0.25 rounds back to 2^52 (phase 3, task 11).
      const absorbed: Rectangle = { x: 2 ** 52, y: -0.5, width: 0.25, height: 1 };
      assert.equal(absorbed.x + absorbed.width, absorbed.x, "the case really rounds back");
      assert.equal(ops.intersects({ x: 2 ** 52 - 4, y: -1, width: 8, height: 2 }, absorbed), false, "empty as computed");
      fc.assert(fc.property(rect(), rect(), (a, b) =>
        ops.intersects(a, b) === (!isEmpty(a) && !isEmpty(b) &&
          a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height)));
    });

    test("RectangleOps.intersects.symmetric", () => {
      fc.assert(fc.property(rect(), rect(), (a, b) => ops.intersects(a, b) === ops.intersects(b, a)));
    });

    test("RectangleOps.cut.exact", () => {
      assert.deepEqual(ops.cut({ x: 0, y: 0, width: 100, height: 50 }, "left", 30),
        [{ x: 0, y: 0, width: 30, height: 50 }, { x: 30, y: 0, width: 70, height: 50 }], "left");
      assert.deepEqual(ops.cut({ x: 0, y: 0, width: 100, height: 50 }, "bottom", 80),
        [{ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 100, height: 0 }], "more than all of it");
      fc.assert(fc.property(carvable, edge, length, (r, e, s) => deepEqual(ops.cut(r, e, s), cutRect(r, e, s))));
    });

    test("RectangleOps.splitHoriz.exact", () => {
      assert.deepEqual(ops.splitHoriz({ x: 0, y: 0, width: 100, height: 10 }, 5, 10, 5).map((r) => r.width), [25, 50, 25], "quarters and a half");
      assert.deepEqual(ops.splitHoriz({ x: 0, y: 0, width: 10, height: 10 }, 1, 1, 1).map((r) => r.width), [4, 3, 3], "a tie goes to the first");
      assert.deepEqual(ops.splitHoriz({ x: 0, y: 0, width: 11, height: 10 }, 1, 1, 1).map((r) => r.width), [4, 4, 3], "two left over, spread");
      assert.deepEqual(ops.splitHoriz({ x: 0, y: 0, width: 10, height: 10 }, 1, 3).map((r) => r.width), [3, 7], "largest fraction wins");
      assert.deepEqual(ops.splitHoriz({ x: 0, y: 0, width: 10.5, height: 10 }, 1, 1).map((r) => r.width), [5, 5.5], "a fraction goes last");
      fc.assert(fc.property(carvable, weights, (r, w) => deepEqual(ops.splitHoriz(r, ...w), splitRect(r, "horizontal", w))));
    });

    test("RectangleOps.splitVert.exact", () => {
      assert.deepEqual(ops.splitVert({ x: 0, y: 0, width: 10, height: 100 }, 5, 10, 5).map((r) => [r.y, r.height]), [[0, 25], [25, 50], [75, 25]]);
      fc.assert(fc.property(carvable, weights, (r, w) => deepEqual(ops.splitVert(r, ...w), splitRect(r, "vertical", w))));
    });

    test("RectangleOps.inset.exact", () => {
      assert.deepEqual(ops.inset({ x: 0, y: 0, width: 100, height: 50 }, 8), { x: 8, y: 8, width: 84, height: 34 });
      assert.deepEqual(ops.inset({ x: 0, y: 0, width: 10, height: 50 }, 8), { x: 5, y: 8, width: 0, height: 34 }, "too narrow");
      fc.assert(fc.property(carvable, fc.integer({ min: 0, max: 70 }), (r, d) => deepEqual(ops.inset(r, d), insetRect(r, d))));
    });

    test("RectangleOps.place.exact", () => {
      assert.deepEqual(ops.place({ x: 0, y: 0, width: 100, height: 50 }, { width: 31, height: 10 }, "center", "end"), { x: 34, y: 40, width: 31, height: 10 });
      assert.deepEqual(ops.place({ x: 0, y: 0, width: 20, height: 50 }, { width: 31, height: 10 }, "start", "start"), { x: 0, y: 0, width: 20, height: 10 }, "too wide");
      fc.assert(fc.property(carvable, length, length, align, align, (r, w, h, ax, ay) =>
        deepEqual(ops.place(r, { width: w, height: h }, ax, ay), placeRect(r, { width: w, height: h }, ax, ay))));
    });

    test("Rectangle.non-negative-size", () => {
      fc.assert(fc.property(carvable, edge, length, weights, align, align, (r, e, s, w, ax, ay) => [
        ...ops.cut(r, e, s), ...ops.splitHoriz(r, ...w), ...ops.splitVert(r, ...w),
        ops.inset(r, s / 2), ops.place(r, { width: s, height: s }, ax, ay),
      ].every(validRect)));
    });

    test("RectangleOps.no-mutation", () => {
      fc.assert(fc.property(rect(), rect(), point(), carvable, weights, (a, b, p, r, w) => {
        deepFreeze(a);
        deepFreeze(b);
        deepFreeze(p);
        deepFreeze(r);
        deepFreeze(w);
        ops.contains(a, p);
        ops.intersects(a, b);
        ops.cut(r, "left", 10);
        ops.splitHoriz(r, ...w);
        ops.splitVert(r, ...w);
        ops.inset(r, 3);
        ops.place(r, deepFreeze({ width: 5, height: 5 }), "center", "center");
      }));
    });
  });
}
