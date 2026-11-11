// A canvas ShapeView for the round 4 phase 1b adversaries: correct unless a
// bug is switched on. It differs from _view.ts in drawing only when
// something changed since its last frame, a common optimization.

import type { Viewport } from "../geometry.ts";
import type { Circle } from "../shape.ts";
import type { ShapeCollection } from "../shapeModel.ts";
import type { DrawingContext } from "../canvas.ts";
import type { ShapeView } from "../shapeView.ts";
import type { FrameScheduler } from "../frames.ts";
import type { MakeShapeView } from "../shapeView.contract.ts";
import { RecordingContext } from "../viewkit.ts";
import { Events } from "../eventkit.ts";

export type DirtyViewBug =
  | "none"
  | "starts-clean"        // the dirty flag starts false, so the first frame draws nothing
  | "alpha-two-decimals"; // fillStyle's alpha is written with toFixed(2)

const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export class DirtyShapeView extends Events<{ viewport: [Viewport] }> implements ShapeView {
  readonly model: ShapeCollection;
  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  private readonly bug: DirtyViewBug;
  private disposed = false;
  private dirty: boolean;
  private readonly onChange = () => {
    this.dirty = true;
    this.scheduler.requestFrame(this);
  };

  constructor(model: ShapeCollection, context: DrawingContext, scheduler: FrameScheduler, bug: DirtyViewBug = "none") {
    super();
    this.model = model;
    this.context = context;
    this.scheduler = scheduler;
    this.bug = bug;
    this.dirty = bug !== "starts-clean";
    model.on("change", this.onChange);
    scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    return identity;
  }

  set viewport(_: Viewport) {
    // Only the identity viewport is supported; anything else is outside the rules.
  }

  frame(_timeMs: number): void {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    const c = this.context;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    this.model.forEach((_, shape) => {
      const { center, radius, color } = shape as Circle;
      const a = this.bug === "alpha-two-decimals" ? color.a.toFixed(2) : color.a;
      c.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
      c.beginPath();
      c.arc(center.x, center.y, radius, 0, 2 * Math.PI);
      c.fill();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.model.off("change", this.onChange);
  }
}

export function makeDirtyView(bug: DirtyViewBug = "none"): MakeShapeView {
  return (model, scheduler, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new DirtyShapeView(model, recording.context, scheduler, bug), painted: (p) => recording.painted(p) };
  };
}
