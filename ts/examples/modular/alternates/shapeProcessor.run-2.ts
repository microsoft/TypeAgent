/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Keeps a local and a remote queue of ShapeOps as plain arrays; process
 * drains all of local, then all of remote, repeating (nothing is enqueued
 * meanwhile, so one pass suffices). A local add goes on top; a remote add
 * goes directly below the lowest still-pending local add, tracked by a
 * pointer kept up to date as adds are applied, acknowledged or removed. Each
 * present shape's add is a node linked into its client's list (ordered by
 * clientSeq, for knew()'s own-client test) and, once acknowledged, into one
 * more list ordered by seq (for knew()'s refSeq test); both lists support
 * O(1) removal of any node, so a clear walks only the prefixes it removes.
 *
 * Choose when: always; the only implementation of this interface.
 * Cost: local.enqueue, remote.enqueue, newShapeId and acknowledging an
 * operation are O(1) apart from copying the operation; applying an add or a
 * remove (per listed id) does O(1) bookkeeping beyond the writer's own
 * call; applying a clear does O(k) bookkeeping for the k shapes it knew,
 * plus the writer's one remove call.
 * AdditionalSemantics: none.
 * Parts: the add-tracking linked lists (AddNode, and the client and global
 * lists built on it) form a self-contained ordered index and could become
 * their own interface.
 * Imports: geometry.ts, shape.ts, dataModel.ts, shapeModel.ts, events.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { ShapeId } from "./shape.ts";
import type { OperationContent, OperationLogEvents, OperationSink } from "./dataModel.ts";
import type { EventEmitter, EventMap } from "./events.ts";
import type {
  AddShape, ClearShapes, ShapeCollection, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp,
} from "./shapeModel.ts";

/**
 * One present shape's add: linked into its client's list by clientSeq, and,
 * once acknowledged (seq !== -1), into the global list by seq.
 */
interface AddNode {
  readonly id: ShapeId;
  readonly clientId: string;
  readonly clientSeq: number;
  seq: number;
  prevC: AddNode | undefined;
  nextC: AddNode | undefined;
  prevG: AddNode | undefined;
  nextG: AddNode | undefined;
}

/** The ends of a doubly linked list of AddNodes. */
interface ListHead {
  head: AddNode | undefined;
  tail: AddNode | undefined;
}

function pushClient(list: ListHead, node: AddNode): void {
  node.prevC = list.tail;
  node.nextC = undefined;
  if (list.tail) list.tail.nextC = node;
  else list.head = node;
  list.tail = node;
}

function unlinkClient(list: ListHead, node: AddNode): void {
  if (node.prevC) node.prevC.nextC = node.nextC;
  else list.head = node.nextC;
  if (node.nextC) node.nextC.prevC = node.prevC;
  else list.tail = node.prevC;
  node.prevC = undefined;
  node.nextC = undefined;
}

function pushGlobal(list: ListHead, node: AddNode): void {
  node.prevG = list.tail;
  node.nextG = undefined;
  if (list.tail) list.tail.nextG = node;
  else list.head = node;
  list.tail = node;
}

function unlinkGlobal(list: ListHead, node: AddNode): void {
  if (node.prevG) node.prevG.nextG = node.nextG;
  else list.head = node.nextG;
  if (node.nextG) node.nextG.prevG = node.prevG;
  else list.tail = node.prevG;
  node.prevG = undefined;
  node.nextG = undefined;
}

type Listener = (...args: unknown[]) => void;

/** A minimal EventEmitter (events.ts) with Node's behavior: ordered, snapshot-called listeners. */
class Log<Events extends EventMap> implements EventEmitter<Events> {
  private readonly lists = new Map<string, Listener[]>();

  on<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    const list = this.lists.get(event) ?? [];
    list.push(listener as Listener);
    this.lists.set(event, list);
    return this;
  }

  off<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    const list = this.lists.get(event);
    if (list) {
      const i = list.lastIndexOf(listener as Listener);
      if (i >= 0) list.splice(i, 1);
    }
    return this;
  }

  emit<E extends keyof Events & string>(event: E, ...args: Events[E]): void {
    for (const listener of [...(this.lists.get(event) ?? [])]) listener(...args);
  }
}

/** A copy of op, with its ids array copied when it has one. */
function copyOp(op: ShapeOp): ShapeOp {
  return op.type === "remove" ? { ...op, ids: [...op.ids] } : { ...op };
}

export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;
  readonly logOperations: EventEmitter<OperationLogEvents<ShapeOp>>;

  private readonly writer: ShapeCollectionWriter;
  private readonly log = new Log<OperationLogEvents<ShapeOp>>();
  private readonly localQueue: ShapeOp[] = [];
  private readonly remoteQueue: ShapeOp[] = [];
  private readonly byId = new Map<ShapeId, AddNode>();
  private readonly clientLists = new Map<string, ListHead>();
  private readonly global: ListHead = { head: undefined, tail: undefined };
  private firstPendingNode: AddNode | undefined = undefined;
  private nextClientSeq = 0;
  private nextIdSeq = 0;
  private lastAppliedSeq = -1;

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.writer = writer;
    this.logOperations = this.log;
    const facet: ShapeCollection = {
      get: (id) => writer.get(id),
      get size() {
        return writer.size;
      },
      forEach: (visit) => writer.forEach(visit),
      compareZ: (a, b) => writer.compareZ(a, b),
      inRect: (r: Rectangle, out: ShapeId[]) => writer.inRect(r, out),
      atPoint: (p: Point, out: ShapeId[]) => writer.atPoint(p, out),
      on(event, listener) {
        writer.on(event, listener);
        return facet;
      },
      off(event, listener) {
        writer.off(event, listener);
        return facet;
      },
    };
    this.model = facet;
    this.local = { enqueue: (content) => this.enqueueLocal(content) };
    this.remote = { enqueue: (op) => this.enqueueRemote(op) };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.nextIdSeq++}` as ShapeId;
  }

  async process(): Promise<void> {
    while (this.localQueue.length > 0 || this.remoteQueue.length > 0) {
      while (this.localQueue.length > 0) this.applyLocal(this.localQueue.shift()!);
      while (this.remoteQueue.length > 0) this.applyRemote(this.remoteQueue.shift()!);
    }
  }

  private enqueueLocal(content: OperationContent<ShapeOp>): ShapeOp {
    const stamped = {
      ...content,
      clientId: this.clientId,
      clientSeq: this.nextClientSeq++,
      refSeq: this.lastAppliedSeq,
      seq: -1,
    } as ShapeOp;
    this.localQueue.push(stamped);
    return copyOp(stamped);
  }

  private enqueueRemote(op: ShapeOp): ShapeOp {
    this.remoteQueue.push(op);
    return copyOp(op);
  }

  private applyLocal(op: ShapeOp): void {
    switch (op.type) {
      case "add":
        this.writer.add(op.id, op.shape, undefined);
        this.trackPendingAdd(op);
        break;
      case "remove":
        this.writer.remove(op.ids);
        for (const id of op.ids) this.forgetAdd(id);
        break;
      case "clear":
        this.applyClear(op);
        break;
    }
    this.log.emit("applied", op);
  }

  private applyRemote(op: ShapeOp): void {
    this.lastAppliedSeq = op.seq;
    if (op.clientId === this.clientId) {
      // The acknowledgment of a local operation: already applied from the
      // local queue, so nothing further happens to the writer.
      if (op.type === "add") this.acknowledgeAdd(op);
      this.log.emit("applied", op);
      return;
    }
    switch (op.type) {
      case "add":
        this.writer.add(op.id, op.shape, this.firstPendingNode?.id);
        this.trackAcknowledgedAdd(op);
        break;
      case "remove":
        this.writer.remove(op.ids);
        for (const id of op.ids) this.forgetAdd(id);
        break;
      case "clear":
        this.applyClear(op);
        break;
    }
    this.log.emit("applied", op);
  }

  /** Registers a's shape as this client's own, still-pending add. */
  private trackPendingAdd(a: AddShape): void {
    const node: AddNode = {
      id: a.id, clientId: a.clientId, clientSeq: a.clientSeq, seq: -1,
      prevC: undefined, nextC: undefined, prevG: undefined, nextG: undefined,
    };
    this.byId.set(a.id, node);
    pushClient(this.clientListOf(a.clientId), node);
    if (this.firstPendingNode === undefined) this.firstPendingNode = node;
  }

  /** Registers a's shape as an already-acknowledged add, from any client. */
  private trackAcknowledgedAdd(a: AddShape): void {
    const node: AddNode = {
      id: a.id, clientId: a.clientId, clientSeq: a.clientSeq, seq: a.seq,
      prevC: undefined, nextC: undefined, prevG: undefined, nextG: undefined,
    };
    this.byId.set(a.id, node);
    pushClient(this.clientListOf(a.clientId), node);
    pushGlobal(this.global, node);
  }

  /** Gives a's node (this client's own, previously pending) its assigned seq, and joins it to the global list. */
  private acknowledgeAdd(a: AddShape): void {
    const node = this.byId.get(a.id);
    if (!node) return; // its shape was removed while still pending
    node.seq = a.seq;
    if (this.firstPendingNode === node) this.firstPendingNode = node.nextC;
    pushGlobal(this.global, node);
  }

  /** Forgets id's add, if any is tracked: it is no longer present. */
  private forgetAdd(id: ShapeId): void {
    const node = this.byId.get(id);
    if (!node) return;
    if (this.firstPendingNode === node) this.firstPendingNode = node.nextC;
    unlinkClient(this.clientListOf(node.clientId), node);
    if (node.seq !== -1) unlinkGlobal(this.global, node);
    this.byId.delete(id);
  }

  private clientListOf(clientId: string): ListHead {
    let list = this.clientLists.get(clientId);
    if (!list) {
      list = { head: undefined, tail: undefined };
      this.clientLists.set(clientId, list);
    }
    return list;
  }

  /**
   * Removes, in one writer call, the present shapes c knew: the global
   * list's prefix with seq at most c.refSeq, and c's own client's list's
   * prefix with clientSeq less than c.clientSeq (the two can't overlap: a
   * shape named by the second scan was already unlinked from the global
   * list, if it was there, by the first).
   */
  private applyClear(c: ClearShapes): void {
    const removed: ShapeId[] = [];
    for (let g = this.global.head; g && g.seq <= c.refSeq;) {
      const next = g.nextG;
      removed.push(g.id);
      this.forgetAdd(g.id);
      g = next;
    }
    const ownList = this.clientLists.get(c.clientId);
    for (let n = ownList?.head; n && n.clientSeq < c.clientSeq;) {
      const next = n.nextC;
      removed.push(n.id);
      this.forgetAdd(n.id);
      n = next;
    }
    this.writer.remove(removed);
  }
}
