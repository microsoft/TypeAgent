/**
 * rectangleOps implements RectangleOps.
 *
 * How: Direct comparisons of edge coordinates under the half-open convention; empty rectangles are rejected up front in intersects.
 * Choose when: Always; this is the only RectangleOps and has no tuning knobs.
 * Cost: O(1) time and no allocation per call.
 * AdditionalSemantics: none
 * Parts: none
 * Imports: geometry.ts
 */

import type { Point, Rectangle, RectangleOps } from "./geometry.ts";

function isEmpty(r: Rectangle): boolean {
  return r.width === 0 || r.height === 0;
}

export const rectangleOps: RectangleOps = Object.freeze({
  contains(r: Rectangle, p: Point): boolean {
    return r.x <= p.x && p.x < r.x + r.width && r.y <= p.y && p.y < r.y + r.height;
  },

  intersects(a: Rectangle, b: Rectangle): boolean {
    return !isEmpty(a) && !isEmpty(b) &&
      a.x < b.x + b.width && b.x < a.x + a.width &&
      a.y < b.y + b.height && b.y < a.y + a.height;
  },
});
