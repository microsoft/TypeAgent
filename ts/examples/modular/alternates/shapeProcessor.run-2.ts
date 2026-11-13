/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Keeps a local and a remote queue of ShapeOps; process drains local
 * then remote, repeating until both are empty. An add from the local queue
 * goes on top; a genuinely remote add goes directly below the oldest
 * pending local add (tracked as the head of a small linked list, never
 * searched for); a remote item carrying this client's own clientId is its
 * acknowledgment and only updates bookkeeping. For each present shape, a
 * record of its add's clientId, clientSeq and seq is kept in two more
 * linked lists ordered by seq (across every client) and by clientSeq
 * (per client), so a clear walks only the shapes it knows and removes them
 * in one writer.remove call, never scanning the shapes it doesn't know.
 * Choose when: it's the only implementation of ShapeMessageProcessor the
 * spec names; use it wherever a ShapeCollectionWriter needs a processor.
 * Cost: newShapeId, local.enqueue and remote.enqueue are constant time
 * apart from copying the operation. process applies each add or remove in
 * the writer's own amortized-logarithmic time, and a clear in time
 * proportional to the shapes it removes, since the seq-ordered and
 * clientSeq-ordered lists are walked only over matching, present entries.
 * AdditionalSemantics: none.
 * Parts: none.
 * Imports: shape.ts, dataModel.ts, shapeModel.ts
 */

import type { Shape, ShapeId } from "./shape.ts";
import type { OperationContent, OperationSink } from "./dataModel.ts";
import type { ShapeCollection, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";

/** A clone of op, with its own copy of any array field, independent of op. */
function cloneOp(op: ShapeOp): ShapeOp {
  if (op.type === "remove") return { ...op, ids: [...op.ids] };
  return { ...op };
}

/** content stamped with base's processor-assigned fields. */
function stamp(base: { clientId: string; clientSeq: number; seq: number; refSeq: number }, content: OperationContent<ShapeOp>): ShapeOp {
  if (content.type === "add") return { ...base, type: "add", id: content.id, shape: content.shape };
  if (content.type === "remove") return { ...base, type: "remove", ids: [...content.ids] };
  return { ...base, type: "clear" };
}

/** Per-client adds, oldest first, in clientSeq order. */
interface ClientList {
  head: AddRecord | null;
  tail: AddRecord | null;
}

/** What is kept about one present shape's add, and its membership in the lists that find it again. */
interface AddRecord {
  readonly id: ShapeId;
  readonly clientId: string;
  readonly clientSeq: number;
  /** -1 until acknowledged. */
  seq: number;
  // The global list of acknowledged, present adds, oldest seq first.
  seqPrev: AddRecord | null;
  seqNext: AddRecord | null;
  inSeq: boolean;
  // This client's list (clientLists.get(clientId)), oldest clientSeq first.
  clientPrev: AddRecord | null;
  clientNext: AddRecord | null;
  // The pending local adds, oldest (lowest) first; only this processor's own, unacknowledged adds.
  pendingPrev: AddRecord | null;
  pendingNext: AddRecord | null;
  inPending: boolean;
}

export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;

  private readonly writer: ShapeCollectionWriter;
  private readonly localQueue: ShapeOp[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private nextClientSeq = 0;
  private nextIdCounter = 0;
  private lastAppliedSeq = -1;

  private readonly addRecords = new Map<ShapeId, AddRecord>();
  private readonly clientLists = new Map<string, ClientList>();
  private seqHead: AddRecord | null = null;
  private seqTail: AddRecord | null = null;
  private pendingHead: AddRecord | null = null;
  private pendingTail: AddRecord | null = null;

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.writer = writer;

    const w = writer;
    this.model = {
      get(id) { return w.get(id); },
      get size() { return w.size; },
      forEach(visit) { w.forEach(visit); },
      compareZ(a, b) { return w.compareZ(a, b); },
      inRect(r, out) { return w.inRect(r, out); },
      atPoint(p, out) { return w.atPoint(p, out); },
      on(event, listener) { w.on(event, listener); return this; },
      off(event, listener) { w.off(event, listener); return this; },
    };

    this.local = {
      enqueue: (content: OperationContent<ShapeOp>): ShapeOp => {
        const stamped = stamp({ clientId: this.clientId, clientSeq: this.nextClientSeq++, seq: -1, refSeq: this.lastAppliedSeq }, content);
        this.localQueue.push(stamped);
        return cloneOp(stamped);
      },
    };
    this.remote = {
      enqueue: (op: ShapeOp): ShapeOp => {
        this.remoteQueue.push(cloneOp(op));
        return cloneOp(op);
      },
    };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.nextIdCounter++}` as ShapeId;
  }

  async process(): Promise<void> {
    while (this.localQueue.length > 0 || this.remoteQueue.length > 0) {
      while (this.localQueue.length > 0) this.apply(this.localQueue.shift()!);
      while (this.remoteQueue.length > 0) {
        const op = this.remoteQueue.shift()!;
        if (op.clientId === this.clientId) this.acknowledge(op);
        else this.apply(op);
      }
    }
  }

  /** Applies a freshly dequeued op: a local one (always its own) or a genuinely remote one (never its own). */
  private apply(op: ShapeOp): void {
    const own = op.clientId === this.clientId;
    if (op.type === "add") {
      const below = own ? undefined : this.pendingHead?.id;
      this.writer.add(op.id, op.shape, below);
      const record: AddRecord = {
        id: op.id, clientId: op.clientId, clientSeq: op.clientSeq, seq: op.seq,
        seqPrev: null, seqNext: null, inSeq: false,
        clientPrev: null, clientNext: null,
        pendingPrev: null, pendingNext: null, inPending: false,
      };
      this.addRecords.set(op.id, record);
      this.appendClient(record);
      if (op.seq === -1) this.appendPending(record); else this.appendSeq(record);
    } else if (op.type === "remove") {
      for (const id of op.ids) {
        const record = this.addRecords.get(id);
        if (record) this.removeAdd(record);
      }
      this.writer.remove(op.ids);
    } else {
      const toRemove: ShapeId[] = [];
      let node = this.seqHead;
      while (node && node.seq <= op.refSeq) {
        const next = node.seqNext;
        toRemove.push(node.id);
        this.removeAdd(node);
        node = next;
      }
      let cnode = this.clientLists.get(op.clientId)?.head ?? null;
      while (cnode && cnode.clientSeq < op.clientSeq) {
        const next = cnode.clientNext;
        toRemove.push(cnode.id);
        this.removeAdd(cnode);
        cnode = next;
      }
      this.writer.remove(toRemove);
    }
    if (op.seq !== -1) this.lastAppliedSeq = op.seq;
  }

  /** Records a local operation's assigned seq; applies nothing. */
  private acknowledge(op: ShapeOp): void {
    if (op.type === "add") {
      const record = this.addRecords.get(op.id);
      if (record) {
        record.seq = op.seq;
        this.unlinkPending(record);
        this.appendSeq(record);
      }
    }
    this.lastAppliedSeq = op.seq;
  }

  private removeAdd(record: AddRecord): void {
    this.unlinkSeq(record);
    this.unlinkPending(record);
    this.unlinkClient(record);
    this.addRecords.delete(record.id);
  }

  private appendSeq(record: AddRecord): void {
    record.seqPrev = this.seqTail;
    record.seqNext = null;
    if (this.seqTail) this.seqTail.seqNext = record; else this.seqHead = record;
    this.seqTail = record;
    record.inSeq = true;
  }

  private unlinkSeq(record: AddRecord): void {
    if (!record.inSeq) return;
    if (record.seqPrev) record.seqPrev.seqNext = record.seqNext; else this.seqHead = record.seqNext;
    if (record.seqNext) record.seqNext.seqPrev = record.seqPrev; else this.seqTail = record.seqPrev;
    record.seqPrev = record.seqNext = null;
    record.inSeq = false;
  }

  private appendPending(record: AddRecord): void {
    record.pendingPrev = this.pendingTail;
    record.pendingNext = null;
    if (this.pendingTail) this.pendingTail.pendingNext = record; else this.pendingHead = record;
    this.pendingTail = record;
    record.inPending = true;
  }

  private unlinkPending(record: AddRecord): void {
    if (!record.inPending) return;
    if (record.pendingPrev) record.pendingPrev.pendingNext = record.pendingNext; else this.pendingHead = record.pendingNext;
    if (record.pendingNext) record.pendingNext.pendingPrev = record.pendingPrev; else this.pendingTail = record.pendingPrev;
    record.pendingPrev = record.pendingNext = null;
    record.inPending = false;
  }

  private appendClient(record: AddRecord): void {
    let list = this.clientLists.get(record.clientId);
    if (!list) {
      list = { head: null, tail: null };
      this.clientLists.set(record.clientId, list);
    }
    record.clientPrev = list.tail;
    record.clientNext = null;
    if (list.tail) list.tail.clientNext = record; else list.head = record;
    list.tail = record;
  }

  private unlinkClient(record: AddRecord): void {
    const list = this.clientLists.get(record.clientId);
    if (!list) return;
    if (record.clientPrev) record.clientPrev.clientNext = record.clientNext; else list.head = record.clientNext;
    if (record.clientNext) record.clientNext.clientPrev = record.clientPrev; else list.tail = record.clientPrev;
    record.clientPrev = record.clientNext = null;
  }
}
