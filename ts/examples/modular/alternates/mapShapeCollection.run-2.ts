/**
 * MapShapeCollection implements ShapeCollectionWriter.
 *
 * How: a Map from ShapeId to a node holds each shape for O(1) get, size and
 * lookup; the z-order is an implicit treap (a balanced binary tree ordered
 * by position, balanced by a random priority per node, with subtree sizes
 * and parent links) so inserting directly below any shape, removing any
 * shape, and comparing two shapes' order all cost time proportional to the
 * tree's height, whatever the pattern of adds: no numeric order keys are
 * relabeled, so a burst of adds that keep landing in the same gap costs the
 * same as any other pattern. Present shapes are also indexed by ID in the
 * locator passed to the constructor, which answers inRect and atPoint.
 * Choose when: always, for a ShapeCollectionWriter backed by any ShapeLocator.
 * Cost: get and size O(1); add, remove (per ID listed) and compareZ
 *   O(log n) expected, from the treap's expected height; forEach O(n).
 * AdditionalSemantics: none.
 * Parts: the treap (merge, split and rank over its nodes) could become an
 *   order-maintenance structure of its own.
 * Imports: geometry.ts, shape.ts, shapeModel.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";
import type { ShapeCollectionEvents, ShapeCollectionWriter } from "./shapeModel.ts";

/**
 * A node of the z-order treap: in-order traversal (left, self, right) is
 * the z-order, bottom to top. priority is a random tiebreaker that keeps
 * the tree balanced in expectation regardless of insertion pattern. size
 * is the count of this node's subtree, kept current by update after any
 * change below it.
 */
interface TreapNode<S extends Shape> {
  readonly id: ShapeId;
  readonly shape: S;
  readonly priority: number;
  size: number;
  left: TreapNode<S> | null;
  right: TreapNode<S> | null;
  parent: TreapNode<S> | null;
}

function subtreeSize<S extends Shape>(node: TreapNode<S> | null): number {
  return node === null ? 0 : node.size;
}

function setParent<S extends Shape>(node: TreapNode<S> | null, parent: TreapNode<S> | null): void {
  if (node !== null) node.parent = parent;
}

function update<S extends Shape>(node: TreapNode<S>): void {
  node.size = 1 + subtreeSize(node.left) + subtreeSize(node.right);
}

/** Merges a and b into one treap, keeping every shape of a below every shape of b. */
function merge<S extends Shape>(a: TreapNode<S> | null, b: TreapNode<S> | null): TreapNode<S> | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.priority > b.priority) {
    a.right = merge(a.right, b);
    setParent(a.right, a);
    update(a);
    return a;
  }
  b.left = merge(a, b.left);
  setParent(b.left, b);
  update(b);
  return b;
}

/** Splits root into the bottom k shapes and the rest, each still in z-order. */
function split<S extends Shape>(root: TreapNode<S> | null, k: number): [TreapNode<S> | null, TreapNode<S> | null] {
  if (root === null) return [null, null];
  const leftSize = subtreeSize(root.left);
  if (k <= leftSize) {
    const [left, right] = split(root.left, k);
    root.left = right;
    setParent(right, root);
    setParent(left, null);
    update(root);
    return [left, root];
  }
  const [left, right] = split(root.right, k - leftSize - 1);
  root.right = left;
  setParent(left, root);
  setParent(right, null);
  update(root);
  return [root, right];
}

/** node's position among its treap's shapes, bottom to top, 0-based. */
function rank<S extends Shape>(node: TreapNode<S>): number {
  let r = subtreeSize(node.left);
  let cur = node;
  while (cur.parent !== null) {
    if (cur.parent.right === cur) r += subtreeSize(cur.parent.left) + 1;
    cur = cur.parent;
  }
  return r;
}

export class MapShapeCollection<S extends Shape = Shape> implements ShapeCollectionWriter<S> {
  private readonly locator: ShapeLocator;
  private readonly nodes = new Map<ShapeId, TreapNode<S>>();
  private root: TreapNode<S> | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(locator: ShapeLocator) {
    this.locator = locator;
  }

  get size(): number {
    return this.nodes.size;
  }

  get(id: ShapeId): S | undefined {
    return this.nodes.get(id)?.shape;
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    const stack: TreapNode<S>[] = [];
    let cur = this.root;
    while (cur !== null || stack.length > 0) {
      while (cur !== null) {
        stack.push(cur);
        cur = cur.left;
      }
      const node = stack.pop() as TreapNode<S>;
      visit(node.id, node.shape);
      cur = node.right;
    }
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    const nodeA = this.nodes.get(a) as TreapNode<S>;
    const nodeB = this.nodes.get(b) as TreapNode<S>;
    return nodeA === nodeB ? 0 : rank(nodeA) - rank(nodeB);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.locator.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.locator.atPoint(p, out);
  }

  add(id: ShapeId, shape: S, below?: ShapeId): void {
    const node: TreapNode<S> = { id, shape, priority: Math.random(), size: 1, left: null, right: null, parent: null };
    if (below === undefined) {
      this.root = merge(this.root, node);
    } else {
      const belowNode = this.nodes.get(below) as TreapNode<S>;
      const [left, right] = split(this.root, rank(belowNode));
      this.root = merge(merge(left, node), right);
    }
    this.nodes.set(id, node);
    this.locator.add(id, shape);
    this.emitChange();
  }

  remove(listed: readonly ShapeId[]): number {
    const present: ShapeId[] = [];
    for (const id of listed) {
      const node = this.nodes.get(id);
      if (node === undefined) continue;
      this.removeNode(node);
      this.nodes.delete(id);
      present.push(id);
    }
    if (present.length === 0) return 0;
    this.locator.removeMultiple(present);
    this.emitChange();
    return present.length;
  }

  on<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    this.listeners.push(listener as () => void);
    return this;
  }

  off<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    const i = this.listeners.lastIndexOf(listener as () => void);
    if (i >= 0) this.listeners.splice(i, 1);
    return this;
  }

  /** Removes node from the treap, merging its children in its place and refreshing ancestor sizes. */
  private removeNode(node: TreapNode<S>): void {
    const parent = node.parent;
    const merged = merge(node.left, node.right);
    setParent(merged, parent);
    if (parent === null) this.root = merged;
    else if (parent.left === node) parent.left = merged;
    else parent.right = merged;
    for (let cur = parent; cur !== null; cur = cur.parent) update(cur);
  }

  private emitChange(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
