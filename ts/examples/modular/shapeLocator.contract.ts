// Contract tests for ShapeLocator (geometry.ts), including the ShapeLocatorQueries
// rules it inherits. Every implementation runs this suite. Test names are
// rule IDs.
//
// The suite runs random sequences of operations against the locator, while
// tracking indexed(locator), the ghost state the rules refer to, in a Map.
// It uses the test shapes in testkit.ts, so locator tests don't depend on any InkStroke
// implementation. Triangles have a region smaller than their bounding box,
// which catches locators that answer from bounding boxes alone. Some shapes
// are empty.
//
// Three kinds of sequence run against every rule: sparse ones that mix all
// operations; dense ones that pack many small shapes into a cluster, so that
// a tree-shaped locator splits several levels deep, then remove most of the
// cluster at once, so that it merges; and moved ones, which are sparse
// sequences shifted and scaled so that coordinates round.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";
import { isEmpty, sameSet, unique } from "./shape.vocab.ts";
import { coverage, grid, point, rect, shape, shapeOf, TestBox, TestTriangle } from "./testkit.ts";

/**
 * Out arrays may start with IDs, to check that queries append. Each pick
 * becomes an ID ever added, or 0, which is never added.
 */
const prefill = fc.array(fc.nat(), { maxLength: 3 });

type Op =
  | { op: "add"; shape: Shape; reuse: number | null; sameAs: number | null }
  | { op: "remove"; pick: number }
  | { op: "removeMultiple"; picks: number[] }
  | { op: "inRect"; r: Rectangle; prefill: number[] }
  | { op: "atPoint"; p: Point; prefill: number[] };

/**
 * pick chooses among IDs ever added, plus 0, which is never added, so
 * removals hit present, removed and unknown IDs. An add may reuse a removed
 * ID (reuse), or add a shape object that was added before (sameAs).
 */
const addArb = fc.record({
  shape,
  reuse: fc.option(fc.nat(), { freq: 4 }),
  sameAs: fc.option(fc.nat(), { freq: 6 }),
}).map(({ shape, reuse, sameAs }): Op => ({ op: "add", shape, reuse, sameAs }));

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: addArb },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick })) },
  { weight: 1, arbitrary: fc.array(fc.nat(), { maxLength: 6 }).map((picks): Op => ({ op: "removeMultiple", picks })) },
  { weight: 2, arbitrary: fc.tuple(rect(grid), prefill).map(([r, prefill]): Op => ({ op: "inRect", r, prefill })) },
  { weight: 2, arbitrary: fc.tuple(point(grid), prefill).map(([p, prefill]): Op => ({ op: "atPoint", p, prefill })) },
);
const sparse = fc.array(opArb, { minLength: 10, maxLength: 40, size: "max" });

/** Multiples of 1/8 from 0 to 4, so that values land on many power-of-two cell boundaries. */
const eighth = fc.integer({ min: 0, max: 32 }).map((n) => n / 8);
const smallBox: fc.Arbitrary<Rectangle> = fc.record({
  x: eighth,
  y: eighth,
  width: fc.integer({ min: 1, max: 8 }).map((n) => n / 8),
  height: fc.integer({ min: 1, max: 8 }).map((n) => n / 8),
});
const denseQuery: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ x: eighth, y: eighth, width: eighth, height: eighth }).map((r): Op => ({ op: "inRect", r, prefill: [] })),
  fc.record({ x: eighth, y: eighth }).map((p): Op => ({ op: "atPoint", p, prefill: [] })),
);
const dense: fc.Arbitrary<Op[]> = fc.tuple(
  fc.array(fc.tuple(fc.boolean(), smallBox).map(shapeOf), { minLength: 100, maxLength: 300 }),
  fc.array(denseQuery, { minLength: 10, maxLength: 20 }),
  fc.array(fc.nat(), { minLength: 50, maxLength: 400 }),
  fc.array(denseQuery, { minLength: 10, maxLength: 20 }),
).map(([shapes, queries, picks, after]) => [
  ...shapes.map((s): Op => ({ op: "add", shape: s, reuse: null, sameAs: null })),
  ...queries,
  { op: "removeMultiple", picks },
  ...after,
]);
const denseRuns = { numRuns: 30 };

/**
 * Sparse sequences moved and resized, so that coordinates round: far from the
 * origin, near the in-range limit, tiny, huge, and off the binary grid. Each
 * operation is moved by one of up to three transforms, so one locator holds
 * shapes at very different scales. The rules still hold exactly, because the
 * ghost state asks the shapes themselves.
 */
const transform = fc.constantFrom(
  { scale: 1, x: 1e15, y: -1e15 },
  { scale: 1, x: 0.1, y: 0.3 },
  { scale: 3.7, x: -3.3e7, y: 1.1e9 },
  { scale: 1e-6, x: 0, y: 0 },
  { scale: 1e-6, x: 1, y: 1 },
  { scale: 1e290, x: 0, y: 0 },
  { scale: 1, x: 9e299, y: -9e299 },
  { scale: 1e283, x: 9e299, y: 9e299 },
  { scale: 100, x: 3e17, y: -5e17 }, // beyond 2^53, so a root grown from the origin rounds
  { scale: 1e20, x: 1e35, y: -7e33 },
);
type Transform = { scale: number; x: number; y: number };
const movePoint = (t: Transform, p: Point): Point => ({ x: p.x * t.scale + t.x, y: p.y * t.scale + t.y });
const moveRect = (t: Transform, r: Rectangle): Rectangle =>
  ({ ...movePoint(t, r), width: r.width * t.scale, height: r.height * t.scale });
const moveShape = (t: Transform, s: Shape): Shape =>
  (s instanceof TestBox ? new TestBox(moveRect(t, s.box)) : new TestTriangle(moveRect(t, (s as TestTriangle).box)));
const moveOp = (t: Transform, op: Op): Op => {
  switch (op.op) {
    case "add": return { ...op, shape: moveShape(t, op.shape) };
    case "inRect": return { ...op, r: moveRect(t, op.r) };
    case "atPoint": return { ...op, p: movePoint(t, op.p) };
    default: return op;
  }
};
const movedRuns = { numRuns: 300 };

/**
 * Half the moved sequences start with a shape at the origin, so that a tree's
 * root must grow out to the moved shapes; the rest start far out.
 */
const origin: Op = { op: "add", shape: new TestBox({ x: 0, y: 0, width: 1, height: 1 }), reuse: null, sameAs: null };
const moved: fc.Arbitrary<Op[]> = fc.tuple(
  sparse,
  fc.array(transform, { minLength: 1, maxLength: 3 }),
  fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
  fc.boolean(),
).map(([ops, ts, picks, fromOrigin]) =>
  [...(fromOrigin ? [origin] : []), ...ops.map((op, i) => moveOp(ts[picks[i] % ts.length], op))]);

interface Step {
  op: Op;
  locator: ShapeLocator;
  before: ReadonlyMap<ShapeId, Shape>;
  after: ReadonlyMap<ShapeId, Shape>;
  /** For add, the ID added; for removals, the IDs listed; for queries, the out array itself. */
  ids: ShapeId[];
  result: unknown;
  outBefore: ShapeId[];
}

/** Runs ops against a fresh locator, calling check after each one. */
function run(make: () => ShapeLocator, opList: Op[], check: (s: Step) => void): void {
  const locator = make();
  const indexed = new Map<ShapeId, Shape>();
  const added: Shape[] = [];
  let nextId = 1;
  const pickId = (n: number) => (n % nextId) as ShapeId; // 0 is never added
  for (const op of opList) {
    const before = new Map(indexed);
    let ids: ShapeId[] = [];
    let result: unknown;
    let outBefore: ShapeId[] = [];
    switch (op.op) {
      case "add": {
        const reused = op.reuse === null ? 0 : pickId(op.reuse);
        const id = reused !== 0 && !indexed.has(reused) ? reused : nextId++ as ShapeId;
        const s = op.sameAs !== null && added.length > 0 ? added[op.sameAs % added.length] : op.shape;
        locator.add(id, s);
        indexed.set(id, s);
        added.push(s);
        ids = [id];
        break;
      }
      case "remove":
        ids = [pickId(op.pick)];
        result = locator.remove(ids[0]);
        indexed.delete(ids[0]);
        break;
      case "removeMultiple":
        ids = op.picks.map(pickId);
        result = locator.removeMultiple(ids);
        for (const id of ids) indexed.delete(id);
        break;
      case "inRect": {
        const out = op.prefill.map(pickId);
        outBefore = [...out];
        result = locator.inRect(op.r, out);
        ids = out;
        break;
      }
      case "atPoint": {
        const out = op.prefill.map(pickId);
        outBefore = [...out];
        result = locator.atPoint(op.p, out);
        ids = out;
        break;
      }
    }
    check({ op, locator, before, after: new Map(indexed), ids, result, outBefore });
  }
}

function matching(indexed: ReadonlyMap<ShapeId, Shape>, op: Op): ShapeId[] {
  return [...indexed]
    .filter(([, s]) => (op.op === "inRect" ? s.intersects(op.r) : op.op === "atPoint" && s.contains(op.p)))
    .map(([id]) => id);
}

/** A rectangle covering every shape the suite uses. */
const everywhere: Rectangle = { x: -1e300, y: -1e300, width: 2e300, height: 2e300 };

/**
 * The input classes one sequence reaches, for the coverage test: kinds of
 * removal and add, shape kinds, query results, and for moved sequences the
 * coordinate ranges where rounding happens.
 */
function labelsOf(make: () => ShapeLocator, opList: Op[]): Set<string> {
  const seen = new Set<string>();
  const ever = new Set<ShapeId>();
  const magnitudes: number[] = [];
  const widths: number[] = [];
  const noteRect = (r: Rectangle) => {
    magnitudes.push(Math.abs(r.x), Math.abs(r.y));
    if (r.width > 0) widths.push(r.width);
    if (!Number.isInteger(r.x * 1024) || !Number.isInteger(r.y * 1024)) seen.add("off-grid");
  };
  if (opList[0]?.op === "add" && opList[0].shape.boundingBox().x !== 0) seen.add("first shape not at origin");
  run(make, opList, (s) => {
    const op = s.op;
    switch (op.op) {
      case "add": {
        const shape = s.after.get(s.ids[0])!;
        noteRect(shape.boundingBox());
        if (ever.has(s.ids[0])) seen.add("add reuses removed ID");
        if (op.sameAs !== null && s.before.size > 0 && [...s.before.values()].includes(shape)) seen.add("add same shape twice");
        if (isEmpty(shape.boundingBox())) seen.add("empty shape");
        if (shape instanceof TestTriangle) seen.add("triangle");
        ever.add(s.ids[0]);
        break;
      }
      case "remove":
      case "removeMultiple":
        for (const id of s.ids) {
          seen.add(s.before.has(id) ? "remove present" : ever.has(id) ? "remove removed" : "remove unknown");
        }
        if (op.op === "removeMultiple" && s.ids.length !== new Set(s.ids).size) seen.add("batch lists an ID twice");
        if (op.op === "removeMultiple" && s.before.size >= 20 && (s.result as number) * 2 >= s.before.size) seen.add("batch removes half of many");
        break;
      case "inRect":
      case "atPoint":
        if (op.op === "inRect") noteRect(op.r);
        if (s.ids.length > s.outBefore.length) seen.add(`${op.op} finds something`);
        if (s.outBefore.length > 0) seen.add("out starts non-empty");
        if ([...s.after.values()].some((shape) => isEmpty(shape.boundingBox()))) seen.add("query while an empty shape is indexed");
        break;
    }
    if (s.after.size >= 100) seen.add("100 shapes indexed");
  });
  const big = Math.max(0, ...magnitudes);
  if (big > 2 ** 53) seen.add("beyond 2^53");
  if (big > 1e299) seen.add("near the in-range limit");
  if (widths.some((w) => w < 1e-3)) seen.add("tiny shapes");
  if (widths.length > 1 && Math.max(...widths) / Math.min(...widths) > 1e6) seen.add("scales 1e6 apart");
  return seen;
}

export function shapeLocatorContract(make: () => ShapeLocator): void {
  /** Checks a rule after every step of sparse and dense sequences. */
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      for (const [ops, params] of [[sparse, {}], [dense, denseRuns], [moved, movedRuns]] as const) {
        fc.assert(fc.property(ops, (opList) => {
          run(make, opList, (s) => assert.ok(check(s), id));
        }), params);
      }
    });

  describe("ShapeLocator", () => {
    for (const query of ["inRect", "atPoint"] as const) {
      const queryRule = (slug: string, check: (s: Step) => boolean) =>
        rule(`ShapeLocatorQueries.${query}.${slug}`, (s) => s.op.op !== query || check(s));
      queryRule("exact", (s) => sameSet(s.ids.slice(s.outBefore.length), matching(s.after, s.op)));
      queryRule("once", (s) => unique(s.ids.slice(s.outBefore.length)));
      queryRule("append", (s) => s.outBefore.every((id, i) => s.ids[i] === id));
      queryRule("count", (s) => s.result === s.ids.length - s.outBefore.length);
    }

    rule("ShapeLocatorQueries.read-only", (s) => {
      // After a query, the locator still holds exactly the indexed shapes:
      // a query covering everything finds them, probes at points inside each
      // bounding box find exactly the shapes that contain them, and every
      // indexed ID, empty shapes included, can be removed. Each is added back
      // at once, so the sequence goes on with the same shapes indexed.
      if (s.op.op !== "inRect" && s.op.op !== "atPoint") return true;
      const out: ShapeId[] = [];
      s.locator.inRect(everywhere, out);
      if (!sameSet(out, [...s.after].filter(([, shape]) => shape.intersects(everywhere)).map(([id]) => id))) return false;
      for (const [, shape] of s.after) {
        const b = shape.boundingBox();
        // The top-left corner is in every non-empty test shape; the point
        // near the bottom-right corner is outside every triangle.
        for (const p of [{ x: b.x, y: b.y }, { x: b.x + b.width * 0.9, y: b.y + b.height * 0.9 }]) {
          const found: ShapeId[] = [];
          s.locator.atPoint(p, found);
          if (!sameSet(found, matching(s.after, { op: "atPoint", p, prefill: [] }))) return false;
        }
      }
      for (const [id, shape] of s.after) {
        if (!s.locator.remove(id)) return false;
        s.locator.add(id, shape);
      }
      return true;
    });

    rule("ShapeLocator.add.indexed", (s) => {
      if (s.op.op !== "add") return true;
      const shape = s.after.get(s.ids[0])!;
      const box = shape.boundingBox();
      const out: ShapeId[] = [];
      s.locator.inRect(box, out);
      return !shape.intersects(box) || out.includes(s.ids[0]);
    });

    rule("ShapeLocator.remove.result", (s) => s.op.op !== "remove" || s.result === s.before.has(s.ids[0]));

    rule("ShapeLocator.remove.gone", (s) => {
      if (s.op.op !== "remove" && s.op.op !== "removeMultiple") return true;
      const out: ShapeId[] = [];
      s.locator.inRect(everywhere, out);
      return s.ids.every((id) => !out.includes(id));
    });

    rule("ShapeLocator.removeMultiple.count",
      (s) => s.op.op !== "removeMultiple" || s.result === s.before.size - s.after.size);

    test("ShapeLocatorQueries.no-retain", () => {
      // Every out array a query filled must keep its contents through all later operations.
      for (const [ops, params] of [[sparse, {}], [dense, denseRuns], [moved, movedRuns]] as const) {
        fc.assert(fc.property(ops, (opList) => {
          const filled: [ShapeId[], ShapeId[]][] = [];
          run(make, opList, (s) => {
            for (const [out, copy] of filled) assert.deepEqual(out, copy, "ShapeLocatorQueries.no-retain");
            if (s.op.op === "inRect" || s.op.op === "atPoint") filled.push([s.ids, [...s.ids]]);
          });
        }), params);
      }
    });

    test("ShapeLocator.removeMultiple.same-as-remove", () => {
      // Two locators get the same shapes; one removes with removeMultiple and
      // the other with remove() in a shuffled order. Every query must agree.
      fc.assert(fc.property(
        fc.array(shape, { minLength: 1, maxLength: 20 }),
        fc.array(fc.nat(), { maxLength: 10 }),
        fc.array(rect(grid), { minLength: 1, maxLength: 5 }),
        fc.array(point(grid), { minLength: 1, maxLength: 5 }),
        (shapes, picks, rects, points) => {
          const a = make();
          const b = make();
          shapes.forEach((s, i) => {
            a.add((i + 1) as ShapeId, s);
            b.add((i + 1) as ShapeId, s);
          });
          const ids = picks.map((n) => (n % (shapes.length + 2)) as ShapeId);
          const removedA = a.removeMultiple(ids);
          let removedB = 0;
          for (const id of [...ids].reverse()) if (b.remove(id)) removedB++;
          assert.equal(removedA, removedB, "same number removed");
          for (const r of rects) {
            const oa: ShapeId[] = [];
            const ob: ShapeId[] = [];
            a.inRect(r, oa);
            b.inRect(r, ob);
            assert.ok(sameSet(oa, ob), "inRect agrees");
          }
          for (const p of points) {
            const oa: ShapeId[] = [];
            const ob: ShapeId[] = [];
            a.atPoint(p, oa);
            b.atPoint(p, ob);
            assert.ok(sameSet(oa, ob), "atPoint agrees");
          }
        }));
    });

    test("ShapeLocator.any-extent", () => {
      const far = 1e15;
      const shapes: Rectangle[] = [
        { x: 0, y: 0, width: 0, height: 0 }, // empty, and first
        { x: far, y: far, width: 1, height: 1 },
        { x: -far, y: -far, width: 1, height: 1 },
        { x: 0.25, y: 0.25, width: 0.001, height: 0.001 },
        { x: -far, y: 0, width: 2 * far, height: 1 },
        { x: 0, y: 0, width: 1, height: 1 },
        { x: -1e300, y: -1e300, width: 1e299, height: 1e299 }, // at the in-range limit
        { x: 9e299, y: 9e299, width: 1e299, height: 1e299 },
        { x: 9e299, y: -1e300, width: 1e299, height: 2e300 },
      ];
      const locator = make();
      shapes.forEach((r, i) => locator.add((i + 1) as ShapeId, new TestBox(r)));
      shapes.forEach((r, i) => {
        if (isEmpty(r)) return;
        const out: ShapeId[] = [];
        locator.inRect(r, out);
        assert.ok(out.includes((i + 1) as ShapeId), `finds shape ${i + 1} by rectangle`);
        const atPointOut: ShapeId[] = [];
        locator.atPoint({ x: r.x, y: r.y }, atPointOut);
        assert.ok(atPointOut.includes((i + 1) as ShapeId), `finds shape ${i + 1} by point`);
      });
      const out: ShapeId[] = [];
      locator.inRect(everywhere, out);
      assert.ok(sameSet(out, [2, 3, 4, 5, 6, 7, 8, 9] as ShapeId[]), "one huge query finds every non-empty shape");
      assert.equal(locator.remove(1 as ShapeId), true, "the empty shape was indexed");

      // More shapes at one spot than any cell holds, so a tree can't separate them by splitting.
      for (const r of [{ x: 1, y: 1, width: 0, height: 0 }, { x: 1, y: 1, width: 0.5, height: 0.5 }]) {
        const locator = make();
        for (let i = 1; i <= 40; i++) locator.add(i as ShapeId, new TestBox(r));
        const out: ShapeId[] = [];
        locator.inRect(everywhere, out);
        assert.equal(out.length, isEmpty(r) ? 0 : 40, `40 copies of ${JSON.stringify(r)}`);
        assert.equal(locator.removeMultiple(Array.from({ length: 40 }, (_, i) => (i + 1) as ShapeId)), 40);
      }
    });

    test("ShapeLocator input coverage", () => {
      const labels = (opList: Op[]) => labelsOf(make, opList);
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sparse", sparse, labels, {
        "remove present": 0.45, "remove removed": 0.25, "remove unknown": 0.4, "batch lists an ID twice": 0.3,
        "add reuses removed ID": 0.3, "add same shape twice": 0.45, "empty shape": 0.1, "triangle": 0.35,
        "inRect finds something": 0.3, "atPoint finds something": 0.1, "out starts non-empty": 0.5,
        "query while an empty shape is indexed": 0.1,
      });
      // Only about 1 in 8 dense sequences removes half the cluster at once.
      coverage("dense", dense, labels, { "100 shapes indexed": 0.9, "batch removes half of many": 0.03 }, 60);
      coverage("moved", moved, labels, {
        "beyond 2^53": 0.35, "near the in-range limit": 0.15, "tiny shapes": 0.1, "off-grid": 0.25,
        "scales 1e6 apart": 0.25, "first shape not at origin": 0.1,
      });
    });
  });
}
