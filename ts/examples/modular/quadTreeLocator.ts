/**
 * QuadTreeLocator implements ShapeLocator.
 *
 * How: A region quadtree over cached bounding boxes. Each shape lives in exactly one node, the deepest existing cell that fully contains its box; a leaf splits when it holds more than 8 shapes (never below depth 32, root at depth 0), and the root doubles toward any shape that falls outside it. Queries descend only into cells that can overlap the query, prefilter by the cached box, and let the shape (intersects / contains) give the final answer.
 * Choose when: Hundreds of shapes or more with frequent small queries (eraser hit tests, hover, taps). Measured (see Cost): about 3.5x faster than ListLocator per eraser inRect and 2.5x per atPoint at 100 strokes, 12x and 16x at 1,000, and 15x and 60x at 10,000. ListLocator builds 4-9x faster and its removeMultiple is 3-6x faster, so prefer ListLocator when the index is rebuilt or bulk-edited more often than it is queried, or for a few dozen shapes.
 * Cost: add O(depth) node visits plus an amortized split, one entry object; remove O(depth) (it walks up to merge); removeMultiple O(k * depth) for k IDs plus the merged subtrees; inRect O(cells overlapping r + shapes stored in them, including shapes that straddle a split line high in the tree); atPoint O(depth + shapes stored along the root-to-leaf path); inRect allocates a small traversal stack, atPoint nothing beyond out. Measured by npm run bench (bench.ts) on an Intel Core i9-14900KF desktop, Windows 11 (10.0.26200), Node 26.13.0; median of 9 runs; ink strokes of 2-40 points on a 10,000 x 10,000 canvas, 20 x 20 eraser. For 100 / 1,000 / 10,000 strokes: build 0.05 / 0.22 / 1.6 ms (0.5 / 0.22 / 0.16 us per add); eraser inRect 0.26 / 0.75 / 7.2 us per query; atPoint 0.33 / 0.48 / 1.5 us per query; removeMultiple of 10% 0.007 / 0.020 / 0.18 ms.
 * AdditionalSemantics: add throws an Error when the ID is already indexed (as ListLocator does), and a RangeError, before changing anything, when the shape's bounding box has a negative or non-finite size or reaches outside +-1e300 (a @requires in-range violation). The root starts as a square of side 2s, where s is the smallest power of two at least the first shape's width and height (and at least 2^-40 of its coordinates' magnitude, so that doubling always makes progress; 1 for an empty box at the origin), with its top-left corner s/2 above and left of the box's top-left corner; it grows by doubling toward the new shape, the old root becoming one quadrant, and never shrinks. Cell boundaries are stored, not recomputed, so children tile their parent exactly even when coordinates round. Depth is counted from the current root: when the root grows past a tree 32 levels deep, the subtrees that would sit below depth 32 are merged into their depth-32 ancestor. Merging: after any removal (remove or removeMultiple), the highest ancestor whose subtree holds 4 or fewer shapes collapses its subtree into itself. Empty shapes are stored in the tree like any other but are skipped by the box prefilter, so no query reports them. Bounding boxes are cached at add (Shape.deterministic).
 * Parts: The node tree (split, grow, collapse) could become a generic spatial-tree interface keyed by rectangles; the bounding-box prefilter is a rectangle-ops helper.
 * Imports: geometry.ts, shape.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "./shape.ts";

/** A leaf splits when it holds more than this many shapes. */
const MAX_ITEMS = 8;
/** No node is created below this depth; the root is depth 0. */
const MAX_DEPTH = 32;
/** A subtree holding this many shapes or fewer is merged into one leaf. */
const MERGE_AT = 4;
/** The in-range limit from ShapeLocator.add. */
const LIMIT = 1e300;

interface Entry {
  readonly id: ShapeId;
  readonly shape: Shape;
  // The cached bounding box, with right and bottom computed once as x + width and y + height.
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
  readonly empty: boolean;
  node: Node;
  /** Position in node.items. */
  index: number;
}

/**
 * A square-ish cell covering [x0, x1) × [y0, y1). Children, when present, are
 * [low-x/low-y, high-x/low-y, low-x/high-y, high-x/high-y], split at mx and my.
 */
interface Node {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  mx: number;
  my: number;
  parent: Node | undefined;
  children: Node[] | undefined;
  items: Entry[];
  /** Shapes stored in this node and all its descendants. */
  count: number;
}

function newNode(x0: number, y0: number, x1: number, y1: number, parent: Node | undefined): Node {
  return { x0, y0, x1, y1, mx: 0, my: 0, parent, children: undefined, items: [], count: 0 };
}

function fits(n: Node, e: Entry): boolean {
  return n.x0 <= e.x && e.right <= n.x1 && n.y0 <= e.y && e.bottom <= n.y1;
}

/** Index of n's child that fully contains e's box, or -1 if e straddles a split line. */
function childIndex(n: Node, e: Entry): number {
  const lowX = e.right <= n.mx;
  const highX = !lowX && e.x >= n.mx;
  const lowY = e.bottom <= n.my;
  const highY = !lowY && e.y >= n.my;
  if (!(lowX || highX) || !(lowY || highY)) return -1;
  return (highX ? 1 : 0) + (highY ? 2 : 0);
}

function place(n: Node, e: Entry): void {
  e.node = n;
  e.index = n.items.length;
  n.items.push(e);
}

function unplace(e: Entry): void {
  const items = e.node.items;
  const last = items.pop()!;
  if (last !== e) {
    items[e.index] = last;
    last.index = e.index;
  }
}

/** Smallest power of two that is at least v (v > 0, finite). */
function powerOfTwoAtLeast(v: number): number {
  let s = 1;
  while (s < v) s *= 2;
  while (s / 2 >= v) s /= 2;
  return s;
}

export class QuadTreeLocator implements ShapeLocator {
  readonly #entries = new Map<ShapeId, Entry>();
  #root: Node | undefined;
  /** An upper bound on the depth of the deepest node. */
  #height = 0;

  add(id: ShapeId, shape: Shape): void {
    if (this.#entries.has(id)) throw new Error(`ShapeLocator.add.new-id: ID ${id} is already indexed`);
    const b = shape.boundingBox();
    const right = b.x + b.width;
    const bottom = b.y + b.height;
    if (!(b.width >= 0 && b.height >= 0) ||
      ![b.x, b.y, right, bottom].every((v) => Math.abs(v) <= LIMIT)) {
      throw new RangeError(`ShapeLocator.add.in-range: bounding box ${JSON.stringify(b)} is out of range`);
    }
    const e: Entry = {
      id, shape, x: b.x, y: b.y, right, bottom,
      empty: b.width === 0 || b.height === 0,
      node: undefined as unknown as Node, index: -1,
    };
    if (!this.#root) this.#root = this.#initialRoot(e);
    if (!fits(this.#root, e)) {
      do this.#grow(e); while (!fits(this.#root, e));
      if (this.#height > MAX_DEPTH) this.#trim();
    }
    this.#entries.set(id, e);
    this.#insert(e);
  }

  remove(id: ShapeId): boolean {
    const e = this.#entries.get(id);
    if (!e) return false;
    this.#entries.delete(id);
    const n = e.node;
    unplace(e);
    this.#decrement(n);
    this.#mergeFrom(n);
    return true;
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    // First remove every listed ID, remembering which nodes lost shapes...
    const touched = new Set<Node>();
    let removed = 0;
    for (const id of ids) {
      const e = this.#entries.get(id);
      if (!e) continue;
      this.#entries.delete(id);
      touched.add(e.node);
      unplace(e);
      this.#decrement(e.node);
      removed++;
    }
    // ...then merge, once, above each of them.
    for (const n of touched) this.#mergeFrom(n);
    return removed;
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const start = out.length;
    const root = this.#root;
    if (!root || r.width === 0 || r.height === 0) return 0;
    const rx = r.x;
    const ry = r.y;
    const rr = r.x + r.width;
    const rb = r.y + r.height;
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (!(n.x0 < rr && rx < n.x1 && n.y0 < rb && ry < n.y1)) continue;
      for (const e of n.items) {
        if (!e.empty && e.x < rr && rx < e.right && e.y < rb && ry < e.bottom && e.shape.intersects(r)) out.push(e.id);
      }
      if (n.children) for (const c of n.children) if (c.count > 0) stack.push(c);
    }
    return out.length - start;
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const start = out.length;
    const { x, y } = p;
    let n = this.#root;
    if (!n || !(n.x0 <= x && x < n.x1 && n.y0 <= y && y < n.y1)) return 0;
    while (n) {
      for (const e of n.items) {
        if (e.x <= x && x < e.right && e.y <= y && y < e.bottom && e.shape.contains(p)) out.push(e.id);
      }
      n = n.children?.[(x >= n.mx ? 1 : 0) + (y >= n.my ? 2 : 0)];
    }
    return out.length - start;
  }

  #initialRoot(e: Entry): Node {
    const magnitude = Math.max(Math.abs(e.x), Math.abs(e.y), Math.abs(e.right), Math.abs(e.bottom));
    const extent = Math.max(e.right - e.x, e.bottom - e.y, magnitude * 2 ** -40);
    const s = extent > 0 ? powerOfTwoAtLeast(extent) : 1;
    const x0 = e.x - s / 2;
    const y0 = e.y - s / 2;
    return newNode(x0, y0, x0 + 2 * s, y0 + 2 * s, undefined);
  }

  /** Doubles the root toward e. The old root becomes one quadrant of the new one. */
  #grow(e: Entry): void {
    const old = this.#root!;
    const w = old.x1 - old.x0;
    const h = old.y1 - old.y0;
    const left = e.x < old.x0;
    const up = e.y < old.y0;
    const x0 = left ? old.x0 - w : old.x0;
    const x1 = left ? old.x1 : old.x1 + w;
    const y0 = up ? old.y0 - h : old.y0;
    const y1 = up ? old.y1 : old.y1 + h;
    const root = newNode(x0, y0, x1, y1, undefined);
    if (old.count === 0) {
      // Nothing to keep: replace the old root, children and all.
      this.#root = root;
      this.#height = 0;
      return;
    }
    root.mx = left ? old.x0 : old.x1;
    root.my = up ? old.y0 : old.y1;
    const slot = (left ? 1 : 0) + (up ? 2 : 0);
    root.children = [0, 1, 2, 3].map((i) => (i === slot ? old : this.#quadrant(root, i)));
    old.parent = root;
    root.count = old.count;
    this.#root = root;
    this.#height++;
  }

  #quadrant(n: Node, i: number): Node {
    return newNode(
      i & 1 ? n.mx : n.x0, i & 2 ? n.my : n.y0,
      i & 1 ? n.x1 : n.mx, i & 2 ? n.y1 : n.my, n);
  }

  /** Stores e in the deepest existing cell that fully contains its box, splitting a full leaf. */
  #insert(e: Entry): void {
    let n = this.#root!;
    let depth = 0;
    for (;;) {
      n.count++;
      if (!n.children) break;
      const i = childIndex(n, e);
      if (i < 0) break;
      n = n.children[i];
      depth++;
    }
    place(n, e);
    if (!n.children && n.items.length > MAX_ITEMS && depth < MAX_DEPTH) this.#split(n, depth);
  }

  /** Splits leaf n, at depth, into four children, moving down each shape that fits one. */
  #split(n: Node, depth: number): void {
    n.mx = n.x0 + (n.x1 - n.x0) / 2;
    n.my = n.y0 + (n.y1 - n.y0) / 2;
    const children = [0, 1, 2, 3].map((i) => this.#quadrant(n, i));
    n.children = children;
    if (depth + 1 > this.#height) this.#height = depth + 1;
    const items = n.items;
    n.items = [];
    for (const e of items) {
      const i = childIndex(n, e);
      const c = i < 0 ? n : children[i];
      place(c, e);
      if (c !== n) c.count++;
    }
    if (depth + 1 < MAX_DEPTH) {
      for (const c of children) if (c.items.length > MAX_ITEMS) this.#split(c, depth + 1);
    }
  }

  #decrement(n: Node | undefined): void {
    for (; n; n = n.parent) n.count--;
  }

  /** Collapses the highest ancestor of n (or n itself) whose subtree is nearly empty. */
  #mergeFrom(n: Node): void {
    if (n.parent === undefined && n !== this.#root) return; // detached by an earlier collapse
    let top: Node | undefined;
    for (let m: Node | undefined = n; m && m.count <= MERGE_AT; m = m.parent) top = m;
    if (top?.children) this.#collapse(top);
  }

  /** Moves every shape below n into n and drops n's children. */
  #collapse(n: Node): void {
    const gather = (m: Node) => {
      for (const c of m.children!) {
        for (const e of c.items) place(n, e);
        c.items = [];
        c.parent = undefined;
        if (c.children) gather(c);
        c.children = undefined;
      }
    };
    gather(n);
    n.children = undefined;
  }

  /** After the root grows, merges every node at depth MAX_DEPTH that has children. */
  #trim(): void {
    let height = 0;
    const visit = (n: Node, depth: number) => {
      if (depth > height) height = depth;
      if (!n.children) return;
      if (depth === MAX_DEPTH) {
        this.#collapse(n);
        return;
      }
      for (const c of n.children) visit(c, depth + 1);
    };
    visit(this.#root!, 0);
    this.#height = height;
  }
}
