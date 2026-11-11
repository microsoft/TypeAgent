// The reference shape model (shapeModel.ts): RefShapeWriter, a writer kept
// in an array in z-order, and RefShapeProcessor, which applies ShapeOps to
// one. helpers.check.ts runs their contracts against them.

import type { Shape } from "./shape.ts";
import type { OperationContent } from "./dataModel.ts";
import type {
  ShapeCollection, ShapeCollectionEvents, ShapeCollectionWriter, ShapeId, ShapeMessageProcessor, ShapeOp,
} from "./shapeModel.ts";
import { compareOrder, knew } from "./shapeModel.vocab.ts";
import { Events } from "./eventkit.ts";

export class RefShapeWriter<S extends Shape = Shape> extends Events<ShapeCollectionEvents> implements ShapeCollectionWriter<S> {
  private items: [ShapeId, S][] = [];

  get size(): number {
    return this.items.length;
  }

  get(id: ShapeId): S | undefined {
    return this.items.find(([i]) => i === id)?.[1];
  }

  forEach(visit: (id: ShapeId, shape: S) => void): void {
    for (const [id, shape] of [...this.items]) visit(id, shape);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.items.findIndex(([i]) => i === a) - this.items.findIndex(([i]) => i === b);
  }

  add(id: ShapeId, shape: S, below?: ShapeId): void {
    const at = below === undefined ? this.items.length : this.items.findIndex(([i]) => i === below);
    this.items.splice(at, 0, [id, shape]);
    this.emit("change");
  }

  remove(ids: readonly ShapeId[]): number {
    const before = this.items.length;
    this.items = this.items.filter(([i]) => !ids.includes(i));
    const removed = before - this.items.length;
    if (removed > 0) this.emit("change");
    return removed;
  }
}

/** A read-only view of a writer: the facet a processor gives out. */
export function readFacet<S extends Shape>(w: ShapeCollectionWriter<S>): ShapeCollection<S> {
  return {
    get: (id) => w.get(id),
    get size() { return w.size; },
    forEach: (visit) => w.forEach(visit),
    compareZ: (a, b) => w.compareZ(a, b),
    on(event, listener) { w.on(event, listener); return this; },
    off(event, listener) { w.off(event, listener); return this; },
  };
}

type Stamped = ShapeOp;

export class RefShapeProcessor extends Events<{ outgoing: [ShapeOp] }> implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local = { enqueue: (content: OperationContent<ShapeOp>) => this.enqueueLocal(content) };
  readonly remote = { enqueue: (op: ShapeOp) => void this.remoteQueue.push(op) };
  private readonly writer = new RefShapeWriter();
  private readonly localQueue: Stamped[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private clientSeq = 0;
  private ids = 0;
  private lastSeq = -1;
  // The add behind each present shape, with its seq as known here.
  private readonly adds = new Map<ShapeId, ShapeOp>();
  // Local operations applied and not yet acknowledged, by clientSeq.
  private readonly pending = new Map<number, ShapeOp>();

  constructor(clientId: string) {
    super();
    this.clientId = clientId;
    this.model = readFacet(this.writer);
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.ids++}` as ShapeId;
  }

  async process(): Promise<void> {
    // Local operations first, so that each is applied before its
    // acknowledgment, which can only be enqueued after it; then remote.
    for (let op = this.localQueue.shift(); op; op = this.localQueue.shift()) this.apply(op);
    for (let op = this.remoteQueue.shift(); op; op = this.remoteQueue.shift()) this.applyRemote(op);
  }

  private enqueueLocal(content: OperationContent<ShapeOp>): void {
    const op = { ...content, clientId: this.clientId, clientSeq: ++this.clientSeq, refSeq: this.lastSeq, seq: -1 } as ShapeOp;
    this.localQueue.push(op);
    this.emit("outgoing", { ...op });
  }

  private applyRemote(op: ShapeOp): void {
    this.lastSeq = op.seq;
    const mine = op.clientId === this.clientId ? this.pending.get(op.clientSeq) : undefined;
    if (mine) {
      // The acknowledgment of an applied local operation: record its seq only.
      mine.seq = op.seq;
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
        // Directly below the lowest shape that the order puts above this one.
        let below: ShapeId | undefined;
        this.writer.forEach((id) => {
          if (below === undefined && compareOrder(op, this.adds.get(id)!) < 0) below = id;
        });
        this.writer.add(op.id, op.shape, below);
        break;
      }
      case "remove":
        this.writer.remove(op.ids);
        break;
      case "clear": {
        const known: ShapeId[] = [];
        this.writer.forEach((id) => { if (knew(op, this.adds.get(id)!)) known.push(id); });
        this.writer.remove(known);
        break;
      }
    }
  }
}
