// The reference router (pointer.ts), written as simply as possible from the
// rules. Tests of the parts that receive mouse input use it.
// helpers.check.ts runs the router contract on it. The router's own
// generation task never sees this file.

import type { Point, Rectangle } from "./geometry.ts";
import type { PointerEvents, PointerKind, Region, RootRegion } from "./pointer.ts";
import { rectContains } from "./geometry.vocab.ts";
import { Events } from "./eventkit.ts";

export class KitRegion extends Events<PointerEvents> implements Region {
  readonly bounds: Rectangle;
  readonly parent: KitRegion | undefined;
  kids: KitRegion[] = [];
  removed = false;

  constructor(bounds: Rectangle, parent: KitRegion | undefined) {
    super();
    this.bounds = { ...bounds };
    this.parent = parent;
  }

  add(rect: Rectangle): Region {
    const child = new KitRegion(rect, this);
    this.kids.push(child);
    return child;
  }

  remove(): void {
    if (this.removed) return;
    const mark = (r: KitRegion) => {
      r.removed = true;
      r.kids.forEach(mark);
    };
    mark(this);
    if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this);
  }

  /** The top left in window coordinates. */
  origin(): Point {
    const up = this.parent ? this.parent.origin() : { x: 0, y: 0 };
    return { x: up.x + this.bounds.x, y: up.y + this.bounds.y };
  }

  /** Emits as the root routes it; not part of Region. */
  receive(kind: PointerKind, window: Point, timeMs: number): void {
    const o = this.origin();
    this.emit(kind, { point: { x: window.x - o.x, y: window.y - o.y }, timeMs });
  }
}

export class RefRootRegion extends KitRegion implements RootRegion {
  private pressing = false;
  private captured: KitRegion | undefined;

  constructor(width: number, height: number) {
    super({ x: 0, y: 0, width, height }, undefined);
  }

  /** The regions containing a window point, outermost first. */
  private path(p: Point): KitRegion[] {
    const path: KitRegion[] = [];
    let at: KitRegion | undefined = rectContains(this.bounds, p) ? this : undefined;
    while (at) {
      path.push(at);
      const o = at.origin();
      at = at.kids.find((k) => rectContains({ ...k.bounds, x: o.x + k.bounds.x, y: o.y + k.bounds.y }, p));
    }
    return path;
  }

  deliver(kind: PointerKind, point: Point, timeMs: number): void {
    let target: KitRegion | undefined;
    if (this.pressing) {
      const c = this.captured;
      target = c && !c.removed && c.listenerCount(kind) > 0 ? c : undefined;
      if (kind === "up") {
        this.pressing = false;
        this.captured = undefined;
      }
    } else {
      target = this.path(point).reverse().find((r) => r.listenerCount(kind) > 0);
      if (kind === "down") {
        this.pressing = true;
        this.captured = target;
      }
    }
    target?.receive(kind, point, timeMs);
  }
}
