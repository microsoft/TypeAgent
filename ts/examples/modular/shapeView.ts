/**
 * Showing shapes: ShapeView, a view of a ShapeCollection (shapeModel.ts).
 * Each ShapeView implementation draws on its platform's surface, and the
 * rules say only what each point shows. For now a ShapeView draws only
 * circles, with the identity viewport. Rules follow the format described
 * in rules.ts.
 *
 * @module
 */

import type { ShapeCollection } from "./shapeModel.ts";
import type { View } from "./view.ts";

/**
 * A view of shapes. It draws each kind of shape itself, on its platform's
 * surface; for now the only kind is Circle. painted(this, p) (shapeView.vocab.ts) is
 * what the view shows at point p.
 *
 * With no viewport transform yet, canonical coordinates are the view's
 * coordinates. The viewport stays the identity (scale 1, no rotation or
 * translation); setting another one is outside the rules.
 *
 * For now a ShapeView has no state of its own: it shows only the model.
 *
 * A view may cache each shape's drawing by ShapeId, since shapes are
 * immutable and a ShapeId is never made twice (ShapeMessageProcessor.new-ids).
 *
 * @requires circles-only  Every shape in the model is a Circle; other kinds are outside the rules until their drawing is specified.
 *   circles(this.model).length === this.model.size
 * @ensures first-frame  Requests a frame when created, so that its first frame shows the model.
 * @deferred view-state  A view draws its own state, such as a drag in progress or wet ink, above the model's shapes, and paints then covers both.
 *   when: a ShapeView has state of its own (the first drag or wet-ink task).
 *   how: shapeView.contract.ts gains steps that set and clear the view's state, and paints compares each point with the model's circles composited under that state; with an adversary that draws the state below the model.
 */
export interface ShapeView extends View<ShapeCollection> {
  /**
   * Draws the model as it is now.
   *
   * @ensures paints  Afterward, each point of the surface that is on no circle's edge shows the model's circles containing it, composited bottom to top, and nothing else.
   *   (p: Point) => implies(circles(this.model).every((c) => distToPolyline(p, [c.center]) !== c.radius),
   *     deepEqual(painted(this, p), over(circles(this.model).filter((c) => c.contains(p)).map((c) => c.color))))
   */
  frame(timeMs: number): void;
}
