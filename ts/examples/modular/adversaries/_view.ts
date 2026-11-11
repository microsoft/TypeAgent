// A canvas ShapeView for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the ShapeView contract against it with no bug, so a
// caught adversary means the bug was caught, not that the helper was wrong.

import type { Viewport } from "../geometry.ts";
import type { Circle, Shape } from "../shape.ts";
import type { ShapeCollection } from "../shapeModel.ts";
import type { DrawingContext } from "../canvas.ts";
import type { ShapeView } from "../shapeView.ts";
import type { FrameScheduler } from "../frames.ts";
import type { MakeShapeView } from "../shapeView.contract.ts";
import { RecordingContext } from "../viewkit.ts";
import { Events } from "../eventkit.ts";

export type ViewBug =
  | "none"
  | "no-clear"                 // frame draws over the last frame without clearing
  | "items-reversed"           // frame draws the shapes top first
  | "radius-plus-half"         // circles are drawn half a unit too large
  | "ignores-alpha"            // circles are drawn opaque
  | "draws-on-change"          // a model change redraws at once, instead of in the next frame
  | "no-request-on-change"     // a model change marks the view but requests no frame
  | "requests-every-frame"     // every frame requests the next one, as a render loop would
  | "no-first-request"         // creating the view requests no frame
  | "listens-twice"            // the constructor adds its listener to the model twice
  | "relistens-on-change"      // each change adds the listener again
  | "dispose-keeps-listeners"  // dispose leaves the view's listener on the model
  | "draws-after-dispose"      // a frame requested before dispose still draws
  | "viewport-read-requests"   // reading viewport requests a frame, to be safe
  | "viewport-zero"            // viewport reads as all zeros, a viewport never initialized
  | "set-requests";            // setting the viewport requests a frame even when the value is unchanged

const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export class TestShapeView extends Events<{ viewport: [Viewport] }> implements ShapeView {
  readonly model: ShapeCollection;
  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  private readonly bug: ViewBug;
  private disposed = false;
  private readonly onChange = () => {
    if (this.bug === "draws-on-change") this.draw();
    if (this.bug === "relistens-on-change") this.model.on("change", this.onChange);
    if (this.bug !== "no-request-on-change") this.scheduler.requestFrame(this);
  };

  constructor(model: ShapeCollection, context: DrawingContext, scheduler: FrameScheduler, bug: ViewBug = "none") {
    super();
    this.model = model;
    this.context = context;
    this.scheduler = scheduler;
    this.bug = bug;
    model.on("change", this.onChange);
    if (bug === "listens-twice") model.on("change", this.onChange);
    if (bug !== "no-first-request") scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    if (this.bug === "viewport-read-requests") this.scheduler.requestFrame(this);
    return this.bug === "viewport-zero" ? { scale: 0, rotation: 0, tx: 0, ty: 0 } : identity;
  }

  set viewport(_: Viewport) {
    // Only the identity viewport is supported; anything else is outside the rules.
    if (this.bug === "set-requests") this.scheduler.requestFrame(this);
  }

  frame(_timeMs: number): void {
    if (this.disposed && this.bug !== "draws-after-dispose") return;
    this.draw();
    if (this.bug === "requests-every-frame") this.scheduler.requestFrame(this);
  }

  private draw(): void {
    const c = this.context;
    if (this.bug !== "no-clear") c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    const shapes: Shape[] = [];
    this.model.forEach((_, shape) => shapes.push(shape));
    if (this.bug === "items-reversed") shapes.reverse();
    for (const shape of shapes) {
      const circle = shape as Circle;
      const { r, g, b, a } = circle.color;
      c.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.bug === "ignores-alpha" ? 1 : a})`;
      c.beginPath();
      c.arc(circle.center.x, circle.center.y, circle.radius + (this.bug === "radius-plus-half" ? 0.5 : 0), 0, 2 * Math.PI);
      c.fill();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bug !== "dispose-keeps-listeners") this.model.off("change", this.onChange);
  }
}

/** Wires a TestShapeView to a RecordingContext, as the ShapeView contract wants. */
export function makeTestView(bug: ViewBug = "none"): MakeShapeView {
  return (model, scheduler, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new TestShapeView(model, recording.context, scheduler, bug), painted: (p) => recording.painted(p) };
  };
}
