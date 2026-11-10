// Contract tests for Chrome (chrome.ts). Every Chrome implementation runs
// this suite. Test names are rule IDs.
//
// Each run makes a chrome over a ListLayer (viewkit.ts) with random options,
// then applies a random sequence: what the user does with controls (including
// keys that aren't controls, disabled controls and the wrong kind of event),
// taps on a small grid so that circles overlap and erasing hits, edits to the
// layer from outside the chrome, present calls, and in some runs dispose.
// After every step the rules are checked against the vocabulary in
// chrome.vocab.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape } from "./shape.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { ItemId } from "./view.ts";
import type { SemanticNode, Size, UiEvent } from "./ui.ts";
import type { Chrome, ChromeOptions, ChromeState, MakeCircle } from "./chrome.ts";
import {
  byKey, controls, deepEqual, entries, ids, keys, minimumSize, nodes, onStep, rectIntersects, snapRadius, unique, validRect, wellFormed, within,
} from "./chrome.vocab.ts";
import { coverage } from "./testkit.ts";
import { ListLayer, testCircle } from "./viewkit.ts";

export type MakeChrome = (layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle) => Chrome;

/** A ListLayer that counts the edits made to it. */
class CountingLayer extends ListLayer {
  removes = 0;
  removeMultiples = 0;

  override remove(id: ItemId): boolean {
    this.removes++;
    return super.remove(id);
  }

  override removeMultiple(list: readonly ItemId[]): number {
    this.removeMultiples++;
    return super.removeMultiple(list);
  }
}

const colors: Color[] = [
  { r: 220, g: 40, b: 40, a: 1 }, { r: 40, g: 90, b: 220, a: 1 }, { r: 30, g: 160, b: 70, a: 1 }, { r: 0, g: 0, b: 0, a: 0.5 },
];
const labels = ["Red", "Blue", "Green", "Shadow"];

const optionsArb: fc.Arbitrary<ChromeOptions> = fc.record({
  colors: fc.integer({ min: 1, max: 4 }),
  min: fc.constantFrom(1, 2),
  step: fc.constantFrom(1, 2, 5),
  steps: fc.integer({ min: 1, max: 8 }),
  start: fc.nat({ max: 8 }),
}).map(({ colors: n, min, step, steps, start }) => ({
  palette: colors.slice(0, n).map((color, i) => ({ label: labels[i], color })),
  radius: { min, max: min + steps * step, step, initial: min + Math.min(start, steps) * step },
}));

const grid = 12;
const pointArb: fc.Arbitrary<Point> = fc.record({ x: fc.integer({ min: 0, max: grid }), y: fc.integer({ min: 0, max: grid }) })
  .map(({ x, y }) => ({ x: x + 0.5, y: y + 0.5 }));

/** Keys that aren't controls, and a color index that may be past the palette. */
const junkKeys = ["root", "toolbar", "view", "status", "mode", "color", "nope", "color.7", "Clear"];

type Op =
  | { op: "dispatch"; key: number; junk: boolean; kind: "activate" | "set-value"; value: number; named?: string }
  | { op: "tap"; p: Point }
  | { op: "external-add"; center: Point; radius: number; color: number }
  | { op: "external-remove"; pick: number }
  | { op: "present"; extraWidth: number; extraHeight: number }
  | { op: "dispose" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      key: fc.nat(), junk: fc.nat({ max: 9 }).map((n) => n < 3),
      kind: fc.constantFrom("activate" as const, "activate" as const, "set-value" as const),
      value: fc.integer({ min: -10, max: 100 }).map((v) => v / 2),
    }).map((a): Op => ({ op: "dispatch", ...a })),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom("mode.erase", "mode.draw")
      .map((named): Op => ({ op: "dispatch", key: 0, junk: false, kind: "activate", value: 0, named })),
  },
  {
    weight: 1,
    arbitrary: fc.integer({ min: -10, max: 100 })
      .map((v): Op => ({ op: "dispatch", key: 0, junk: false, kind: "set-value", value: v / 2, named: "radius" })),
  },
  { weight: 5, arbitrary: pointArb.map((p): Op => ({ op: "tap", p })) },
  {
    weight: 1,
    arbitrary: fc.record({ center: pointArb, radius: fc.integer({ min: 1, max: 4 }), color: fc.nat({ max: 3 }) })
      .map((a): Op => ({ op: "external-add", ...a })),
  },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "external-remove", pick })) },
  {
    weight: 1,
    arbitrary: fc.record({ extraWidth: fc.nat({ max: 300 }), extraHeight: fc.nat({ max: 300 }) })
      .map((a): Op => ({ op: "present", ...a })),
  },
);

const runArb = fc.record({
  options: optionsArb,
  prefill: fc.array(fc.record({ center: pointArb, radius: fc.integer({ min: 1, max: 4 }) }), { maxLength: 3 }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 40, size: "max" }),
  disposeAt: fc.option(fc.nat({ max: 39 }), { freq: 4 }),
}).map(({ disposeAt, ops, ...rest }) => ({
  ...rest,
  ops: disposeAt === null ? ops : [...ops.slice(0, disposeAt), { op: "dispose" } as Op, ...ops.slice(disposeAt)],
}));
type Run = { options: ChromeOptions; prefill: { center: Point; radius: number }[]; ops: Op[] };

interface Step {
  op: Op;
  /** For dispatch, the event sent. */
  event: UiEvent | undefined;
  /** For present, the size and the tree returned. */
  size: Size | undefined;
  tree: unknown;
  chrome: Chrome;
  layer: CountingLayer;
  options: ChromeOptions;
  disposed: boolean;
  before: ChromeState;
  /** The state object read before the step, and its values then. */
  read: ChromeState;
  after: ChromeState;
  /** The layer's items before and after the step, bottom to top. */
  itemsBefore: [ItemId, Shape][];
  itemsAfter: [ItemId, Shape][];
  /** The state as it was at each change the chrome emitted during the step. */
  emitted: ChromeState[];
  removes: number;
  removeMultiples: number;
}

const copy = (s: ChromeState): ChromeState => ({ ...s });
const idsOf = (items: [ItemId, Shape][]) => items.map(([id]) => id);

/** Whether event acts on a control: its key names an enabled node of the right role for its kind. */
function applies(options: ChromeOptions, state: ChromeState, event: UiEvent): boolean {
  const node = byKey(controls(options, state, minimumSize(options)), event.key);
  if (!node || !node.enabled) return false;
  return event.kind === "activate" ? node.role === "radio" || node.role === "button" : node.role === "slider";
}

function run(make: MakeChrome, r: Run, check: (s: Step) => void): void {
  const layer = new CountingLayer();
  for (const p of r.prefill) layer.add(testCircle({ ...p, color: colors[0] }));
  const chrome = make(layer, r.options, testCircle);
  let emitted: ChromeState[] = [];
  chrome.on("change", () => emitted.push(copy(chrome.state)));
  let disposed = false;
  for (const op of r.ops) {
    const read = chrome.state;
    const before = copy(read);
    const itemsBefore = entries(layer);
    emitted = [];
    layer.removes = 0;
    layer.removeMultiples = 0;
    let event: UiEvent | undefined;
    let size: Size | undefined;
    let tree: unknown;
    switch (op.op) {
      case "dispatch": {
        const all = [...keys(controls(r.options, before, minimumSize(r.options))), ...junkKeys];
        const key = op.named ?? (op.junk ? junkKeys[op.key % junkKeys.length] : all[op.key % all.length]);
        event = op.kind === "activate" ? { kind: "activate", key } : { kind: "set-value", key, value: op.value };
        chrome.dispatch(event);
        break;
      }
      case "tap":
        chrome.tap(op.p);
        break;
      case "external-add":
        layer.add(testCircle({ center: op.center, radius: op.radius, color: colors[op.color] }));
        break;
      case "external-remove": {
        const list = ids(layer);
        if (list.length > 0) layer.remove(list[op.pick % list.length]);
        break;
      }
      case "present": {
        const min = minimumSize(r.options);
        size = { width: min.width + op.extraWidth, height: min.height + op.extraHeight };
        tree = chrome.present(size);
        break;
      }
      case "dispose":
        chrome.dispose();
        break;
    }
    // A disposed chrome's state is no longer kept up to date, so only read it before.
    const after = disposed || op.op === "dispose" ? before : copy(chrome.state);
    check({
      op, event, size, tree, chrome, layer, options: r.options, disposed, before, read, after,
      itemsBefore, itemsAfter: entries(layer), emitted, removes: layer.removes, removeMultiples: layer.removeMultiples,
    });
    if (op.op === "dispose") disposed = true;
  }
}

/** The input classes one run reaches, for the coverage test. */
function labelsOf(make: MakeChrome, r: Run): Set<string> {
  const seen = new Set<string>();
  run(make, r, (s) => {
    if (s.disposed) {
      if (s.op.op === "tap" || s.op.op === "dispatch") seen.add("action after dispose");
      return;
    }
    const e = s.event;
    if (e) {
      const node = byKey(controls(s.options, s.before, minimumSize(s.options)), e.key);
      if (!node) seen.add("event for a key that isn't a control");
      else if (!node.enabled) seen.add("event for a disabled control");
      else if (!applies(s.options, s.before, e)) seen.add("event of the wrong kind");
      else if (e.kind === "set-value" && snapRadius(s.options.radius, e.value) !== e.value) seen.add("radius moved onto a step or into range");
      else if (e.key === "clear") seen.add("clear with items");
      else if (e.key.startsWith("color.") && Number(e.key.slice(6)) !== s.before.color) seen.add("color changed");
    }
    if (s.op.op === "tap") {
      if (s.before.mode === "draw") seen.add("draw");
      else seen.add(s.itemsAfter.length < s.itemsBefore.length ? "erase hits" : "erase misses");
      if (s.before.mode === "erase" && s.itemsBefore.filter(([, c]) => c.contains((s.op as { p: Point }).p)).length >= 2) {
        seen.add("erase where circles overlap");
      }
    }
    if (s.op.op === "external-add" || s.op.op === "external-remove") seen.add("edit from outside");
  });
  return seen;
}

export function chromeContract(make: MakeChrome): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (r) => {
        run(make, r, (s) => assert.ok(check(s), id));
      }));
    });

  describe("Chrome", () => {
    test("Chrome.starts", () => {
      fc.assert(fc.property(optionsArb, fc.nat({ max: 3 }), (options, n) => {
        const layer = new ListLayer();
        for (let i = 0; i < n; i++) layer.add(testCircle({ center: { x: i, y: i }, radius: 1, color: colors[0] }));
        const chrome = make(layer, options, testCircle);
        return deepEqual(chrome.state, { mode: "draw", color: 0, radius: options.radius.initial, count: n });
      }));
    });

    rule("Chrome.one-listener", (s) => s.disposed || s.op.op === "dispose" || s.layer.listenerCount() === 1);

    rule("Chrome.counts", (s) => s.disposed || s.op.op === "dispose" || s.after.count === s.layer.size);

    rule("Chrome.emits", (s) => {
      if (s.disposed || s.op.op === "dispose") return true;
      const changed = !deepEqual(s.before, s.after);
      return s.emitted.length === (changed ? 1 : 0) && s.emitted.every((e) => deepEqual(e, s.after));
    });

    rule("Chrome.state.snapshot", (s) => deepEqual(s.read, s.before));

    const acting = (s: Step, kind: UiEvent["kind"]) =>
      !s.disposed && s.event !== undefined && s.event.kind === kind && applies(s.options, s.before, s.event);

    rule("Chrome.dispatch.mode", (s) => !acting(s, "activate") || !s.event!.key.startsWith("mode.") ||
      s.after.mode === (s.event!.key === "mode.draw" ? "draw" : "erase"));

    rule("Chrome.dispatch.color", (s) => !acting(s, "activate") || !s.event!.key.startsWith("color.") ||
      s.after.color === Number(s.event!.key.slice("color.".length)));

    rule("Chrome.dispatch.radius", (s) => !acting(s, "set-value") ||
      s.after.radius === snapRadius(s.options.radius, (s.event as { value: number }).value));

    rule("Chrome.dispatch.clear", (s) => !acting(s, "activate") || s.event!.key !== "clear" ||
      (s.layer.size === 0 && s.removeMultiples === 1 && s.removes === 0));

    rule("Chrome.dispatch.ignores", (s) => s.disposed || s.event === undefined || applies(s.options, s.before, s.event) ||
      (deepEqual(s.after, s.before) && s.emitted.length === 0 && deepEqual(idsOf(s.itemsAfter), idsOf(s.itemsBefore))));

    rule("Chrome.tap.draws", (s) => {
      if (s.disposed || s.op.op !== "tap" || s.before.mode !== "draw") return true;
      const added = s.itemsAfter.at(-1);
      if (!added || !deepEqual(idsOf(s.itemsAfter).slice(0, -1), idsOf(s.itemsBefore)) || idsOf(s.itemsBefore).includes(added[0])) return false;
      const c = added[1] as Circle;
      return c.kind === "circle" && deepEqual({ x: c.center.x, y: c.center.y }, s.op.p) && c.radius === s.before.radius &&
        deepEqual({ ...c.color }, s.options.palette[s.before.color].color);
    });

    rule("Chrome.tap.erases", (s) => {
      if (s.disposed || s.op.op !== "tap" || s.before.mode !== "erase") return true;
      const p = s.op.p;
      const top = s.itemsBefore.filter(([, item]) => item.contains(p)).at(-1);
      const expected = idsOf(s.itemsBefore).filter((id) => top === undefined || id !== top[0]);
      return deepEqual(idsOf(s.itemsAfter), expected);
    });

    rule("Chrome.present.exact", (s) => s.op.op !== "present" || s.disposed || deepEqual(s.tree, controls(s.options, s.before, s.size!)));

    // The trees a chrome presents are SemanticNodes, so they hold its invariants.
    const presented = (s: Step) => s.tree as SemanticNode;
    rule("SemanticNode.well-formed", (s) => s.op.op !== "present" || s.disposed || wellFormed(presented(s)));
    rule("SemanticNode.unique-keys", (s) => s.op.op !== "present" || s.disposed || unique(keys(presented(s))));
    rule("SemanticNode.inside", (s) => s.op.op !== "present" || s.disposed ||
      nodes(presented(s)).every((n) => n.children.every((c) => within(c.bounds, n.bounds))));
    rule("SemanticNode.disjoint", (s) => s.op.op !== "present" || s.disposed ||
      nodes(presented(s)).every((n) => n.children.every((a, i) => n.children.every((b, j) => j <= i || !rectIntersects(a.bounds, b.bounds)))));

    rule("Rectangle.non-negative-size", (s) => s.op.op !== "present" || s.disposed ||
      nodes(presented(s)).every((n) => validRect(n.bounds)));

    rule("Chrome.present.pure",(s) => s.op.op !== "present" ||
      (deepEqual(s.after, s.before) && s.emitted.length === 0 && deepEqual(idsOf(s.itemsAfter), idsOf(s.itemsBefore))));

    rule("Chrome.dispose.detaches", (s) => {
      if (!s.disposed && s.op.op !== "dispose") return true;
      if (s.layer.listenerCount() !== 0 || s.emitted.length !== 0) return false;
      const own = s.op.op === "tap" || s.op.op === "dispatch";
      return !own || deepEqual(idsOf(s.itemsAfter), idsOf(s.itemsBefore));
    });

    // ChromeOptions only flow into a chrome, so the generator is where they
    // are made: options that break their rules would test outside the rules.
    test("ChromeOptions.palette", () => {
      fc.assert(fc.property(optionsArb, (o) =>
        o.palette.length > 0 && unique(o.palette.map((p) => p.label)) && o.palette.every((p) => p.label !== "")));
    });

    test("ChromeOptions.radius-range", () => {
      fc.assert(fc.property(optionsArb, ({ radius: r }) =>
        0 < r.min && r.min <= r.initial && r.initial <= r.max && r.step > 0 && onStep(r, r.max) && onStep(r, r.initial)));
    });

    test("Chrome input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("run", runArb, (r) => labelsOf(make, r), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "action after dispose": 0.17, "clear with items": 0.04, "color changed": 0.04, "draw": 0.35,
  "edit from outside": 0.29, "erase hits": 0.11, "erase misses": 0.13, "erase where circles overlap": 0.06,
  "event for a disabled control": 0.12, "event for a key that isn't a control": 0.25, "event of the wrong kind": 0.39,
  "radius moved onto a step or into range": 0.14,
};
