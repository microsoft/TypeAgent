/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Keeps three small sorted structures besides the writer: the present
 * acknowledged shapes by seq (the acknowledged, bottom part of the
 * z-order), each remote client's present shapes by clientSeq, and this
 * client's own present pending (unacknowledged) adds, in the order they
 * were applied. A remote add's place and a clear's knowledge are found
 * from these by binary search, never by scanning every present shape.
 * Choose when: always; it is the only implementation of
 * ShapeMessageProcessor.
 * Cost: newShapeId, local.enqueue and remote.enqueue are constant time,
 * apart from copying the operation's fields. process is amortized
 * logarithmic per operation (binary searches over the structures above),
 * plus time proportional to the shapes a clear removes (each found and
 * removed in logarithmic time).
 * AdditionalSemantics: none.
 * Parts: a seq-ordered index of present acknowledged shapes, and a
 * clientSeq-ordered index per remote client, used to tell what a clear
 * knew without scanning every present shape; each could stand alone as
 * an interface.
 * Imports: shape.ts, dataModel.ts, shapeModel.ts, events.ts
 */

import type { ShapeId } from "./shape.ts";
import type { OperationContent, OperationLogEvents, OperationSink } from "./dataModel.ts";
import type { AddShape, ClearShapes, RemoveShapes, ShapeCollection, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";
import type { EventEmitter, EventMap } from "./events.ts";

/** Node's EventEmitter semantics (events.ts), reimplemented here since this task can't import eventkit.ts. */
class Emitter<M extends EventMap> implements EventEmitter<M> {
  private readonly listeners = new Map<string, unknown[]>();

  on<E extends keyof M & string>(event: E, listener: (...args: M[E]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  off<E extends keyof M & string>(event: E, listener: (...args: M[E]) => void): this {
    const list = this.listeners.get(event) ?? [];
    const i = list.lastIndexOf(listener);
    if (i >= 0) this.listeners.set(event, list.filter((_, j) => j !== i));
    return this;
  }

  emit<E extends keyof M & string>(event: E, ...args: M[E]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: M[E]) => void)(...args);
  }
}

/** The first index whose key is at least value, in an array sorted ascending by key. */
function lowerBound<T>(arr: readonly T[], key: (t: T) => number, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(arr[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Removes the one entry at this exact seq, if present, from an array sorted ascending by seq. */
function removeBySeq(arr: { seq: number }[], seq: number): void {
  const i = lowerBound(arr, (e) => e.seq, seq);
  if (i < arr.length && arr[i].seq === seq) arr.splice(i, 1);
}

/** Removes the one entry at this exact clientSeq, if present, from an array sorted ascending by clientSeq. */
function removeByClientSeq(arr: { clientSeq: number }[], clientSeq: number): void {
  const i = lowerBound(arr, (e) => e.clientSeq, clientSeq);
  if (i < arr.length && arr[i].clientSeq === clientSeq) arr.splice(i, 1);
}

/** What this processor records of an applied add, to place remote adds and decide what a clear knew. */
interface AddRecord {
  clientId: string;
  clientSeq: number;
  /** -1 while the add is this client's own and still pending. */
  seq: number;
}

export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;
  readonly logOperations: EventEmitter<OperationLogEvents<ShapeOp>>;

  private readonly logEmitter = new Emitter<OperationLogEvents<ShapeOp>>();
  private readonly writer: ShapeCollectionWriter;
  private readonly localQueue: ShapeOp[] = [];
  private readonly remoteQueue: ShapeOp[] = [];

  /** Every present shape's add, by id. */
  private readonly addInfo = new Map<ShapeId, AddRecord>();
  /** Present acknowledged shapes, sorted ascending by seq: the acknowledged part of the z-order. */
  private readonly globalAcked: { seq: number; id: ShapeId }[] = [];
  /** Each remote client's present shapes, sorted ascending by clientSeq. */
  private readonly remoteClientAdds = new Map<string, { clientSeq: number; seq: number; id: ShapeId }[]>();
  /** This client's own present, unacknowledged adds, in the order applied (so the first is the lowest). */
  private readonly pendingLocalAdds: ShapeId[] = [];

  private lastRemoteSeq = -1;
  private nextClientSeq = 0;
  private nextShapeNum = 0;

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.writer = writer;
    this.logOperations = this.logEmitter;
    this.local = {
      enqueue: (content) => {
        const op = this.stamp(content);
        this.localQueue.push(op);
        return op;
      },
    };
    this.remote = {
      enqueue: (op) => {
        this.remoteQueue.push(op);
        return op;
      },
    };
    this.model = {
      get: (id) => writer.get(id),
      get size() {
        return writer.size;
      },
      forEach: (visit) => writer.forEach(visit),
      compareZ: (a, b) => writer.compareZ(a, b),
      inRect: (r, out) => writer.inRect(r, out),
      atPoint: (p, out) => writer.atPoint(p, out),
      on(event, listener) {
        writer.on(event, listener);
        return this;
      },
      off(event, listener) {
        writer.off(event, listener);
        return this;
      },
    };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.nextShapeNum++}` as ShapeId;
  }

  async process(): Promise<void> {
    while (this.localQueue.length > 0 || this.remoteQueue.length > 0) {
      while (this.localQueue.length > 0) {
        const op = this.localQueue.shift();
        if (op) this.applyOne(op, true);
      }
      while (this.remoteQueue.length > 0) {
        const op = this.remoteQueue.shift();
        if (op) this.applyOne(op, false);
      }
    }
  }

  private stamp(content: OperationContent<ShapeOp>): ShapeOp {
    return {
      ...content,
      clientId: this.clientId,
      clientSeq: this.nextClientSeq++,
      refSeq: this.lastRemoteSeq,
      seq: -1,
    } as ShapeOp;
  }

  private applyOne(op: ShapeOp, isLocal: boolean): void {
    if (isLocal) {
      this.apply(op, true);
    } else {
      this.lastRemoteSeq = op.seq;
      if (op.clientId === this.clientId) this.applyAck(op);
      else this.apply(op, false);
    }
    this.logEmitter.emit("applied", op);
  }

  /** Applies a local operation, or a genuine remote one (never one of this client's own acknowledgments). */
  private apply(op: ShapeOp, isLocal: boolean): void {
    switch (op.type) {
      case "add":
        this.applyAdd(op, isLocal);
        break;
      case "remove":
        this.applyRemove(op);
        break;
      case "clear":
        this.applyClear(op, isLocal);
        break;
    }
  }

  /** The acknowledgment of one of this client's own operations: records its seq, applies nothing else. */
  private applyAck(op: ShapeOp): void {
    if (op.type !== "add") return;
    const info = this.addInfo.get(op.id);
    if (!info) return;
    info.seq = op.seq;
    const i = this.pendingLocalAdds.indexOf(op.id);
    if (i >= 0) this.pendingLocalAdds.splice(i, 1);
    this.globalAcked.push({ seq: op.seq, id: op.id });
  }

  private applyAdd(op: AddShape, isLocal: boolean): void {
    if (isLocal) {
      this.writer.add(op.id, op.shape);
      this.addInfo.set(op.id, { clientId: this.clientId, clientSeq: op.clientSeq, seq: -1 });
      this.pendingLocalAdds.push(op.id);
      return;
    }
    const below = this.pendingLocalAdds.length > 0 ? this.pendingLocalAdds[0] : undefined;
    this.writer.add(op.id, op.shape, below);
    this.addInfo.set(op.id, { clientId: op.clientId, clientSeq: op.clientSeq, seq: op.seq });
    this.globalAcked.push({ seq: op.seq, id: op.id });
    const forClient = this.remoteClientAdds.get(op.clientId) ?? [];
    forClient.push({ clientSeq: op.clientSeq, seq: op.seq, id: op.id });
    this.remoteClientAdds.set(op.clientId, forClient);
  }

  private applyRemove(op: RemoveShapes): void {
    this.writer.remove(op.ids);
    for (const id of op.ids) this.forgetShape(id);
  }

  private applyClear(op: ClearShapes, isLocal: boolean): void {
    const ids = isLocal ? this.knownForLocalClear(op) : this.knownForRemoteClear(op);
    if (ids.length > 0) this.writer.remove(ids);
  }

  /**
   * What a local clear knew: the present acknowledged shapes with seq at
   * most its refSeq, and all of this client's own currently pending adds
   * (each has a clientSeq less than the clear's, since it was applied
   * from the same local queue, in order, before the clear).
   */
  private knownForLocalClear(op: ClearShapes): readonly ShapeId[] {
    const cut = lowerBound(this.globalAcked, (e) => e.seq, op.refSeq + 1);
    const removedGlobal = this.globalAcked.splice(0, cut);
    const removedPending = this.pendingLocalAdds.splice(0, this.pendingLocalAdds.length);
    for (const e of removedGlobal) this.addInfo.delete(e.id);
    for (const id of removedPending) this.addInfo.delete(id);
    return [...removedGlobal.map((e) => e.id), ...removedPending];
  }

  /**
   * What a remote clear knew: the present acknowledged shapes with seq at
   * most its refSeq, from any client, plus its own author's present
   * shapes with a clientSeq less than its own (which, since a client's
   * own seq grows with its clientSeq, extends the author's part of the
   * first set only when the author formed the clear before an earlier
   * add of its own was acknowledged).
   */
  private knownForRemoteClear(op: ClearShapes): readonly ShapeId[] {
    const authored = this.remoteClientAdds.get(op.clientId) ?? [];
    const bySeq = lowerBound(authored, (e) => e.seq, op.refSeq + 1);
    const byClientSeq = lowerBound(authored, (e) => e.clientSeq, op.clientSeq);
    const cut = Math.max(bySeq, byClientSeq);
    const removedAuthored = authored.splice(0, cut);
    const globalCut = lowerBound(this.globalAcked, (e) => e.seq, op.refSeq + 1);
    const removedGlobal = this.globalAcked.splice(0, globalCut);
    // The author's shapes beyond bySeq aren't in removedGlobal (their seq is past refSeq); remove them too.
    for (const e of removedAuthored.slice(bySeq)) removeBySeq(this.globalAcked, e.seq);
    const ids = new Set<ShapeId>([...removedGlobal.map((e) => e.id), ...removedAuthored.map((e) => e.id)]);
    for (const id of ids) this.addInfo.delete(id);
    return [...ids];
  }

  /** Drops id's bookkeeping, wherever it is kept, when a remove takes it (or a clear, through the two methods above). */
  private forgetShape(id: ShapeId): void {
    const info = this.addInfo.get(id);
    if (!info) return;
    this.addInfo.delete(id);
    if (info.seq === -1) {
      const i = this.pendingLocalAdds.indexOf(id);
      if (i >= 0) this.pendingLocalAdds.splice(i, 1);
      return;
    }
    removeBySeq(this.globalAcked, info.seq);
    if (info.clientId !== this.clientId) {
      const forClient = this.remoteClientAdds.get(info.clientId);
      if (forClient) removeByClientSeq(forClient, info.clientSeq);
    }
  }
}
