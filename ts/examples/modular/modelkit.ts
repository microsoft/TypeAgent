// Test doubles for the shape model: a collection and a locator, each the
// simplest correct version, so that a contract for something built on them
// (such as a group) doesn't depend on any generated implementation.
// helpers.check.ts runs their contracts on them.

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeCollection, ShapeId, ShapeLocator } from "./shape.ts";

/** A ShapeCollection kept in a map and an array of IDs in z-order. */
export class ListCollection<S extends Shape = Shape> implements ShapeCollection<S> {
  private readonly shapes = new Map<ShapeId, S>();
  private order: ShapeId[] = [];
  private nextId = 1;

  add(shape: S): ShapeId {
    const id = this.nextId++ as ShapeId;
    this.shapes.set(id, shape);
    this.order.push(id);
    return id;
  }

  remove(id: ShapeId): boolean {
    return this.removeMultiple([id]) > 0;
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    const gone = ids.filter((id) => this.shapes.delete(id));
    if (gone.length > 0) this.order = this.order.filter((id) => this.shapes.has(id));
    return gone.length;
  }

  get(id: ShapeId): S | undefined {
    return this.shapes.get(id);
  }

  get size(): number {
    return this.order.length;
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    for (const id of [...this.order]) visit(id, this.shapes.get(id)!);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.order.indexOf(a) - this.order.indexOf(b);
  }
}

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
