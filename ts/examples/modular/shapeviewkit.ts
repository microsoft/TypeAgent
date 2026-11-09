// The reference ShapeView: draws circles on a DrawingContext the way
// impl-specs.md section 12 describes, so that tests of other parts don't
// depend on any generated view. helpers.check.ts runs the ShapeView
// contract on it. The view's own generation task never sees this file.

import type { Point, Viewport } from "./geometry.ts";
import type { Circle, Shape } from "./shape.ts";
import type { DrawingContext } from "./canvas.ts";
import type { Scene } from "./view.ts";
import type { FrameScheduler, TapSource } from "./window.ts";
import type { ShapeView } from "./shapeView.ts";
import type { MakeShapeView } from "./shapeView.contract.ts";
import { Events } from "./eventkit.ts";
import { RecordingContext } from "./viewkit.ts";

const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export class KitShapeView extends Events<{ viewport: [Viewport]; tap: [Point] }> implements ShapeView {
  readonly scene: Scene<Shape>;
  interactive = false;
  private disposed = false;
  private readonly onChange = () => this.scheduler.requestFrame(this);
  private readonly onTap = (p: Point) => {
    if (this.interactive && !this.disposed) this.emit("tap", p);
  };

  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  private readonly taps: TapSource;

  constructor(scene: Scene<Shape>, context: DrawingContext, scheduler: FrameScheduler, taps: TapSource) {
    super();
    this.scene = scene;
    this.context = context;
    this.scheduler = scheduler;
    this.taps = taps;
    for (const layer of scene.layers) layer.on("change", this.onChange);
    taps.on("tap", this.onTap);
    scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    return identity;
  }

  set viewport(_: Viewport) {
    // Only the identity viewport is supported.
  }

  frame(_timeMs: number): void {
    if (this.disposed) return;
    const c = this.context;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    for (const layer of this.scene.layers) {
      layer.forEach((_, item) => {
        const circle = item as Circle;
        const { r, g, b, a } = circle.color;
        c.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        c.beginPath();
        c.arc(circle.center.x, circle.center.y, circle.radius, 0, 2 * Math.PI);
        c.fill();
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.scene.layers) layer.off("change", this.onChange);
    this.taps.off("tap", this.onTap);
  }
}

/** A KitShapeView on a RecordingContext, in the ShapeView contract's shape. */
export const kitView: MakeShapeView = (scene, scheduler, taps, width, height) => {
  const recording = new RecordingContext(width, height);
  return { view: new KitShapeView(scene, recording.context, scheduler, taps), painted: (p) => recording.painted(p) };
};
