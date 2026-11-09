// RectangleOps for adversaries: the reference functions in geometry.vocab.ts,
// correct unless a bug is switched on. helpers.check.ts runs the
// RectangleOps contract against it with no bug.

import type { Align, Edge, Point, Rectangle, RectangleOps } from "../geometry.ts";
import { cutRect, insetRect, placeRect, rectContains, rectIntersects, splitRect } from "../geometry.vocab.ts";

export type RectBug =
  | "none"
  | "remainder-to-last"     // every leftover unit goes to the last share
  | "shares-rounded"        // shares are rounded to nearest, so they may not add up
  | "fraction-to-first"     // a fraction of a unit goes to the first share
  | "vert-by-width"         // splitVert divides the width, not the height
  | "cut-right-from-left"   // cutting the right edge takes the strip from the left
  | "cut-unclamped"         // a cut larger than the rectangle leaves a negative rest
  | "inset-unclamped"       // inset can make a negative size
  | "inset-at-corner"       // a too-small inset sits at the top left plus d, not the center
  | "place-center-up"       // centering rounds up
  | "place-unclamped";      // a size larger than r isn't reduced

function shares(total: number, weights: readonly number[], bug: RectBug): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  if (bug === "shares-rounded") return exact.map(Math.round);
  const sizes = exact.map(Math.floor);
  const left = total - sizes.reduce((a, b) => a + b, 0);
  const whole = Math.floor(left);
  if (bug === "remainder-to-last") {
    sizes[sizes.length - 1] += left;
    return sizes;
  }
  const order = exact.map((e, i) => i).sort((i, j) => (exact[j] - sizes[j]) - (exact[i] - sizes[i]) || i - j);
  for (const i of order.slice(0, whole)) sizes[i] += 1;
  sizes[bug === "fraction-to-first" ? 0 : sizes.length - 1] += left - whole;
  return sizes;
}

function split(r: Rectangle, horizontal: boolean, weights: readonly number[], bug: RectBug): Rectangle[] {
  if (bug === "none") return splitRect(r, horizontal ? "horizontal" : "vertical", weights);
  const sizes = shares(horizontal || bug === "vert-by-width" ? r.width : r.height, weights, bug);
  let at = horizontal ? r.x : r.y;
  return sizes.map((s) => {
    const piece = horizontal ? { x: at, y: r.y, width: s, height: r.height } : { x: r.x, y: at, width: r.width, height: s };
    at += s;
    return piece;
  });
}

export function makeTestRectOps(bug: RectBug = "none"): RectangleOps {
  return {
    contains: (r: Rectangle, p: Point) => rectContains(r, p),
    intersects: (a: Rectangle, b: Rectangle) => rectIntersects(a, b),
    cut(r: Rectangle, edge: Edge, size: number): [Rectangle, Rectangle] {
      if (bug === "cut-right-from-left" && edge === "right") {
        const [piece, rest] = cutRect(r, "left", size);
        return [piece, rest];
      }
      if (bug === "cut-unclamped" && edge === "left") {
        return [{ ...r, width: size }, { ...r, x: r.x + size, width: r.width - size }];
      }
      return cutRect(r, edge, size);
    },
    splitHoriz: (r: Rectangle, ...weights: number[]) => split(r, true, weights, bug),
    splitVert: (r: Rectangle, ...weights: number[]) => split(r, false, weights, bug),
    inset(r: Rectangle, d: number): Rectangle {
      if (bug === "inset-unclamped") return { x: r.x + d, y: r.y + d, width: r.width - 2 * d, height: r.height - 2 * d };
      if (bug === "inset-at-corner") {
        return { x: r.x + d, y: r.y + d, width: Math.max(0, r.width - 2 * d), height: Math.max(0, r.height - 2 * d) };
      }
      return insetRect(r, d);
    },
    place(r: Rectangle, size: { width: number; height: number }, alignX: Align, alignY: Align): Rectangle {
      if (bug === "place-unclamped") {
        const p = placeRect(r, { width: 0, height: 0 }, "start", "start");
        return { ...p, width: size.width, height: size.height, x: alignX === "start" ? r.x : p.x, y: alignY === "start" ? r.y : p.y };
      }
      const placed = placeRect(r, size, alignX, alignY);
      if (bug === "place-center-up" && alignX === "center") {
        return { ...placed, x: r.x + Math.ceil((r.width - placed.width) / 2) };
      }
      return placed;
    },
  };
}
