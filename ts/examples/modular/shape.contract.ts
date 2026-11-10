// Contract tests for the rules every Shape has (shape.ts), and Rectangle's
// @valid rule on the bounding boxes shapes return, run by each shape type's
// contract with its own generators. Test names are rule IDs.

import { test } from "node:test";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Shape } from "./shape.ts";
import { deepEqual, implies, isEmpty, rectContains, rectIntersects, validRect } from "./shape.vocab.ts";
import { point, prevDouble, rect } from "./testkit.ts";

/**
 * shapes: shapes on the half grid, as the shape type's own rules use them.
 * offGrid: shapes with arbitrary double coordinates, each with a point of
 * the shape (such as one of a stroke's points, or a circle's center), level
 * with which the box-edge probes are made. Rounding at the bounding box's
 * edges only shows up off the grid.
 */
export function shapeContract(shapes: fc.Arbitrary<Shape>, offGrid: fc.Arbitrary<{ shape: Shape; q: Point }>): void {
  test("Shape.deterministic", () => {
    fc.assert(fc.property(shapes, point(14), rect(14), (s, p, r) =>
      deepEqual(s.boundingBox(), s.boundingBox()) &&
      s.contains(p) === s.contains(p) && s.intersects(r) === s.intersects(r)));
  });

  test("Rectangle.non-negative-size", () => {
    fc.assert(fc.property(shapes, (s) => validRect(s.boundingBox())));
    fc.assert(fc.property(offGrid, ({ shape: s }) => validRect(s.boundingBox())));
  });

  test("Shape.intersects.empty-rect", () => {
    fc.assert(fc.property(shapes, rect(14), (s, r) => implies(isEmpty(r), !s.intersects(r))));
  });

  test("Shape.intersects.implies-box", () => {
    fc.assert(fc.property(shapes, rect(14), (s, r) => implies(s.intersects(r), rectIntersects(s.boundingBox(), r))));
    // Rectangles ending exactly at the left or top edge, level with a point of the shape.
    fc.assert(fc.property(offGrid, ({ shape: s, q }) => {
      const box = s.boundingBox();
      const left = { x: box.x - 1, y: q.y - 0.5, width: box.x - (box.x - 1), height: 1 };
      const top = { x: q.x - 0.5, y: box.y - 1, width: 1, height: box.y - (box.y - 1) };
      return [left, top].every((r) => implies(s.intersects(r), rectIntersects(box, r)));
    }), { numRuns: 2000 });
  });

  test("Shape.intersects.witness", () => {
    fc.assert(fc.property(shapes, rect(14), point(14), (s, r, p) =>
      implies(s.contains(p) && rectContains(r, p), s.intersects(r))));
  });

  test("Shape.contains.implies-box", () => {
    fc.assert(fc.property(shapes, point(14), (s, p) => implies(s.contains(p), rectContains(s.boundingBox(), p))));
    // Just outside the left and top edges, level with a point of the shape.
    fc.assert(fc.property(offGrid, ({ shape: s, q }) => {
      const box = s.boundingBox();
      return !s.contains({ x: prevDouble(box.x), y: q.y }) && !s.contains({ x: q.x, y: prevDouble(box.y) });
    }), { numRuns: 2000 });
  });
}
