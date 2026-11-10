// An EventDistributor for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the EventDistributor contract against it with no bug.

import type { Point, Rectangle } from "../geometry.ts";
import type { EventDistributor, LayoutObject, Listener } from "../layout.ts";
import type { MakeDistributor } from "../eventDistributor.contract.ts";
import { distPointToRect, right, bottom, within } from "../geometry.vocab.ts";

export type DistributorBug =
  | "none"
  | "dedupes"         // on ignores a registration that exists already
  | "off-all"         // off removes every matching registration
  | "off-oldest"      // off removes the oldest matching registration
  | "off-any-target"  // off matches on event name and listener only
  | "outermost"       // delivers to the outermost containing target
  | "all-containing"  // delivers to every containing target
  | "across-names"    // picks the innermost target among all targets, whatever they're registered for
  | "ignores-except"  // never skips except
  | "closed-edges"    // a region contains the points on its right and bottom edges
  | "reverse-order"   // calls a target's listeners newest first
  | "copies-event"    // passes listeners a copy of the event
  | "nearest"         // with no containing target, delivers to the nearest one
  | "always-true"     // returns true even when no target took the event
  | "cached-regions"  // uses each target's region as it was when registered
  | "live-list"       // iterates the live registration list, so listeners' changes affect the call
  | "needs-this";     // distribute is a method that fails when called detached

interface Registration<M> {
  eventName: keyof M;
  listener: Listener<M, keyof M>;
  target: LayoutObject;
  regionWhenRegistered: Rectangle;
}

class TestDistributor<M> implements EventDistributor<M> {
  region: Rectangle;
  readonly locate: (event: M[keyof M]) => Point;
  private registrations: Registration<M>[] = [];
  private readonly bug: DistributorBug;

  constructor(region: Rectangle, locate: (event: M[keyof M]) => Point, bug: DistributorBug) {
    this.region = region;
    this.locate = locate;
    this.bug = bug;
    if (bug !== "needs-this") this.distribute = this.distribute.bind(this);
  }

  on<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void {
    const l = listener as Listener<M, keyof M>;
    if (this.bug === "dedupes" && this.registrations.some((r) => r.eventName === eventName && r.listener === l && r.target === target)) return;
    this.registrations.push({ eventName, listener: l, target, regionWhenRegistered: { ...target.region } });
  }

  off<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void {
    const l = listener as Listener<M, keyof M>;
    const matches = (r: Registration<M>) =>
      r.eventName === eventName && r.listener === l && (this.bug === "off-any-target" || r.target === target);
    if (this.bug === "off-all") {
      this.registrations = this.registrations.filter((r) => !matches(r));
      return;
    }
    const found = this.registrations.map((r, i) => (matches(r) ? i : -1)).filter((i) => i >= 0);
    const i = this.bug === "off-oldest" ? found[0] : found[found.length - 1];
    if (i !== undefined) this.registrations.splice(i, 1);
  }

  private regionOf(r: Registration<M>): Rectangle {
    return this.bug === "cached-regions" ? r.regionWhenRegistered : r.target.region;
  }

  private contains(rect: Rectangle, p: Point): boolean {
    return this.bug === "closed-edges"
      ? rect.x <= p.x && p.x <= right(rect) && rect.y <= p.y && p.y <= bottom(rect)
      : rect.x <= p.x && p.x < right(rect) && rect.y <= p.y && p.y < bottom(rect);
  }

  distribute<E extends keyof M & string>(eventName: E, event: M[E], except?: LayoutObject): boolean {
    const p = this.locate(event);
    const pool = this.bug === "across-names" ? this.registrations : this.registrations.filter((r) => r.eventName === eventName);
    const regionOf = new Map(pool.map((r) => [r.target, this.regionOf(r)]));
    const skip = this.bug === "ignores-except" ? undefined : except;
    const containing = [...regionOf.keys()].filter((t) => t !== skip && this.contains(regionOf.get(t)!, p));
    let chosen: LayoutObject[];
    if (this.bug === "all-containing") chosen = containing;
    else if (this.bug === "outermost") chosen = containing.filter((t) => containing.every((u) => within(regionOf.get(u)!, regionOf.get(t)!)));
    else chosen = containing.filter((t) => containing.every((u) => within(regionOf.get(t)!, regionOf.get(u)!)));
    if (chosen.length === 0 && this.bug === "nearest" && regionOf.size > 0) {
      const targets = [...regionOf.keys()].filter((t) => t !== skip);
      const d = (t: LayoutObject) => distPointToRect(p, regionOf.get(t)!);
      if (targets.length > 0) chosen = [targets.reduce((a, b) => (d(b) < d(a) ? b : a))];
    }
    if (chosen.length === 0) return this.bug === "always-true";
    const delivered = this.bug === "copies-event" ? ({ ...event } as M[E]) : event;
    const list = this.bug === "live-list" ? this.registrations : this.registrations.slice();
    const order = this.bug === "reverse-order" ? [...list].reverse() : list;
    let took = false;
    for (let i = 0; i < order.length; i++) {
      const r = order[i];
      if (r.eventName === eventName && chosen.includes(r.target)) {
        r.listener(eventName, delivered);
        took = true;
      }
    }
    return took || this.bug === "always-true";
  }
}

export function makeTestDistributor(bug: DistributorBug = "none"): MakeDistributor {
  return (region, locate) => new TestDistributor(region, locate, bug);
}
