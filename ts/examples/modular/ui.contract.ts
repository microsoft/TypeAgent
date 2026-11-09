// Contract tests for Renderer (ui.ts). Every Renderer implementation runs
// this suite through a fixture that reads what the platform presents and
// acts as the user would. Test names are rule IDs.
//
// Each run renders random well-formed trees whose keys come from a small
// pool, so that successive trees share keys, some with the same role and
// some not. Between renders the user activates nodes and sets sliders,
// including disabled ones, selected radios, containers and keys that
// aren't there; some runs dispose of the renderer partway.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Rectangle } from "./geometry.ts";
import type { Renderer, SemanticNode, UiEvent } from "./ui.ts";
import { byKey, deepEqual, keys, nodes, wellFormed } from "./ui.vocab.ts";
import { coverage } from "./testkit.ts";

/** A renderer, with what its platform presents and the user's actions on it. */
export interface RendererFixture {
  renderer: Renderer;
  /** The tree the platform presents, read from its widgets; undefined when it presents nothing. */
  presented(): SemanticNode | undefined;
  /** The user activates the node with this key, as a click or tap would. */
  activate(key: string): void;
  /** The user sets the slider with this key to value, as dragging it would. Does nothing for other nodes. */
  setValue(key: string, value: number): void;
  /** The platform widget presenting the node with this key, for comparing identity. */
  widget(key: string): unknown;
}

const pool = ["a", "b", "c", "d", "e", "f"];
const labels = ["Alpha", "Beta", "Gamma", "Delta"];
const texts = ["", "Ready", "3 items"];

type Spec = {
  role: "button" | "slider" | "text" | "radio-group";
  enabled: boolean;
  label: number;
  radios: number;
  selected: number;
  radioEnabled: boolean[];
  min: number;
  step: number;
  steps: number;
  at: number;
  text: number;
};

const specArb: fc.Arbitrary<Spec> = fc.record({
  role: fc.constantFrom("button" as const, "slider" as const, "text" as const, "radio-group" as const),
  enabled: fc.nat({ max: 3 }).map((n) => n > 0),
  label: fc.nat({ max: labels.length - 1 }),
  radios: fc.integer({ min: 1, max: 3 }),
  selected: fc.nat({ max: 3 }),
  radioEnabled: fc.array(fc.nat({ max: 3 }).map((n) => n > 0), { minLength: 3, maxLength: 3 }),
  min: fc.integer({ min: 0, max: 5 }),
  step: fc.constantFrom(1, 2, 5),
  steps: fc.integer({ min: 1, max: 10 }),
  at: fc.nat({ max: 10 }),
  text: fc.nat({ max: texts.length - 1 }),
});

/** Builds a tree: a root group holding a toolbar of controls, and maybe a view-host below it. */
function build(specs: Spec[], ks: string[], host: boolean, width: number): SemanticNode {
  let x = 8;
  const children = specs.map((s, i): SemanticNode => {
    const key = ks[i];
    const label = labels[s.label];
    const w = s.role === "radio-group" ? 64 * s.radios : s.role === "slider" ? 160 : s.role === "button" ? 72 : 112;
    const bounds: Rectangle = { x, y: 8, width: w, height: 32 };
    x += w + 8;
    switch (s.role) {
      case "button":
        return { role: "button", key, label, enabled: s.enabled, bounds, children: [] };
      case "text":
        return { role: "text", key, label, value: texts[s.text], enabled: s.enabled, bounds, children: [] };
      case "slider": {
        const max = s.min + s.steps * s.step;
        const value = s.min + Math.min(s.at, s.steps) * s.step;
        return { role: "slider", key, label, value, min: s.min, max, step: s.step, enabled: s.enabled, bounds, children: [] };
      }
      case "radio-group":
        return {
          role: "radio-group", key, label, enabled: s.enabled, bounds,
          children: Array.from({ length: s.radios }, (_, r): SemanticNode => ({
            role: "radio", key: `${key}.${r}`, label: labels[(s.label + r) % labels.length], selected: r === s.selected % s.radios,
            enabled: s.radioEnabled[r], bounds: { x: bounds.x + 64 * r, y: 8, width: 64, height: 32 }, children: [],
          })),
        };
    }
  });
  const full = Math.max(width, x);
  const toolbar: SemanticNode = { role: "toolbar", key: "bar", label: "Tools", enabled: true, bounds: { x: 0, y: 0, width: full, height: 48 }, children };
  const view: SemanticNode[] = host ? [{ role: "view-host", key: "host", label: "Drawing", enabled: true, bounds: { x: 0, y: 48, width: full, height: 252 }, children: [] }] : [];
  return { role: "group", key: "root", label: "App", enabled: true, bounds: { x: 0, y: 0, width: full, height: 300 }, children: [toolbar, ...view] };
}

const treeArb: fc.Arbitrary<SemanticNode> = fc.record({
  specs: fc.array(specArb, { minLength: 1, maxLength: 5 }),
  ks: fc.shuffledSubarray(pool, { minLength: 5, maxLength: 5 }),
  host: fc.boolean(),
  width: fc.integer({ min: 300, max: 900 }),
}).map(({ specs, ks, host, width }) => build(specs, ks, host, width));

/** tree with each slider's value moved by steps, wrapping within its range. */
function moveSliders(tree: SemanticNode, by: number): SemanticNode {
  const children = tree.children.map((c) => moveSliders(c, by));
  if (tree.role !== "slider") return { ...tree, children };
  const { min = 0, max = 0, step = 1, value } = tree;
  const count = Math.round((max - min) / step) + 1;
  const at = (Math.round(((value as number) - min) / step) + by) % count;
  return { ...tree, value: min + at * step, children };
}

/** Every key a user action may name: the pool, radios, containers, and one that is never used. */
const actionKeys = [...pool, ...pool.flatMap((k) => [`${k}.0`, `${k}.1`, `${k}.2`]), "root", "bar", "host", "missing"];

type Op =
  | { op: "render"; tree: SemanticNode }
  /** Re-renders the tree last rendered with every slider moved to another step, as a model following a drag would. */
  | { op: "move-sliders"; by: number }
  | { op: "activate"; key: number; fromTree: boolean }
  | { op: "setValue"; key: number; at: number; fromTree: boolean }
  | { op: "dispose" };

/** Most actions name a node of the tree last rendered; the rest name any key. */
const fromTree = fc.nat({ max: 4 }).map((n) => n > 0);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 2, arbitrary: treeArb.map((tree): Op => ({ op: "render", tree })) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 9 }).map((by): Op => ({ op: "move-sliders", by })) },
  { weight: 4, arbitrary: fc.record({ key: fc.nat(), fromTree: fromTree }).map((a): Op => ({ op: "activate", ...a })) },
  { weight: 3, arbitrary: fc.record({ key: fc.nat(), at: fc.nat({ max: 10 }), fromTree }).map((a): Op => ({ op: "setValue", ...a })) },
);

const runArb = fc.record({
  ops: fc.array(opArb, { minLength: 1, maxLength: 30, size: "max" }),
  disposeAt: fc.option(fc.nat({ max: 29 }), { freq: 4 }),
}).map(({ ops, disposeAt }) => disposeAt === null ? ops : [...ops.slice(0, disposeAt), { op: "dispose" } as Op, ...ops.slice(disposeAt)]);

interface Step {
  op: Op;
  /** The key acted on, and for setValue the value set. */
  key: string | undefined;
  value: number | undefined;
  /** The tree last rendered before the step, if any, and whether dispose was called before it. */
  current: SemanticNode | undefined;
  /** The tree this step rendered, if it rendered one. */
  rendered: SemanticNode | undefined;
  disposed: boolean;
  presented: SemanticNode | undefined;
  emitted: UiEvent[];
  /** For render: the widget of each key before and after. */
  widgetsBefore: Map<string, unknown>;
  widgetsAfter: Map<string, unknown>;
}

function run(make: () => RendererFixture, ops: Op[], check: (s: Step) => void): void {
  const f = make();
  let emitted: UiEvent[] = [];
  f.renderer.on("input", (e) => emitted.push(e));
  let current: SemanticNode | undefined;
  let disposed = false;
  const pick = (op: { key: number; fromTree: boolean }) => {
    const list = op.fromTree && current ? keys(current) : actionKeys;
    return list[op.key % list.length];
  };
  const widgets = (tree: SemanticNode | undefined) => new Map(tree ? keys(tree).map((k) => [k, f.widget(k)]) : []);
  for (const op of ops) {
    emitted = [];
    let key: string | undefined;
    let value: number | undefined;
    let rendered: SemanticNode | undefined;
    const widgetsBefore = widgets(current);
    switch (op.op) {
      case "render":
        rendered = op.tree;
        f.renderer.render(op.tree);
        break;
      case "move-sliders":
        if (current) {
          rendered = moveSliders(current, op.by);
          f.renderer.render(rendered);
        }
        break;
      case "activate":
        key = pick(op);
        f.activate(key);
        break;
      case "setValue": {
        key = pick(op);
        const node = current && byKey(current, key);
        const { min = 0, max = 10, step = 1 } = node ?? {};
        value = Math.min(max, min + op.at * step);
        f.setValue(key, value);
        break;
      }
      case "dispose":
        f.renderer.dispose();
        break;
    }
    const next = rendered && !disposed ? rendered : current;
    check({
      op, key, value, current, rendered, disposed, presented: f.presented(), emitted,
      widgetsBefore, widgetsAfter: widgets(rendered ?? current),
    });
    current = next;
    if (op.op === "dispose") disposed = true;
  }
}

/** What the rules say the user's action should emit. */
function expectedInput(s: Step): UiEvent[] {
  if (s.disposed || s.key === undefined || !s.current) return [];
  const node = byKey(s.current, s.key);
  if (!node || !node.enabled) return [];
  if (s.op.op === "activate" && (node.role === "button" || (node.role === "radio" && !node.selected))) return [{ kind: "activate", key: s.key }];
  if (s.op.op === "setValue" && node.role === "slider") return [{ kind: "set-value", key: s.key, value: s.value! }];
  return [];
}

function labelsOf(make: () => RendererFixture, ops: Op[]): Set<string> {
  const seen = new Set<string>();
  run(make, ops, (s) => {
    const node = s.current && s.key !== undefined ? byKey(s.current, s.key) : undefined;
    if (s.disposed) {
      if (!s.rendered) seen.add("action after dispose");
      return;
    }
    if (s.op.op === "move-sliders" && s.current && nodes(s.current).some((n) => n.role === "slider")) seen.add("render moves sliders");
    if (s.rendered && s.current) {
      const before = s.current;
      const tree = s.rendered;
      const same = (k: string) => byKey(before, k) !== undefined && byKey(before, k)!.role === byKey(tree, k)!.role;
      if (keys(tree).some((k) => k !== "root" && k !== "bar" && same(k))) seen.add("render keeps a control");
      if (keys(before).some((k) => !keys(tree).includes(k))) seen.add("render drops a key");
      if (keys(tree).some((k) => byKey(before, k) !== undefined && !same(k))) seen.add("render changes a key's role");
    }
    if (!node) return;
    if (!node.enabled && (node.role === "button" || node.role === "radio" || node.role === "slider")) seen.add("action on a disabled control");
    if (s.op.op === "activate" && node.role === "radio" && node.selected && node.enabled) seen.add("activate a selected radio");
    if (s.op.op === "activate" && node.enabled && (node.role === "button" || (node.role === "radio" && !node.selected))) seen.add("activate an enabled control");
    if (s.op.op === "setValue" && node.role === "slider" && node.enabled) seen.add("set an enabled slider");
    if (s.op.op === "activate" && node.role === "slider") seen.add("activate a slider");
  });
  return seen;
}

export function rendererContract(make: () => RendererFixture): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (ops) => {
        run(make, ops, (s) => assert.ok(check(s), id));
      }));
    });

  describe("Renderer", () => {
    test("Renderer.starts-empty", () => {
      assert.equal(make().presented(), undefined);
    });

    test("trees are well-formed", () => {
      fc.assert(fc.property(treeArb, (t) => wellFormed(t)));
    });

    rule("Renderer.render.presents", (s) => !s.rendered || s.disposed || deepEqual(s.presented, s.rendered));

    rule("Renderer.render.quiet", (s) => !s.rendered || s.emitted.length === 0);

    rule("Renderer.reports", (s) => expectedInput(s).length === 0 || deepEqual(s.emitted, expectedInput(s)));

    rule("Renderer.silent", (s) => s.rendered !== undefined || expectedInput(s).length > 0 || s.emitted.length === 0);

    rule("Renderer.stable", (s) => {
      if (!s.rendered || s.disposed || !s.current) return true;
      const tree = s.rendered;
      return nodes(tree).every((n) => {
        const old = byKey(s.current!, n.key);
        return !old || old.role !== n.role || s.widgetsBefore.get(n.key) === s.widgetsAfter.get(n.key);
      });
    });

    rule("Renderer.dispose.removes", (s) => (!s.disposed && s.op.op !== "dispose") || (s.presented === undefined && s.emitted.length === 0));

    test("Renderer input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("run", runArb, (ops) => labelsOf(make, ops), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "action after dispose": 0.18, "action on a disabled control": 0.09, "activate a selected radio": 0.05,
  "activate a slider": 0.08, "activate an enabled control": 0.11, "render changes a key's role": 0.19,
  "render drops a key": 0.22, "render keeps a control": 0.17, "set an enabled slider": 0.05,
  "render moves sliders": 0.1,
};
