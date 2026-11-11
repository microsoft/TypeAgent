// The reference ShapeCollectionWriter (shapeModel.ts): RefShapeWriter, kept
// in an array in z-order, answering queries by checking every shape. Also
// readFacet, the read-only view of a writer that a processor gives out.
// helpers.check.ts runs the writer contract against it.

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import type { ShapeCollection, ShapeCollectionEvents, ShapeCollectionWriter } from "./shapeModel.ts";
import { Events } from "./eventkit.ts";

export class RefShapeWriter<S extends Shape = Shape> extends Events<ShapeCollectionEvents> implements ShapeCollectionWriter<S> {
  private items: [ShapeId, S][] = [];

  get size(): number {
    return this.items.length;
  }

  get(id: ShapeId): S | undefined {
    return this.items.find(([i]) => i === id)?.[1];
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    for (const [id, shape] of [...this.items]) visit(id, shape);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.items.findIndex(([i]) => i === a) - this.items.findIndex(([i]) => i === b);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const found = this.items.filter(([, s]) => s.intersects(r)).map(([id]) => id);
    out.push(...found);
    return found.length;
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const found = this.items.filter(([, s]) => s.contains(p)).map(([id]) => id);
    out.push(...found);
    return found.length;
  }

  add(id: ShapeId, shape: S, below?: ShapeId): void {
    const at = below === undefined ? this.items.length : this.items.findIndex(([i]) => i === below);
    this.items.splice(at, 0, [id, shape]);
    this.emit("change");
  }

  remove(ids: readonly ShapeId[]): number {
    const before = this.items.length;
    this.items = this.items.filter(([i]) => !ids.includes(i));
    const removed = before - this.items.length;
    if (removed > 0) this.emit("change");
    return removed;
  }
}

/** A read-only view of a writer: the facet a processor gives out. */
export function readFacet<S extends Shape>(w: ShapeCollectionWriter<S>): ShapeCollection<S> {
  return {
    get: (id) => w.get(id),
    get size() { return w.size; },
    forEach: (visit) => w.forEach(visit),
    compareZ: (a, b) => w.compareZ(a, b),
    inRect: (r, out) => w.inRect(r, out),
    atPoint: (p, out) => w.atPoint(p, out),
    on(event, listener) { w.on(event, listener); return this; },
    off(event, listener) { w.off(event, listener); return this; },
  };
}
