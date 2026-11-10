// Contract tests for InkStroke and its Shape and Color rules (shape.ts, color.ts),
// plus the makeInkStroke requirements in impl-specs.md. Every InkStroke
// implementation runs this suite. Test names are rule IDs.
//
// Floating-point: generated coordinates are multiples of 0.5 and thicknesses
// are integers, so box arithmetic is exact. Where a rule compares a computed
// distance with thickness / 2, generated cases within 1e-9 of the tie are
// skipped, because two correct implementations may round differently there.
// Exact touches are covered by fixed cases instead, chosen so that the
// distances are exact.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { InkStroke } from "./shape.ts";
import { colorContract } from "./color.contract.ts";
import { shapeContract } from "./shape.contract.ts";
import {
  deepEqual, distPolylineToRect, distToPolyline, extents, implies, inflate, isEmpty, rectContains,
} from "./shape.vocab.ts";
import { color, point, rect } from "./testkit.ts";

type Fields = { points: readonly Point[]; thickness: number; color: Color };
type Make = (fields: Fields) => InkStroke;

const black: Color = { r: 0, g: 0, b: 0, a: 1 };
const tie = 1e-9;

// Arbitrary doubles, for rules that hold as computed (see rules.ts), where
// rounding near the bounding box's edges matters.
const anyCoord = fc.double({ min: -100, max: 100, noNaN: true });
const offGrid: fc.Arbitrary<Fields> = fc.record({
  points: fc.array(fc.record({ x: anyCoord, y: anyCoord }), { minLength: 1, maxLength: 6 }),
  thickness: fc.double({ min: 1, max: 10, noNaN: true }),
  color,
});

const fields: fc.Arbitrary<Fields> = fc.record({
  points: fc.array(point(10), { minLength: 1, maxLength: 6 }),
  thickness: fc.integer({ min: 1, max: 6 }),
  color,
});

export function inkStrokeContract(make: Make): void {
  describe("InkStroke", () => {
    test("makeInkStroke.validation", () => {
      const ok: Fields = { points: [{ x: 0, y: 0 }], thickness: 1, color: black };
      assert.doesNotThrow(() => make(ok), "valid fields");
      const bad: [string, Fields][] = [
        ["InkStroke.has-points", { ...ok, points: [] }],
        ["InkStroke.min-thickness", { ...ok, thickness: 0.5 }],
        ["Color.rgb-range (above)", { ...ok, color: { ...black, r: 256 } }],
        ["Color.rgb-range (below)", { ...ok, color: { ...black, g: -1 } }],
        ["Color.rgb-range (fraction)", { ...ok, color: { ...black, b: 1.5 } }],
        ["Color.alpha-range (above)", { ...ok, color: { ...black, a: 1.1 } }],
        ["Color.alpha-range (below)", { ...ok, color: { ...black, a: -0.1 } }],
        ["finite (point)", { ...ok, points: [{ x: NaN, y: 0 }] }],
        ["finite (later point)", { ...ok, points: [{ x: 0, y: 0 }, { x: 1, y: Infinity }] }],
        ["finite (thickness)", { ...ok, thickness: Infinity }],
      ];
      for (const [rule, f] of bad) assert.throws(() => make(f), RangeError, rule);
    });

    test("makeInkStroke.immutability", () => {
      const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
      const s = make({ points, thickness: 2, color: black });
      const box = s.boundingBox();
      points[1].x = 100;
      points.push({ x: -50, y: -50 });
      assert.deepEqual(s.boundingBox(), box);
      assert.deepEqual(s.points, [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    });

    test("makeInkStroke.copying", () => {
      const points = [{ x: 0, y: 0, pressure: 0.5 }];
      const s = make({ points, thickness: 2, color: { ...black, name: "black" } as Color });
      assert.ok(deepEqual(s.points, [{ x: 0, y: 0 }]), "points keep only x and y");
      assert.ok(deepEqual(s.color, black), "color keeps only r, g, b and a");
    });

    test("InkStroke.fields", () => {
      fc.assert(fc.property(fields, (f) => {
        const s = make(f);
        return s.kind === "ink" && deepEqual(s.points, f.points) &&
          s.thickness === f.thickness && deepEqual(s.color, f.color);
      }));
    });

    test("InkStroke.box", () => {
      const dot = make({ points: [{ x: 0, y: 0 }], thickness: 2, color: black });
      assert.deepEqual(dot.boundingBox(), { x: -1, y: -1, width: 2, height: 2 });
      fc.assert(fc.property(fields, (f) => {
        const s = make(f);
        return deepEqual(s.boundingBox(), inflate(extents(s.points), s.thickness / 2));
      }));
    });

    test("InkStroke.round-pen", () => {
      const dot = make({ points: [{ x: 0, y: 0 }], thickness: 2, color: black });
      assert.equal(dot.contains({ x: -1, y: 0 }), true, "left extreme is inside");
      assert.equal(dot.contains({ x: 1, y: 0 }), false, "right extreme is outside");
      assert.equal(dot.contains({ x: 0, y: 1 }), false, "bottom extreme is outside");
      assert.equal(dot.contains({ x: 0.8, y: 0.8 }), false, "box corner is outside the round pen");
      fc.assert(fc.property(fields, point(14), (f, p) => {
        const s = make(f);
        const box = s.boundingBox();
        const inBox = rectContains(box, p);
        const d = distToPolyline(p, s.points);
        fc.pre(!inBox || Math.abs(d - s.thickness / 2) > tie);
        return s.contains(p) === (d <= s.thickness / 2 && inBox);
      }));
    });

    // The rule's expression covers every case except the pen exactly touching r; the hand-written cases below cover those.
    test("InkStroke.exact-intersects", () => {
      const diagonal = make({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], thickness: 1, color: black });
      assert.equal(diagonal.intersects({ x: 7, y: 0, width: 3, height: 3 }), false, "inside the box but clear of the pen");
      assert.equal(diagonal.intersects({ x: 4, y: 4, width: 2, height: 2 }), true, "on the line");

      // Exact touches: the pen reaches r's boundary but not its interior.
      // Each touched point is in r only on r's left or top edge, and is in the
      // stroke only if it isn't at the stroke's maximum x or y.
      const touches: [string, Point[], Rectangle, boolean][] = [
        ["touches r's left edge", [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 10, y: 4 }], { x: 1, y: 0, width: 1, height: 2 }, true],
        ["touches r's top edge", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { x: 2, y: 1, width: 2, height: 2 }, true],
        ["touches r's left edge at the stroke's maximum x", [{ x: 0, y: 0 }, { x: 0, y: 10 }], { x: 1, y: 2, width: 2, height: 2 }, false],
        ["touches r's top edge at the stroke's maximum y", [{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 2, y: 1, width: 2, height: 2 }, false],
        ["touches r's right edge", [{ x: 0, y: 0 }, { x: 0, y: 10 }], { x: -3, y: 2, width: 2, height: 2 }, false],
        ["touches r's bottom edge", [{ x: 0, y: 5 }, { x: 10, y: 5 }], { x: 2, y: 2, width: 2, height: 2 }, false],
      ];
      for (const [name, points, r, expected] of touches) {
        const s = make({ points, thickness: 2, color: black });
        assert.equal(distPolylineToRect(s.points, r), 1, `${name}: the case really is a touch`);
        assert.equal(s.intersects(r), expected, name);
      }

      fc.assert(fc.property(fields, rect(14), (f, r) => {
        const s = make(f);
        const d = distPolylineToRect(s.points, r);
        fc.pre(Math.abs(d - s.thickness / 2) > tie);
        return implies(!isEmpty(r) && d < s.thickness / 2, s.intersects(r)) &&
          implies(d > s.thickness / 2, !s.intersects(r));
      }));
    });

    test("InkStroke.has-points", () => {
      fc.assert(fc.property(fields, (f) => make(f).points.length >= 1));
    });

    test("InkStroke.min-thickness", () => {
      fc.assert(fc.property(fields, (f) => make(f).thickness >= 1));
    });

    colorContract(fields.map((f) => make(f).color));
    shapeContract(fields.map(make), fc.tuple(offGrid, fc.nat()).map(([f, i]) => ({ shape: make(f), q: f.points[i % f.points.length] })));
  });
}
