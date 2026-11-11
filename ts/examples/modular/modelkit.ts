// A test double for the shape model: a locator, the simplest correct
// version, so that a contract for something built on one (such as a
// ShapeCollectionWriter) doesn't depend on any generated implementation.
// helpers.check.ts runs the locator contract on it.

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";

/** A ShapeLocator that checks every shape on every query. */
export class ListIndex implements ShapeLocator {
  private readonly shapes = new Map<ShapeId, Shape>();

  add(id: ShapeId, shape: Shape): void {
    if (this.shapes.has(id)) throw new Error(`ID ${id} is already indexed`);
    this.shapes.set(id, shape);
  }

  remove(id: ShapeId): boolean {
    return this.shapes.delete(id);
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    return ids.filter((id) => this.shapes.delete(id)).length;
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const found = [...this.shapes].filter(([, s]) => s.intersects(r)).map(([id]) => id);
    out.push(...found);
    return found.length;
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const found = [...this.shapes].filter(([, s]) => s.contains(p)).map(([id]) => id);
    out.push(...found);
    return found.length;
  }
}
