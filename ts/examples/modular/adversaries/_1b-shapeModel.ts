// Shape writer and processor for the round 4 phase 1b adversaries: correct
// unless a bug is switched on. Unlike _shapeModel.ts, the writer keeps
// z-order with order keys and indexes in a locator, as task 8 describes,
// and the processor keeps its own read facet, as task 9 describes.

import type { Point, Rectangle } from "../geometry.ts";
import type { Shape, ShapeId, ShapeLocator } from "../shape.ts";
import type { OperationContent, OperationLogEvents } from "../dataModel.ts";
import type {
  ShapeCollection, ShapeCollectionEvents, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp,
} from "../shapeModel.ts";
import { compareOrder, knew } from "../shapeModel.vocab.ts";
import { Events } from "../eventkit.ts";
import { ListIndex } from "../modelkit.ts";
import { RefShapeWriter } from "../shapewriterkit.ts";

export type KeyedWriterBug =
  | "none"
  | "keys-run-out"     // order keys are integers 1024 apart, halved on each insert below, never renumbered
  | "index-after-emit"; // the locator is updated after change is emitted

interface Node {
  id: ShapeId;
  shape: Shape;
  key: number;
  prev: Node | undefined;
  next: Node | undefined;
}

/** A ShapeCollectionWriter over a locator, with z-order as a linked list with order keys. */
export class KeyedWriter extends Events<ShapeCollectionEvents> implements ShapeCollectionWriter {
  private readonly locator: ShapeLocator;
  private readonly nodes = new Map<ShapeId, Node>();
  private head: Node | undefined;
  private tail: Node | undefined;
  private readonly bug: KeyedWriterBug;

  constructor(bug: KeyedWriterBug = "none", locator: ShapeLocator = new ListIndex()) {
    super();
    this.bug = bug;
    this.locator = locator;
  }

  get size(): number {
    return this.nodes.size;
  }

  get(id: ShapeId): Shape | undefined {
    return this.nodes.get(id)?.shape;
  }

  forEach(visit: (id: ShapeId, shape: Shape) => void): void {
    for (let n = this.head; n; n = n.next) visit(n.id, n.shape);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return Math.sign(this.nodes.get(a)!.key - this.nodes.get(b)!.key);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.locator.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.locator.atPoint(p, out);
  }

  add(id: ShapeId, shape: Shape, below?: ShapeId): void {
    const next = below === undefined ? undefined : this.nodes.get(below)!;
    const prev = next ? next.prev : this.tail;
    const node: Node = { id, shape, key: 0, prev, next };
    if (prev) prev.next = node; else this.head = node;
    if (next) next.prev = node; else this.tail = node;
    this.nodes.set(id, node);
    if (!prev && !next) node.key = 0;
    else if (!next) node.key = prev!.key + 1024;
    else if (!prev) node.key = next.key - 1024;
    else {
      node.key = Math.floor((prev.key + next.key) / 2);
      if (this.bug !== "keys-run-out" && (node.key <= prev.key || node.key >= next.key)) this.renumber();
    }
    if (this.bug !== "index-after-emit") this.locator.add(id, shape);
    this.emit("change");
    if (this.bug === "index-after-emit") this.locator.add(id, shape);
  }

  private renumber(): void {
    let k = 0;
    for (let n = this.head; n; n = n.next) n.key = (k += 1024);
  }

  remove(ids: readonly ShapeId[]): number {
    const gone: ShapeId[] = [];
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (!n) continue;
      this.nodes.delete(id);
      if (n.prev) n.prev.next = n.next; else this.head = n.next;
      if (n.next) n.next.prev = n.prev; else this.tail = n.prev;
      gone.push(id);
    }
    if (gone.length === 0) return 0;
    if (this.bug !== "index-after-emit") this.locator.removeMultiple(gone);
    this.emit("change");
    if (this.bug === "index-after-emit") this.locator.removeMultiple(gone);
    return gone.length;
  }
}

export type FacetProcessorBug =
  | "none"
  | "facet-on-returns-writer" // the model facet's on and off return the writer, as a delegating one-liner does
  | "ids-no-separator"        // newShapeId is the clientId and a counter with nothing between them
  | "timer-process"           // enqueue schedules process for the next frame, 16 ms later
  | "remote-first-twice"      // process takes remote first; an ack whose operation is still queued is applied, then the operation again
  | "ack-by-client-seq"       // recognizes an acknowledgment by clientSeq alone, ignoring clientId
  | "refseq-exclusive"        // a clear knows acknowledged adds with seq below its refSeq, not at it
  | "clear-ignores-refseq"    // a clear removes every present shape except this client's pending adds
  | "filters-ids-in-place";   // returns a shallow copy, then drops absent IDs from a remove's ids array in place when applying it

/** A ShapeMessageProcessor with its own read facet, as task 9 describes. */
export class FacetProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly logOperations = new Events<OperationLogEvents<ShapeOp>>();
  readonly model: ShapeCollection;
  readonly local = { enqueue: (content: OperationContent<ShapeOp>) => this.enqueueLocal(content) };
  readonly remote = { enqueue: (op: ShapeOp) => this.enqueueRemote(op) };
  private readonly writer: ShapeCollectionWriter;
  private readonly localQueue: ShapeOp[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private clientSeq = 0;
  private ids = 0;
  private lastSeq = -1;
  private readonly adds = new Map<ShapeId, ShapeOp>();
  private readonly pending = new Map<number, ShapeOp>();
  private readonly bug: FacetProcessorBug;

  constructor(clientId: string, bug: FacetProcessorBug = "none", writer: ShapeCollectionWriter = new RefShapeWriter()) {
    this.clientId = clientId;
    this.bug = bug;
    this.writer = writer;
    const w = writer;
    const returnsWriter = bug === "facet-on-returns-writer";
    const facet: ShapeCollection = {
      get: (id) => w.get(id),
      get size() { return w.size; },
      forEach: (visit) => w.forEach(visit),
      compareZ: (a, b) => w.compareZ(a, b),
      inRect: (r, out) => w.inRect(r, out),
      atPoint: (p, out) => w.atPoint(p, out),
      on(event, listener) { const r = w.on(event, listener); return returnsWriter ? r : this; },
      off(event, listener) { const r = w.off(event, listener); return returnsWriter ? r : this; },
    };
    this.model = facet;
  }

  newShapeId(): ShapeId {
    return `${this.clientId}${this.bug === "ids-no-separator" ? "" : "#"}${this.ids++}` as ShapeId;
  }

  async process(): Promise<void> {
    if (this.bug === "remote-first-twice") {
      for (let op = this.remoteQueue.shift(); op; op = this.remoteQueue.shift()) {
      this.applyRemote(op);
      this.logOperations.emit("applied", op);
    }
      for (let op = this.localQueue.shift(); op; op = this.localQueue.shift()) {
      this.apply(op);
      this.logOperations.emit("applied", op);
    }
      return;
    }
    for (let op = this.localQueue.shift(); op; op = this.localQueue.shift()) {
      this.apply(op);
      this.logOperations.emit("applied", op);
    }
    for (let op = this.remoteQueue.shift(); op; op = this.remoteQueue.shift()) {
      this.applyRemote(op);
      this.logOperations.emit("applied", op);
    }
  }

  private enqueueLocal(content: OperationContent<ShapeOp>): ShapeOp {
    const op = { ...content, clientId: this.clientId, clientSeq: ++this.clientSeq, refSeq: this.lastSeq, seq: -1 } as ShapeOp;
    if (this.bug === "filters-ids-in-place" && op.type === "remove") {
      // A shallow copy for the queue too, so the queued and returned operations share ids.
      this.localQueue.push({ ...op });
    } else {
      this.localQueue.push(op.type === "remove" ? { ...op, ids: [...op.ids] } : op);
    }
    if (this.bug === "timer-process") setTimeout(() => void this.process(), 16);
    return this.bug === "filters-ids-in-place" ? { ...op } : (op.type === "remove" ? { ...op, ids: [...op.ids] } : { ...op });
  }

  private enqueueRemote(op: ShapeOp): ShapeOp {
    this.remoteQueue.push({ ...op });
    if (this.bug === "timer-process") setTimeout(() => void this.process(), 16);
    return { ...op };
  }

  private applyRemote(op: ShapeOp): void {
    this.lastSeq = op.seq;
    const mine = op.clientId === this.clientId || this.bug === "ack-by-client-seq" ? this.pending.get(op.clientSeq) : undefined;
    if (mine) {
      if (mine.type === "add") this.adds.set(mine.id, { ...mine, seq: op.seq });
      this.pending.delete(op.clientSeq);
      return;
    }
    this.apply({ ...op });
  }

  private apply(op: ShapeOp): void {
    if (op.seq === -1) this.pending.set(op.clientSeq, op);
    switch (op.type) {
      case "add": {
        this.adds.set(op.id, op);
        let below: ShapeId | undefined;
        this.writer.forEach((id) => {
          if (below === undefined && compareOrder(op, this.adds.get(id)!) < 0) below = id;
        });
        this.writer.add(op.id, op.shape, below);
        break;
      }
      case "remove": {
        if (this.bug === "filters-ids-in-place") {
          const ids = op.ids as ShapeId[];
          for (let i = ids.length - 1; i >= 0; i--) if (this.writer.get(ids[i]) === undefined) ids.splice(i, 1);
        }
        this.writer.remove(op.ids);
        break;
      }
      case "clear": {
        const known: ShapeId[] = [];
        this.writer.forEach((id) => {
          const add = this.adds.get(id)!;
          let k: boolean;
          if (this.bug === "refseq-exclusive") {
            k = (add.seq !== -1 && add.seq < op.refSeq) || (add.clientId === op.clientId && add.clientSeq < op.clientSeq);
          } else if (this.bug === "clear-ignores-refseq") {
            k = op.seq === -1 || add.seq !== -1;
          } else {
            k = knew(op, add);
          }
          if (k) known.push(id);
        });
        this.writer.remove(known);
        break;
      }
    }
  }
}
