// A canvas ShapeView for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the ShapeView contract against it with no bug, so a
// caught adversary means the bug was caught, not that the helper was wrong.

import type { Point, Viewport } from "../geometry.ts";
import type { Circle, Shape } from "../shape.ts";
import type { DrawingContext } from "../canvas.ts";
import type { ShapeView } from "../shapeView.ts";
import type { Scene } from "../view.ts";
import type { FrameScheduler, TapSource } from "../window.ts";
import type { MakeShapeView } from "../shapeView.contract.ts";
import { RecordingContext } from "../viewkit.ts";
import { Events } from "../eventkit.ts";

export type ViewBug =
  | "none"
  | "no-clear"                 // frame draws over the last frame without clearing
  | "layers-reversed"          // frame draws the top layer first
  | "items-reversed"           // frame draws each layer's items top first
  | "radius-plus-half"         // circles are drawn half a unit too large
  | "ignores-alpha"            // circles are drawn opaque
  | "draws-on-change"          // a layer change redraws at once, instead of in the next frame
  | "no-request-on-change"     // a layer change marks the view but requests no frame
  | "requests-every-frame"     // every frame requests the next one, as a render loop would
  | "no-first-request"         // creating the view requests no frame
  | "listens-twice"            // the constructor adds its listener to each layer twice
  | "relistens-on-change"      // each change adds the listener again
  | "dispose-keeps-listeners"  // dispose leaves the view's listeners on the layers
  | "draws-after-dispose"      // a frame requested before dispose still draws
  | "viewport-read-requests"   // reading viewport requests a frame, to be safe
  | "starts-interactive"       // a new view is interactive
  | "tap-ignores-interactive"  // taps are passed on even when not interactive
  | "tap-twice"                // each tap is emitted twice
  | "tap-rounded"              // tap points are rounded to whole units
  | "taps-after-dispose";      // dispose leaves the tap listener, and taps are still passed on

const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export class TestShapeView extends Events<{ viewport: [Viewport]; tap: [Point] }> implements ShapeView {
  readonly scene: Scene<Shape>;
  interactive: boolean;
  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  private readonly taps: TapSource;
  private readonly bug: ViewBug;
  private disposed = false;
  private readonly onTap = (p: Point) => {
    const live = !this.disposed || this.bug === "taps-after-dispose";
    if (!live || (!this.interactive && this.bug !== "tap-ignores-interactive")) return;
    const q = this.bug === "tap-rounded" ? { x: Math.round(p.x), y: Math.round(p.y) } : p;
    this.emit("tap", q);
    if (this.bug === "tap-twice") this.emit("tap", q);
  };
  private readonly onChange = () => {
    if (this.bug === "draws-on-change") this.draw();
    if (this.bug === "relistens-on-change") for (const layer of this.scene.layers) layer.on("change", this.onChange);
    if (this.bug !== "no-request-on-change") this.scheduler.requestFrame(this);
  };

  constructor(scene: Scene<Shape>, context: DrawingContext, scheduler: FrameScheduler, taps: TapSource, bug: ViewBug = "none") {
    super();
    this.scene = scene;
    this.context = context;
    this.scheduler = scheduler;
    this.taps = taps;
    this.bug = bug;
    this.interactive = bug === "starts-interactive";
    taps.on("tap", this.onTap);
    for (const layer of scene.layers) layer.on("change", this.onChange);
    if (bug === "listens-twice") for (const layer of scene.layers) layer.on("change", this.onChange);
    if (bug !== "no-first-request") scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    if (this.bug === "viewport-read-requests") this.scheduler.requestFrame(this);
    return identity;
  }

  set viewport(_: Viewport) {
    // Only the identity viewport is supported; anything else is outside the rules.
  }

  frame(_timeMs: number): void {
    if (this.disposed && this.bug !== "draws-after-dispose") return;
    this.draw();
    if (this.bug === "requests-every-frame") this.scheduler.requestFrame(this);
  }

  private draw(): void {
    const c = this.context;
    if (this.bug !== "no-clear") c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    const layers = this.bug === "layers-reversed" ? [...this.scene.layers].reverse() : this.scene.layers;
    for (const layer of layers) {
      const items: Shape[] = [];
      layer.forEach((_, item) => items.push(item));
      if (this.bug === "items-reversed") items.reverse();
      for (const item of items) {
        const circle = item as Circle;
        const { r, g, b, a } = circle.color;
        c.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.bug === "ignores-alpha" ? 1 : a})`;
        c.beginPath();
        c.arc(circle.center.x, circle.center.y, circle.radius + (this.bug === "radius-plus-half" ? 0.5 : 0), 0, 2 * Math.PI);
        c.fill();
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bug !== "dispose-keeps-listeners") for (const layer of this.scene.layers) layer.off("change", this.onChange);
    if (this.bug !== "taps-after-dispose") this.taps.off("tap", this.onTap);
  }
}

/** Wires a TestShapeView to a RecordingContext, as the ShapeView contract wants. */
export function makeTestView(bug: ViewBug = "none"): MakeShapeView {
  return (scene, scheduler, taps, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new TestShapeView(scene, recording.context, scheduler, taps, bug), painted: (p) => recording.painted(p) };
  };
}
