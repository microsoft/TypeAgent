/**
 * makeInkStroke implements InkStroke.
 *
 * How: Validates and deep-copies the fields into a frozen value, precomputes the bounding box, and answers contains and intersects from exact point-to-segment and segment-to-rectangle distances over the polyline.
 * Choose when: Always for ink; it is the only InkStroke and keeps no acceleration structure, so it suits strokes of up to a few thousand points.
 * Cost: makeInkStroke O(n) time and O(n) allocation for n points; boundingBox O(1), no allocation; contains O(n), no allocation; intersects O(n), no allocation.
 * AdditionalSemantics: The stroke, its points array, each point and its color are frozen. Points and color are copied as plain objects holding only x, y (and r, g, b, a). intersects resolves exact distance ties precisely: it is true exactly when some point the stroke contains lies in r. contains and intersects both clip to the computed bounding box (all four edges), so near its left and top edges, where box.x and box.y may be rounded, the computed box wins over the computed pen distance.
 * Parts: Polyline distance functions (point to polyline, polyline to closed rectangle), which could become a shared geometry-kernel interface.
 * Imports: geometry.ts, color.ts, shape.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { InkStroke } from "./shape.ts";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function copyPoint(p: Point, i: number): Point {
  if (p === null || typeof p !== "object" || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    throw new RangeError(`finite: points[${i}] must have finite numeric x and y`);
  }
  return Object.freeze({ x: p.x, y: p.y });
}

function copyColor(c: Color): Color {
  if (c === null || typeof c !== "object") throw new RangeError("color must be an object");
  for (const k of ["r", "g", "b"] as const) {
    const v = c[k];
    if (!isFiniteNumber(v) || !Number.isInteger(v) || v < 0 || v > 255) {
      throw new RangeError(`Color.rgb-range: ${k} must be an integer from 0 to 255, got ${v}`);
    }
  }
  if (!isFiniteNumber(c.a) || c.a < 0 || c.a > 1) {
    throw new RangeError(`Color.alpha-range: a must be from 0 to 1, got ${c.a}`);
  }
  return Object.freeze({ r: c.r, g: c.g, b: c.b, a: c.a });
}

/** Distance from p to the nearest point of segment ab (a point when a equals b). */
function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Distance from (px, py) to the nearest point of the polyline. */
function distToPolyline(px: number, py: number, points: readonly Point[]): number {
  let best = Math.hypot(px - points[0].x, py - points[0].y);
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distToSegment(px, py, points[i - 1], points[i]));
  }
  return best;
}

/** Distance from (px, py) to the closed rectangle [x0, x1] × [y0, y1]. */
function distPointToBox(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}

/** Whether segment ab touches the closed rectangle [x0, x1] × [y0, y1] (Liang–Barsky clipping). */
function segmentTouchesBox(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 <= t1;
  };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y);
}

/** Distance from the polyline to the closed rectangle [x0, x1] × [y0, y1]. */
function distPolylineToBox(points: readonly Point[], x0: number, y0: number, x1: number, y1: number): number {
  let best = distPointToBox(points[0].x, points[0].y, x0, y0, x1, y1);
  for (let i = 1; i < points.length && best > 0; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (segmentTouchesBox(a, b, x0, y0, x1, y1)) return 0;
    best = Math.min(
      best,
      distPointToBox(b.x, b.y, x0, y0, x1, y1),
      distToSegment(x0, y0, a, b), distToSegment(x1, y0, a, b),
      distToSegment(x0, y1, a, b), distToSegment(x1, y1, a, b),
    );
  }
  return best;
}

class Ink implements InkStroke {
  readonly kind = "ink" as const;
  readonly points: readonly Point[];
  readonly thickness: number;
  readonly color: Color;
  readonly #box: Rectangle;
  readonly #radius: number;

  constructor(points: readonly Point[], thickness: number, color: Color) {
    this.points = points;
    this.thickness = thickness;
    this.color = color;
    this.#radius = thickness / 2;
    // Same arithmetic as inflate(extents(points), thickness / 2), so the box matches it bit for bit.
    let minX = points[0].x, maxX = minX, minY = points[0].y, maxY = minY;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const d = this.#radius;
    this.#box = Object.freeze({ x: minX - d, y: minY - d, width: (maxX - minX) + 2 * d, height: (maxY - minY) + 2 * d });
    Object.freeze(this);
  }

  boundingBox(): Rectangle {
    return this.#box;
  }

  contains(p: Point): boolean {
    const box = this.#box;
    // The left and top tests matter only as computed: box.x and box.y are rounded, so a point just
    // outside them can still be within the radius by computed distance (Shape.contains.implies-box).
    return box.x <= p.x && p.x < box.x + box.width && box.y <= p.y && p.y < box.y + box.height &&
      distToPolyline(p.x, p.y, this.points) <= this.#radius;
  }

  intersects(r: Rectangle): boolean {
    const box = this.#box;
    if (r.width === 0 || r.height === 0) return false;
    // Clip r to the half-open box: R = [x0, x1) × [y0, y1). Every contained point lies in it.
    const x0 = Math.max(r.x, box.x);
    const y0 = Math.max(r.y, box.y);
    const x1 = Math.min(r.x + r.width, box.x + box.width);
    const y1 = Math.min(r.y + r.height, box.y + box.height);
    if (!(x0 < x1 && y0 < y1)) return false;
    // The pen reaches strictly into the closure of R, so it covers points of R itself.
    if (distPolylineToBox(this.points, x0, y0, x1, y1) < this.#radius) return true;
    // Otherwise the pen can at most touch R. A touching point inside half-open R lies on its
    // left or top edge, and is the corner (x0, y0) or a vertex projected onto one of those
    // edges; test those candidates with the same rule contains() uses.
    if (this.#reaches(x0, y0)) return true;
    for (const v of this.points) {
      const cy = Math.min(Math.max(v.y, y0), y1);
      if (cy < y1 && this.#reaches(x0, cy)) return true;
      const cx = Math.min(Math.max(v.x, x0), x1);
      if (cx < x1 && this.#reaches(cx, y0)) return true;
    }
    return false;
  }

  #reaches(x: number, y: number): boolean {
    return distToPolyline(x, y, this.points) <= this.#radius;
  }
}

export function makeInkStroke(fields: { points: readonly Point[]; thickness: number; color: Color }): InkStroke {
  const { points, thickness, color } = fields;
  if (!Array.isArray(points) || points.length < 1) {
    throw new RangeError("InkStroke.has-points: a stroke needs at least one point");
  }
  if (!isFiniteNumber(thickness)) throw new RangeError(`finite: thickness must be finite, got ${thickness}`);
  if (!(thickness >= 1)) throw new RangeError(`InkStroke.min-thickness: thickness must be at least 1, got ${thickness}`);
  const copied = Object.freeze(points.map(copyPoint));
  return new Ink(copied, thickness, copyColor(color));
}
