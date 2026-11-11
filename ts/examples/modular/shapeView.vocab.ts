/**
 * Vocabulary for rule expressions about shapeView.ts: a model's circles,
 * and what a view shows. Re-exports the vocabulary of the files
 * shapeView.ts imports.
 *
 * @module
 */

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";
import type { ShapeCollection } from "./shapeModel.ts";
import type { ShapeView } from "./shapeView.ts";
import { entries } from "./rules.ts";

export * from "./shapeModel.vocab.ts";
export * from "./view.vocab.ts";

/** The model's circles, bottom to top. */
export function circles(model: ShapeCollection): Circle[] {
  return entries(model).map(([, s]) => s).filter((s): s is Circle => s.kind === "circle");
}

/** Ghost state: whether p is on the view's surface, as the contract's fixture for that view reports it. */
export declare function onSurface(view: ShapeView, p: Point): boolean;

/**
 * Ghost state: what the view shows at p on its surface, as the contract's
 * fixture for that view reports it. For a canvas view, the fixture's
 * recording context computes it from the calls it received.
 */
export declare function painted(view: ShapeView, p: Point): Color;
