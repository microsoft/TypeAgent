// Contract tests for RootRegion and Region (pointer.ts). Every router runs
// this suite. Test names are rule IDs.
//
// Each run makes a root for a 90 x 90 window, then applies a random
// sequence: carving child regions from cells of their parents, removing
// regions, registering and removing listeners for each kind, and
// delivering presses, releases and moves at points on a grid that includes
// region edges and points outside the window. The suite keeps its own model
// of the regions in window coordinates and works out, for every delivered
// event, which region should receive it.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { PointerEvent, PointerKind, Region, RootRegion } from "./pointer.ts";
import { deepEqual, insetRect, rectContains, rectIntersects, splitRect } from "./pointer.vocab.ts";
import { coverage } from "./testkit.ts";

export type MakeRoot = (width: number, height: number) => RootRegion;

const size = 90;
const kinds: PointerKind[] = ["down", "move", "up"];

interface Node {
  id: number;
  region: Region;
  /** Bounds in window coordinates. */
  win: Rectangle;
  parent: Node | undefined;
  children: Node[];
  removed: boolean;
  /** The suite's registrations on this region, per kind, oldest first. */
  listeners: Record<PointerKind, ((e: PointerEvent) => void)[]>;
}

type Op =
  | { op: "add"; parent: number; cols: number; rows: number; cell: number; inset: number }
  | { op: "remove"; pick: number; captor: boolean }
  | { op: "on"; pick: number; kind: PointerKind }
  | { op: "off"; pick: number; kind: PointerKind }
  | { op: "deliver"; kind: PointerKind; x: number; y: number };

const coord = fc.integer({ min: -2, max: 2 * size + 2 }).map((n) => n / 2);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({ parent: fc.nat(), cols: fc.integer({ min: 1, max: 3 }), rows: fc.integer({ min: 1, max: 3 }), cell: fc.nat(), inset: fc.nat({ max: 2 }) })
      .map((a): Op => ({ op: "add", ...a })),
  },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick, captor: false })) },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick, captor: true })) },
  { weight: 3, arbitrary: fc.record({ pick: fc.nat(), kind: fc.constantFrom(...kinds) }).map((a): Op => ({ op: "on", ...a })) },
  { weight: 1, arbitrary: fc.record({ pick: fc.nat(), kind: fc.constantFrom(...kinds) }).map((a): Op => ({ op: "off", ...a })) },
  {
    weight: 8,
    arbitrary: fc.record({ kind: fc.constantFrom<PointerKind>("down", "move", "move", "up"), x: coord, y: coord })
      .map((a): Op => ({ op: "deliver", ...a })),
  },
);
const runArb = fc.array(opArb, { minLength: 1, maxLength: 60, size: "max" });

/** One emit a suite listener saw. */
interface Seen {
  id: number;
  kind: PointerKind;
  event: PointerEvent;
}

interface Step {
  op: Op;
  /** For deliver: the kind actually delivered (a down during a press is delivered as a move), and where. */
  kind: PointerKind | undefined;
  point: Point | undefined;
  time: number;
  /** Whether a press was in progress before the step, and its capturer then. */
  pressing: boolean;
  captor: Node | undefined;
  /** The region the model says receives the event, if any. */
  expected: Node | undefined;
  seen: Seen[];
  nodes: Node[];
  added: { node: Node; rect: Rectangle } | undefined;
}

function run(make: MakeRoot, ops: Op[], check: (s: Step) => void): void {
  const root = make(size, size);
  let next = 0;
  let seen: Seen[] = [];
  const node = (region: Region, win: Rectangle, parent: Node | undefined): Node => ({
    id: next++, region, win, parent, children: [], removed: false, listeners: { down: [], move: [], up: [] },
  });
  const all: Node[] = [node(root, { x: 0, y: 0, width: size, height: size }, undefined)];
  const live = () => all.filter((n) => !n.removed);
  let pressing = false;
  let captor: Node | undefined;
  let time = 0;

  for (const op of ops) {
    seen = [];
    time += 7;
    let kind: PointerKind | undefined;
    let point: Point | undefined;
    let expected: Node | undefined;
    let added: Step["added"];
    const before = { pressing, captor };
    switch (op.op) {
      case "add": {
        const parent = live()[op.parent % live().length];
        const local = { x: 0, y: 0, width: parent.win.width, height: parent.win.height };
        const cols = splitRect(local, "horizontal", Array(op.cols).fill(1));
        const cells = cols.flatMap((c) => splitRect(c, "vertical", Array(op.rows).fill(1)));
        const rect = insetRect(cells[op.cell % cells.length], op.inset);
        const taken = parent.children.some((c) => rectIntersects(
          { ...c.win, x: c.win.x - parent.win.x, y: c.win.y - parent.win.y }, rect));
        if (rect.width === 0 || rect.height === 0 || taken) break;
        const region = parent.region.add(rect);
        const child = node(region, { ...rect, x: parent.win.x + rect.x, y: parent.win.y + rect.y }, parent);
        parent.children.push(child);
        all.push(child);
        added = { node: child, rect };
        break;
      }
      case "remove": {
        const candidates = live().slice(1);
        if (candidates.length === 0 || (op.captor && (!captor || captor.removed || !captor.parent))) break;
        const target = op.captor ? captor! : candidates[op.pick % candidates.length];
        target.region.remove();
        const mark = (n: Node) => {
          n.removed = true;
          n.children.forEach(mark);
        };
        mark(target);
        target.parent!.children = target.parent!.children.filter((c) => c !== target);
        break;
      }
      case "on": {
        const n = live()[op.pick % live().length];
        const id = n.id;
        const k = op.kind;
        const listener = (event: PointerEvent) => seen.push({ id, kind: k, event });
        n.listeners[k].push(listener);
        n.region.on(k, listener);
        break;
      }
      case "off": {
        const n = live()[op.pick % live().length];
        const listener = n.listeners[op.kind].pop();
        if (listener) n.region.off(op.kind, listener);
        break;
      }
      case "deliver": {
        kind = op.kind === "down" && pressing ? "move" : op.kind;
        point = { x: op.x, y: op.y };
        const has = (n: Node) => !n.removed && n.listeners[kind!].length > 0;
        if (pressing) {
          expected = captor && has(captor) ? captor : undefined;
          if (kind === "up") {
            pressing = false;
            captor = undefined;
          }
        } else {
          const path: Node[] = [];
          let at: Node | undefined = rectContains(all[0].win, point) ? all[0] : undefined;
          while (at) {
            path.push(at);
            at = at.children.find((c) => rectContains(c.win, point!));
          }
          expected = path.reverse().find(has);
          if (kind === "down") {
            pressing = true;
            captor = expected;
          }
        }
        root.deliver(kind, point, time);
        break;
      }
    }
    check({ op, kind, point, time, pressing: before.pressing, captor: before.captor, expected, seen, nodes: all, added });
  }
}

/** The region IDs that received the step's event, once per registration. */
const receivers = (s: Step) => s.seen.map((e) => e.id);
const expectedReceivers = (s: Step) => (s.expected ? Array(s.expected.listeners[s.kind!].length).fill(s.expected.id) : []);

function labelsOf(make: MakeRoot, ops: Op[]): Set<string> {
  const seen = new Set<string>();
  run(make, ops, (s) => {
    if (s.added && s.added.node.parent!.parent) seen.add("region two levels deep");
    if (s.op.op !== "deliver") return;
    if (!s.pressing && s.expected && s.expected.children.some((c) => rectContains(c.win, s.point!))) {
      seen.add("event goes to an outer region past an inner one without a listener");
    }
    if (!s.pressing && s.expected && s.expected.parent) seen.add("event goes to a nested region");
    if (s.pressing && s.captor && !s.captor.removed && !rectContains(s.captor.win, s.point!)) seen.add("captured event outside its region");
    if (s.pressing && s.captor && s.captor.removed) seen.add("event after the capturing region was removed");
    if (s.pressing && !s.captor) seen.add("event in a press no region received");
    if (!s.pressing && s.kind === "move" && s.expected) seen.add("hover move received");
    if (!s.pressing && s.kind === "up") seen.add("up with no press");
    const edge = s.nodes.some((n) => !n.removed && n.parent && (s.point!.x === n.win.x + n.win.width || s.point!.y === n.win.y + n.win.height));
    if (edge) seen.add("point on a right or bottom edge");
  });
  return seen;
}

export function routerContract(make: MakeRoot): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (ops) => {
        run(make, ops, (s) => assert.ok(check(s), id));
      }));
    });

  describe("RootRegion", () => {
    rule("RootRegion.innermost-listener", (s) => s.op.op !== "deliver" || s.pressing || deepEqual(receivers(s), expectedReceivers(s)));

    rule("RootRegion.capture", (s) => s.op.op !== "deliver" || !s.pressing || !s.captor || s.captor.removed ||
      deepEqual(receivers(s), expectedReceivers(s)));

    test("RootRegion.released-capture", () => {
      // Random sequences rarely remove the captor mid-press, so also press a region, remove it or its parent, and keep going.
      fc.assert(fc.property(fc.boolean(), fc.array(fc.tuple(fc.constantFrom<PointerKind>("move", "up"), coord, coord), { minLength: 1, maxLength: 5 }),
        (removeParent, rest) => {
          const root = make(size, size);
          const outer = root.add({ x: 10, y: 10, width: 60, height: 60 });
          const inner = outer.add({ x: 10, y: 10, width: 20, height: 20 });
          const got: string[] = [];
          for (const r of [root, outer, inner]) for (const k of kinds) r.on(k, () => got.push(k));
          root.deliver("down", { x: 25, y: 25 }, 1);
          (removeParent ? outer : inner).remove();
          got.length = 0;
          let pressing = true;
          for (const [k, x, y] of rest) {
            if (!pressing) break;
            root.deliver(k, { x, y }, 2);
            if (k === "up") pressing = false;
          }
          return got.length === 0;
        }));
      fc.assert(fc.property(runArb, (ops) => {
        run(make, ops, (s) => assert.ok(s.op.op !== "deliver" || !s.pressing || !s.captor || !s.captor.removed || s.seen.length === 0));
      }));
    });

    rule("RootRegion.uncaptured", (s) => s.op.op !== "deliver" || !s.pressing || s.captor !== undefined || s.seen.length === 0);

    rule("RootRegion.local", (s) => s.seen.every((e) => {
      const n = s.nodes[e.id];
      return e.kind === s.kind && e.event.timeMs === s.time &&
        deepEqual(e.event.point, { x: s.point!.x - n.win.x, y: s.point!.y - n.win.y });
    }));

    rule("Region.add.adds", (s) => !s.added || deepEqual({ ...s.added.node.region.bounds }, s.added.rect));

    rule("Region.remove.detaches", (s) => s.seen.every((e) => !s.nodes[e.id].removed));

    test("RootRegion input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("run", runArb, (ops) => labelsOf(make, ops), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "captured event outside its region": 0.09, "event goes to a nested region": 0.1,
  "event goes to an outer region past an inner one without a listener": 0.16, "event in a press no region received": 0.31,
  "hover move received": 0.19, "point on a right or bottom edge": 0.07, "region two levels deep": 0.3, "up with no press": 0.35,
};
