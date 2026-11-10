// The reference ShapeView: draws circles on a DrawingContext the way
// impl-specs.md section 12 describes, so that tests of other parts don't
// depend on any generated view. helpers.check.ts runs the ShapeView
// contract on it. The view's own generation task never sees this file.

import type { Viewport } from "./geometry.ts";
import type { Circle, Shape } from "./shape.ts";
import type { DrawingContext } from "./canvas.ts";
import type { Scene } from "./view.ts";
import type { FrameScheduler } from "./frames.ts";
import type { ShapeView } from "./shapeView.ts";
import type { MakeShapeView } from "./shapeView.contract.ts";
import { Events } from "./eventkit.ts";
import { RecordingContext } from "./viewkit.ts";

const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export class KitShapeView extends Events<{ viewport: [Viewport] }> implements ShapeView {
  readonly scene: Scene<Shape>;
  private disposed = false;
  private readonly onChange = () => this.scheduler.requestFrame(this);

  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;

  constructor(scene: Scene<Shape>, context: DrawingContext, scheduler: FrameScheduler) {
    super();
    this.scene = scene;
    this.context = context;
    this.scheduler = scheduler;
    for (const group of scene.groups) group.on("change", this.onChange);
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
    for (const group of this.scene.groups) {
      group.forEach((_, item) => {
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
    for (const group of this.scene.groups) group.off("change", this.onChange);
  }
}

/** A KitShapeView on a RecordingContext, in the ShapeView contract's shape. */
export const kitView: MakeShapeView = (scene, scheduler, width, height) => {
  const recording = new RecordingContext(width, height);
  return { view: new KitShapeView(scene, recording.context, scheduler), painted: (p) => recording.painted(p) };
};
