/**
 * Tests that tell the two implementations of canvasShapeView.ts apart.
 *
 * Each test drives a CanvasShapeView through ShapeView's own interface, with
 * a model built from the reference writer (shapewriterkit.ts), a
 * ManualScheduler, and either a drawing context that records the order of
 * the calls it gets or a model wrapper that counts the off calls it gets.
 * Every call is a valid use: the model holds only circles, no viewport other
 * than the identity is set, and dispose is called only as View.dispose
 * allows (including twice, which View.dispose.idempotent covers).
 * Imports: node:test, node:assert/strict, canvas.ts, shape.ts, shapeModel.ts, canvasShapeView.ts, viewkit.ts, shapewriterkit.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DrawingContext } from "./canvas.ts";
import type { ShapeId } from "./shape.ts";
import type { ShapeCollection } from "./shapeModel.ts";
import { CanvasShapeView } from "./canvasShapeView.ts";
import { ManualScheduler, testCircle } from "./viewkit.ts";
import { readFacet, RefShapeWriter } from "./shapewriterkit.ts";

const width = 12;
const height = 12;

/**
 * A DrawingContext that keeps the name of each call it gets, fillStyle's
 * setter included, so a test can see the order a view draws a circle in.
 */
class OrderContext implements DrawingContext {
  readonly canvas: { readonly width: number; readonly height: number } = { width, height };
  readonly calls: string[] = [];
  private style: string | object = "rgba(0, 0, 0, 1)";

  get fillStyle(): string | object {
    return this.style;
  }

  set fillStyle(value: string | object) {
    this.style = value;
    this.calls.push("fillStyle");
  }

  clearRect(): void {
    this.calls.push("clearRect");
  }

  beginPath(): void {
    this.calls.push("beginPath");
  }

  arc(): void {
    this.calls.push("arc");
  }

  fill(): void {
    this.calls.push("fill");
  }
}

/** A model that is m, and counts the off calls it gets. */
function countingOff(m: ShapeCollection, counts: { off: number }): ShapeCollection {
  return {
    get: (id) => m.get(id),
    get size() { return m.size; },
    forEach: (visit) => m.forEach(visit),
    compareZ: (a, b) => m.compareZ(a, b),
    inRect: (r, out) => m.inRect(r, out),
    atPoint: (p, out) => m.atPoint(p, out),
    on(event, listener) { m.on(event, listener); return this; },
    off(event, listener) { counts.off += 1; m.off(event, listener); return this; },
  };
}

/** A model holding the given circles, bottom to top. */
function modelOf(circles: { center: { x: number; y: number }; radius: number; color: { r: number; g: number; b: number; a: number } }[]): ShapeCollection {
  const writer = new RefShapeWriter();
  circles.forEach((c, i) => writer.add(`c${i}` as ShapeId, testCircle(c)));
  return readFacet(writer);
}

const red = { r: 255, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 255, a: 0.5 };

// A sets fillStyle between arc and fill; B sets it before beginPath, as the
// spec's "with fillStyle set first" reads.
test("fillStyle is set before beginPath for each circle", () => {
  const model = modelOf([
    { center: { x: 4, y: 4 }, radius: 2, color: red },
    { center: { x: 8, y: 7 }, radius: 3, color: blue },
  ]);
  const context = new OrderContext();
  const scheduler = new ManualScheduler();
  const view = new CanvasShapeView(model, context, scheduler);
  scheduler.runFrame();
  assert.deepEqual(context.calls, [
    "clearRect",
    "fillStyle", "beginPath", "arc", "fill",
    "fillStyle", "beginPath", "arc", "fill",
  ]);
  view.dispose();
});

// A builds a new identity Viewport for each read; B returns one shared value.
test("viewport reads as the same object every time", () => {
  const model = modelOf([{ center: { x: 6, y: 6 }, radius: 2, color: red }]);
  const context = new OrderContext();
  const scheduler = new ManualScheduler();
  const view = new CanvasShapeView(model, context, scheduler);
  scheduler.runFrame();
  assert.equal(view.viewport, view.viewport);
  view.dispose();
});

// A calls the model's off again on a second dispose; B returns at once.
test("a second dispose calls the model's off no further time", () => {
  const counts = { off: 0 };
  const model = countingOff(modelOf([{ center: { x: 3, y: 3 }, radius: 1, color: red }]), counts);
  const context = new OrderContext();
  const scheduler = new ManualScheduler();
  const view = new CanvasShapeView(model, context, scheduler);
  scheduler.runFrame();
  view.dispose();
  assert.equal(counts.off, 1, "the first dispose removes the listener");
  view.dispose();
  assert.equal(counts.off, 1);
});
