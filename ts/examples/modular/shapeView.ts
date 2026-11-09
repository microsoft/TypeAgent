/**
 * Showing shapes: the bridge between the shape data (shape.ts) and the
 * generic views (view.ts). It imports both, and neither imports it, so the
 * data side stays independent of views.
 *
 * A ShapeView doesn't depend on any drawing surface: each implementation
 * draws on its own platform's surface, such as a canvas (canvas.ts), and the
 * rules say only what each point shows. For now a ShapeView draws only
 * circles, with the identity viewport, and its only input is taps. Ink,
 * viewport transforms and other input come later. This file also holds
 * DrawingLayer, a layer of shapes that can be edited. Rules follow the
 * format described in rules.ts.
 *
 * @module
 */

import type { Shape } from "./shape.ts";
import type { ItemId, Layer, View } from "./view.ts";

/**
 * A view of shapes. It draws each kind of shape itself, on its platform's
 * surface; for now the only kind is Circle. painted(this, p) (shapeView.vocab.ts) is
 * what the view shows at point p.
 *
 * With no viewport transform yet, canonical coordinates are the surface's
 * own units. The viewport stays the identity (scale 1, no rotation or
 * translation); setting another one is outside the rules. Its only input
 * is taps, which it emits at the same point (View's taps rule).
 *
 * @requires fixed-layers  The scene's list of layers doesn't change while the view exists; the items in each layer may. The view starts listening to each layer when it is created.
 * @requires circles-only  Every item in the scene is a Circle; other kinds are outside the rules until their drawing is specified.
 *   circles(this.scene).length === items(this.scene).length
 * @ensures first-frame  Requests a frame when created, so that its first frame shows the scene.
 */
export interface ShapeView extends View<Shape> {
  /**
   * Draws the scene as it is now.
   *
   * @ensures paints  Afterward, each point of the surface that is on no circle's edge shows the circles containing it, composited bottom to top.
   *   (p: Point) => implies(circles(this.scene).every((c) => distToPolyline(p, [c.center]) !== c.radius),
   *     deepEqual(painted(this, p), over(circles(this.scene).filter((c) => c.contains(p)).map((c) => c.color))))
   */
  frame(timeMs: number): void;
}

/**
 * A layer of shapes with edits, for code that changes what a layer shows,
 * such as an app's controls (chrome.ts). Each item is its own shape and its
 * own region. ShapeLayer is one: it presents a ShapeCollection with a
 * ShapeLocator, and its edits change both.
 */
export interface DrawingLayer extends Layer<Shape> {
  /**
   * Adds shape as the top item, and emits change.
   *
   * @ensures on-top  The shape becomes the top item, under the returned ID, which wasn't present before; the other items stay, in the same order.
   *   deepEqual(ids(this), [...old(ids(this)), result]) && this.get(result) === shape
   */
  add(shape: Shape): ItemId;

  /**
   * Removes the item with ID id, if present, and emits change if it was.
   *
   * @ensures result  Returns whether the item was present; afterward it isn't, and the other items stay, in the same order.
   *   result === old(ids(this)).includes(id) && deepEqual(ids(this), old(ids(this)).filter((i) => i !== id))
   */
  remove(id: ItemId): boolean;

  /**
   * Removes every listed item that is present, and emits change once if any
   * was. IDs not present, and repeats, are ignored.
   *
   * @ensures result  Returns the number of items removed; the other items stay, in the same order.
   *   result === old(ids(this)).filter((i) => ids.includes(i)).length &&
   *     deepEqual(ids(this), old(ids(this)).filter((i) => !ids.includes(i)))
   */
  removeMultiple(ids: readonly ItemId[]): number;
}
