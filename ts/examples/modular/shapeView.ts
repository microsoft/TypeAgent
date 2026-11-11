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
 * A view may cache each shape's drawing by ShapeId, since shapes are
 * immutable and a ShapeId is never made twice (ShapeMessageProcessor.new-ids).
 *
 * @requires circles-only  Every shape in the model is a Circle; other kinds are outside the rules until their drawing is specified.
 *   circles(this.model).length === this.model.size
 * @ensures first-frame  Requests a frame when created, so that its first frame shows the model.
 */
export interface ShapeView extends View<ShapeCollection> {
  /**
   * Draws the model as it is now.
   *
   * @ensures paints  Afterward, each point of the surface that is on no circle's edge shows the circles containing it, composited bottom to top.
   *   (p: Point) => implies(circles(this.model).every((c) => distToPolyline(p, [c.center]) !== c.radius),
   *     deepEqual(painted(this, p), over(circles(this.model).filter((c) => c.contains(p)).map((c) => c.color))))
   */
  frame(timeMs: number): void;
}
