// Contract tests for ShapeView (shapeView.ts) and the View rules it can be
// checked against (view.ts). Every ShapeView implementation runs this suite,
// whatever surface it draws on: its fixture reports what each point shows.
// Test names are rule IDs.
//
// The suite gives the view the read side of a RefShapeWriter
// (shapewriterkit.ts), and drives the view with a ManualScheduler. Random
// sequences add circles (on top, or below a present one, as a remote add
// can be) and remove them, run frames and read the view; some sequences
// dispose of the view partway.
// After every step the rules are checked at every half-integer point of a
// 12 x 12 surface. Centers and radii are integers, so no sample
// point is ever on a circle's edge or at its maximum x or y.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { ShapeId } from "./shape.ts";
import type { ShapeCollection } from "./shapeModel.ts";
import type { ShapeView } from "./shapeView.ts";
import type { FrameScheduler } from "./frames.ts";
import { circles, deepEqual, over, validViewport } from "./shapeView.vocab.ts";
import { coverage } from "./testkit.ts";
import { ManualScheduler, testCircle } from "./viewkit.ts";
import { readFacet, RefShapeWriter } from "./shapewriterkit.ts";

/** A view, and what its surface shows at each point. */
export interface ShapeViewFixture {
  view: ShapeView;
  painted(p: Point): Color;
}

export type MakeShapeView = (model: ShapeCollection, scheduler: FrameScheduler, width: number, height: number) => ShapeViewFixture;

const width = 12;
const height = 12;
const samples: Point[] = Array.from({ length: width * height }, (_, i) => ({ x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 }));

const color: fc.Arbitrary<Color> = fc.constantFrom(
  { r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 128, b: 255, a: 1 }, { r: 20, g: 200, b: 60, a: 1 },
  { r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 0, a: 0.25 }, { r: 90, g: 30, b: 200, a: 0.75 },
);

type Op =
  | { op: "add"; below: number | null; center: Point; radius: number; color: Color }
  | { op: "remove"; pick: number }
  | { op: "frame" }
  | { op: "read" }
  | { op: "dispose" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      below: fc.option(fc.nat(), { freq: 3 }),
      center: fc.record({ x: fc.integer({ min: -2, max: width + 2 }), y: fc.integer({ min: -2, max: height + 2 }) }),
      radius: fc.integer({ min: 1, max: 5 }),
      color,
    }).map((a): Op => ({ op: "add", ...a })),
  },
  { weight: 2, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick })) },
  { weight: 3, arbitrary: fc.constant<Op>({ op: "frame" }) },
  { weight: 1, arbitrary: fc.constant<Op>({ op: "read" }) },
);

/** Ops; a third of sequences dispose of the view partway. */
const sequence = fc.record({
  ops: fc.array(opArb, { minLength: 1, maxLength: 30, size: "max" }),
  disposeAt: fc.option(fc.nat({ max: 29 }), { freq: 2 }),
}).map(({ ops, disposeAt }) =>
  disposeAt === null ? ops : [...ops.slice(0, disposeAt), { op: "dispose" } as Op, ...ops.slice(disposeAt)]);
type Sequence = Op[];

interface Step {
  op: Op;
  view: ShapeView;
  model: ShapeCollection;
  /** Whether dispose was called before this step. */
  disposed: boolean;
  /** Whether an edit changed the model during this step. */
  changing: boolean;
  /** Whether a change is still to be drawn after this step: true from creation, or a change, until a frame. */
  dirty: boolean;
  /** Whether the view had asked for a frame before and after the step. */
  requestedBefore: boolean;
  requestedAfter: boolean;
  /** What each sample point showed before and after the step. */
  before: Color[];
  after: Color[];
  /** The model's listener count before and after the step. */
  listenersBefore: number;
  listenersAfter: number;
}

/** What each sample point should show for the model as it is now. */
function expected(model: ShapeCollection): Color[] {
  const all = circles(model);
  return samples.map((p) => over(all.filter((c) => c.contains(p)).map((c) => c.color)));
}

const sameColors = (a: Color[], b: Color[]) => a.every((c, i) => deepEqual(c, b[i]));

/** Runs a sequence against a fresh view, calling check after each step. */
function run(make: MakeShapeView, seq: Sequence, check: (s: Step) => void): void {
  const writer = new RefShapeWriter();
  const model = readFacet(writer);
  const scheduler = new ManualScheduler();
  const { view, painted } = make(model, scheduler, width, height);
  const look = () => samples.map(painted);
  const counts = () => writer.listenerCount("change");
  const made: ShapeId[] = [];
  let disposed = false;
  let dirty = true;
  let shown = look();
  for (const op of seq) {
    const before = shown;
    const requestedBefore = scheduler.isRequested(view);
    const listenersBefore = counts();
    let changing = false;
    switch (op.op) {
      case "add": {
        const id = `v${made.length}` as ShapeId;
        const present: ShapeId[] = [];
        writer.forEach((i) => present.push(i));
        const below = op.below === null || present.length === 0 ? undefined : present[op.below % present.length];
        writer.add(id, testCircle(op), below);
        made.push(id);
        changing = true;
        break;
      }
      case "remove": {
        // made.length stands for an ID the model never had.
        const n = op.pick % (made.length + 1);
        changing = writer.remove([n < made.length ? made[n] : ("never" as ShapeId)]) > 0;
        break;
      }
      case "frame":
        scheduler.runFrame();
        dirty = false;
        break;
      case "read":
        void view.model;
        void view.viewport;
        break;
      case "dispose":
        view.dispose();
        break;
    }
    if (changing) dirty = true;
    shown = look();
    check({
      op, view, model, disposed, changing, dirty, requestedBefore,
      requestedAfter: scheduler.isRequested(view), before, after: shown,
      listenersBefore, listenersAfter: counts(),
    });
    if (op.op === "dispose") disposed = true;
  }
}

/** The input classes one sequence reaches, for the coverage test. */
function labelsOf(make: MakeShapeView, seq: Sequence): Set<string> {
  const seen = new Set<string>();
  run(make, seq, (s) => {
    if (s.op.op === "add" && (s.op.center.x - s.op.radius < 0 || s.op.center.x + s.op.radius > width)) {
      seen.add("circle partly off the surface");
    }
    if (s.op.op === "dispose" && s.requestedBefore) seen.add("dispose with a frame pending");
    if (s.disposed && s.changing) seen.add("edit after dispose");
    if (s.disposed && s.op.op === "frame") seen.add("frame after dispose");
    if (s.disposed) return;
    if (s.op.op === "remove" && s.changing) seen.add("removal");
    if (s.op.op === "add" && s.op.below !== null && s.model.size >= 2) seen.add("add below another circle");
    if (s.op.op !== "frame") return;
    if (!s.requestedBefore) seen.add("frame with nothing changed");
    const all = circles(s.model);
    for (const p of samples) {
      const here = all.filter((c) => c.contains(p));
      if (here.length < 2) continue;
      if (here.at(-1)!.color.a < 1) seen.add("translucent circle over another");
      if (here.some((c, i) => i > 0 && !deepEqual(c.color, here[i - 1].color))) seen.add("circles of different colors overlap");
    }
  });
  return seen;
}

export function shapeViewContract(make: MakeShapeView): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(sequence, (seq) => {
        run(make, seq, (s) => assert.ok(check(s), id));
      }));
    });

  describe("ShapeView", () => {
    test("ShapeView.first-frame", () => {
      const scheduler = new ManualScheduler();
      const { view } = make(readFacet(new RefShapeWriter()), scheduler, width, height);
      assert.ok(scheduler.isRequested(view));
    });

    // ShapeView has only the identity viewport, so the equal value is a copy of it.
    test("View.viewport.set-equal", () => {
      const scheduler = new ManualScheduler();
      const { view } = make(readFacet(new RefShapeWriter()), scheduler, width, height);
      scheduler.runFrame();
      const emitted: unknown[] = [];
      view.on("viewport", (v) => emitted.push(v));
      view.viewport = { ...view.viewport };
      assert.ok(!scheduler.isRequested(view) && emitted.length === 0);
    });

    rule("ShapeView.frame.paints", (s) => s.op.op !== "frame" || s.disposed || sameColors(s.after, expected(s.model)));

    rule("View.model-change", (s) => !s.changing || s.disposed || (s.requestedAfter && sameColors(s.after, s.before)));

    rule("View.idle", (s) => s.disposed || s.dirty || !s.requestedAfter);

    rule("Viewport.positive-scale", (s) => validViewport(s.view.viewport));

    rule("View.one-listener", (s) => s.disposed || s.op.op === "dispose" || s.listenersAfter === 1);

    rule("View.read-only", (s) => s.op.op !== "read" ||
      (sameColors(s.after, s.before) && s.requestedAfter === s.requestedBefore && s.listenersAfter === s.listenersBefore));

    rule("View.dispose.detaches", (s) => {
      if (!s.disposed && s.op.op !== "dispose") return true;
      return s.listenersAfter === 0 && (!s.changing || s.requestedAfter === s.requestedBefore);
    });

    rule("View.dispose.inert", (s) => !s.disposed || sameColors(s.after, s.before));

    test("ShapeView input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sequence", sequence, (seq) => labelsOf(make, seq), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "add below another circle": 0.32, "circle partly off the surface": 0.41, "circles of different colors overlap": 0.17,
  "dispose with a frame pending": 0.16, "edit after dispose": 0.1,
  "frame after dispose": 0.1, "frame with nothing changed": 0.24, "removal": 0.25,
  "translucent circle over another": 0.12,
};
