// Contract tests for ShapeView (shapeView.ts) and the View rules it can be
// checked against (view.ts). Every ShapeView implementation runs this suite,
// whatever surface it draws on: its fixture reports what each point shows.
// Test names are rule IDs.
//
// The suite builds a scene of one to three ListGroups (viewkit.ts), and a
// view of it driven by a ManualScheduler. Random sequences add and remove
// circles, run frames and read the view; some sequences dispose of the view
// partway.
// After every step the rules are checked at every half-integer point of a
// 12 x 12 surface. Centers and radii are integers, so no sample
// point is ever on a circle's edge or at its maximum x or y.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape } from "./shape.ts";
import type { ShapeView } from "./shapeView.ts";
import type { ItemId, Scene } from "./view.ts";
import type { FrameScheduler } from "./frames.ts";
import { circles, deepEqual, over, validViewport } from "./shapeView.vocab.ts";
import { coverage } from "./testkit.ts";
import { ListGroup, ManualScheduler, testCircle } from "./viewkit.ts";

/** A view, and what its surface shows at each point. */
export interface ShapeViewFixture {
  view: ShapeView;
  painted(p: Point): Color;
}

export type MakeShapeView = (scene: Scene<Shape>, scheduler: FrameScheduler, width: number, height: number) => ShapeViewFixture;

const width = 12;
const height = 12;
const samples: Point[] = Array.from({ length: width * height }, (_, i) => ({ x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 }));

const color: fc.Arbitrary<Color> = fc.constantFrom(
  { r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 128, b: 255, a: 1 }, { r: 20, g: 200, b: 60, a: 1 },
  { r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 0, a: 0.25 }, { r: 90, g: 30, b: 200, a: 0.75 },
);

type Op =
  | { op: "add"; group: number; center: Point; radius: number; color: Color }
  | { op: "remove"; group: number; pick: number }
  | { op: "frame" }
  | { op: "read" }
  | { op: "dispose" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      group: fc.nat(),
      center: fc.record({ x: fc.integer({ min: -2, max: width + 2 }), y: fc.integer({ min: -2, max: height + 2 }) }),
      radius: fc.integer({ min: 1, max: 5 }),
      color,
    }).map((a): Op => ({ op: "add", ...a })),
  },
  { weight: 2, arbitrary: fc.record({ group: fc.nat(), pick: fc.nat() }).map((a): Op => ({ op: "remove", ...a })) },
  { weight: 3, arbitrary: fc.constant<Op>({ op: "frame" }) },
  { weight: 1, arbitrary: fc.constant<Op>({ op: "read" }) },
);

/** A group count, and ops; a third of sequences dispose of the view partway. */
const sequence = fc.record({
  groups: fc.integer({ min: 1, max: 3 }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 30, size: "max" }),
  disposeAt: fc.option(fc.nat({ max: 29 }), { freq: 2 }),
}).map(({ groups, ops, disposeAt }) => ({
  groups,
  ops: disposeAt === null ? ops : [...ops.slice(0, disposeAt), { op: "dispose" } as Op, ...ops.slice(disposeAt)],
}));
type Sequence = { groups: number; ops: Op[] };

interface Step {
  op: Op;
  view: ShapeView;
  scene: Scene<Shape>;
  groups: ListGroup[];
  /** Whether dispose was called before this step. */
  disposed: boolean;
  /** Whether an edit changed a group during this step. */
  changing: boolean;
  /** Whether a change is still to be drawn after this step: true from creation, or a change, until a frame. */
  dirty: boolean;
  /** Whether the view had asked for a frame before and after the step. */
  requestedBefore: boolean;
  requestedAfter: boolean;
  /** What each sample point showed before and after the step. */
  before: Color[];
  after: Color[];
  /** Each group's listener count before and after the step. */
  listenersBefore: number[];
  listenersAfter: number[];
}

/** What each sample point should show for the scene as it is now. */
function expected(scene: Scene<Shape>): Color[] {
  const all = circles(scene);
  return samples.map((p) => over(all.filter((c) => c.contains(p)).map((c) => c.color)));
}

const sameColors = (a: Color[], b: Color[]) => a.every((c, i) => deepEqual(c, b[i]));
const sameCounts = (a: number[], b: number[]) => a.every((n, i) => n === b[i]);

/** Runs a sequence against a fresh view, calling check after each step. */
function run(make: MakeShapeView, seq: Sequence, check: (s: Step) => void): void {
  const groups = Array.from({ length: seq.groups }, () => new ListGroup());
  const scene: Scene<Shape> = { groups };
  const scheduler = new ManualScheduler();
  const { view, painted } = make(scene, scheduler, width, height);
  const look = () => samples.map(painted);
  const counts = () => groups.map((l) => l.listenerCount());
  const returned: ItemId[][] = groups.map(() => []);
  let disposed = false;
  let dirty = true;
  let shown = look();
  for (const op of seq.ops) {
    const before = shown;
    const requestedBefore = scheduler.isRequested(view);
    const listenersBefore = counts();
    let changing = false;
    switch (op.op) {
      case "add": {
        const i = op.group % groups.length;
        returned[i].push(groups[i].add(testCircle(op)));
        changing = true;
        break;
      }
      case "remove": {
        const i = op.group % groups.length;
        const ids = returned[i];
        // ids.length stands for an ID the group never returned.
        const n = op.pick % (ids.length + 1);
        changing = groups[i].remove(n < ids.length ? ids[n] : (1e9 as ItemId));
        break;
      }
      case "frame":
        scheduler.runFrame();
        dirty = false;
        break;
      case "read":
        void view.scene;
        void view.viewport;
        break;
      case "dispose":
        view.dispose();
        break;
    }
    if (changing) dirty = true;
    shown = look();
    check({
      op, view, scene, groups, disposed, changing, dirty, requestedBefore,
      requestedAfter: scheduler.isRequested(view), before, after: shown,
      listenersBefore, listenersAfter: counts(),
    });
    if (op.op === "dispose") disposed = true;
  }
}

/** The input classes one sequence reaches, for the coverage test. */
function labelsOf(make: MakeShapeView, seq: Sequence): Set<string> {
  const seen = new Set<string>();
  let changedGroups = new Set<number>();
  run(make, seq, (s) => {
    if (s.op.op === "add" && (s.op.center.x - s.op.radius < 0 || s.op.center.x + s.op.radius > width)) {
      seen.add("circle partly off the surface");
    }
    if (s.op.op === "dispose" && s.requestedBefore) seen.add("dispose with a frame pending");
    if (s.disposed && s.changing) seen.add("edit after dispose");
    if (s.disposed && s.op.op === "frame") seen.add("frame after dispose");
    if (s.disposed) return;
    if (s.changing && (s.op.op === "add" || s.op.op === "remove")) changedGroups.add(s.op.group % s.groups.length);
    if (s.op.op === "remove" && s.changing) seen.add("removal");
    if (s.op.op !== "frame") return;
    if (!s.requestedBefore) seen.add("frame with nothing changed");
    if (changedGroups.size >= 2) seen.add("two groups changed before a frame");
    changedGroups = new Set();
    const all = circles(s.scene);
    const owner = new Map<Circle, number>();
    s.groups.forEach((group, i) => group.forEach((_, c) => owner.set(c as Circle, i)));
    for (const p of samples) {
      const here = all.filter((c) => c.contains(p));
      if (here.length < 2) continue;
      if (here.at(-1)!.color.a < 1) seen.add("translucent circle over another");
      if (new Set(here.map((c) => owner.get(c))).size >= 2) seen.add("circles overlap across groups");
      if (here.some((c, i) => i > 0 && owner.get(c) === owner.get(here[i - 1]) && !deepEqual(c.color, here[i - 1].color))) {
        seen.add("circles of different colors overlap within a group");
      }
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
      fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), (n) => {
        const scheduler = new ManualScheduler();
        const { view } = make({ groups: Array.from({ length: n }, () => new ListGroup()) }, scheduler, width, height);
        return scheduler.isRequested(view);
      }));
    });

    // ShapeView has only the identity viewport, so the equal value is a copy of it.
    test("View.viewport.set-equal", () => {
      fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), (n) => {
        const scheduler = new ManualScheduler();
        const { view } = make({ groups: Array.from({ length: n }, () => new ListGroup()) }, scheduler, width, height);
        scheduler.runFrame();
        const emitted: unknown[] = [];
        view.on("viewport", (v) => emitted.push(v));
        view.viewport = { ...view.viewport };
        return !scheduler.isRequested(view) && emitted.length === 0;
      }));
    });

    rule("ShapeView.frame.paints", (s) => s.op.op !== "frame" || s.disposed || sameColors(s.after, expected(s.scene)));

    rule("View.group-change", (s) => !s.changing || s.disposed || (s.requestedAfter && sameColors(s.after, s.before)));

    rule("View.idle", (s) => s.disposed || s.dirty || !s.requestedAfter);

    rule("Viewport.positive-scale", (s) => validViewport(s.view.viewport));

    rule("View.one-listener", (s) => s.disposed || s.op.op === "dispose" || s.listenersAfter.every((n) => n === 1));

    rule("View.read-only", (s) => s.op.op !== "read" ||
      (sameColors(s.after, s.before) && s.requestedAfter === s.requestedBefore && sameCounts(s.listenersAfter, s.listenersBefore)));

    rule("View.dispose.detaches", (s) => {
      if (!s.disposed && s.op.op !== "dispose") return true;
      return s.listenersAfter.every((n) => n === 0) && (!s.changing || s.requestedAfter === s.requestedBefore);
    });

    rule("View.dispose.inert", (s) => !s.disposed || sameColors(s.after, s.before));

    test("ShapeView input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sequence", sequence, (seq) => labelsOf(make, seq), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "circle partly off the surface": 0.39, "circles of different colors overlap within a group": 0.09,
  "circles overlap across groups": 0.07, "dispose with a frame pending": 0.16, "edit after dispose": 0.09,
  "frame after dispose": 0.09, "frame with nothing changed": 0.22, "removal": 0.19,
  "translucent circle over another": 0.08, "two groups changed before a frame": 0.11,
};
