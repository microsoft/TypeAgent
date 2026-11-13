/**
 * CanvasShapeView implements ShapeView.
 *
 * How: adds one change listener to the model that requests a frame, and
 * requests a frame when constructed; frame() clears the whole canvas with
 * one clearRect, then draws the model's circles bottom to top with
 * beginPath/arc/fill, setting fillStyle to an rgba() string first.
 * Choose when: the platform's surface is a browser canvas, or anything
 * that implements the DrawingContext subset of one.
 * Cost: frame() is O(n) in the number of shapes in the model, with one
 * beginPath/arc/fill per circle and no allocation beyond the fillStyle
 * string and arguments object per shape.
 * AdditionalSemantics: on/off register and unregister viewport listeners
 * as EventEmitter requires, even though viewport is never emitted; a shape
 * whose kind isn't "circle" is skipped rather than drawn.
 * Parts: none
 * Imports: geometry.ts, shape.ts, shapeModel.ts, canvas.ts, frames.ts, shapeView.ts
 */

import type { Viewport } from "./geometry.ts";
import type { Circle, Shape } from "./shape.ts";
import type { ShapeCollection } from "./shapeModel.ts";
import type { DrawingContext } from "./canvas.ts";
import type { FrameScheduler } from "./frames.ts";
import type { ShapeView } from "./shapeView.ts";

function isCircle(shape: Shape): shape is Circle {
  return shape.kind === "circle";
}

export class CanvasShapeView implements ShapeView {
  readonly model: ShapeCollection;
  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  private readonly viewportListeners: ((v: Viewport) => void)[] = [];
  private disposed = false;

  private readonly onChange = (): void => {
    this.scheduler.requestFrame(this);
  };

  constructor(model: ShapeCollection, context: DrawingContext, scheduler: FrameScheduler) {
    this.model = model;
    this.context = context;
    this.scheduler = scheduler;
    this.model.on("change", this.onChange);
    this.scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    return { scale: 1, rotation: 0, tx: 0, ty: 0 };
  }

  set viewport(_value: Viewport) {
    // Only the identity viewport is supported; every set is ignored,
    // whether or not the value given is the identity.
  }

  on(_event: "viewport", listener: (v: Viewport) => void): this {
    this.viewportListeners.push(listener);
    return this;
  }

  off(_event: "viewport", listener: (v: Viewport) => void): this {
    const index = this.viewportListeners.lastIndexOf(listener);
    if (index !== -1) this.viewportListeners.splice(index, 1);
    return this;
  }

  frame(_timeMs: number): void {
    if (this.disposed) return;
    const { width, height } = this.context.canvas;
    this.context.clearRect(0, 0, width, height);
    this.model.forEach((_id, shape) => {
      if (!isCircle(shape)) return;
      const { center, radius, color } = shape;
      this.context.beginPath();
      this.context.arc(center.x, center.y, radius, 0, 2 * Math.PI);
      this.context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
      this.context.fill();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.model.off("change", this.onChange);
  }
}
