/**
 * ListLocator implements ShapeLocator.
 *
 * How: Keeps every indexed shape in a Map keyed by ID and answers each query by asking every shape directly (shape.intersects / shape.contains).
 * Choose when: As the reference implementation that faster locators are compared against; for a few dozen shapes; or when the index is rebuilt or bulk-edited more often than it is queried. Measured (see Cost): it builds 4-9x faster than QuadTreeLocator and its removeMultiple is 3-6x faster, but each eraser inRect or atPoint query is 2.5-3.5x slower at 100 strokes, 12-16x slower at 1,000 and 15-60x slower at 10,000.
 * Cost: add, remove O(1); removeMultiple O(k) for k IDs; inRect and atPoint O(n) shape tests for n indexed shapes, allocating nothing beyond what out grows by. Measured by npm run bench (bench.ts) on an Intel Core i9-14900KF desktop, Windows 11 (10.0.26200), Node 26.13.0; median of 9 runs; ink strokes of 2-40 points on a 10,000 x 10,000 canvas, 20 x 20 eraser. For 100 / 1,000 / 10,000 strokes: build 0.008 / 0.025 / 0.36 ms (about 0.03 us per add once warm); eraser inRect 0.86 / 9.4 / 112 us per query; atPoint 0.86 / 7.6 / 94 us per query; removeMultiple of 10% 0.002 / 0.006 / 0.031 ms.
 * AdditionalSemantics: add throws an Error when the ID is already indexed (a @requires new-id violation) instead of silently replacing the shape.
 * Parts: none
 * Imports: geometry.ts, shape.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";

export class ListLocator implements ShapeLocator {
  readonly #shapes = new Map<ShapeId, Shape>();

  add(id: ShapeId, shape: Shape): void {
    if (this.#shapes.has(id)) throw new Error(`ShapeLocator.add.new-id: ID ${id} is already indexed`);
    this.#shapes.set(id, shape);
  }

  remove(id: ShapeId): boolean {
    return this.#shapes.delete(id);
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    let removed = 0;
    for (const id of ids) if (this.#shapes.delete(id)) removed++;
    return removed;
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const start = out.length;
    for (const [id, shape] of this.#shapes) if (shape.intersects(r)) out.push(id);
    return out.length - start;
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const start = out.length;
    for (const [id, shape] of this.#shapes) if (shape.contains(p)) out.push(id);
    return out.length - start;
  }
}
