/**
 * CanvasShapeView implements ShapeView.
 *
 * How: holds the model, a canvas drawing context and a frame scheduler; a
 * change listener on the model asks the scheduler for a frame, and each
 * frame clears the whole canvas once and fills one arc per circle, in the
 * model's forEach order, bottom to top.
 * Choose when: the platform draws with a canvas context (the web, or any
 * surface wrapped in canvas.ts's subset) and the whole model is visible,
 * so there is nothing to cull and no viewport to apply.
 * Cost: the constructor is constant time and allocates the listener and the
 * registration list. frame() is one clearRect plus four context calls per
 * circle, so time proportional to the model's size, with one fillStyle
 * string allocated per circle and nothing retained between frames. on and
 * off are constant and linear in the viewport registrations respectively;
 * dispose is constant.
 * AdditionalSemantics: every set of viewport is ignored, the identity
 * because that is a no-op and any other value because it is outside the
 * rules for now; viewport reads as one shared immutable identity object,
 * the same one every time. Each frame draws every circle, including ones
 * wholly off the surface, and caches nothing by ShapeId, so a frame shows
 * the model as it is at that moment. The canvas's size is read each frame,
 * so a resized canvas is cleared in full at the next frame. A shape whose
 * kind is not "circle" is skipped rather than drawn or reported, since
 * ShapeView.circles-only says the model has none. Registrations for the
 * viewport event are kept in order so that off removes the most recent,
 * but nothing calls them, because viewport is never emitted yet.
 * Parts: none.
 * Imports: geometry.ts, shape.ts, shapeModel.ts, frames.ts, shapeView.ts, canvas.ts
 */

import type { Viewport } from "./geometry.ts";
import type { Circle, Shape } from "./shape.ts";
import type { ShapeCollection } from "./shapeModel.ts";
import type { FrameScheduler } from "./frames.ts";
import type { ShapeView } from "./shapeView.ts";
import type { DrawingContext } from "./canvas.ts";

/** The events a View emits. */
type ViewEvents = { viewport: [Viewport] };

/** The only viewport a ShapeView has, shared because a Viewport is a value. */
const identity: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

/** Whether a shape is a circle: the only kind this view draws. */
function isCircle(shape: Shape): shape is Circle {
  return shape.kind === "circle";
}

export class CanvasShapeView implements ShapeView {
  readonly model: ShapeCollection;
  private readonly context: DrawingContext;
  private readonly scheduler: FrameScheduler;
  /** The model listener, kept so that dispose can remove this exact one. */
  private readonly onChange: () => void;
  /** The viewport event's registrations, oldest first. */
  private readonly viewportListeners: unknown[] = [];
  private disposed = false;

  constructor(model: ShapeCollection, context: DrawingContext, scheduler: FrameScheduler) {
    this.model = model;
    this.context = context;
    this.scheduler = scheduler;
    this.onChange = () => this.scheduler.requestFrame(this);
    model.on("change", this.onChange);
    scheduler.requestFrame(this);
  }

  get viewport(): Viewport {
    return identity;
  }

  set viewport(_value: Viewport) {
    // Setting the identity does nothing (View.viewport.set-equal), and any
    // other viewport is outside the rules for now, so every set is ignored.
  }

  /** Clears the canvas and draws the model's circles, bottom to top. */
  frame(_timeMs: number): void {
    if (this.disposed) return;
    const { width, height } = this.context.canvas;
    this.context.clearRect(0, 0, width, height);
    // forEach, not a query: without a viewport the whole model is visible.
    this.model.forEach((_id, shape) => {
      if (isCircle(shape)) this.fillCircle(shape);
    });
  }

  on<E extends keyof ViewEvents & string>(_event: E, listener: (...args: ViewEvents[E]) => void): this {
    this.viewportListeners.push(listener as unknown);
    return this;
  }

  off<E extends keyof ViewEvents & string>(_event: E, listener: (...args: ViewEvents[E]) => void): this {
    const i = this.viewportListeners.lastIndexOf(listener as unknown);
    if (i >= 0) this.viewportListeners.splice(i, 1);
    return this;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.model.off("change", this.onChange);
  }

  private fillCircle(circle: Circle): void {
    const { r, g, b, a } = circle.color;
    this.context.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    this.context.beginPath();
    this.context.arc(circle.center.x, circle.center.y, circle.radius, 0, 2 * Math.PI);
    this.context.fill();
  }
}
