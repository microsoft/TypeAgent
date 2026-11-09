// Generators shared by the contract suites. Coordinates are multiples of 0.5
// on a small grid, so that generated values often land exactly on edges and
// corners, where half-open bugs live, while arithmetic stays exact.

import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Shape } from "./shape.ts";
import { isEmpty, rectContains, rectIntersects } from "./geometry.vocab.ts";

// FC_SEED makes runs repeatable; npm run adversaries sets it.
if (process.env.FC_SEED) fc.configureGlobal({ seed: Number(process.env.FC_SEED) });

export const coord = (limit = 20): fc.Arbitrary<number> =>
  fc.integer({ min: -2 * limit, max: 2 * limit }).map((n) => n / 2);

export const size = (max = 10): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 2 * max }).map((n) => n / 2);

export const point = (limit = 20): fc.Arbitrary<Point> =>
  fc.record({ x: coord(limit), y: coord(limit) });

/** Rectangles, including empty ones. */
export const rect = (limit = 20): fc.Arbitrary<Rectangle> =>
  fc.record({ x: coord(limit), y: coord(limit), width: size(), height: size() });

export const nonEmptyRect = (limit = 20): fc.Arbitrary<Rectangle> =>
  fc.record({
    x: coord(limit),
    y: coord(limit),
    width: size().filter((w) => w > 0),
    height: size().filter((h) => h > 0),
  });

export const color: fc.Arbitrary<Color> = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
  a: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
});

/**
 * Checks that a generator reaches every input class a contract relies on.
 * labelsOf names the classes one generated value falls in; each class in
 * mins must appear in at least that share of numRuns samples. A generator
 * that stops reaching a class fails here, instead of silently testing less.
 * Set COVERAGE=1 to print the shares.
 */
export function coverage<T>(
  name: string,
  arb: fc.Arbitrary<T>,
  labelsOf: (value: T) => ReadonlySet<string>,
  mins: Record<string, number>,
  numRuns = 300,
): void {
  const counts = new Map<string, number>();
  for (const value of fc.sample(arb, { numRuns })) {
    for (const label of labelsOf(value)) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const share = (label: string) => (counts.get(label) ?? 0) / numRuns;
  if (process.env.COVERAGE) {
    console.log(name, Object.fromEntries([...counts.keys()].sort().map((l) => [l, share(l).toFixed(2)])));
  }
  const short = Object.entries(mins).filter(([label, min]) => share(label) < min)
    .map(([label, min]) => `${label}: ${share(label).toFixed(2)} < ${min}`);
  assert.deepEqual(short, [], `${name} reaches too few inputs in some classes`);
}

/** Recursively freezes a value, so that any attempt to modify it throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The largest double below v. */
export function prevDouble(v: number): number {
  if (v === 0) return -Number.MIN_VALUE;
  const bits = new BigInt64Array(new Float64Array([v]).buffer);
  bits[0] += v > 0 ? -1n : 1n;
  return new Float64Array(bits.buffer)[0];
}

// ---- Test shapes ----------------------------------------------------------
// Shapes for suites that store shapes without caring what they are, so that
// those suites don't depend on any InkStroke implementation.

/** A shape that covers exactly its bounding box. */
export class TestBox implements Shape {
  readonly kind = "test-box";
  readonly box: Rectangle;
  constructor(box: Rectangle) { this.box = box; }
  boundingBox(): Rectangle { return this.box; }
  contains(p: Point): boolean { return rectContains(this.box, p); }
  intersects(r: Rectangle): boolean { return rectIntersects(this.box, r); }
}

/** The top-left half of its bounding box: points where u + v < 1, with u and v from 0 to 1 across the box. */
export class TestTriangle implements Shape {
  readonly kind = "test-triangle";
  readonly box: Rectangle;
  constructor(box: Rectangle) { this.box = box; }
  boundingBox(): Rectangle { return this.box; }
  private uv(p: Point): number {
    return (p.x - this.box.x) / this.box.width + (p.y - this.box.y) / this.box.height;
  }
  contains(p: Point): boolean { return rectContains(this.box, p) && this.uv(p) < 1; }
  intersects(r: Rectangle): boolean {
    if (isEmpty(r) || !rectIntersects(this.box, r)) return false;
    // The overlap's top-left corner is the overlap point closest to the triangle's corner.
    return this.uv({ x: Math.max(r.x, this.box.x), y: Math.max(r.y, this.box.y) }) < 1;
  }
}

export const shapeOf = ([box, r]: [boolean, Rectangle]): Shape => (box ? new TestBox(r) : new TestTriangle(r));

/** Shapes and queries share a small grid, so that queries often overlap shapes. */
export const grid = 6;

const emptyRect: fc.Arbitrary<Rectangle> = fc.tuple(nonEmptyRect(grid), fc.boolean())
  .map(([r, flat]) => (flat ? { ...r, height: 0 } : { ...r, width: 0 }));

/** Boxes and triangles on the grid; one in eight is empty. */
export const shape: fc.Arbitrary<Shape> = fc.oneof(
  { weight: 7, arbitrary: fc.tuple(fc.boolean(), nonEmptyRect(grid)).map(shapeOf) },
  { weight: 1, arbitrary: fc.tuple(fc.boolean(), emptyRect).map(shapeOf) },
);
