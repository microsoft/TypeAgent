/**
 * Vocabulary for rule expressions about view.ts: ghost state for layers,
 * and the items of a scene. Re-exports the vocabulary of the files view.ts
 * imports.
 *
 * @module
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { ItemId, Layer, Scene } from "./view.ts";
import { entries } from "./rules.ts";

export * from "./geometry.vocab.ts";

/** A region of the plane, as a layer's source defines it. A Shape is one. */
export interface Region {
  contains(p: Point): boolean;
  intersects(r: Rectangle): boolean;
}

/**
 * Ghost state: the region each of a layer's items covers, as the layer's
 * source defines it. For a layer presenting shapes, each item is its own
 * region. Test harnesses get regions from the source they build.
 */
export declare function regions<T>(layer: Layer<T>): ReadonlyMap<ItemId, Region>;

/** Every item in the scene: layers bottom to top, each layer's items in z-order. */
export function items<T>(scene: Scene<T>): T[] {
  return scene.layers.flatMap((layer) => entries(layer).map(([, item]) => item));
}
