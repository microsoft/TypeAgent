// Contract tests for App (app.ts). Every way of connecting an app runs this
// suite. Test names are rule IDs.
//
// The parts are the reference chrome, a tree renderer and a kit view, each
// wrapped to log the calls the app makes. Each run connects them, then
// applies a random sequence: the user's actions on the controls, taps on
// the view, edits to the layer from outside, and in some runs dispose
// (called twice). The suite's own listeners are registered after the app's,
// so when they run the app's listener has already run.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { SemanticNode, Size, UiEvent } from "./ui.ts";
import type { ChromeOptions, MakeCircle } from "./chrome.ts";
import type { App, AppParts } from "./app.ts";
import { deepEqual, keys, minimumSize } from "./app.vocab.ts";
import { coverage } from "./testkit.ts";
import { ListLayer, ManualScheduler, ManualTaps, RecordingContext, testCircle } from "./viewkit.ts";
import { KitShapeView } from "./shapeviewkit.ts";
import { TreeRenderer } from "./uikit.ts";
import { RefChrome } from "./chromekit.ts";

export type Connect = (parts: AppParts) => App;

class SpyChrome extends RefChrome {
  dispatched: UiEvent[] = [];
  tapped: Point[] = [];
  disposals = 0;
  private readonly order: string[];
  constructor(layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle, order: string[]) {
    super(layer, options, makeCircle);
    this.order = order;
  }
  override dispatch(event: UiEvent): void {
    this.dispatched.push(event);
    super.dispatch(event);
  }
  override tap(p: Point): void {
    this.tapped.push(p);
    super.tap(p);
  }
  override dispose(): void {
    this.disposals++;
    this.order.push("chrome");
    super.dispose();
  }
}

class SpyRenderer extends TreeRenderer {
  rendered: SemanticNode[] = [];
  disposals = 0;
  private readonly order: string[];
  constructor(order: string[]) {
    super();
    this.order = order;
  }
  override render(tree: SemanticNode): void {
    this.rendered.push(tree);
    super.render(tree);
  }
  override dispose(): void {
    this.disposals++;
    this.order.push("renderer");
    super.dispose();
  }
}

class SpyView extends KitShapeView {
  disposals = 0;
  order: string[] = [];
  override dispose(): void {
    this.disposals++;
    this.order.push("view");
    super.dispose();
  }
}

const red: Color = { r: 220, g: 40, b: 40, a: 1 };
const blue: Color = { r: 40, g: 90, b: 220, a: 1 };
const options: ChromeOptions = {
  palette: [{ label: "Red", color: red }, { label: "Blue", color: blue }],
  radius: { min: 1, max: 5, step: 1, initial: 2 },
};

type Op =
  | { op: "activate"; key: number }
  | { op: "radius"; value: number }
  | { op: "tap"; p: Point }
  | { op: "external"; p: Point }
  | { op: "dispose" };

const pointArb = fc.record({ x: fc.integer({ min: 0, max: 10 }), y: fc.integer({ min: 0, max: 10 }) }).map(({ x, y }) => ({ x: x + 0.5, y: y + 0.5 }));
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.nat().map((key): Op => ({ op: "activate", key })) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 5 }).map((value): Op => ({ op: "radius", value })) },
  { weight: 3, arbitrary: pointArb.map((p): Op => ({ op: "tap", p })) },
  { weight: 1, arbitrary: pointArb.map((p): Op => ({ op: "external", p })) },
);
const runArb = fc.record({
  extra: fc.record({ width: fc.nat({ max: 200 }), height: fc.nat({ max: 200 }) }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 30, size: "max" }),
  disposeAt: fc.option(fc.nat({ max: 29 }), { freq: 3 }),
}).map(({ extra, ops, disposeAt }) => ({
  extra,
  ops: disposeAt === null ? ops : [...ops.slice(0, disposeAt), { op: "dispose" } as Op, ...ops.slice(disposeAt)],
}));
type Run = { extra: { width: number; height: number }; ops: Op[] };

interface Parts {
  chrome: SpyChrome;
  renderer: SpyRenderer;
  view: SpyView;
  taps: ManualTaps;
  layer: ListLayer;
  size: Size;
  order: string[];
}

interface Step {
  op: Op;
  p: Parts;
  disposed: boolean;
  /** What happened during the step, as the suite's own listeners saw it. */
  changes: number;
  /** At each change the chrome emitted: whether the app had rendered the chrome's controls by then. */
  renderedAtChange: boolean[];
  renders: SemanticNode[];
  inputs: UiEvent[];
  /** At each input: whether the chrome had been given it by then. */
  dispatchedAtInput: boolean[];
  dispatched: UiEvent[];
  taps: Point[];
  tappedAtTap: boolean[];
  tapped: Point[];
}

function setUp(extra: { width: number; height: number }): Parts {
  const order: string[] = [];
  const layer = new ListLayer();
  const chrome = new SpyChrome(layer, options, testCircle, order);
  const renderer = new SpyRenderer(order);
  const taps = new ManualTaps();
  const min = minimumSize(options);
  const size = { width: min.width + extra.width, height: min.height + extra.height };
  const view = new SpyView({ layers: [layer] }, new RecordingContext(size.width, size.height - 48).context, new ManualScheduler(), taps);
  view.order = order;
  return { chrome, renderer, view, taps, layer, size, order };
}

function run(connect: Connect, r: Run, check: (s: Step, app: App) => void): void {
  const p = setUp(r.extra);
  const app = connect({ chrome: p.chrome, view: p.view, renderer: p.renderer, size: p.size });
  let changes = 0;
  let renderedAtChange: boolean[] = [];
  let inputs: UiEvent[] = [];
  let dispatchedAtInput: boolean[] = [];
  let taps: Point[] = [];
  let tappedAtTap: boolean[] = [];
  p.chrome.on("change", () => {
    changes++;
    renderedAtChange.push(deepEqual(p.renderer.rendered.at(-1), p.chrome.present(p.size)));
  });
  p.renderer.on("input", (e) => {
    inputs.push(e);
    dispatchedAtInput.push(deepEqual(p.chrome.dispatched.at(-1), e));
  });
  p.view.on("tap", (q) => {
    taps.push(q);
    tappedAtTap.push(deepEqual(p.chrome.tapped.at(-1), q));
  });
  let disposed = false;
  for (const op of r.ops) {
    changes = 0;
    renderedAtChange = [];
    inputs = [];
    dispatchedAtInput = [];
    taps = [];
    tappedAtTap = [];
    const renders = p.renderer.rendered.length;
    const dispatched = p.chrome.dispatched.length;
    const tapped = p.chrome.tapped.length;
    const tree = p.renderer.presented();
    switch (op.op) {
      case "activate": {
        const list = tree ? keys(tree) : ["mode.erase"];
        p.renderer.activate(list[op.key % list.length]);
        break;
      }
      case "radius":
        p.renderer.setValue("radius", op.value);
        break;
      case "tap":
        p.taps.emit("tap", op.p);
        break;
      case "external":
        p.layer.add(testCircle({ center: op.p, radius: 1, color: blue }));
        break;
      case "dispose":
        app.dispose();
        app.dispose();
        break;
    }
    check({
      op, p, disposed, changes, renderedAtChange, renders: p.renderer.rendered.slice(renders), inputs, dispatchedAtInput,
      dispatched: p.chrome.dispatched.slice(dispatched), taps, tappedAtTap, tapped: p.chrome.tapped.slice(tapped),
    }, app);
    if (op.op === "dispose") disposed = true;
  }
}

function labelsOf(connect: Connect, r: Run): Set<string> {
  const seen = new Set<string>();
  run(connect, r, (s) => {
    if (s.disposed) return void seen.add("action after dispose");
    if (s.inputs.length > 0) seen.add(s.inputs[0].kind === "activate" ? "activate a control" : "set the radius");
    if (s.taps.length > 0) seen.add(s.changes > 0 ? "tap that changes the layer" : "tap that changes nothing");
    if (s.op.op === "external") seen.add("edit from outside");
  });
  return seen;
}

export function appContract(connect: Connect): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (r) => {
        run(connect, r, (s) => assert.ok(check(s), id));
      }));
    });

  describe("App", () => {
    test("App.starts", () => {
      fc.assert(fc.property(runArb, (r) => {
        const p = setUp(r.extra);
        connect({ chrome: p.chrome, view: p.view, renderer: p.renderer, size: p.size });
        return deepEqual(p.renderer.presented(), p.chrome.present(p.size)) && p.view.interactive;
      }));
    });

    rule("App.renders", (s) => s.disposed || s.op.op === "dispose" ||
      (s.renders.length === s.changes && s.renderedAtChange.every(Boolean)));

    rule("App.forwards-input", (s) => s.disposed || s.op.op === "dispose" ||
      (deepEqual(s.dispatched, s.inputs) && s.dispatchedAtInput.every(Boolean)));

    rule("App.forwards-taps", (s) => s.disposed || s.op.op === "dispose" ||
      (deepEqual(s.tapped, s.taps) && s.tappedAtTap.every(Boolean)));

    rule("App.one-listener", (s) => s.disposed || s.op.op === "dispose" ||
      (s.p.chrome.listenerCount("change") === 2 && s.p.renderer.listenerCount("input") === 2 && s.p.view.listenerCount("tap") === 2));

    rule("App.dispose.detaches", (s) => {
      if (!s.disposed && s.op.op !== "dispose") return true;
      const { chrome, renderer, view, order } = s.p;
      return chrome.listenerCount("change") === 1 && renderer.listenerCount("input") === 1 && view.listenerCount("tap") === 1 &&
        chrome.disposals === 1 && view.disposals === 1 && renderer.disposals === 1 && deepEqual(order, ["chrome", "view", "renderer"]) &&
        s.renders.length === 0 && s.dispatched.length === 0 && s.tapped.length === 0;
    });

    test("App input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("run", runArb, (r) => labelsOf(connect, r), MINIMUMS);
    });
  });
}

const MINIMUMS: Record<string, number> = {
  "action after dispose": 0.18, "activate a control": 0.23, "edit from outside": 0.29, "set the radius": 0.26,
  "tap that changes nothing": 0.07, "tap that changes the layer": 0.39,
};
