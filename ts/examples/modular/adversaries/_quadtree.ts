// A quadtree locator following impl-specs.md section 4, for building adversaries.
// Not an adversary itself (the runner only picks up *.adversary.ts). With no bug
// flag it passes shapeLocator.contract.ts. Each flag switches on one mistake
// that a real implementation of section 4 could plausibly make.

import type { Point, Rectangle } from "../geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "../shape.ts";
import { TestBox } from "../testkit.ts";

export type Bug =
  | "none"
  | "point-on-mid-goes-low"       // atPoint descends into the low child when p is exactly on the midline
  | "place-by-corner"             // places a shape in the child holding its top-left corner, even if it sticks out
  | "grow-wrong-quadrant"         // when growing up/left, puts the old root in the wrong child slot
  | "split-drops-straddlers"      // on split, shapes that fit no child are lost
  | "skip-internal-items"         // queries only check shapes stored in leaves
  | "merge-drops-grandchildren"   // removeMultiple's merge pass collects only direct children's shapes
  | "merge-on-remove-drops-grandchildren" // same mistake, but in remove()
  | "remove-leaves-node-entry"    // remove() forgets the ID but leaves the shape in its node
  | "batch-keeps-where"           // removeMultiple deletes from nodes but not from the ID map
  | "batch-counts-duplicates"     // removeMultiple counts every listed ID that was present at the start
  | "tombstones"                  // lazy deletion: removed IDs go in a dead set that add() never clears
  | "dedupe-includes"             // enforces "once" with out.includes, over the whole of out
  | "dedupe-whole-out"            // enforces "once" by rewriting out through a Set
  | "count-total"                 // returns out.length instead of the number appended
  | "store-in-all-overlapping"    // stores a straddling shape in every overlapping child, no dedupe
  | "bbox-only-atPoint"           // atPoint answers from bounding boxes
  | "bbox-only-inRect"            // inRect answers from bounding boxes
  | "retain-out"                  // keeps the last out array and appends later results to it too
  | "grow-cap"                    // gives up (throws) after 64 doublings of the root
  | "zero-size-root"              // root sized from the first shape's box; a zero-size first box can't grow
  | "drop-empty"                  // doesn't index shapes with an empty bounding box (they never match)
  | "shared-out-length"           // computes the count from a length captured on the first call only
  | "first-box-root"              // root starts exactly at the first box, without padding (correct, but see findings)
  | "atPoint-root-twice"          // atPoint checks the root's own shapes before the descent loop, and again in it
  | "recomputed-bounds"           // recomputes midlines and grown roots from x + size, so cells disagree after rounding
  | "unit-root"                   // first root has side 2 however far out the first shape is, so growth can't move it
  | "query-drops-empty"           // inRect drops empty shapes it passes, since no query can ever find them
  | "query-boxes-found";          // inRect replaces each shape it finds with a box of its bounding box, to speed up later queries

/** Counters for checking what the contract suite exercises. */
export const stats = { splits: 0, maxSplitDepth: 0, merges: 0, deepMerges: 0, grows: 0 };

const MAX_ITEMS = 8;
const MAX_DEPTH = 32;

/**
 * A cell [x0, x1) × [y0, y1), split at its midlines mx and my. Edges and
 * midlines are stored, never recomputed, so children tile their parent
 * exactly even when coordinates round.
 */
interface Node {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mx: number;
  my: number;
  depth: number;
  items: Map<ShapeId, Shape>;
  children: Node[] | undefined;
}

function right(r: Rectangle): number { return r.x + r.width; }
function bottom(r: Rectangle): number { return r.y + r.height; }

function cellContainsBox(n: Node, b: Rectangle): boolean {
  return b.x >= n.x0 && b.y >= n.y0 && right(b) <= n.x1 && bottom(b) <= n.y1;
}

function cellOverlaps(n: Node, r: Rectangle): boolean {
  return r.width > 0 && r.height > 0 &&
    r.x < n.x1 && n.x0 < right(r) && r.y < n.y1 && n.y0 < bottom(r);
}

function newNode(x0: number, y0: number, x1: number, y1: number, depth: number,
  mx = x0 + (x1 - x0) / 2, my = y0 + (y1 - y0) / 2): Node {
  return { x0, y0, x1, y1, mx, my, depth, items: new Map(), children: undefined };
}

/** n's four children, tiling it exactly: top-left, top-right, bottom-left, bottom-right. */
function quarters(n: Node): Node[] {
  const d = n.depth + 1;
  return [
    newNode(n.x0, n.y0, n.mx, n.my, d), newNode(n.mx, n.y0, n.x1, n.my, d),
    newNode(n.x0, n.my, n.mx, n.y1, d), newNode(n.mx, n.my, n.x1, n.y1, d),
  ];
}

export class QuadTree implements ShapeLocator {
  readonly bug: Bug;
  root: Node | undefined;
  readonly where = new Map<ShapeId, Node[]>();
  readonly dead = new Set<ShapeId>();
  retained: ShapeId[] | undefined;
  firstLength: number | undefined;

  constructor(bug: Bug = "none") { this.bug = bug; }

  add(id: ShapeId, shape: Shape): void {
    const b = shape.boundingBox();
    if (this.bug === "drop-empty" && (b.width === 0 || b.height === 0)) return;
    if (this.bug === "tombstones" && this.dead.has(id)) {
      // Forgets to clear the tombstone, but does index the shape again.
    }
    if (!this.root) {
      let size: number;
      if (this.bug === "zero-size-root") size = Math.max(b.width, b.height);
      else {
        const m = Math.max(b.width, b.height);
        size = 1;
        if (m > 0) {
          while (size < m) size *= 2;
          // 2^1024 overflows: a finite box wider than 2^1023 has no power-of-two cell.
          if (!Number.isFinite(size)) throw new Error("root size overflows");
          while (size / 2 >= m) size /= 2;
        }
        // Far from the origin a small cell can't move when it doubles, so keep it a
        // fixed fraction of the coordinates' magnitude.
        const far = Math.max(Math.abs(b.x), Math.abs(b.y)) * 2 ** -40;
        if (this.bug !== "unit-root") while (size < far) size *= 2;
      }
      this.root = this.bug === "first-box-root" || this.bug === "zero-size-root"
        ? newNode(b.x, b.y, b.x + size, b.y + size, 0)
        : newNode(b.x - size / 2, b.y - size / 2, b.x - size / 2 + size * 2, b.y - size / 2 + size * 2, 0);
    }
    let doublings = 0;
    while (!cellContainsBox(this.root, b)) {
      if (++doublings > (this.bug === "grow-cap" ? 64 : 4000)) throw new Error("root can't grow to hold this shape");
      const before = this.root;
      this.grow(b);
      // A root whose edges round to the same values when it doubles can never reach b.
      if (this.root.x0 === before.x0 && this.root.x1 === before.x1 &&
        this.root.y0 === before.y0 && this.root.y1 === before.y1) throw new Error("root doesn't grow");
      if (!Number.isFinite(this.root.x1 - this.root.x0)) throw new Error("root size overflows");
    }
    this.insert(this.root, id, shape, b);
  }

  private grow(b: Rectangle): void {
    stats.grows++;
    const old = this.root!;
    const left = b.x < old.x0;
    const up = b.y < old.y0;
    const w = old.x1 - old.x0;
    const h = old.y1 - old.y0;
    const root = this.bug === "recomputed-bounds"
      ? newNode(left ? old.x0 - w : old.x0, up ? old.y0 - h : old.y0,
        (left ? old.x0 - w : old.x0) + 2 * w, (up ? old.y0 - h : old.y0) + 2 * h, 0)
      : newNode(left ? old.x0 - w : old.x0, up ? old.y0 - h : old.y0,
        left ? old.x1 : old.x1 + w, up ? old.y1 : old.y1 + h, 0,
        left ? old.x0 : old.x1, up ? old.y0 : old.y1);
    this.bumpDepth(old);
    if (old.items.size > 0 || old.children) {
      const children = quarters(root);
      let slot = (left ? 1 : 0) + (up ? 2 : 0);
      if (this.bug === "grow-wrong-quadrant" && left) slot = slot ^ 1;
      children[slot] = old;
      root.children = children;
    }
    this.root = root;
  }

  private bumpDepth(n: Node): void {
    n.depth++;
    if (n.children) for (const c of n.children) this.bumpDepth(c);
  }

  private childFor(n: Node, b: Rectangle): Node | undefined {
    if (!n.children) return undefined;
    if (this.bug === "place-by-corner") {
      const i = (b.x >= n.mx ? 1 : 0) + (b.y >= n.my ? 2 : 0);
      return n.children[i];
    }
    return n.children.find((c) => cellContainsBox(c, b));
  }

  private insert(n: Node, id: ShapeId, shape: Shape, b: Rectangle, spread = true): void {
    for (;;) {
      if (this.bug === "store-in-all-overlapping" && spread && n.children && !this.childFor(n, b)) {
        // Copies a straddling shape into each overlapping child (one level only).
        const hit = n.children.filter((c) => cellOverlaps(c, b));
        for (const c of hit) {
          c.items.set(id, shape);
          const list = this.where.get(id) ?? [];
          list.push(c);
          this.where.set(id, list);
        }
        return;
      }
      const c = this.childFor(n, b);
      if (!c) break;
      n = c;
    }
    n.items.set(id, shape);
    const list = this.where.get(id) ?? [];
    list.push(n);
    this.where.set(id, list);
    if (!n.children && n.items.size > MAX_ITEMS && n.depth < MAX_DEPTH) this.split(n);
  }

  private split(n: Node): void {
    stats.splits++;
    stats.maxSplitDepth = Math.max(stats.maxSplitDepth, n.depth + 1);
    n.children = quarters(n);
    const items = [...n.items];
    n.items.clear();
    for (const [id, shape] of items) {
      const list = this.where.get(id);
      if (list) list.splice(list.indexOf(n), 1);
      const b = shape.boundingBox();
      if (this.bug === "split-drops-straddlers" && !this.childFor(n, b)) { this.where.delete(id); continue; }
      this.insert(n, id, shape, b, false);
    }
  }

  remove(id: ShapeId): boolean {
    if (this.bug === "tombstones") {
      if (!this.where.has(id) || this.dead.has(id)) return false;
      this.dead.add(id);
      return true;
    }
    const nodes = this.where.get(id);
    if (!nodes) return false;
    this.where.delete(id);
    if (this.bug !== "remove-leaves-node-entry") for (const n of nodes) n.items.delete(id);
    if (this.bug === "merge-on-remove-drops-grandchildren" && this.root) this.merge(this.root, true);
    return true;
  }

  removeMultiple(ids: readonly ShapeId[]): number {
    if (this.bug === "tombstones") {
      let k = 0;
      for (const id of ids) if (this.remove(id)) k++;
      return k;
    }
    let removed = 0;
    if (this.bug === "batch-counts-duplicates") {
      const present = new Set(this.where.keys());
      removed = ids.filter((id) => present.has(id)).length;
    }
    for (const id of ids) {
      const nodes = this.where.get(id);
      if (!nodes) continue;
      if (this.bug !== "batch-keeps-where") this.where.delete(id);
      const had = nodes.some((n) => n.items.delete(id));
      if (this.bug !== "batch-counts-duplicates") {
        if (this.bug === "batch-keeps-where" ? had : true) removed++;
      }
    }
    if (this.root) this.merge(this.root, this.bug === "merge-drops-grandchildren");
    return removed;
  }

  /** Returns the number of shapes in n's subtree; merges nearly empty subtrees into n. */
  private merge(n: Node, buggy: boolean): number {
    if (!n.children) return n.items.size;
    if (buggy) {
      // Top-down: counts only n and its direct children, then collapses them,
      // dropping any grandchildren.
      const direct = n.items.size + n.children.reduce((k, c) => k + c.items.size, 0);
      if (direct <= MAX_ITEMS / 2) {
        stats.merges++;
        if (n.children.some((c) => c.children)) stats.deepMerges++;
        const drop = (m: Node) => { for (const id of m.items.keys()) this.where.delete(id); if (m.children) m.children.forEach(drop); };
        for (const c of n.children) {
          for (const [id, sh] of c.items) { n.items.set(id, sh); this.where.set(id, [n]); }
          if (c.children) c.children.forEach(drop);
        }
        n.children = undefined;
        return n.items.size;
      }
    }
    let total = n.items.size;
    for (const c of n.children) total += this.merge(c, buggy);
    if (total <= MAX_ITEMS / 2) {
      stats.merges++;
      if (n.children.some((c) => c.children)) stats.deepMerges++;
      const gather = (m: Node) => {
        for (const [id, sh] of m.items) { n.items.set(id, sh); this.where.set(id, [n]); }
        if (m.children) m.children.forEach(gather);
      };
      n.children.forEach(gather);
      n.children = undefined;
    }
    return total;
  }

  private live(id: ShapeId): boolean {
    return !(this.bug === "tombstones" && this.dead.has(id));
  }

  private emit(out: ShapeId[], start: number, id: ShapeId): void {
    if (this.bug === "dedupe-includes" && out.includes(id)) return;
    out.push(id);
    if (this.bug === "retain-out" && this.retained && this.retained !== out) this.retained.push(id);
  }

  private finish(out: ShapeId[], start: number): number {
    if (this.bug === "dedupe-whole-out") {
      const all = [...new Set(out)];
      out.length = 0;
      out.push(...all);
    }
    if (this.bug === "retain-out") this.retained = out;
    if (this.bug === "count-total") return out.length;
    if (this.bug === "shared-out-length") {
      this.firstLength ??= start;
      return out.length - this.firstLength;
    }
    return out.length - start;
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const start = out.length;
    const empty: ShapeId[] = [];
    const visit = (n: Node) => {
      if (!cellOverlaps(n, r)) return;
      if (!(this.bug === "skip-internal-items" && n.children)) {
        for (const [id, s] of n.items) {
          if (!this.live(id)) continue;
          const b = s.boundingBox();
          if (this.bug === "query-drops-empty" && (b.width === 0 || b.height === 0)) empty.push(id);
          const hit = this.bug === "bbox-only-inRect" ? boxOverlaps(b, r) : s.intersects(r);
          if (hit) this.emit(out, start, id);
          if (hit && this.bug === "query-boxes-found") n.items.set(id, new TestBox(b));
        }
      }
      if (n.children) for (const c of n.children) visit(c);
    };
    if (this.root) visit(this.root);
    if (empty.length > 0) this.removeMultiple(empty);
    return this.finish(out, start);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const start = out.length;
    let n = this.root;
    if (n && !(n.x0 <= p.x && p.x < n.x1 && n.y0 <= p.y && p.y < n.y1)) n = undefined;
    if (n && this.bug === "atPoint-root-twice") for (const [id, s] of n.items) if (s.contains(p)) out.push(id);
    while (n) {
      if (!(this.bug === "skip-internal-items" && n.children)) {
        for (const [id, s] of n.items) {
          if (!this.live(id)) continue;
          const b = s.boundingBox();
          const hit = this.bug === "bbox-only-atPoint"
            ? b.x <= p.x && p.x < right(b) && b.y <= p.y && p.y < bottom(b)
            : s.contains(p);
          if (hit) this.emit(out, start, id);
        }
      }
      if (!n.children) break;
      const recompute = this.bug === "recomputed-bounds";
      const midX = recompute ? n.x0 + (n.x1 - n.x0) / 2 : n.mx;
      const midY = recompute ? n.y0 + (n.y1 - n.y0) / 2 : n.my;
      const i = this.bug === "point-on-mid-goes-low"
        ? (p.x > midX ? 1 : 0) + (p.y > midY ? 2 : 0)
        : (p.x >= midX ? 1 : 0) + (p.y >= midY ? 2 : 0);
      n = n.children[i];
    }
    return this.finish(out, start);
  }
}

function boxOverlaps(a: Rectangle, b: Rectangle): boolean {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
    a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}
