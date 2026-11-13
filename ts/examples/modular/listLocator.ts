/**
 * ListLocator implements ShapeLocator.
 *
 * How: Keeps every indexed shape in a Map keyed by ID and answers each query by asking every shape directly (shape.intersects / shape.contains).
 * Choose when: As the reference implementation that faster locators are compared against; for a few dozen shapes, fewer than the 100 that is the smallest size bench.ts measures; or when the index is rebuilt or bulk-edited more often than it is queried. Measured (see Cost): it builds 3-10x faster than QuadTreeLocator and its removeMultiple is 2-8x faster, but each eraser inRect or atPoint query is about 2.5x slower at 100 strokes, 12-19x slower at 1,000 and 14-63x slower at 10,000.
 * Cost: add, remove O(1); removeMultiple O(k) for k IDs; inRect and atPoint O(n) shape tests for n indexed shapes, allocating nothing beyond what out grows by. Measured by npm run bench (bench.ts), whose output holds the absolute times and the machine they are the times of; ink strokes of 2-40 points on a 10,000 x 10,000 canvas, 20 x 20 eraser, at 100, 1,000 and 10,000 strokes, over four runs. Against QuadTreeLocator: this locator builds 5-6x faster per add at 100 strokes, 7-10x faster at 1,000 and 3-4x faster at 10,000, and its removeMultiple of a tenth of the shapes is 3-4x faster at 100, 2.4-3.1x at 1,000 and 5-8x at 10,000, with no crossover up to 10,000, the largest size the script measures; but its query cost grows about tenfold with each tenfold increase in shapes, so an eraser inRect costs 2.6-3.0x more per query at 100 strokes, 12-16x at 1,000 and 14-17x at 10,000, and atPoint 2.3-2.6x, 18-19x and 59-63x, which puts QuadTreeLocator ahead on queries already at 100 strokes.
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
