/**
 * Vocabulary for rule expressions about geometry.ts: reference functions
 * for rectangles and polylines. Re-exports rules.ts, so a rule expression
 * about geometry uses this file alone.
 *
 * @module
 */

import type { Align, Edge, Point, Rectangle, Viewport } from "./geometry.ts";

export * from "./rules.ts";

/** Whether r holds Rectangle's @valid rules. */
export function validRect(r: Rectangle): boolean {
  return r.width >= 0 && r.height >= 0;
}

/** Whether v holds Viewport's @valid rules. */
export function validViewport(v: Viewport): boolean {
  return v.scale > 0;
}

/** Empty as computed: width or height 0, or so small that x + width rounds back to x (geometry.ts). */
export function isEmpty(r: Rectangle): boolean {
  return right(r) <= r.x || bottom(r) <= r.y;
}

export function right(r: Rectangle): number {
  return r.x + r.width;
}

export function bottom(r: Rectangle): number {
  return r.y + r.height;
}

/** Whether r's x, y, right and bottom all lie within ±limit. */
export function inRange(r: Rectangle, limit: number): boolean {
  return [r.x, r.y, right(r), bottom(r)].every((v) => Math.abs(v) <= limit);
}

export function rectContains(r: Rectangle, p: Point): boolean {
  return r.x <= p.x && p.x < right(r) && r.y <= p.y && p.y < bottom(r);
}

export function rectIntersects(a: Rectangle, b: Rectangle): boolean {
  return !isEmpty(a) && !isEmpty(b) &&
    a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

/** The smallest rectangle whose closed extents include every point. */
export function extents(points: readonly Point[]): Rectangle {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** r grown by d on every side. */
export function inflate(r: Rectangle, d: number): Rectangle {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
}

/** Distance from p to the nearest point of the polyline through points. */
export function distToPolyline(p: Point, points: readonly Point[]): number {
  let best = Math.hypot(p.x - points[0].x, p.y - points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Distance from p to the nearest point of r, including r's edges. */
export function distPointToRect(p: Point, r: Rectangle): number {
  const dx = Math.max(r.x - p.x, 0, p.x - right(r));
  const dy = Math.max(r.y - p.y, 0, p.y - bottom(r));
  return Math.hypot(dx, dy);
}

/** Whether segment ab touches r, including r's edges (Liang–Barsky clipping). */
function segmentTouchesRect(a: Point, b: Point, r: Rectangle): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 <= t1;
  };
  return clip(-dx, a.x - r.x) && clip(dx, right(r) - a.x) &&
    clip(-dy, a.y - r.y) && clip(dy, bottom(r) - a.y);
}

/** Distance from the polyline through points to the nearest point of r, including r's edges. */
export function distPolylineToRect(points: readonly Point[], r: Rectangle): number {
  let best = distPointToRect(points[0], r);
  const corners: Point[] = [
    { x: r.x, y: r.y }, { x: right(r), y: r.y },
    { x: r.x, y: bottom(r) }, { x: right(r), y: bottom(r) },
  ];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (segmentTouchesRect(a, b, r)) return 0;
    best = Math.min(best, distPointToRect(b, r), ...corners.map((c) => distToPolyline(c, [a, b])));
  }
  return best;
}

/** Whether a lies within b, edges included. */
export function within(a: Rectangle, b: Rectangle): boolean {
  return a.x >= b.x && a.y >= b.y && right(a) <= right(b) && bottom(a) <= bottom(b);
}

// ---- Carving ----------------------------------------------------------------

/** The strip of size cut off edge of r, and the rest (RectangleOps.cut). */
export function cutRect(r: Rectangle, edge: Edge, size: number): [Rectangle, Rectangle] {
  const { x, y, width: w, height: h } = r;
  if (edge === "left" || edge === "right") {
    const s = Math.min(size, w);
    return edge === "left"
      ? [{ x, y, width: s, height: h }, { x: x + s, y, width: w - s, height: h }]
      : [{ x: x + w - s, y, width: s, height: h }, { x, y, width: w - s, height: h }];
  }
  const s = Math.min(size, h);
  return edge === "top"
    ? [{ x, y, width: w, height: s }, { x, y: y + s, width: w, height: h - s }]
    : [{ x, y: y + h - s, width: w, height: s }, { x, y, width: w, height: h - s }];
}

/**
 * total divided among weights: each share rounded down, then the whole units
 * left over given one each to the shares with the largest fractional parts,
 * earlier shares first on ties (the largest-remainder method). Any fraction
 * of a unit left after that, which arises only when total isn't whole, goes
 * to the last share. The shares add up to total.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const sizes = exact.map(Math.floor);
  const left = total - sizes.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => i).sort((i, j) => (exact[j] - sizes[j]) - (exact[i] - sizes[i]) || i - j);
  for (const i of order.slice(0, Math.floor(left))) sizes[i] += 1;
  sizes[sizes.length - 1] += left - Math.floor(left);
  return sizes;
}

/** r split along an axis by weights (RectangleOps.splitHoriz and splitVert). */
export function splitRect(r: Rectangle, axis: "horizontal" | "vertical", weights: readonly number[]): Rectangle[] {
  const horizontal = axis === "horizontal";
  const sizes = apportion(horizontal ? r.width : r.height, weights);
  let at = horizontal ? r.x : r.y;
  return sizes.map((s) => {
    const piece = horizontal ? { x: at, y: r.y, width: s, height: r.height } : { x: r.x, y: at, width: r.width, height: s };
    at += s;
    return piece;
  });
}

/** r shrunk by d on every side, empty at its center along an axis it doesn't fit (RectangleOps.inset). */
export function insetRect(r: Rectangle, d: number): Rectangle {
  const width = Math.max(0, r.width - 2 * d);
  const height = Math.max(0, r.height - 2 * d);
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
}

/** A rectangle of size aligned within r, its size reduced to r's (RectangleOps.place). */
export function placeRect(r: Rectangle, size: { width: number; height: number }, alignX: Align, alignY: Align): Rectangle {
  const width = Math.min(size.width, r.width);
  const height = Math.min(size.height, r.height);
  const at = (start: number, room: number, align: Align) =>
    align === "start" ? start : align === "end" ? start + room : start + Math.floor(room / 2);
  return { x: at(r.x, r.width - width, alignX), y: at(r.y, r.height - height, alignY), width, height };
}
