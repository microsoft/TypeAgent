/**
 * Vocabulary for rule expressions about view.ts: ghost state for groups,
 * and the items of a scene. Re-exports the vocabulary of the files view.ts
 * imports.
 *
 * @module
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { ItemId, RenderGroup, Scene } from "./view.ts";
import { entries } from "./rules.ts";

export * from "./geometry.vocab.ts";

/** A region of the plane, as a group's source defines it. A Shape is one. */
export interface Region {
  contains(p: Point): boolean;
  intersects(r: Rectangle): boolean;
}

/**
 * Ghost state: the region each of a group's items covers, as the group's
 * source defines it. For a group presenting shapes, each item is its own
 * region. Test harnesses get regions from the source they build.
 */
export declare function regions<T>(group: RenderGroup<T>): ReadonlyMap<ItemId, Region>;

/** Every item in the scene: groups bottom to top, each group's items in z-order. */
export function items<T>(scene: Scene<T>): T[] {
  return scene.groups.flatMap((group) => entries(group).map(([, item]) => item));
}
