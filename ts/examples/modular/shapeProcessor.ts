/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Stamps and queues local operations, queues sequenced remote ones, and
 * on process applies the local queue and then the remote one through the
 * writer, which is the only thing it changes. It keeps the add of each
 * present shape in two chains, acknowledged adds by seq and this client's
 * pending adds by clientSeq, so that placing a remote add, acknowledging a
 * local one and finding what a clear knew each touch only the records they
 * concern.
 * Choose when: Pick it with any ShapeCollectionWriter: it holds no shapes of
 * its own and asks the writer for nothing beyond its interface, so the
 * writer decides how the shapes are stored and queried.
 * Cost: process does constant work per add, remove (per ID listed) and
 * acknowledgment, plus one writer call each, so it is amortized logarithmic
 * per operation with a writer that meets
 * ShapeCollectionWriter.log-amortized; a clear walks the records it removes,
 * at most twice each, and calls remove once. local.enqueue, remote.enqueue
 * and newShapeId are constant time apart from copying the operation. State
 * is one record per present shape.
 * AdditionalSemantics: process applies everything before the promise it
 * returns settles, and takes the whole local queue before the remote one,
 * repeating until both are empty; a remote operation whose clientId is this
 * processor's is taken as the acknowledgment of the local operation with
 * that clientSeq, and records a seq only for an add whose shape is still
 * present, since nothing else can observe one; a clear with nothing to
 * remove still calls the writer's remove, with an empty list.
 * Parts: the read-only facet of the writer, and the bookkeeping of the adds
 * of present shapes (the chains and maps below), which a processor for
 * another shape-like model could share.
 * Imports: geometry.ts, shape.ts, dataModel.ts, shapeModel.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import type { OperationContent, OperationSink } from "./dataModel.ts";
import type { AddShape, ClearShapes, ShapeCollection, ShapeCollectionEvents, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";

/**
 * What the processor remembers about the add that made a present shape: the
 * fields a clear's knowing and the z-order depend on, and the links of the
 * two chains the record is in.
 */
interface AddRecord {
  readonly id: ShapeId;
  readonly clientId: string;
  readonly clientSeq: number;
  /** -1 until the add is acknowledged, then the seq its acknowledgment gave it. */
  seq: number;
  /** The chain of acknowledged adds, by seq; unused while the add is pending. */
  prev: AddRecord | undefined;
  next: AddRecord | undefined;
  /** The chain of this add's client's present adds, by clientSeq. */
  earlier: AddRecord | undefined;
  later: AddRecord | undefined;
}

/** The ends of one client's chain of present adds. */
interface ClientChain {
  first: AddRecord | undefined;
  last: AddRecord | undefined;
}

/** The operation as the processor queues it: its own copy, down to its arrays. */
function copyOp(op: ShapeOp): ShapeOp {
  if (op.type === "add") return { ...op };
  if (op.type === "remove") return { ...op, ids: [...op.ids] };
  return { ...op };
}

/** The content with the fields a processor stamps on a local operation. */
function stamped(content: OperationContent<ShapeOp>, clientId: string, clientSeq: number, refSeq: number): ShapeOp {
  const marks = { clientId, clientSeq, refSeq, seq: -1 };
  if (content.type === "add") return { type: "add", id: content.id, shape: content.shape, ...marks };
  if (content.type === "remove") return { type: "remove", ids: [...content.ids], ...marks };
  return { type: "clear", ...marks };
}

/**
 * The read-only facet of a writer: ShapeCollection's members, delegating to
 * the writer, with on and off returning the facet so that whoever holds it
 * never reaches the writer.
 */
class WriterFacet implements ShapeCollection {
  private readonly writer: ShapeCollectionWriter;

  constructor(writer: ShapeCollectionWriter) {
    this.writer = writer;
  }

  get size(): number {
    return this.writer.size;
  }

  get(id: ShapeId): Shape | undefined {
    return this.writer.get(id);
  }

  forEach(visit: (id: ShapeId, shape: Shape) => void): void {
    this.writer.forEach(visit);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.writer.compareZ(a, b);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.writer.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.writer.atPoint(p, out);
  }

  on<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    this.writer.on(event, listener);
    return this;
  }

  off<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    this.writer.off(event, listener);
    return this;
  }
}

export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;

  /** The write side, this processor's from now on. */
  private readonly writer: ShapeCollectionWriter;
  private localQueue: ShapeOp[] = [];
  private remoteQueue: ShapeOp[] = [];
  /** The counter newShapeId follows the last # with. */
  private nextShape = 0;
  /** The clientSeq to stamp on the next local operation. */
  private nextClientSeq = 0;
  /** The seq of the last remote operation applied, or -1: a local operation's refSeq. */
  private lastApplied = -1;
  /** The add of each present shape. */
  private readonly present = new Map<ShapeId, AddRecord>();
  /** This client's pending adds whose shapes are present, by clientSeq. */
  private readonly ownPending = new Map<number, AddRecord>();
  /** Each client's present adds, by clientSeq: what a clear of that client's knew. */
  private readonly byClient = new Map<string, ClientChain>();
  /** The acknowledged adds of present shapes, by seq: the bottom of the z-order, in order. */
  private ackedFirst: AddRecord | undefined = undefined;
  private ackedLast: AddRecord | undefined = undefined;
  /** The add of the lowest shape of a pending local add, while there is one. */
  private pendingFirst: AddRecord | undefined = undefined;

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.writer = writer;
    this.model = new WriterFacet(writer);
    this.local = { enqueue: (content) => this.enqueueLocal(content) };
    this.remote = { enqueue: (op) => this.enqueueRemote(op) };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.nextShape++}` as ShapeId;
  }

  async process(): Promise<void> {
    // The local queue first, so that a local operation is applied before the
    // acknowledgment that arrived in the same call, and before any remote
    // operation that was made knowing it.
    while (this.localQueue.length > 0 || this.remoteQueue.length > 0) {
      const local = this.localQueue;
      this.localQueue = [];
      for (const op of local) this.applyLocal(op);
      const remote = this.remoteQueue;
      this.remoteQueue = [];
      for (const op of remote) this.applyRemote(op);
    }
  }

  // ---- The queues ---------------------------------------------------------

  private enqueueLocal(content: OperationContent<ShapeOp>): ShapeOp {
    const op = stamped(content, this.clientId, this.nextClientSeq++, this.lastApplied);
    this.localQueue.push(op);
    return copyOp(op);
  }

  private enqueueRemote(op: ShapeOp): ShapeOp {
    const queued = copyOp(op);
    this.remoteQueue.push(queued);
    return copyOp(queued);
  }

  // ---- Applying -----------------------------------------------------------

  /** A local add goes on top. */
  private applyLocal(op: ShapeOp): void {
    if (op.type === "add") this.applyAdd(op, undefined);
    else if (op.type === "remove") this.applyRemove(op.ids);
    else this.applyClear(op);
  }

  /**
   * A remote add goes directly below the lowest shape of a pending local
   * add, or on top if none is pending. An operation of this client's is its
   * acknowledgment, which applies nothing.
   */
  private applyRemote(op: ShapeOp): void {
    this.lastApplied = op.seq;
    if (op.clientId === this.clientId) this.acknowledge(op);
    else if (op.type === "add") this.applyAdd(op, this.pendingFirst?.id);
    else if (op.type === "remove") this.applyRemove(op.ids);
    else this.applyClear(op);
  }

  private applyAdd(op: AddShape, below: ShapeId | undefined): void {
    const rec: AddRecord = {
      id: op.id, clientId: op.clientId, clientSeq: op.clientSeq, seq: op.seq,
      prev: undefined, next: undefined, earlier: undefined, later: undefined,
    };
    this.present.set(rec.id, rec);
    this.linkClient(rec);
    if (rec.seq === -1) {
      // Pending, so this client's: above every shape already present, and
      // the lowest pending one when it is the first.
      this.ownPending.set(rec.clientSeq, rec);
      if (this.pendingFirst === undefined) this.pendingFirst = rec;
    } else {
      // Acknowledged with a seq greater than every seq already applied, so
      // the top of the acknowledged chain.
      this.pushAcked(rec);
    }
    this.writer.add(rec.id, op.shape, below);
  }

  private applyRemove(listed: readonly ShapeId[]): void {
    for (const id of listed) this.forget(id);
    this.writer.remove(listed);
  }

  /** Removes the present shapes whose adds op knew (knew in dataModel.vocab.ts). */
  private applyClear(op: ClearShapes): void {
    const listed: ShapeId[] = [];
    // The adds acknowledged by op's refSeq: a prefix of the acknowledged
    // chain, which is in seq order.
    for (let r = this.ackedFirst; r !== undefined && r.seq <= op.refSeq; r = r.next) listed.push(r.id);
    // The earlier adds of op's own client, which it knew whether they are
    // acknowledged or not; those its refSeq covers are already listed.
    const chain = this.byClient.get(op.clientId);
    for (let r = chain?.first; r !== undefined && r.clientSeq < op.clientSeq; r = r.later) {
      if (r.seq === -1 || r.seq > op.refSeq) listed.push(r.id);
    }
    for (const id of listed) this.forget(id);
    this.writer.remove(listed);
  }

  /**
   * Records the acknowledged seq of this client's operation in the
   * processor's own state. The operation itself is never changed, and
   * nothing is applied: the add keeps its place, since its seq is greater
   * than every seq applied before it and less than every one after.
   */
  private acknowledge(op: ShapeOp): void {
    const rec = this.ownPending.get(op.clientSeq);
    if (rec === undefined) return;
    this.ownPending.delete(op.clientSeq);
    rec.seq = op.seq;
    if (this.pendingFirst === rec) this.pendingFirst = rec.later;
    this.pushAcked(rec);
  }

  // ---- The adds of present shapes -----------------------------------------

  /** Forgets the add of id, if the shape is present. */
  private forget(id: ShapeId): void {
    const rec = this.present.get(id);
    if (rec === undefined) return;
    this.present.delete(id);
    if (rec.seq === -1) {
      this.ownPending.delete(rec.clientSeq);
      if (this.pendingFirst === rec) this.pendingFirst = rec.later;
    } else {
      this.unlinkAcked(rec);
    }
    this.unlinkClient(rec);
  }

  private pushAcked(rec: AddRecord): void {
    rec.prev = this.ackedLast;
    rec.next = undefined;
    if (this.ackedLast === undefined) this.ackedFirst = rec;
    else this.ackedLast.next = rec;
    this.ackedLast = rec;
  }

  private unlinkAcked(rec: AddRecord): void {
    if (rec.prev === undefined) this.ackedFirst = rec.next;
    else rec.prev.next = rec.next;
    if (rec.next === undefined) this.ackedLast = rec.prev;
    else rec.next.prev = rec.prev;
    rec.prev = undefined;
    rec.next = undefined;
  }

  /** Puts rec in its client's chain, in clientSeq order: at the end, as they arrive. */
  private linkClient(rec: AddRecord): void {
    let chain = this.byClient.get(rec.clientId);
    if (chain === undefined) {
      chain = { first: undefined, last: undefined };
      this.byClient.set(rec.clientId, chain);
    }
    let at = chain.last;
    while (at !== undefined && at.clientSeq > rec.clientSeq) at = at.earlier;
    rec.earlier = at;
    rec.later = at === undefined ? chain.first : at.later;
    if (at === undefined) chain.first = rec;
    else at.later = rec;
    if (rec.later === undefined) chain.last = rec;
    else rec.later.earlier = rec;
  }

  private unlinkClient(rec: AddRecord): void {
    const chain = this.byClient.get(rec.clientId);
    if (chain === undefined) return;
    if (rec.earlier === undefined) chain.first = rec.later;
    else rec.earlier.later = rec.later;
    if (rec.later === undefined) chain.last = rec.earlier;
    else rec.later.earlier = rec.earlier;
    rec.earlier = undefined;
    rec.later = undefined;
    if (chain.first === undefined) this.byClient.delete(rec.clientId);
  }
}
