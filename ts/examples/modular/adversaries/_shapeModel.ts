// A shape writer and processor for adversaries: correct unless a bug is
// switched on. helpers.check.ts runs the shape model contracts against them
// with no bug.

import type { Point, Rectangle } from "../geometry.ts";
import type { Shape, ShapeId } from "../shape.ts";
import type { OperationContent } from "../dataModel.ts";
import type { ShapeCollection, ShapeCollectionEvents, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "../shapeModel.ts";
import { compareOrder, knew, rectContains } from "../shapeModel.vocab.ts";
import { Events } from "../eventkit.ts";
import { readFacet } from "../shapewriterkit.ts";

export type WriterBug =
  | "none"
  | "above-below"        // add with below puts the shape above below
  | "counts-listed"      // remove returns the number of IDs listed
  | "emits-on-no-change" // remove emits change even when it removed nothing
  | "emits-before"       // add emits change before inserting
  | "stale-size"         // size isn't updated by remove
  | "reversed"           // forEach visits top to bottom
  | "keeps-removed"      // get still returns removed shapes
  | "get-emits"          // get emits change
  | "compares-shapes"    // compareZ compares the positions of the shapes' objects, not the IDs
  | "compare-abs"        // compareZ returns the distance between positions, never negative
  | "index-keeps-removed" // queries still find removed shapes
  | "box-only"           // atPoint answers from bounding boxes
  | "reports-twice"      // inRect reports the top shape it finds twice
  | "clears-out"         // atPoint empties out before appending
  | "returns-length"     // inRect returns out's length, not the number appended
  | "retains-out"        // a query keeps its out array, and the next query appends to it too
  | "query-moves-found"; // atPoint moves the shapes it finds to the top, as a most-recently-used cache would

export class TestShapeWriter extends Events<ShapeCollectionEvents> implements ShapeCollectionWriter {
  private items: [ShapeId, Shape][] = [];
  private readonly gone = new Map<ShapeId, Shape>();
  private sizeCache = 0;
  private readonly bug: WriterBug;

  constructor(bug: WriterBug = "none") {
    super();
    this.bug = bug;
  }

  get size(): number {
    return this.bug === "stale-size" ? this.sizeCache : this.items.length;
  }

  get(id: ShapeId): Shape | undefined {
    if (this.bug === "get-emits") this.emit("change");
    return this.items.find(([i]) => i === id)?.[1] ?? (this.bug === "keeps-removed" ? this.gone.get(id) : undefined);
  }

  forEach(visit: (id: ShapeId, shape: Shape) => void): void {
    const list = this.bug === "reversed" ? [...this.items].reverse() : [...this.items];
    for (const [id, shape] of list) visit(id, shape);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    const found = this.searched().filter(([, s]) => s.intersects(r)).map(([id]) => id);
    if (this.bug === "reports-twice" && found.length > 0) found.push(found[found.length - 1]);
    return this.report(found, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    const hit = (s: Shape) => (this.bug === "box-only" ? rectContains(s.boundingBox(), p) : s.contains(p));
    const found = this.searched().filter(([, s]) => hit(s)).map(([id]) => id);
    if (this.bug === "clears-out") out.length = 0;
    if (this.bug === "query-moves-found") {
      this.items = [...this.items.filter(([i]) => !found.includes(i)), ...this.items.filter(([i]) => found.includes(i))];
    }
    return this.report(found, out);
  }

  private retained: ShapeId[] | undefined;

  /** The shapes queries search. */
  private searched(): [ShapeId, Shape][] {
    return this.bug === "index-keeps-removed" ? [...this.items, ...this.gone] : this.items;
  }

  private report(found: ShapeId[], out: ShapeId[]): number {
    out.push(...found);
    if (this.bug === "retains-out") {
      this.retained?.push(...found);
      this.retained = out;
    }
    return this.bug === "returns-length" ? out.length : found.length;
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    const at = (id: ShapeId) => {
      if (this.bug === "compares-shapes") {
        const shape = this.items.find(([i]) => i === id)?.[1];
        return this.items.findIndex(([, s]) => s === shape);
      }
      return this.items.findIndex(([i]) => i === id);
    };
    return this.bug === "compare-abs" ? Math.abs(at(a) - at(b)) : at(a) - at(b);
  }

  add(id: ShapeId, shape: Shape, below?: ShapeId): void {
    if (this.bug === "emits-before") this.emit("change");
    let at = below === undefined ? this.items.length : this.items.findIndex(([i]) => i === below);
    if (below !== undefined && this.bug === "above-below") at++;
    this.items.splice(at, 0, [id, shape]);
    this.sizeCache++;
    if (this.bug !== "emits-before") this.emit("change");
  }

  remove(ids: readonly ShapeId[]): number {
    const before = this.items.length;
    for (const [id, shape] of this.items) if (ids.includes(id)) this.gone.set(id, shape);
    this.items = this.items.filter(([i]) => !ids.includes(i));
    const removed = before - this.items.length;
    if (removed > 0 || this.bug === "emits-on-no-change") this.emit("change");
    return this.bug === "counts-listed" ? ids.length : removed;
  }
}

export type ProcessorBug =
  | "none"
  | "stale-refseq"        // stamps refSeq -1 always
  | "pending-minus-two"   // stamps a pending seq of -2
  | "client-seq-from-minus-one" // clientSeq starts at -1
  | "refseq-minus-two"    // refSeq starts at -2 before any remote operation
  | "shares-op"           // returns its own stamped operation, which acknowledging later changes
  | "marks-remote"        // returns the queued remote operation itself, and marks it when applying it
  | "applies-at-once"     // enqueue on local applies the operation immediately
  | "applies-on-read"     // reading the model first applies whatever is queued
  | "self-schedules"      // enqueue schedules process itself
  | "remote-on-top"       // puts a remote add on top, above pending local adds
  | "local-newest-bottom" // puts a local add below the pending local adds before it
  | "ignores-remote-add"  // ignores a remote add while local operations are pending
  | "removes-first-only"  // a remove removes only the first listed shape
  | "clears-everything"   // a clear removes every shape present
  | "forgets-own-pending" // a clear knows only acknowledged adds up to its refSeq, not its client's own earlier ones
  | "ack-reapplies"       // an acknowledgment removes the shape and adds it again on top
  | "one-at-a-time"       // a remove calls the writer once per listed ID
  | "counter-ids"         // newShapeId uses a counter without the clientId
  | "exposes-writer";     // model is the writer itself

export class TestShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local = { enqueue: (content: OperationContent<ShapeOp>) => this.enqueueLocal(content) };
  readonly remote = { enqueue: (op: ShapeOp) => this.enqueueRemote(op) };
  private readonly writer = new TestShapeWriter();
  private readonly localQueue: ShapeOp[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private clientSeq: number;
  private ids = 0;
  private lastSeq: number;
  private readonly adds = new Map<ShapeId, ShapeOp>();
  private readonly pending = new Map<number, ShapeOp>();
  private readonly bug: ProcessorBug;

  constructor(clientId: string, bug: ProcessorBug = "none") {
    this.clientId = clientId;
    this.bug = bug;
    this.clientSeq = bug === "client-seq-from-minus-one" ? -2 : 0;
    this.lastSeq = bug === "refseq-minus-two" ? -2 : -1;
    const facet = readFacet(this.writer);
    this.model = bug === "exposes-writer" ? this.writer : bug === "applies-on-read" ? this.lazy(facet) : facet;
  }

  /** A facet that applies what is queued before each read. */
  private lazy(facet: ShapeCollection): ShapeCollection {
    const drain = () => void this.drain();
    return {
      get: (id) => { drain(); return facet.get(id); },
      get size() { drain(); return facet.size; },
      forEach: (visit) => { drain(); facet.forEach(visit); },
      compareZ: (a, b) => { drain(); return facet.compareZ(a, b); },
      inRect: (r, out) => { drain(); return facet.inRect(r, out); },
      atPoint: (p, out) => { drain(); return facet.atPoint(p, out); },
      on(event, listener) { facet.on(event, listener); return this; },
      off(event, listener) { facet.off(event, listener); return this; },
    };
  }

  newShapeId(): ShapeId {
    return (this.bug === "counter-ids" ? `${this.ids++}` : `${this.clientId}#${this.ids++}`) as ShapeId;
  }

  async process(): Promise<void> {
    this.drain();
  }

  private drain(): void {
    for (let op = this.localQueue.shift(); op; op = this.localQueue.shift()) this.apply(op);
    for (let op = this.remoteQueue.shift(); op; op = this.remoteQueue.shift()) this.applyRemote(op);
  }

  private enqueueLocal(content: OperationContent<ShapeOp>): ShapeOp {
    const op = {
      ...content, clientId: this.clientId, clientSeq: ++this.clientSeq,
      refSeq: this.bug === "stale-refseq" ? -1 : this.lastSeq, seq: this.bug === "pending-minus-two" ? -2 : -1,
    } as ShapeOp;
    if (this.bug === "pending-minus-two") {
      // Keeps -1 internally, so only the returned operation is wrong.
      this.localQueue.push({ ...op, seq: -1 });
    } else {
      this.localQueue.push(op);
    }
    if (this.bug === "applies-at-once") this.drain();
    if (this.bug === "self-schedules") setImmediate(() => void this.process());
    return this.bug === "shares-op" ? op : { ...op };
  }

  private enqueueRemote(op: ShapeOp): ShapeOp {
    this.remoteQueue.push(op);
    return this.bug === "marks-remote" ? op : { ...op };
  }

  private applyRemote(op: ShapeOp): void {
    if (this.bug === "marks-remote") Object.assign(op, { applied: true });
    this.lastSeq = op.seq;
    const mine = op.clientId === this.clientId ? this.pending.get(op.clientSeq) : undefined;
    if (mine) {
      mine.seq = op.seq;
      this.pending.delete(op.clientSeq);
      if (this.bug === "ack-reapplies" && mine.type === "add" && this.writer.get(mine.id)) {
        this.writer.remove([mine.id]);
        this.writer.add(mine.id, mine.shape);
      }
      return;
    }
    if (this.bug === "ignores-remote-add" && op.type === "add" && this.pending.size > 0) return;
    this.apply({ ...op });
  }

  private apply(op: ShapeOp): void {
    if (op.seq === -1) this.pending.set(op.clientSeq, op);
    switch (op.type) {
      case "add": {
        this.adds.set(op.id, op);
        let below: ShapeId | undefined;
        if (!(this.bug === "remote-on-top" && op.seq !== -1)) {
          this.writer.forEach((id) => {
            const other = this.adds.get(id)!;
            const earlierPending = this.bug === "local-newest-bottom" && op.seq === -1 && other.seq === -1;
            if (below === undefined && (earlierPending || compareOrder(op, other) < 0)) below = id;
          });
        }
        this.writer.add(op.id, op.shape, below);
        break;
      }
      case "remove":
        if (this.bug === "removes-first-only") this.writer.remove(op.ids.slice(0, 1));
        else if (this.bug === "one-at-a-time") for (const id of op.ids) this.writer.remove([id]);
        else this.writer.remove(op.ids);
        break;
      case "clear": {
        const removed: ShapeId[] = [];
        this.writer.forEach((id) => {
          const add = this.adds.get(id)!;
          const known = this.bug === "forgets-own-pending" ? add.seq !== -1 && add.seq <= op.refSeq : knew(op, add);
          if (this.bug === "clears-everything" || known) removed.push(id);
        });
        this.writer.remove(removed);
        break;
      }
    }
  }
}
