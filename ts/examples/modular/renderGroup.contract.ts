// Contract tests for RenderGroup (view.ts). Every implementation runs this suite.
// Test names are rule IDs.
//
// A group is read-only; changes are made to its source. The suite drives a
// group of shapes through a fixture that adds the source's edits, and each
// shape is its own region. The fixture's edits act like ShapeCollection's,
// so an add puts one new item on top.
//
// The suite runs random sequences that mix edits, reads, queries, on and
// off. A reference listener stays registered throughout and records what
// every observer and query showed each time it was called. Three more
// functions are registered, sometimes more than once each, and removed,
// sometimes when they have no registration left. A meddling listener adds
// or removes one of them during a change, when armed. Every listener logs
// its calls, so the rules from events.ts (EventEmitter) are checked through the
// group too. The rules are checked after every step.
//
// Shapes stay on a small grid. A group does no arithmetic of its own; the
// ShapeLocator contract covers rounding in the index.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Shape } from "./shape.ts";
import type { ItemId, RenderGroup } from "./view.ts";
import type { DrawingGroup } from "./shapeView.ts";
import { deepEqual, entries, ids, isStrictlySorted, sameSet, unique } from "./view.vocab.ts";
import { coverage, grid, point, rect, shape } from "./testkit.ts";

/** A group of shapes with the edits that change its source. */
export type ShapeGroupFixture = DrawingGroup;

/** A rectangle covering every shape the suite uses. */
const everywhere: Rectangle = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };

/** What the group looked like when the reference listener was called. */
interface Look {
  /** What forEach visited. */
  entries: [ItemId, Shape][];
  size: number;
  /** Whether get returned each visited item under its ID. */
  gets: boolean;
  /** Whether compareZ agreed with forEach's order. */
  sorted: boolean;
  /** The IDs a query covering everything found. */
  found: ItemId[];
  /** Points probed with atPoint, and the IDs found at each. */
  probes: [Point, ItemId[]][];
}

/**
 * The reference listener. Listeners may read and query the group while
 * they are called, so it uses every observer and query. It probes atPoint
 * at the top-left corner of each item's bounding box, which every non-empty
 * test shape contains. If a query itself emits change, which RenderGroup.quiet
 * forbids, the nested call is counted without looking again.
 */
function reference(group: RenderGroup<Shape>): { looks: Look[]; listener: () => void } {
  const looks: Look[] = [];
  let inside = false;
  const listener = () => {
    if (inside) {
      return void looks.push({ entries: [], size: -1, gets: false, sorted: false, found: [], probes: [] });
    }
    inside = true;
    const seen = entries(group);
    const found: ItemId[] = [];
    group.inRect(everywhere, found);
    const probes = seen.map(([, item]): [Point, ItemId[]] => {
      const { x, y } = item.boundingBox();
      const out: ItemId[] = [];
      group.atPoint({ x, y }, out);
      return [{ x, y }, out];
    });
    looks.push({
      entries: seen,
      size: group.size,
      gets: seen.every(([id, item]) => group.get(id) === item),
      sorted: isStrictlySorted(seen.map(([id]) => id), (a, b) => group.compareZ(a, b)),
      found,
      probes,
    });
    inside = false;
  };
  return { looks, listener };
}

const pool = 3;
const prefill = fc.array(fc.nat(), { maxLength: 3 });

type Op =
  | { op: "add"; shape: Shape; sameAs: number | null }
  | { op: "remove"; pick: number }
  | { op: "removeMultiple"; picks: number[] }
  | { op: "inRect"; r: Rectangle; prefill: number[] }
  | { op: "atPoint"; p: Point; prefill: number[] }
  | { op: "read"; pick: number }
  | { op: "on"; k: number }
  | { op: "off"; k: number }
  | { op: "meddle"; action: "on" | "off"; k: number }
  | { op: "cycle" };

const poolIndex = fc.nat({ max: pool - 1 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ shape, sameAs: fc.option(fc.nat(), { freq: 5 }) }).map((a): Op => ({ op: "add", ...a })) },
  { weight: 2, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick })) },
  { weight: 1, arbitrary: fc.array(fc.nat(), { maxLength: 6 }).map((picks): Op => ({ op: "removeMultiple", picks })) },
  { weight: 2, arbitrary: fc.tuple(rect(grid), prefill).map(([r, prefill]): Op => ({ op: "inRect", r, prefill })) },
  { weight: 2, arbitrary: fc.tuple(point(grid), prefill).map(([p, prefill]): Op => ({ op: "atPoint", p, prefill })) },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "read", pick })) },
  { weight: 2, arbitrary: poolIndex.map((k): Op => ({ op: "on", k })) },
  { weight: 1, arbitrary: poolIndex.map((k): Op => ({ op: "off", k })) },
  {
    weight: 1,
    arbitrary: fc.record({ action: fc.constantFrom("on" as const, "off" as const), k: poolIndex })
      .map((a): Op => ({ op: "meddle", ...a })),
  },
  { weight: 1, arbitrary: fc.constant<Op>({ op: "cycle" }) },
);
const sequence = fc.array(opArb, { minLength: 1, maxLength: 50, size: "max" });

/** A listener, as its calls are logged: the reference, the meddler, or a pool function's index. */
type Token = "ref" | "meddler" | number;

interface Step {
  op: Op;
  group: ShapeGroupFixture;
  before: [ItemId, Shape][];
  after: [ItemId, Shape][];
  /** For add, the ID returned; for removals, the IDs listed; for queries, the out array itself. */
  ids: ItemId[];
  /** For add, the shape added. */
  added: Shape | undefined;
  result: unknown;
  outBefore: ItemId[];
  /** An ID the group never returned. */
  unknown: ItemId;
  /** IDs that were present at some point and then went. */
  gone: ReadonlySet<ItemId>;
  /** Whether the step changed the items. */
  changing: boolean;
  /** What the reference listener saw during this step. */
  looks: Look[];
  /** Every listener call during this step, in order. */
  log: Token[];
  /** The registrations before this step, in the order they were made. */
  registered: Token[];
  /** Whether off has been called for each pool function, up to the end of this step. */
  removed: boolean[];
  /** For off, whether the function had no registration. */
  offEmpty: boolean;
  /** For cycle, whether nothing was registered once the reference and meddler were removed. */
  none: boolean;
  /** What the meddler did during this step, if anything. */
  meddled: "on" | "off" | null;
}

/** Whether two entry lists have the same IDs and the same item objects, in order. */
const sameEntries = (a: [ItemId, Shape][], b: [ItemId, Shape][]) =>
  a.length === b.length && a.every(([id, item], i) => b[i][0] === id && b[i][1] === item);

const sameTokens = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Runs ops against a fresh group, calling check after each one. */
function run(make: () => ShapeGroupFixture, opList: Op[], check: (s: Step) => void): void {
  const group = make();
  const ref = reference(group);
  const log: Token[] = [];
  // The registrations the group should have, in order; off removes the most recent.
  const registered: Token[] = [];
  const unregister = (t: Token) => {
    const i = registered.lastIndexOf(t);
    if (i >= 0) registered.splice(i, 1);
    return i >= 0;
  };
  const fns = Array.from({ length: pool }, (_, k) => () => void log.push(k));
  const removed = fns.map(() => false);
  const refListener = () => {
    log.push("ref");
    ref.listener();
  };
  let armed: { action: "on" | "off"; k: number } | null = null;
  let meddled: "on" | "off" | null = null;
  const meddler = () => {
    log.push("meddler");
    if (armed === null) return;
    const { action, k } = armed;
    armed = null;
    meddled = action;
    if (action === "on") {
      group.on("change", fns[k]);
      registered.push(k);
    } else {
      group.off("change", fns[k]);
      unregister(k);
      removed[k] = true;
    }
  };
  group.on("change", refListener).on("change", meddler);
  registered.push("ref", "meddler");
  const returned: ItemId[] = [];
  const addedShapes: Shape[] = [];
  const gone = new Set<ItemId>();
  for (const op of opList) {
    const unknown = (Math.max(0, ...returned.filter(Number.isFinite)) + 1) as ItemId;
    const pickId = (n: number) => [...returned, unknown][n % (returned.length + 1)];
    const before = entries(group);
    const registeredBefore = [...registered];
    ref.looks.length = 0;
    log.length = 0;
    meddled = null;
    let stepIds: ItemId[] = [];
    let added: Shape | undefined;
    let result: unknown;
    let outBefore: ItemId[] = [];
    let offEmpty = false;
    let none = false;
    switch (op.op) {
      case "add": {
        added = op.sameAs !== null && addedShapes.length > 0 ? addedShapes[op.sameAs % addedShapes.length] : op.shape;
        const id = group.add(added);
        addedShapes.push(added);
        returned.push(id);
        stepIds = [id];
        result = id;
        break;
      }
      case "remove":
        stepIds = [pickId(op.pick)];
        result = group.remove(stepIds[0]);
        break;
      case "removeMultiple":
        stepIds = op.picks.map(pickId);
        result = group.removeMultiple(stepIds);
        break;
      case "inRect":
      case "atPoint": {
        const out = op.prefill.map(pickId);
        outBefore = [...out];
        result = op.op === "inRect" ? group.inRect(op.r, out) : group.atPoint(op.p, out);
        stepIds = out;
        break;
      }
      case "read": {
        stepIds = [pickId(op.pick)];
        void group.size;
        group.forEach(() => {});
        group.get(stepIds[0]);
        break;
      }
      case "on":
        result = group.on("change", fns[op.k]);
        registered.push(op.k);
        break;
      case "off":
        result = group.off("change", fns[op.k]);
        offEmpty = !unregister(op.k);
        removed[op.k] = true;
        break;
      case "meddle":
        armed = { action: op.action, k: op.k };
        break;
      case "cycle":
        // Removes the reference and the meddler and registers them again, so
        // that a group sometimes has no listeners at all, and the order of
        // registrations varies.
        group.off("change", refListener).off("change", meddler);
        unregister("ref");
        unregister("meddler");
        none = registered.length === 0;
        group.on("change", meddler).on("change", refListener);
        registered.push("meddler", "ref");
        break;
    }
    const after = entries(group);
    check({
      op, group, before, after, ids: stepIds, added, result, outBefore, unknown, gone: new Set(gone),
      changing: !sameEntries(before, after),
      looks: [...ref.looks], log: [...log], registered: registeredBefore, removed: [...removed],
      offEmpty, none, meddled,
    });
    const now = new Set(after.map(([id]) => id));
    for (const [id] of before) if (!now.has(id)) gone.add(id);
  }
}

function matching(after: [ItemId, Shape][], op: Op): ItemId[] {
  return after
    .filter(([, s]) => (op.op === "inRect" ? s.intersects(op.r) : op.op === "atPoint" && s.contains(op.p)))
    .map(([id]) => id);
}


const isEdit = (op: Op) => op.op === "add" || op.op === "remove" || op.op === "removeMultiple";

/** The input classes one sequence reaches, for the coverage test. */
function labelsOf(make: () => ShapeGroupFixture, opList: Op[]): Set<string> {
  const seen = new Set<string>();
  run(make, opList, (s) => {
    if (s.offEmpty) seen.add("off with nothing registered");
    if (s.none) seen.add("no listeners at all");
    if (isEdit(s.op) && !s.changing) seen.add("edit that changes nothing");
    if (s.op.op === "removeMultiple" && s.before.length - s.after.length >= 2) seen.add("batch removes several");
    if (s.op.op === "read" && s.after.length >= 3) seen.add("read with three items");
    if (s.meddled === "on") seen.add("listener added during a change");
    if (s.meddled === "off") seen.add("listener removed during a change");
    if (!s.changing) return;
    const count = (k: number) => s.registered.filter((t) => t === k).length;
    const ks = Array.from({ length: pool }, (_, k) => k);
    if (ks.some((k) => count(k) >= 2)) seen.add("change with a function registered twice");
    if (ks.filter((k) => count(k) > 0).length >= 2) seen.add("change with two functions listening");
    if (ks.some((k) => s.removed[k] && count(k) === 0)) seen.add("change after a listener was removed");
    if (ks.some((k) => s.removed[k] && count(k) > 0)) seen.add("change after one of two registrations was removed");
    if ([...s.gone].length > 0 && s.op.op === "add") seen.add("add after a removal");
  });
  return seen;
}

export function renderGroupContract(make: () => ShapeGroupFixture): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(sequence, (opList) => {
        run(make, opList, (s) => assert.ok(check(s), id));
      }));
    });

  describe("RenderGroup", () => {
    rule("RenderGroup.size", (s) => s.group.size === s.after.length);

    rule("RenderGroup.z-order", (s) => isStrictlySorted(s.after.map(([id]) => id), (a, b) => s.group.compareZ(a, b)));

    rule("RenderGroup.get-agrees", (s) => {
      const probe = s.op.op === "read" ? s.ids[0] : s.unknown;
      return s.after.every(([id, item]) => s.group.get(id) === item) &&
        (s.group.get(probe) === undefined || s.after.some(([id]) => id === probe));
    });

    rule("RenderGroup.stable", (s) => s.before.every(([id, item]) =>
      !s.after.some(([i]) => i === id) || s.group.get(id) === item));

    rule("RenderGroup.no-reuse", (s) => s.after.every(([id]) => !s.gone.has(id)));

    rule("RenderGroup.read-only", (s) => {
      if (!isEdit(s.op)) return sameEntries(s.after, s.before);
      // The reference listener reads and queries during each add, so an
      // add ends with exactly the items before it plus the one added.
      if (s.op.op === "add") return sameEntries(s.after, [...s.before, [s.ids[0], s.added!]]);
      return true;
    });

    test("RenderGroup.no-retain", () => {
      fc.assert(fc.property(sequence, (opList) => {
        const filled: [ItemId[], ItemId[]][] = [];
        run(make, opList, (s) => {
          for (const [out, copy] of filled) assert.deepEqual(out, copy, "RenderGroup.no-retain");
          if (s.op.op === "inRect" || s.op.op === "atPoint") filled.push([s.ids, [...s.ids]]);
        });
      }));
    });

    rule("RenderGroup.notifies", (s) => {
      if (!s.changing) return true;
      if (s.looks.length !== 1) return false;
      const look = s.looks[0];
      return sameEntries(look.entries, s.after) && look.size === s.after.length && look.gets && look.sorted &&
        sameSet(look.found, matching(s.after, { op: "inRect", r: everywhere, prefill: [] })) &&
        look.probes.every(([p, found]) => sameSet(found, matching(s.after, { op: "atPoint", p, prefill: [] })));
    });

    rule("RenderGroup.quiet", (s) => s.changing || s.log.length === 0);

    // The EventEmitter rules (events.ts), checked through the group's change event.
    // A changing step emits once, so its log should be the registrations
    // made before it, in order.
    const emitted = (s: Step) => !s.changing || sameTokens(s.log, s.registered);

    rule("EventEmitter.on.notified", (s) => !s.changing || s.registered.every((t) =>
      typeof t !== "number" || s.removed[t] ||
      s.log.filter((u) => u === t).length === s.registered.filter((u) => u === t).length));

    rule("EventEmitter.off.removes-one", (s) => !s.removed.some(Boolean) || emitted(s));

    rule("EventEmitter.order", (s) => s.meddled !== null || emitted(s));

    rule("EventEmitter.snapshot", (s) => s.meddled === null || emitted(s));

    const pairs = (s: Step) => s.after.flatMap(([a]) => s.after.map(([b]) => [a, b] as const));

    const idsOf = (es: [ItemId, Shape][]) => es.map(([id]) => id);

    rule("DrawingGroup.add.on-top", (s) => s.op.op !== "add" ||
      (deepEqual(idsOf(s.after), [...idsOf(s.before), s.ids[0]]) && s.group.get(s.ids[0]) === s.added));

    rule("DrawingGroup.remove.result", (s) => s.op.op !== "remove" ||
      (s.result === idsOf(s.before).includes(s.ids[0]) && deepEqual(idsOf(s.after), idsOf(s.before).filter((i) => i !== s.ids[0]))));

    rule("DrawingGroup.removeMultiple.result", (s) => s.op.op !== "removeMultiple" ||
      (s.result === idsOf(s.before).filter((i) => s.ids.includes(i)).length &&
        deepEqual(idsOf(s.after), idsOf(s.before).filter((i) => !s.ids.includes(i)))));

    rule("RenderGroup.compareZ.zero-iff-same", (s) =>
      s.op.op !== "read" || pairs(s).every(([a, b]) => (s.group.compareZ(a, b) === 0) === (a === b)));

    rule("RenderGroup.compareZ.antisymmetric", (s) =>
      s.op.op !== "read" || pairs(s).every(([a, b]) => Math.sign(s.group.compareZ(a, b)) === -Math.sign(s.group.compareZ(b, a))));

    for (const query of ["inRect", "atPoint"] as const) {
      const queryRule = (slug: string, check: (s: Step) => boolean) =>
        rule(`RenderGroup.${query}.${slug}`, (s) => s.op.op !== query || check(s));
      queryRule("exact", (s) => sameSet(s.ids.slice(s.outBefore.length), matching(s.after, s.op)));
      queryRule("once", (s) => unique(s.ids.slice(s.outBefore.length)));
      queryRule("append", (s) => s.outBefore.every((id, i) => s.ids[i] === id));
      queryRule("count", (s) => s.result === s.ids.length - s.outBefore.length);
    }

    test("RenderGroup input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sequence", sequence, (opList) => labelsOf(make, opList), {
        "edit that changes nothing": 0.4, "batch removes several": 0.15, "read with three items": 0.17,
        "change with two functions listening": 0.25, "change with a function registered twice": 0.2,
        "change after a listener was removed": 0.3, "change after one of two registrations was removed": 0.24,
        "off with nothing registered": 0.25, "no listeners at all": 0.15, "add after a removal": 0.3,
        "listener added during a change": 0.18, "listener removed during a change": 0.17,
      });
    });
  });
}
