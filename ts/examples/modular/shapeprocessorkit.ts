// The reference ShapeMessageProcessor (shapeModel.ts): RefShapeProcessor,
// which stamps local operations as they are enqueued and applies both
// queues to a writer when process is called. helpers.check.ts runs the
// processor contracts against it.

import type { OperationContent } from "./dataModel.ts";
import type { ShapeId } from "./shape.ts";
import type { ShapeCollection, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";
import { compareOrder, knew } from "./shapeModel.vocab.ts";
import { readFacet, RefShapeWriter } from "./shapewriterkit.ts";

type Stamped = ShapeOp;

export class RefShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local = { enqueue: (content: OperationContent<ShapeOp>) => this.enqueueLocal(content) };
  readonly remote = { enqueue: (op: ShapeOp) => this.enqueueRemote(op) };
  private readonly writer: ShapeCollectionWriter;
  private readonly localQueue: Stamped[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private clientSeq = 0;
  private ids = 0;
  private lastSeq = -1;
  // The add behind each present shape, with its seq as known here.
  private readonly adds = new Map<ShapeId, ShapeOp>();
  // Local operations applied and not yet acknowledged, by clientSeq.
  private readonly pending = new Map<number, ShapeOp>();

  constructor(clientId: string, writer: ShapeCollectionWriter = new RefShapeWriter()) {
    this.clientId = clientId;
    this.writer = writer;
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

  private enqueueLocal(content: OperationContent<ShapeOp>): ShapeOp {
    const op = { ...content, clientId: this.clientId, clientSeq: ++this.clientSeq, refSeq: this.lastSeq, seq: -1 } as ShapeOp;
    this.localQueue.push(op);
    return { ...op };
  }

  private enqueueRemote(op: ShapeOp): ShapeOp {
    this.remoteQueue.push(op);
    return { ...op };
  }

  private applyRemote(op: ShapeOp): void {
    this.lastSeq = op.seq;
    const mine = op.clientId === this.clientId ? this.pending.get(op.clientSeq) : undefined;
    if (mine) {
      // The acknowledgment of an applied local operation: record its seq only.
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
