/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Holds a private ShapeCollectionWriter and applies queued ShapeOps to
 * it, one process() call at a time. Three small structures track just
 * enough to place and clear shapes without ever walking the present
 * shapes: a per-client set of currently present shape IDs (for a clear's
 * own-client knowledge), an ordered list of acknowledged adds by seq (for
 * a clear's refSeq knowledge, walked only as far as it removes), and an
 * ordered list of this client's own still-pending adds (whose front is the
 * "lowest pending shape" a remote add goes under).
 * Choose when: always, for a ShapeCollectionWriter; it is the only
 * ShapeMessageProcessor this task defines.
 * Cost: local.enqueue, remote.enqueue and newShapeId are O(1) apart from
 * copying the operation. process() applies each add, remove or ack in
 * O(1) of its own bookkeeping plus the writer's own logarithmic cost; a
 * clear additionally walks exactly the shapes it removes.
 * AdditionalSemantics: none.
 * Parts: a generic doubly linked list (for the ordered structures above),
 * a minimal EventEmitter (for logOperations), and a read-only
 * ShapeCollection facet (for model) could each become interfaces of their
 * own.
 * Imports: geometry.ts, shape.ts, dataModel.ts, shapeModel.ts, events.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import type { OperationContent, OperationLogEvents, OperationSink } from "./dataModel.ts";
import type {
  ClearShapes,
  ShapeCollection,
  ShapeCollectionEvents,
  ShapeCollectionWriter,
  ShapeMessageProcessor,
  ShapeOp,
} from "./shapeModel.ts";
import type { EventEmitter, EventMap } from "./events.ts";

/** A node of LinkedList. */
interface LLNode<T> {
  value: T;
  prev: LLNode<T> | null;
  next: LLNode<T> | null;
}

/** A doubly linked list, for O(1) removal by node and O(1) access to the front. */
class LinkedList<T> {
  #head: LLNode<T> | null = null;
  #tail: LLNode<T> | null = null;

  get front(): LLNode<T> | null {
    return this.#head;
  }

  pushBack(value: T): LLNode<T> {
    const node: LLNode<T> = { value, prev: this.#tail, next: null };
    if (this.#tail) this.#tail.next = node;
    else this.#head = node;
    this.#tail = node;
    return node;
  }

  remove(node: LLNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    else this.#head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.#tail = node.prev;
    node.prev = null;
    node.next = null;
  }
}

/** A minimal EventEmitter<Events>, with Node's on/off/emit behavior. */
class SimpleEventEmitter<Events extends EventMap> implements EventEmitter<Events> {
  readonly #listeners = new Map<string, Array<(...args: readonly unknown[]) => void>>();

  on<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    let forEvent = this.#listeners.get(event);
    if (!forEvent) {
      forEvent = [];
      this.#listeners.set(event, forEvent);
    }
    forEvent.push(listener as (...args: readonly unknown[]) => void);
    return this;
  }

  off<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    const forEvent = this.#listeners.get(event);
    if (forEvent) {
      const at = forEvent.lastIndexOf(listener as (...args: readonly unknown[]) => void);
      if (at >= 0) forEvent.splice(at, 1);
    }
    return this;
  }

  emit<E extends keyof Events & string>(event: E, ...args: Events[E]): void {
    const forEvent = this.#listeners.get(event);
    if (!forEvent || forEvent.length === 0) return;
    for (const listener of forEvent.slice()) listener(...args);
  }
}

/** A read-only facet of a ShapeCollectionWriter: only ShapeCollection's members, delegating to it. */
class ShapeCollectionFacet implements ShapeCollection {
  readonly #writer: ShapeCollectionWriter;

  constructor(writer: ShapeCollectionWriter) {
    this.#writer = writer;
  }

  get(id: ShapeId): Shape | undefined {
    return this.#writer.get(id);
  }

  get size(): number {
    return this.#writer.size;
  }

  forEach(visit: (id: ShapeId, shape: Shape) => void): void {
    this.#writer.forEach(visit);
  }

  compareZ(a: ShapeId, b: ShapeId): number {
    return this.#writer.compareZ(a, b);
  }

  inRect(r: Rectangle, out: ShapeId[]): number {
    return this.#writer.inRect(r, out);
  }

  atPoint(p: Point, out: ShapeId[]): number {
    return this.#writer.atPoint(p, out);
  }

  on<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    this.#writer.on(event, listener);
    return this;
  }

  off<E extends keyof ShapeCollectionEvents & string>(event: E, listener: (...args: ShapeCollectionEvents[E]) => void): this {
    this.#writer.off(event, listener);
    return this;
  }
}

/** Bookkeeping kept for one add that is currently present. */
interface PresentAdd {
  readonly clientId: string;
  /** Set while the add is this processor's own and still unacknowledged. */
  pendingNode: LLNode<ShapeId> | null;
  /** Set once the add is acknowledged (seq assigned). */
  ackNode: LLNode<{ id: ShapeId; seq: number }> | null;
}

/**
 * Applies ShapeOps to a ShapeCollectionWriter.
 *
 * How: see the file header.
 */
export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;
  readonly logOperations: EventEmitter<OperationLogEvents<ShapeOp>>;

  readonly #writer: ShapeCollectionWriter;
  readonly #logEmitter = new SimpleEventEmitter<OperationLogEvents<ShapeOp>>();

  #localQueue: ShapeOp[] = [];
  #remoteQueue: ShapeOp[] = [];

  #nextClientSeq = 0;
  #nextShapeNumber = 0;
  #lastAppliedRemoteSeq = -1;

  /** Currently present shapes, by the ID of the client whose add made them. */
  readonly #byClient = new Map<string, Set<ShapeId>>();
  /** Bookkeeping for every currently present shape, by ID. */
  readonly #byId = new Map<ShapeId, PresentAdd>();
  /** This client's own adds that are still unacknowledged, oldest (lowest) first. */
  readonly #pendingLocalAdds = new LinkedList<ShapeId>();
  /** Every acknowledged add that is still present, in seq order. */
  readonly #ackedAdds = new LinkedList<{ id: ShapeId; seq: number }>();

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.#writer = writer;
    this.model = new ShapeCollectionFacet(writer);
    this.logOperations = this.#logEmitter;

    this.local = {
      enqueue: (item: OperationContent<ShapeOp>): ShapeOp => {
        const stamped = {
          ...item,
          clientId: this.clientId,
          clientSeq: this.#nextClientSeq++,
          refSeq: this.#lastAppliedRemoteSeq,
          seq: -1,
        } as ShapeOp;
        this.#localQueue.push(stamped);
        return { ...stamped };
      },
    };

    this.remote = {
      enqueue: (item: ShapeOp): ShapeOp => {
        const copy = { ...item } as ShapeOp;
        this.#remoteQueue.push(copy);
        return { ...copy };
      },
    };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.#nextShapeNumber++}` as ShapeId;
  }

  async process(): Promise<void> {
    // Nothing enqueues while process runs, so one pass of each queue drains it.
    const local = this.#localQueue;
    this.#localQueue = [];
    for (const op of local) {
      this.#applyLocal(op);
      this.#logEmitter.emit("applied", op);
    }

    const remote = this.#remoteQueue;
    this.#remoteQueue = [];
    for (const op of remote) {
      this.#applyRemote(op);
      this.#lastAppliedRemoteSeq = op.seq;
      this.#logEmitter.emit("applied", op);
    }
  }

  #applyLocal(op: ShapeOp): void {
    switch (op.type) {
      case "add":
        this.#writer.add(op.id, op.shape);
        this.#recordNewAdd(op.id, op.clientId, -1);
        break;
      case "remove":
        this.#writer.remove(op.ids);
        this.#forgetRemoved(op.ids);
        break;
      case "clear":
        this.#applyClear(op);
        break;
    }
  }

  #applyRemote(op: ShapeOp): void {
    if (op.clientId === this.clientId) {
      // The acknowledgment of one of this client's own operations: already
      // applied when it was enqueued locally, so it applies nothing now.
      if (op.type === "add") this.#acknowledge(op.id, op.seq);
      return;
    }
    switch (op.type) {
      case "add": {
        const below = this.#pendingLocalAdds.front?.value;
        this.#writer.add(op.id, op.shape, below);
        this.#recordNewAdd(op.id, op.clientId, op.seq);
        break;
      }
      case "remove":
        this.#writer.remove(op.ids);
        this.#forgetRemoved(op.ids);
        break;
      case "clear":
        this.#applyClear(op);
        break;
    }
  }

  #applyClear(op: ClearShapes): void {
    const known = new Set<ShapeId>(this.#byClient.get(op.clientId) ?? []);
    let node = this.#ackedAdds.front;
    while (node && node.value.seq <= op.refSeq) {
      known.add(node.value.id);
      node = node.next;
    }
    const listed = [...known];
    this.#writer.remove(listed);
    this.#forgetRemoved(listed);
  }

  #recordNewAdd(id: ShapeId, clientId: string, seq: number): void {
    let present = this.#byClient.get(clientId);
    if (!present) {
      present = new Set();
      this.#byClient.set(clientId, present);
    }
    present.add(id);
    const entry: PresentAdd = { clientId, pendingNode: null, ackNode: null };
    if (seq === -1) entry.pendingNode = this.#pendingLocalAdds.pushBack(id);
    else entry.ackNode = this.#ackedAdds.pushBack({ id, seq });
    this.#byId.set(id, entry);
  }

  #acknowledge(id: ShapeId, seq: number): void {
    const entry = this.#byId.get(id);
    if (!entry || !entry.pendingNode) return;
    this.#pendingLocalAdds.remove(entry.pendingNode);
    entry.pendingNode = null;
    entry.ackNode = this.#ackedAdds.pushBack({ id, seq });
  }

  #forgetRemoved(ids: readonly ShapeId[]): void {
    for (const id of ids) {
      const entry = this.#byId.get(id);
      if (!entry) continue;
      const present = this.#byClient.get(entry.clientId);
      if (present) {
        present.delete(id);
        if (present.size === 0) this.#byClient.delete(entry.clientId);
      }
      if (entry.pendingNode) this.#pendingLocalAdds.remove(entry.pendingNode);
      if (entry.ackNode) this.#ackedAdds.remove(entry.ackNode);
      this.#byId.delete(id);
    }
  }
}
