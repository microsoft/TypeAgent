// Contract tests for Circle and its Shape and Color rules (shape.ts,
// color.ts), plus the makeCircle requirements in impl-specs.md. Every Circle
// implementation runs this suite. Test names are rule IDs.
//
// Floating-point: generated centers are multiples of 0.5 and radii are
// multiples of 0.5, so box arithmetic is exact. Where a rule compares a
// computed distance with the radius, generated cases within 1e-9 of the tie
// are skipped, because two correct implementations may round differently
// there. Exact touches are covered by fixed cases instead.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";
import { colorContract } from "./color.contract.ts";
import { shapeContract } from "./shape.contract.ts";
import { deepEqual, distPolylineToRect, distToPolyline, extents, implies, inflate, isEmpty, rectContains } from "./shape.vocab.ts";
import { color, point, rect } from "./testkit.ts";

export type CircleFields = { center: Point; radius: number; color: Color };
type Make = (fields: CircleFields) => Circle;

const black: Color = { r: 0, g: 0, b: 0, a: 1 };
const tie = 1e-9;

const fields: fc.Arbitrary<CircleFields> = fc.record({
  center: point(10),
  radius: fc.integer({ min: 1, max: 12 }).map((n) => n / 2),
  color,
});

// Arbitrary doubles, for rules that hold as computed, where rounding near the
// bounding box's edges matters.
const anyCoord = fc.double({ min: -100, max: 100, noNaN: true });
const offGrid: fc.Arbitrary<CircleFields> = fc.record({
  center: fc.record({ x: anyCoord, y: anyCoord }),
  radius: fc.double({ min: 1e-3, max: 10, noNaN: true }),
  color,
});

export function circleContract(make: Make): void {
  describe("Circle", () => {
    test("makeCircle.validation", () => {
      const ok: CircleFields = { center: { x: 0, y: 0 }, radius: 1, color: black };
      assert.doesNotThrow(() => make(ok), "valid fields");
      const bad: [string, CircleFields][] = [
        ["Circle.positive-radius (zero)", { ...ok, radius: 0 }],
        ["Circle.positive-radius (negative)", { ...ok, radius: -1 }],
        ["Color.rgb-range (above)", { ...ok, color: { ...black, r: 256 } }],
        ["Color.rgb-range (fraction)", { ...ok, color: { ...black, b: 1.5 } }],
        ["Color.alpha-range (above)", { ...ok, color: { ...black, a: 1.1 } }],
        ["Color.alpha-range (below)", { ...ok, color: { ...black, a: -0.1 } }],
        ["finite (center)", { ...ok, center: { x: NaN, y: 0 } }],
        ["finite (radius)", { ...ok, radius: Infinity }],
      ];
      for (const [rule, f] of bad) assert.throws(() => make(f), RangeError, rule);
    });

    test("makeCircle.copying", () => {
      const center = { x: 1, y: 2, z: 3 };
      const c = make({ center, radius: 2, color: { ...black, name: "black" } as Color });
      center.x = 100;
      assert.ok(deepEqual(c.center, { x: 1, y: 2 }), "center keeps only x and y, and later changes don't reach it");
      assert.ok(deepEqual(c.color, black), "color keeps only r, g, b and a");
    });

    test("makeCircle.fields", () => {
      fc.assert(fc.property(fields, (f) => {
        const c = make(f);
        return c.kind === "circle" && deepEqual(c.center, f.center) && c.radius === f.radius && deepEqual(c.color, f.color);
      }));
    });

    test("Circle.box", () => {
      assert.deepEqual(make({ center: { x: 0, y: 0 }, radius: 1, color: black }).boundingBox(),
        { x: -1, y: -1, width: 2, height: 2 });
      fc.assert(fc.property(fields, (f) => {
        const c = make(f);
        return deepEqual(c.boundingBox(), inflate(extents([c.center]), c.radius));
      }));
    });

    test("Circle.disk", () => {
      const unit = make({ center: { x: 0, y: 0 }, radius: 1, color: black });
      assert.equal(unit.contains({ x: -1, y: 0 }), true, "left extreme is inside");
      assert.equal(unit.contains({ x: 0, y: -1 }), true, "top extreme is inside");
      assert.equal(unit.contains({ x: 1, y: 0 }), false, "right extreme is outside");
      assert.equal(unit.contains({ x: 0, y: 1 }), false, "bottom extreme is outside");
      assert.equal(unit.contains({ x: -0.8, y: -0.8 }), false, "box corner is outside the disk");
      const five = make({ center: { x: 0, y: 0 }, radius: 5, color: black });
      assert.equal(five.contains({ x: -3, y: -4 }), true, "a point at exactly the radius is inside");
      fc.assert(fc.property(fields, point(14), (f, p) => {
        const c = make(f);
        const inBox = rectContains(c.boundingBox(), p);
        const d = distToPolyline(p, [c.center]);
        fc.pre(!inBox || Math.abs(d - c.radius) > tie);
        return c.contains(p) === (d <= c.radius && inBox);
      }));
    });

    test("Circle.exact-intersects", () => {
      const unit = make({ center: { x: 0, y: 0 }, radius: 1, color: black });
      assert.equal(unit.intersects({ x: 0.75, y: 0.75, width: 1, height: 1 }), false, "inside the box but clear of the disk");
      assert.equal(unit.intersects({ x: -0.25, y: -0.25, width: 0.5, height: 0.5 }), true, "around the center");

      // Exact touches: the disk reaches r's boundary but not its interior.
      // An axis-aligned rectangle touches a circle at one of the circle's
      // four extremes, or at one of its own corners; the half-open rule
      // makes every such touch false.
      const touches: [string, Rectangle, boolean][] = [
        ["touches r's right edge from the left extreme", { x: -3, y: -0.5, width: 2, height: 1 }, false],
        ["touches r's bottom edge from the top extreme", { x: -0.5, y: -3, width: 1, height: 2 }, false],
        ["touches r's left edge at the disk's maximum x", { x: 1, y: -0.5, width: 2, height: 1 }, false],
        ["touches r's top edge at the disk's maximum y", { x: -0.5, y: 1, width: 1, height: 2 }, false],
      ];
      for (const [name, r, expected] of touches) {
        assert.equal(distPolylineToRect([unit.center], r), 1, `${name}: the case really is a touch`);
        assert.equal(unit.intersects(r), expected, name);
      }
      // A touch at r's top-right corner, which lies on r's excluded right
      // edge: (-1.5, 2) is exactly 2.5 from the center (phase 2 task 11).
      const wide = make({ center: { x: 0, y: 0 }, radius: 2.5, color: black });
      const corner: Rectangle = { x: -5, y: 2, width: 3.5, height: 1 };
      assert.equal(distPolylineToRect([wide.center], corner), 2.5, "the corner case really is a touch");
      assert.equal(wide.intersects(corner), false, "touches r at its top-right corner, on its excluded right edge");
      fc.assert(fc.property(fields, rect(14), (f, r) => {
        const c = make(f);
        const d = distPolylineToRect([c.center], r);
        fc.pre(Math.abs(d - c.radius) > tie);
        return implies(!isEmpty(r) && d < c.radius, c.intersects(r)) && implies(d > c.radius, !c.intersects(r));
      }));
    });

    test("Circle.positive-radius", () => {
      fc.assert(fc.property(fields, (f) => make(f).radius > 0));
    });

    colorContract(fields.map((f) => make(f).color));
    shapeContract(fields.map(make), offGrid.map((f) => ({ shape: make(f), q: f.center })));
  });
}
