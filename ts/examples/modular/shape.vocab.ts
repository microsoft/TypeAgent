/**
 * Vocabulary for rule expressions about shape.ts: ghost state for locators.
 * Re-exports the vocabulary of the files shape.ts imports, so a rule
 * expression about shapes uses this file alone.
 *
 * @module
 */

import type { Circle, Shape, ShapeId, ShapeLocatorQueries } from "./shape.ts";

import { validColor } from "./color.vocab.ts";

export * from "./geometry.vocab.ts";
export * from "./color.vocab.ts";

/** Whether c holds Circle's @valid rules, and its color Color's. */
export function validCircle(c: Pick<Circle, "radius" | "color">): boolean {
  return c.radius > 0 && validColor(c.color);
}

/**
 * Ghost state: the shapes that q's queries are about. For a ShapeLocator,
 * those added and not yet removed, as tracked by the test harness from its
 * add, remove and removeMultiple calls; the interface does not expose them.
 */
export declare function indexed(q: ShapeLocatorQueries): ReadonlyMap<ShapeId, Shape>;
