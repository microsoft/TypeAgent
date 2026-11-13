// The reference for task 8 in phase 3: MapShapeCollection's constructor
// over RefShapeWriter. It indexes each present shape in the locator and
// answers inRect and atPoint with it, as task 8's Approach says, so that a
// distinguishing test sees the locator used the way the spec asks.

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";
import type { ShapeCollectionEvents, ShapeCollectionWriter } from "./shapeModel.ts";
import { Events } from "./eventkit.ts";
import { RefShapeWriter } from "./shapewriterkit.ts";

export class MapShapeCollection<S extends Shape = Shape> extends Events<ShapeCollectionEvents> implements ShapeCollectionWriter<S> {
  private readonly order = new RefShapeWriter<S>();
  private readonly locator: ShapeLocator;

  constructor(locator: ShapeLocator) {
    super();
    this.locator = locator;
  }

  get size(): number {
    return this.order.size;
  }

  get(id: ShapeId): S | undefined {
    return this.order.get(id);
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    this.order.forEach(visit);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.order.compareZ(a, b);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.locator.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.locator.atPoint(p, out);
  }

  add(id: ShapeId, shape: S, below?: ShapeId): void {
    this.locator.add(id, shape);
    this.order.add(id, shape, below);
    this.emit("change");
  }

  remove(ids: readonly ShapeId[]): number {
    const present = [...new Set(ids)].filter((id) => this.order.get(id) !== undefined);
    if (present.length === 0) return 0;
    this.order.remove(present);
    this.locator.removeMultiple(present);
    this.emit("change");
    return present.length;
  }
}
