// A router for adversaries: the reference regions (routerkit.ts) with a
// root that is correct unless a bug is switched on. helpers.check.ts runs
// the router contract against it with no bug.

import type { Point, Rectangle } from "../geometry.ts";
import type { PointerKind, Region, RootRegion } from "../pointer.ts";
import { KitRegion } from "../routerkit.ts";

export type RouterBug =
  | "none"
  | "bubbles"               // ancestors with a listener get the event too
  | "outermost"             // the outermost region with a listener gets it
  | "deepest-only"          // the innermost region at the point gets it, or nobody if it has no listener
  | "no-capture"            // moves and ups during a press are routed by position
  | "capture-sticks"        // the capture outlives the up
  | "window-points"         // points stay in window coordinates
  | "parent-points"         // points are offset by the region's own bounds only, not its ancestors'
  | "removed-captor-hears"  // a removed region that captured the press still gets its events
  | "uncaptured-routes"     // a press no region received is routed by position
  | "hover-dropped"         // moves with no press go nowhere
  | "edge-inclusive"        // right and bottom edges count as inside
  | "stray-up-dropped"      // an up with no press goes nowhere
  | "add-window-bounds";    // a nested region's bounds are kept in window coordinates, not its parent's

class TestRegion extends KitRegion {
  readonly bug: RouterBug;
  constructor(bounds: Rectangle, parent: KitRegion | undefined, bug: RouterBug) {
    const o = bug === "add-window-bounds" && parent ? parent.origin() : { x: 0, y: 0 };
    super({ ...bounds, x: bounds.x + o.x, y: bounds.y + o.y }, parent);
    this.bug = bug;
  }
  override add(rect: Rectangle): Region {
    const child = new TestRegion(rect, this, this.bug);
    this.kids.push(child);
    return child;
  }
  override remove(): void {
    if (this.bug === "removed-captor-hears") {
      // Unlinks the region but leaves it able to hear.
      if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this);
      this.removed = true;
      this.removedButHears = true;
      return;
    }
    super.remove();
  }
  removedButHears = false;
}

export class TestRoot extends TestRegion implements RootRegion {
  private pressing = false;
  private captured: TestRegion | undefined;
  private sticky: TestRegion | undefined;

  constructor(width: number, height: number, bug: RouterBug = "none") {
    super({ x: 0, y: 0, width, height }, undefined, bug);
  }

  private contains(r: Rectangle, p: Point): boolean {
    return this.bug === "edge-inclusive"
      ? r.x <= p.x && p.x <= r.x + r.width && r.y <= p.y && p.y <= r.y + r.height
      : r.x <= p.x && p.x < r.x + r.width && r.y <= p.y && p.y < r.y + r.height;
  }

  private path(p: Point): TestRegion[] {
    const path: TestRegion[] = [];
    let at: TestRegion | undefined = this.contains(this.bounds, p) ? this : undefined;
    while (at) {
      path.push(at);
      const o = at.origin();
      at = at.kids.find((k) => this.contains({ ...k.bounds, x: o.x + k.bounds.x, y: o.y + k.bounds.y }, p)) as TestRegion | undefined;
    }
    return path;
  }

  private byPosition(kind: PointerKind, p: Point): TestRegion[] {
    const path = this.path(p);
    const listening = path.filter((r) => r.listenerCount(kind) > 0);
    if (this.bug === "deepest-only") {
      const deepest = path.at(-1);
      return deepest && deepest.listenerCount(kind) > 0 ? [deepest] : [];
    }
    if (this.bug === "outermost") return listening.slice(0, 1);
    if (this.bug === "bubbles") return listening.reverse();
    return listening.slice(-1);
  }

  private send(r: TestRegion, kind: PointerKind, p: Point, timeMs: number): void {
    if (r.removed && !r.removedButHears) return;
    const o = this.bug === "window-points" ? { x: 0, y: 0 } : this.bug === "parent-points" ? { x: r.bounds.x, y: r.bounds.y } : r.origin();
    r.emit(kind, { point: { x: p.x - o.x, y: p.y - o.y }, timeMs });
  }

  deliver(kind: PointerKind, point: Point, timeMs: number): void {
    if (this.bug === "capture-sticks" && !this.pressing && this.sticky && this.sticky.listenerCount(kind) > 0 && kind !== "down") {
      return this.send(this.sticky, kind, point, timeMs);
    }
    let targets: TestRegion[];
    if (this.pressing && this.bug !== "no-capture" && !(this.bug === "uncaptured-routes" && !this.captured)) {
      const c = this.captured;
      targets = c && c.listenerCount(kind) > 0 ? [c] : [];
    } else if (!this.pressing && kind === "move" && this.bug === "hover-dropped") {
      targets = [];
    } else if (!this.pressing && kind === "up" && this.bug === "stray-up-dropped") {
      targets = [];
    } else {
      targets = this.byPosition(kind, point);
    }
    if (kind === "down" && !this.pressing) {
      this.pressing = true;
      this.captured = targets.at(0);
      this.sticky = this.captured;
    } else if (kind === "up") {
      this.pressing = false;
      this.captured = undefined;
    }
    for (const t of targets) this.send(t, kind, point, timeMs);
  }
}

export const makeTestRoot = (bug: RouterBug = "none") => (width: number, height: number): RootRegion => new TestRoot(width, height, bug);
