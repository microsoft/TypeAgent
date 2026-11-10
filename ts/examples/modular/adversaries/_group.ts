// A ShapeCollection, and a RenderGroup presenting one, for building adversaries. Not adversaries themselves
// (the runner only picks up *.adversary.ts). With no bug flag, each passes its
// contract. Each flag switches on one mistake that a real implementation
// could plausibly make.

import type { Point, Rectangle } from "../geometry.ts";
import type { Shape, ShapeCollection, ShapeId } from "../shape.ts";
import type { ItemId } from "../view.ts";
import type { ShapeGroupFixture } from "../renderGroup.contract.ts";
import { ListLocator } from "../listLocator.ts";

export type CollectionBug =
  | "none"
  | "reuse-ids"                 // the next ID is size + 1, so a removed shape's ID comes back
  | "remove-drops-above"        // remove also drops every shape above the removed one
  | "size-counts-adds"          // size counts adds and forgets removeMultiple
  | "add-at-bottom"             // add puts the new shape at the bottom
  | "compareZ-coarse"           // compareZ compares positions / 2, so neighbors tie
  | "compareZ-asymmetric"       // compareZ says "above" both ways for shapes 3 apart
  | "remove-keeps-get"          // remove takes the shape out of z-order but get still finds it
  | "remove-says-true"          // remove returns true even when the ID wasn't there
  | "batch-counts-listed"       // removeMultiple returns how many IDs were listed
  | "batch-skips-last"          // removeMultiple ignores the last listed ID
  | "batch-reverses"            // removeMultiple reverses the z-order of the shapes it keeps
  | "get-unknown-top"           // get returns the top shape for an ID it never returned
  | "get-moves-to-top"          // get moves the shape it finds to the top, as a most-recently-used cache would
  | "batch-renumbers"           // removeMultiple rebuilds its storage, giving the shapes it keeps new IDs
  | "compareZ-far-reversed"     // compareZ flips the sign for shapes 2 or more apart unless one is the top shape
  | "add-returns-next"          // add returns the ID after the one it stored the shape under
  | "add-evicts-same"           // add first removes an earlier add of the same shape object, as a set would
  | "reset-when-empty"          // when a removal empties the collection, IDs start again from 1
  | "empty-batch-means-all";    // removeMultiple([]) removes every shape

export class TestCollection<S extends Shape = Shape> implements ShapeCollection<S> {
  private readonly bug: CollectionBug;
  private readonly shapes = new Map<ShapeId, S>();
  private order: ShapeId[] = [];
  private nextId = 1;
  private adds = 0;
  constructor(bug: CollectionBug = "none") { this.bug = bug; }

  add(shape: S): ShapeId {
    if (this.bug === "add-evicts-same") {
      const same = this.order.find((i) => this.shapes.get(i) === shape);
      if (same !== undefined) this.remove(same);
    }
    const id = (this.bug === "reuse-ids" ? this.order.length + 1 : this.nextId++) as ShapeId;
    this.shapes.set(id, shape);
    if (this.bug === "add-at-bottom") this.order.unshift(id);
    else this.order.push(id);
    this.adds++;
    return this.bug === "add-returns-next" ? (id + 1) as ShapeId : id;
  }

  remove(id: ShapeId): boolean {
    const i = this.order.indexOf(id);
    if (i < 0) return this.bug === "remove-says-true";
    if (this.bug === "remove-drops-above") {
      for (const above of this.order.splice(i)) this.shapes.delete(above);
    } else {
      this.order.splice(i, 1);
      if (this.bug !== "remove-keeps-get") this.shapes.delete(id);
    }
    this.adds--;
    if (this.bug === "reset-when-empty" && this.order.length === 0) this.nextId = 1;
    return true;
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    const listed = this.bug === "batch-skips-last" ? ids.slice(0, -1)
      : this.bug === "empty-batch-means-all" && ids.length === 0 ? [...this.order] : ids;
    let removed = 0;
    for (const id of listed) {
      const i = this.order.indexOf(id);
      if (i < 0) continue;
      this.order.splice(i, 1);
      this.shapes.delete(id);
      removed++;
    }
    if (this.bug === "batch-reverses") this.order.reverse();
    if (this.bug === "batch-renumbers" && removed > 0) {
      const kept = this.order.map((i) => this.shapes.get(i)!);
      this.shapes.clear();
      this.order = kept.map((shape) => {
        const id = this.nextId++ as ShapeId;
        this.shapes.set(id, shape);
        return id;
      });
    }
    if (this.bug === "reset-when-empty" && this.order.length === 0) this.nextId = 1;
    if (this.bug !== "size-counts-adds") this.adds -= removed;
    return this.bug === "batch-counts-listed" ? ids.length : removed;
  }

  get(id: ShapeId): S | undefined {
    if (this.bug === "get-moves-to-top" && this.order.includes(id)) {
      this.order = [...this.order.filter((i) => i !== id), id];
    }
    if (this.bug === "get-unknown-top" && id >= this.nextId && this.order.length > 0) {
      return this.shapes.get(this.order[this.order.length - 1]);
    }
    return this.order.includes(id) || this.bug === "remove-keeps-get" ? this.shapes.get(id) : undefined;
  }

  get size(): number { return this.adds; }

  /** The ID the next add will return, for the notify-before-add mistake. */
  peekNextId(): ShapeId { return this.nextId as ShapeId; }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    for (const id of this.order) visit(id, this.shapes.get(id)!);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    const pa = this.order.indexOf(a);
    const pb = this.order.indexOf(b);
    if (this.bug === "compareZ-coarse") return Math.floor(pa / 2) - Math.floor(pb / 2);
    if (this.bug === "compareZ-asymmetric" && Math.abs(pa - pb) === 3) return 1;
    const top = this.order.length - 1;
    if (this.bug === "compareZ-far-reversed" && Math.abs(pa - pb) >= 2 && pa !== top && pb !== top) return pb - pa;
    return pa - pb;
  }
}

export type GroupBug =
  | "none"
  | "notify-before-add"         // emits change before the shape is in the collection
  | "notify-before-index"       // emits change before the shape is in the index
  | "add-silent"                // add calls no one
  | "remove-silent"             // remove calls no one
  | "remove-absent-notifies"    // remove emits change even when the ID wasn't there
  | "batch-empty-notifies"      // removeMultiple emits change even when it removed nothing
  | "batch-notifies-per-shape"  // removeMultiple emits change after each shape it removes
  | "query-notifies"            // inRect emits change
  | "on-dedupes"                // a listener registered twice is called once
  | "first-listener-only"       // only the first registration is called
  | "off-ignored"               // off does nothing
  | "off-removes-all"           // off removes every registration of the listener
  | "off-removes-first"         // off removes the earliest registration rather than the most recent
  | "off-absent-removes-another" // off for a listener with no registration removes the most recent one of any listener
  | "emit-live-list"            // an emit walks the live list, so listeners added during it are called and removed ones aren't
  | "emit-newest-first"         // an emit calls the most recent registration first
  | "remove-keeps-index"        // remove leaves the shape in the index
  | "batch-keeps-index"         // removeMultiple leaves the shapes in the index
  | "query-drops-empty"         // inRect removes empty shapes from the source, since no query finds them
  | "last-off-clears"           // when the last listener is removed, the group frees its source's shapes
  | "ids-by-position"           // an item's ID is its position in z-order, so IDs shift and come back
  | "get-copies"                // get converts the shape into a new copy each time
  | "on-calls-now"              // on calls the new listener at once, as some observable stores do
  | "emptying-silent"           // a removal that empties the group calls no one
  | "detach-when-no-listeners"  // after its last listener is removed, the group stops emitting for good
  | "point-index-late"          // atPoint uses a second index that is updated after change is emitted
  | "size-own-count"            // size is the group's own count, which removeMultiple forgets to update
  | "compareZ-far-reversed"     // compareZ flips the sign for items 2 or more apart
  | "compareZ-ties-far"         // compareZ returns 0 for items 2 or more apart
  | "compareZ-asymmetric"       // compareZ says "above" both ways for items 2 apart
  | "get-remembers-removed"     // get still finds a removed item, from a cache of every item added
  | "retain-out"                // inRect keeps the last out array and appends later results to it too
  | "inRect-twice"              // inRect reports each item twice
  | "atPoint-twice"             // atPoint reports each item twice
  | "inRect-clears-out"         // inRect empties out before appending
  | "atPoint-clears-out"        // atPoint empties out before appending
  | "inRect-returns-length"     // inRect returns out.length
  | "atPoint-returns-length"    // atPoint returns out.length
  | "ids-reset-when-empty"
  | "add-at-bottom"             // add puts the shape at the bottom
  | "remove-says-true"          // remove returns true for an ID that wasn't there
  | "batch-counts-listed"       // removeMultiple returns how many IDs were listed;     // the collection it presents starts IDs again from 1 when it empties

/** A group presenting a TestCollection indexed by a ListLocator, with the edits the contract drives. */
export class TestGroup implements ShapeGroupFixture {
  private readonly bug: GroupBug;
  private readonly shapes: TestCollection<Shape>;
  private readonly locator = new ListLocator();
  private listeners: (() => void)[] = [];
  private readonly points = new ListLocator();
  private readonly everAdded = new Map<ShapeId, Shape>();
  private count = 0;
  private detached = false;
  private retained: ItemId[] | undefined;
  constructor(bug: GroupBug = "none") {
    this.bug = bug;
    const collectionBugs: Partial<Record<GroupBug, CollectionBug>> = {
      "ids-reset-when-empty": "reset-when-empty",
      "add-at-bottom": "add-at-bottom",
      "remove-says-true": "remove-says-true",
      "batch-counts-listed": "batch-counts-listed",
    };
    this.shapes = new TestCollection<Shape>(collectionBugs[bug] ?? "none");
  }

  private notify(): void {
    if (this.detached) return;
    if (this.bug === "emptying-silent" && this.shapes.size === 0) return;
    if (this.bug === "emit-live-list") {
      for (let i = 0; i < this.listeners.length; i++) this.listeners[i]();
      return;
    }
    const listeners = this.bug === "first-listener-only" ? this.listeners.slice(0, 1)
      : this.bug === "emit-newest-first" ? [...this.listeners].reverse() : [...this.listeners];
    for (const listener of listeners) listener();
  }

  private order(): ShapeId[] {
    const out: ShapeId[] = [];
    this.shapes.forEach((id) => out.push(id));
    return out;
  }

  private toItem(id: ShapeId): ItemId {
    return (this.bug === "ids-by-position" ? this.order().indexOf(id) + 1 : id) as number as ItemId;
  }

  private toShape(id: ItemId): ShapeId {
    return (this.bug === "ids-by-position" ? this.order()[id - 1] ?? -1 : id) as number as ShapeId;
  }

  add(shape: Shape): ItemId {
    if (this.bug === "notify-before-add") this.notify();
    const id = this.shapes.add(shape);
    if (this.bug === "notify-before-index") this.notify();
    this.locator.add(id, shape);
    this.everAdded.set(id, shape);
    this.count++;
    if (this.bug !== "point-index-late") this.points.add(id, shape);
    if (!["notify-before-add", "notify-before-index", "add-silent"].includes(this.bug)) this.notify();
    if (this.bug === "point-index-late") this.points.add(id, shape);
    return this.toItem(id);
  }

  remove(item: ItemId): boolean {
    const id = this.toShape(item);
    const removed = this.shapes.remove(id);
    if (removed && this.bug !== "remove-keeps-index") this.locator.remove(id);
    if (removed) this.count--;
    if (removed && this.bug !== "point-index-late") this.points.remove(id);
    if ((removed && this.bug !== "remove-silent") || this.bug === "remove-absent-notifies") this.notify();
    if (removed && this.bug === "point-index-late") this.points.remove(id);
    return removed;
  }

  removeMultiple(items: readonly ItemId[]): number {
    const ids = items.map((i) => this.toShape(i));
    if (this.bug === "batch-notifies-per-shape") {
      let removed = 0;
      for (const id of ids) {
        if (!this.shapes.remove(id)) continue;
        this.locator.remove(id);
        this.points.remove(id);
        this.count--;
        removed++;
        this.notify();
      }
      return removed;
    }
    const removed = this.shapes.removeMultiple(ids);
    if (this.bug !== "batch-keeps-index") this.locator.removeMultiple(ids);
    if (this.bug !== "size-own-count") this.count -= removed;
    if (this.bug !== "point-index-late") this.points.removeMultiple(ids);
    if (removed > 0 || this.bug === "batch-empty-notifies") this.notify();
    if (this.bug === "point-index-late") this.points.removeMultiple(ids);
    return removed;
  }

  get(item: ItemId): Shape | undefined {
    const s = this.bug === "get-remembers-removed"
      ? this.shapes.get(this.toShape(item)) ?? this.everAdded.get(this.toShape(item))
      : this.shapes.get(this.toShape(item));
    return this.bug === "get-copies" && s ? Object.assign(Object.create(Object.getPrototypeOf(s)), s) : s;
  }

  get size(): number { return this.bug === "size-own-count" ? this.count : this.shapes.size; }
  forEach(visit: (id: ItemId, item: Shape) => void): void { this.shapes.forEach((id, s) => visit(this.toItem(id), s)); }

  compareZ(a: ItemId, b: ItemId): number {
    const z = this.shapes.compareZ(this.toShape(a), this.toShape(b));
    const order = this.order();
    const apart = Math.abs(order.indexOf(this.toShape(a)) - order.indexOf(this.toShape(b)));
    if (this.bug === "compareZ-far-reversed" && apart >= 2) return -z;
    if (this.bug === "compareZ-ties-far" && apart >= 2) return 0;
    if (this.bug === "compareZ-asymmetric" && apart === 2) return 1;
    return z;
  }

  /** Copies a query's results into out, with the query bugs for q. */
  private report(q: "inRect" | "atPoint", found: ShapeId[], n: number, out: ItemId[]): number {
    if (this.bug === `${q}-clears-out`) out.length = 0;
    for (const id of found) out.push(this.toItem(id));
    if (this.bug === `${q}-twice`) for (const id of found) out.push(this.toItem(id));
    if (q === "inRect" && this.bug === "retain-out") {
      if (this.retained && this.retained !== out) for (const id of found) this.retained.push(this.toItem(id));
      this.retained = out;
    }
    return this.bug === `${q}-returns-length` ? out.length : n;
  }

  inRect(r: Rectangle, out: ItemId[]): number {
    if (this.bug === "query-notifies") this.notify();
    if (this.bug === "query-drops-empty") {
      const empty: ShapeId[] = [];
      this.shapes.forEach((id, s) => { if (s.boundingBox().width === 0 || s.boundingBox().height === 0) empty.push(id); });
      this.shapes.removeMultiple(empty);
      this.locator.removeMultiple(empty);
    }
    const found: ShapeId[] = [];
    const n = this.locator.inRect(r, found);
    return this.report("inRect", found, n, out);
  }

  atPoint(p: Point, out: ItemId[]): number {
    const found: ShapeId[] = [];
    const n = (this.bug === "point-index-late" ? this.points : this.locator).atPoint(p, found);
    return this.report("atPoint", found, n, out);
  }

  on(event: "change", listener: () => void): this {
    if (this.bug === "on-dedupes" && this.listeners.includes(listener)) return this;
    this.listeners.push(listener);
    if (this.bug === "on-calls-now") listener();
    return this;
  }

  off(event: "change", listener: () => void): this {
    if (this.bug === "off-ignored") return this;
    if (this.bug === "off-removes-all") {
      this.listeners = this.listeners.filter((l) => l !== listener);
    } else {
      const i = this.bug === "off-removes-first" ? this.listeners.indexOf(listener) : this.listeners.lastIndexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
      else if (this.bug === "off-absent-removes-another") this.listeners.pop();
    }
    if (this.listeners.length === 0) {
      if (this.bug === "detach-when-no-listeners") this.detached = true;
      if (this.bug === "last-off-clears") {
        const all = this.order();
        this.shapes.removeMultiple(all);
        this.locator.removeMultiple(all);
      }
    }
    return this;
  }
}

