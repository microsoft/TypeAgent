// A Circle for adversaries: correct unless a bug is switched on. helpers.check.ts
// runs the Circle contract against it with no bug, so a caught adversary means
// the bug was caught, not that the helper was wrong.

import type { Point, Rectangle } from "../geometry.ts";
import type { Color } from "../color.ts";
import type { Circle } from "../shape.ts";
import type { CircleFields } from "../circle.contract.ts";
import { allFinite, extents, inflate, isEmpty, rectContains, rectIntersects, validColor } from "../shape.vocab.ts";

export type CircleBug =
  | "none"
  | "box-uses-diameter"     // the bounding box is grown by the diameter, not the radius
  | "contains-strict"       // contains leaves out points at exactly the radius
  | "contains-closed"       // contains ignores the half-open rule at the maximum x and y
  | "contains-squared"      // contains compares squared distances, which round differently at the boundary
  | "intersects-by-box"     // intersects answers from the bounding box alone
  | "touch-is-true"         // intersects is distance <= radius, so a disk that only touches r intersects it
  | "touch-extremes-only"   // an exact touch checks r's excluded edges only at the circle's four extremes, not at r's corners
  | "skips-box-check"       // intersects skips the bounding-box check and decides by a recomputed distance alone
  | "empty-by-width"        // intersects treats r as empty only when its width or height is 0, and skips the box check
  | "accepts-zero-radius"   // makeCircle accepts a radius of 0
  | "keeps-center-object"   // makeCircle keeps the caller's center object
  | "alpha-as-byte"         // the color's alpha is stored from 0 to 255, as some platforms use
  | "caches-on-shape";      // contains remembers its last point in a field of the circle

export function makeTestCircle(bug: CircleBug = "none"): (fields: CircleFields) => Circle {
  return (f) => {
    const radiusOk = bug === "accepts-zero-radius" ? f.radius >= 0 : f.radius > 0;
    if (!allFinite([f.center.x, f.center.y, f.radius, f.color]) || !radiusOk || !validColor(f.color)) {
      throw new RangeError("invalid circle");
    }
    const center: Point = bug === "keeps-center-object" ? f.center : { x: f.center.x, y: f.center.y };
    const a = bug === "alpha-as-byte" ? Math.round(f.color.a * 255) : f.color.a;
    const color: Color = { r: f.color.r, g: f.color.g, b: f.color.b, a };
    const radius = f.radius;
    const box = inflate(extents([center]), bug === "box-uses-diameter" ? 2 * radius : radius);
    const dist = (p: Point) => Math.hypot(p.x - center.x, p.y - center.y);
    const remember = (p: Point) => {
      if (bug === "caches-on-shape") (circle as Circle & { lastQuery?: Point }).lastQuery = { x: p.x, y: p.y };
      return true;
    };
    const contains = (p: Point) => remember(p) && (
      bug === "contains-squared" ? rectContains(box, p) && (p.x - center.x) ** 2 + (p.y - center.y) ** 2 <= radius * radius
      : bug === "contains-closed" ? dist(p) <= radius
      : bug === "contains-strict" ? rectContains(box, p) && dist(p) < radius
      : rectContains(box, p) && dist(p) <= radius);
    const intersects = (r: Rectangle) => {
      if (bug === "empty-by-width" ? r.width === 0 || r.height === 0 : isEmpty(r)) return false;
      if (bug !== "touch-is-true" && bug !== "skips-box-check" && bug !== "empty-by-width" && !rectIntersects(box, r)) return false;
      if (bug === "intersects-by-box") return true;
      // The point of r (edges included) nearest the center.
      const q = {
        x: Math.min(Math.max(center.x, r.x), r.x + r.width),
        y: Math.min(Math.max(center.y, r.y), r.y + r.height),
      };
      const d = dist(q);
      if (bug === "touch-is-true") return d <= radius;
      if (d !== radius) return d < radius;
      if (bug === "touch-extremes-only" && q.x !== center.x && q.y !== center.y) return contains(q);
      return rectContains(r, q) && contains(q);
    };
    const circle: Circle = { kind: "circle", center, radius, color, boundingBox: () => box, contains, intersects };
    return circle;
  };
}
