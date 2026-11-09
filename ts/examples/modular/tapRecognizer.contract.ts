// Contract tests for TapRecognizer (pointer.ts). Every recognizer runs this
// suite. Test names are rule IDs.
//
// Each run nests a region at an offset in a reference root (routerkit.ts),
// makes a recognizer on it with a random slop, and delivers random presses:
// a down inside or outside the region, moves that stay within the slop or
// wander past it and maybe come back, and an up near or far, plus hover
// moves, stray ups, and in some runs dispose. The suite works out from the
// rules which presses are taps.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Region, TapRecognizer } from "./pointer.ts";
import { deepEqual, rectContains } from "./pointer.vocab.ts";
import { coverage } from "./testkit.ts";
import { KitRegion, RefRootRegion } from "./routerkit.ts";

export type MakeTaps = (region: Region, slop: number) => TapRecognizer;

const origin = { x: 20, y: 10 };
const area = { x: 20, y: 10, width: 40, height: 30 };

type Press = {
  kind: "press";
  down: Point;
  /** Offsets from the down, in units, for the moves and then the up. */
  moves: Point[];
  up: Point;
};
type Op = Press | { kind: "hover"; at: Point } | { kind: "stray-up"; at: Point } | { kind: "dispose" };

const offset = fc.record({ x: fc.integer({ min: -12, max: 12 }), y: fc.integer({ min: -12, max: 12 }) }).map(({ x, y }) => ({ x: x / 2, y: y / 2 }));
const windowPoint = fc.record({ x: fc.integer({ min: 0, max: 80 }), y: fc.integer({ min: 0, max: 50 }) });
/** Mostly inside the region, near its edges as often as not; sometimes anywhere. */
const downPoint = fc.oneof(
  { weight: 3, arbitrary: fc.record({ x: fc.integer({ min: area.x, max: area.x + area.width - 1 }), y: fc.integer({ min: area.y, max: area.y + area.height - 1 }) }) },
  { weight: 2, arbitrary: fc.record({ x: fc.constantFrom(area.x, area.x + 1, area.x + area.width - 1), y: fc.integer({ min: area.y, max: area.y + area.height - 1 }) }) },
  { weight: 1, arbitrary: windowPoint },
);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({ down: downPoint, moves: fc.array(offset, { maxLength: 3 }), up: offset })
      .map((p): Op => ({ kind: "press", ...p })),
  },
  { weight: 1, arbitrary: windowPoint.map((at): Op => ({ kind: "hover", at })) },
  { weight: 1, arbitrary: windowPoint.map((at): Op => ({ kind: "stray-up", at })) },
);
const runArb = fc.record({
  slop: fc.integer({ min: 0, max: 8 }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 12 }),
  disposeAt: fc.option(fc.nat({ max: 11 }), { freq: 4 }),
}).map(({ slop, ops, disposeAt }) => ({
  slop,
  ops: disposeAt === null ? ops : [...ops.slice(0, disposeAt), { kind: "dispose" } as Op, ...ops.slice(disposeAt)],
}));
type Run = { slop: number; ops: Op[] };

interface Step {
  op: Op;
  slop: number;
  disposed: boolean;
  /** Where the recognizer should emit tap, in the region's coordinates, if anywhere. */
  expected: Point | undefined;
  tapped: Point[];
  /** Whether a tap had been emitted before the step's up was delivered. */
  early: boolean;
  region: KitRegion;
}

const local = (p: Point): Point => ({ x: p.x - origin.x, y: p.y - origin.y });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function run(make: MakeTaps, r: Run, check: (s: Step) => void): void {
  const root = new RefRootRegion(80, 50);
  const region = root.add(area) as KitRegion;
  const taps = make(region, r.slop);
  let tapped: Point[] = [];
  taps.on("tap", (p) => tapped.push(p));
  let disposed = false;
  let t = 0;
  for (const op of r.ops) {
    tapped = [];
    let expected: Point | undefined;
    let early = false;
    switch (op.kind) {
      case "press": {
        const at = (o: Point) => ({ x: op.down.x + o.x, y: op.down.y + o.y });
        root.deliver("down", op.down, (t += 5));
        for (const m of op.moves) root.deliver("move", at(m), (t += 5));
        early = tapped.length > 0;
        root.deliver("up", at(op.up), (t += 5));
        const inside = rectContains(area, op.down);
        const still = [...op.moves, op.up].every((o) => dist(o, { x: 0, y: 0 }) <= r.slop);
        if (!disposed && inside && still) expected = local(op.down);
        break;
      }
      case "hover":
        root.deliver("move", op.at, (t += 5));
        break;
      case "stray-up":
        root.deliver("up", op.at, (t += 5));
        break;
      case "dispose":
        taps.dispose();
        taps.dispose();
        break;
    }
    check({ op, slop: r.slop, disposed: disposed || op.kind === "dispose", expected, tapped, early, region });
    if (op.kind === "dispose") disposed = true;
  }
}

function labelsOf(make: MakeTaps, r: Run): Set<string> {
  const seen = new Set<string>();
  run(make, r, (s) => {
    if (s.op.kind !== "press") return;
    const inside = rectContains(area, s.op.down);
    if (!inside) seen.add("press outside the region");
    else if (s.expected) seen.add(s.op.moves.length > 0 ? "tap with moves within the slop" : "tap with no moves");
    else if (s.disposed) seen.add("press after dispose");
    else if (s.op.moves.some((m) => dist(m, { x: 0, y: 0 }) > s.slop) && dist(s.op.up, { x: 0, y: 0 }) <= s.slop) seen.add("wandered away and came back");
    else seen.add("up too far");
    if (s.expected && !rectContains(area, { x: s.op.down.x + s.op.up.x, y: s.op.down.y + s.op.up.y })) seen.add("tap whose up is outside the region");
  });
  return seen;
}

export function tapRecognizerContract(make: MakeTaps): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (r) => {
        run(make, r, (s) => assert.ok(check(s), id));
      }));
    });

  describe("TapRecognizer", () => {
    test("TapRecognizer.taps", () => {
      // Random offsets rarely land exactly on the slop, so also press with moves and an up at exactly that distance.
      const exact = fc.tuple(fc.integer({ min: 1, max: 4 }), fc.constantFrom(0, 1, 2, 3), fc.boolean()).map(([k, dir, diagonal]) => {
        const [a, b] = diagonal ? [3 * k, 4 * k] : [5 * k, 0];
        const turns = [[a, b], [-b, a], [-a, -b], [b, -a]][dir];
        return { slop: 5 * k, offset: { x: turns[0], y: turns[1] } };
      });
      fc.assert(fc.property(exact, fc.boolean(), ({ slop, offset }, viaMove) => {
        const root = new RefRootRegion(80, 50);
        const region = root.add(area);
        const taps = make(region, slop);
        const got: Point[] = [];
        taps.on("tap", (p) => got.push(p));
        const down = { x: 40, y: 25 };
        const edge = { x: down.x + offset.x, y: down.y + offset.y };
        root.deliver("down", down, 1);
        if (viaMove) root.deliver("move", edge, 2);
        root.deliver("up", viaMove ? down : edge, 3);
        return deepEqual(got, [local(down)]);
      }));
      fc.assert(fc.property(runArb, (r) => {
        run(make, r, (s) => assert.ok(!s.expected || (deepEqual(s.tapped, [s.expected]) && !s.early)));
      }));
    });

    rule("TapRecognizer.only-taps", (s) => s.expected !== undefined || s.tapped.length === 0);

    rule("TapRecognizer.one-listener", (s) => s.disposed ||
      (s.region.listenerCount("down") === 1 && s.region.listenerCount("move") === 1 && s.region.listenerCount("up") === 1));

    rule("TapRecognizer.dispose.detaches", (s) => !s.disposed ||
      (s.region.listenerCount("down") === 0 && s.region.listenerCount("move") === 0 && s.region.listenerCount("up") === 0 && s.tapped.length === 0));

    test("TapRecognizer input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("run", runArb, (r) => labelsOf(make, r), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "press after dispose": 0.18, "press outside the region": 0.2, "tap whose up is outside the region": 0.07,
  "tap with moves within the slop": 0.12, "tap with no moves": 0.1, "up too far": 0.3, "wandered away and came back": 0.1,
};
