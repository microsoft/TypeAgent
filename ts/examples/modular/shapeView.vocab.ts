/**
 * Vocabulary for rule expressions about shapeView.ts: a scene's circles,
 * and what a view shows. Re-exports the vocabulary of the files
 * shapeView.ts imports.
 *
 * @module
 */

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape } from "./shape.ts";
import type { Scene } from "./view.ts";
import type { ShapeView } from "./shapeView.ts";
import { items } from "./view.vocab.ts";

export * from "./shape.vocab.ts";
export * from "./view.vocab.ts";

/** The scene's circles, in the order items lists them. */
export function circles(scene: Scene<Shape>): Circle[] {
  return items(scene).filter((s): s is Circle => s.kind === "circle");
}


/**
 * Ghost state: what the view shows at p on its surface, as the contract's
 * fixture for that view reports it. For a canvas view, the fixture's
 * recording context computes it from the calls it received.
 */
export declare function painted(view: ShapeView, p: Point): Color;
