/**
 * MapShapeCollection implements ShapeCollectionWriter.
 *
 * How: A Map from ShapeId to a node holds the shapes, and those nodes are
 * the nodes of an AVL tree kept in z-order, with subtree sizes and parent
 * links, so an add directly below a present shape is an insertion before
 * that node and compareZ is the difference of two ranks; a ShapeLocator
 * owned by the collection answers inRect and atPoint.
 * Choose when: the shapes live in memory and the spatial work belongs to a
 * locator, and adds may arrive in any pattern, including long runs that
 * all go directly below the same shape.
 * Cost: get and size take constant time; add, compareZ and remove, per ID
 * listed, take time logarithmic in the number of shapes in the worst case,
 * remove plus the locator's removeMultiple for the IDs it removed; forEach
 * takes time proportional to the number of shapes and allocates one stack
 * of at most the tree's height; each shape costs one node, and a query
 * allocates nothing of its own. Measured by npm run bench (bench.ts), which
 * prints each number below with its rule's ID, and keeps the machine's
 * absolute times in its output: for ShapeCollectionWriter.log-amortized, the
 * time per operation at 100,000 shapes divided by the time at 1,000, over
 * batches of 1,000 operations and four runs, is 2.6-5.9 for adds all
 * directly below one shape, 3.2-6.0 for adds each below the one added before
 * it, 3.1-6.3 for adds at the bottom, 5.2-8.9 for adds below random shapes,
 * 4.3-6.2 for removes of random shapes mixed with adds, and 8.4-10.1 for
 * compareZ on random pairs; about 2 is the growth in steps this collection is
 * built for, 4 to 9 is what that measures at these two sizes, because 100,000
 * shapes miss the caches that hold 1,000, and above 16 fails. For
 * frames.fraction-of-frame, with this collection under a ShapeProcessor over
 * a QuadTreeLocator holding 10,000 ink strokes, finishing a stroke takes
 * 0.4-0.5% of the budget (5% of a 120 Hz frame) and an eraser move 1.7-2.1%,
 * both inside it.
 * AdditionalSemantics: a call that breaks a @requires rule throws an Error
 * rather than corrupting the collection: add with an ID that is present or
 * a below that is not, and compareZ with an ID that is not present. remove
 * calls the locator's removeMultiple once, with the IDs it actually
 * removed, and skips it entirely when it removes nothing. The locator is
 * the collection's from construction on: nothing else adds to or removes
 * from it.
 * Parts: the z-order tree (an order-statistic sequence of IDs: insert on
 * top, insert before a node, remove a node, rank of a node, visit in
 * order) and the listener registry behind on, off and the change event.
 * Imports: geometry.ts, shape.ts, shapeModel.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";
import type { ShapeCollectionEvents, ShapeCollectionWriter } from "./shapeModel.ts";

/** A listener for the change event, which takes no arguments. */
type ChangeListener = () => void;

/** One shape, and its place in the z-order tree. Lower z is to the left. */
interface ZNode<S extends Shape> {
  readonly id: ShapeId;
  readonly shape: S;
  left: ZNode<S> | null;
  right: ZNode<S> | null;
  parent: ZNode<S> | null;
  /** 0 for an absent child, so a leaf has height 1. */
  height: number;
  /** The number of nodes in this subtree, this one included. */
  size: number;
}

function height<S extends Shape>(n: ZNode<S> | null): number {
  return n === null ? 0 : n.height;
}

function weight<S extends Shape>(n: ZNode<S> | null): number {
  return n === null ? 0 : n.size;
}

/** Recomputes a node's height and size from its children's. */
function refresh<S extends Shape>(n: ZNode<S>): void {
  n.height = 1 + Math.max(height(n.left), height(n.right));
  n.size = 1 + weight(n.left) + weight(n.right);
}

/** The deepest node of a subtree's right spine: the last one in z-order. */
function last<S extends Shape>(n: ZNode<S>): ZNode<S> {
  let cur = n;
  while (cur.right !== null) cur = cur.right;
  return cur;
}

/** The shallowest node of a subtree's left spine: the first one in z-order. */
function first<S extends Shape>(n: ZNode<S>): ZNode<S> {
  let cur = n;
  while (cur.left !== null) cur = cur.left;
  return cur;
}

export class MapShapeCollection<S extends Shape = Shape> implements ShapeCollectionWriter<S> {
  private readonly locator: ShapeLocator;
  private readonly nodes = new Map<ShapeId, ZNode<S>>();
  private readonly listeners = new Map<string, ChangeListener[]>();
  private root: ZNode<S> | null = null;

  constructor(locator: ShapeLocator) {
    this.locator = locator;
  }

  // ---- Reading -------------------------------------------------------------

  get(id: ShapeId): S | undefined {
    return this.nodes.get(id)?.shape;
  }

  get size(): number {
    return this.nodes.size;
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    const pending: ZNode<S>[] = [];
    let cur = this.root;
    while (cur !== null || pending.length > 0) {
      while (cur !== null) {
        pending.push(cur);
        cur = cur.left;
      }
      const n = pending.pop()!;
      visit(n.id, n.shape);
      cur = n.right;
    }
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (na === undefined || nb === undefined) {
      throw new Error(`compareZ needs both shapes present: ${na === undefined ? a : b} is not`);
    }
    return this.rank(na) - this.rank(nb);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.locator.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.locator.atPoint(p, out);
  }

  // ---- Writing -------------------------------------------------------------

  add(id: ShapeId, shape: S, below?: ShapeId): void {
    if (this.nodes.has(id)) throw new Error(`add needs a new ID: ${id} is already present`);
    let target: ZNode<S> | null = null;
    if (below !== undefined) {
      target = this.nodes.get(below) ?? null;
      if (target === null) throw new Error(`add needs below to be present: ${below} is not`);
    }
    const node: ZNode<S> = { id, shape, left: null, right: null, parent: null, height: 1, size: 1 };
    if (target === null) this.insertOnTop(node);
    else this.insertBefore(node, target);
    this.nodes.set(id, node);
    this.locator.add(id, shape);
    this.emitChange();
  }

  remove(listed: readonly ShapeId[]): number {
    const removed: ShapeId[] = [];
    for (const id of listed) {
      const node = this.nodes.get(id);
      if (node === undefined) continue;
      this.nodes.delete(id);
      this.unlink(node);
      removed.push(id);
    }
    if (removed.length === 0) return 0;
    this.locator.removeMultiple(removed);
    this.emitChange();
    return removed.length;
  }

  // ---- Events --------------------------------------------------------------

  on<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    const list = this.listeners.get(event);
    if (list === undefined) this.listeners.set(event, [listener as ChangeListener]);
    else list.push(listener as ChangeListener);
    return this;
  }

  off<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    const list = this.listeners.get(event);
    if (list !== undefined) {
      const at = list.lastIndexOf(listener as ChangeListener);
      if (at >= 0) list.splice(at, 1);
    }
    return this;
  }

  /** Calls the listeners registered when the emit starts, in that order. */
  private emitChange(): void {
    const list = this.listeners.get("change");
    if (list === undefined || list.length === 0) return;
    for (const listener of [...list]) listener();
  }

  // ---- The z-order tree ----------------------------------------------------

  /** How many shapes lie below n. */
  private rank(n: ZNode<S>): number {
    let below = weight(n.left);
    let cur: ZNode<S> = n;
    while (cur.parent !== null) {
      if (cur.parent.right === cur) below += weight(cur.parent.left) + 1;
      cur = cur.parent;
    }
    return below;
  }

  /** Puts node last in z-order. */
  private insertOnTop(node: ZNode<S>): void {
    if (this.root === null) {
      this.root = node;
      return;
    }
    const parent = last(this.root);
    parent.right = node;
    node.parent = parent;
    this.rebalance(parent);
  }

  /** Puts node directly below target. */
  private insertBefore(node: ZNode<S>, target: ZNode<S>): void {
    let parent: ZNode<S>;
    if (target.left === null) {
      target.left = node;
      parent = target;
    } else {
      parent = last(target.left);
      parent.right = node;
    }
    node.parent = parent;
    this.rebalance(parent);
  }

  /** Takes node out of the tree, leaving the others in the same order. */
  private unlink(node: ZNode<S>): void {
    let from: ZNode<S> | null;
    if (node.left !== null && node.right !== null) {
      // The successor takes node's place; it has no left child of its own.
      const heir = first(node.right);
      if (heir.parent === node) {
        from = heir;
      } else {
        from = heir.parent!;
        from.left = heir.right;
        if (heir.right !== null) heir.right.parent = from;
        heir.right = node.right;
        heir.right.parent = heir;
      }
      heir.left = node.left;
      heir.left.parent = heir;
      this.replace(node, heir);
    } else {
      from = node.parent;
      this.replace(node, node.left ?? node.right);
    }
    node.left = null;
    node.right = null;
    node.parent = null;
    this.rebalance(from);
  }

  /** Puts next where old hangs from its parent, or at the root. */
  private replace(old: ZNode<S>, next: ZNode<S> | null): void {
    const parent = old.parent;
    if (next !== null) next.parent = parent;
    if (parent === null) this.root = next;
    else if (parent.left === old) parent.left = next;
    else parent.right = next;
  }

  /** Refreshes from up to the root, rotating wherever the tree leans too far. */
  private rebalance(from: ZNode<S> | null): void {
    let n = from;
    while (n !== null) {
      refresh(n);
      const lean = height(n.left) - height(n.right);
      if (lean > 1) {
        const l = n.left!;
        if (height(l.left) < height(l.right)) this.rotateLeft(l);
        n = this.rotateRight(n);
      } else if (lean < -1) {
        const r = n.right!;
        if (height(r.right) < height(r.left)) this.rotateRight(r);
        n = this.rotateLeft(n);
      }
      n = n.parent;
    }
  }

  /** Rotates x's right child above it, and returns that child. */
  private rotateLeft(x: ZNode<S>): ZNode<S> {
    const y = x.right!;
    x.right = y.left;
    if (y.left !== null) y.left.parent = x;
    this.replace(x, y);
    y.left = x;
    x.parent = y;
    refresh(x);
    refresh(y);
    return y;
  }

  /** Rotates x's left child above it, and returns that child. */
  private rotateRight(x: ZNode<S>): ZNode<S> {
    const y = x.left!;
    x.left = y.right;
    if (y.right !== null) y.right.parent = x;
    this.replace(x, y);
    y.right = x;
    x.parent = y;
    refresh(x);
    refresh(y);
    return y;
  }
}
