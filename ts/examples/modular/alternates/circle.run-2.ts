/**
 * Circle implements Circle (shape.ts).
 *
 * How: Keeps its own copies of center and color, and a bounding box
 * computed once at construction. contains compares a point's distance
 * from center with the radius, inside the cached box. intersects first
 * rejects r unless it shares a point with the cached box, as computed,
 * then clamps r's closest point to the center; on an exact tie between
 * that distance and the radius, it asks contains() whether the clamped
 * point itself lies in both rectangles, so the circle's and the
 * rectangle's own half-open edges decide the touch.
 * Choose when: the region is a plain filled disk; cheaper to store and
 * test than approximating it with an InkStroke or a polygon.
 * Cost: boundingBox, contains and intersects are each O(1) time, with no
 * allocation beyond the circle's own fields.
 * AdditionalSemantics: boundingBox returns the same Rectangle object on
 * every call.
 * Parts: none
 * Imports: geometry.ts, color.ts, shape.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";

type CircleFields = { center: Point; radius: number; color: Color };

function validate(fields: CircleFields): void {
  const { center, radius, color } = fields;
  if (
    !Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(radius) ||
    !Number.isFinite(color.r) || !Number.isFinite(color.g) || !Number.isFinite(color.b) || !Number.isFinite(color.a)
  ) {
    throw new RangeError("Circle fields must be finite numbers");
  }
  if (!(radius > 0)) throw new RangeError("Circle.positive-radius: radius must be greater than 0");
  if (![color.r, color.g, color.b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    throw new RangeError("Color.rgb-range: r, g and b must be integers from 0 to 255");
  }
  if (!(color.a >= 0 && color.a <= 1)) throw new RangeError("Color.alpha-range: a must be from 0 to 1");
}

class CircleImpl implements Circle {
  readonly kind: "circle" = "circle";
  readonly center: Point;
  readonly radius: number;
  readonly color: Color;
  private readonly box: Rectangle;

  constructor(fields: CircleFields) {
    validate(fields);
    this.center = { x: fields.center.x, y: fields.center.y };
    this.radius = fields.radius;
    this.color = { r: fields.color.r, g: fields.color.g, b: fields.color.b, a: fields.color.a };
    this.box = {
      x: this.center.x - this.radius,
      y: this.center.y - this.radius,
      width: 2 * this.radius,
      height: 2 * this.radius,
    };
  }

  boundingBox(): Rectangle {
    return this.box;
  }

  contains(p: Point): boolean {
    return this.containsXY(p.x, p.y);
  }

  private containsXY(x: number, y: number): boolean {
    const box = this.box;
    if (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) return false;
    return Math.hypot(x - this.center.x, y - this.center.y) <= this.radius;
  }

  intersects(r: Rectangle): boolean {
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    if (right <= r.x || bottom <= r.y) return false;
    const box = this.box;
    const boxRight = box.x + box.width;
    const boxBottom = box.y + box.height;
    if (!(box.x < right && r.x < boxRight && box.y < bottom && r.y < boxBottom)) return false;
    const nx = Math.min(Math.max(this.center.x, r.x), right);
    const ny = Math.min(Math.max(this.center.y, r.y), bottom);
    const d = Math.hypot(nx - this.center.x, ny - this.center.y);
    if (d < this.radius) return true;
    if (d > this.radius) return false;
    return nx >= r.x && nx < right && ny >= r.y && ny < bottom && this.containsXY(nx, ny);
  }
}

export function makeCircle(fields: CircleFields): Circle {
  return new CircleImpl(fields);
}
