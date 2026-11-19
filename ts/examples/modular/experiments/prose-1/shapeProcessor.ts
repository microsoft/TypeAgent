/**
 * ShapeProcessor implements ShapeMessageProcessor.
 *
 * How: Keeps a local and a remote queue of ShapeOps (stamping each local one
 * as it is enqueued) and, on process, drains all of local before any of
 * remote, applying each op to the writer it was constructed with. It tracks
 * which of its own adds are still unacknowledged (for the "directly below
 * the lowest pending local add" rule) and, for every present shape, the
 * identity of the add that placed it (for clear's "knew" rule), without
 * scanning the whole collection on the hot paths (add, remove, and a clear
 * that knows nothing).
 * Choose when: whenever a ShapeCollection needs the one MessageProcessor
 * that applies ShapeOps to it; there is no alternative to choose between.
 * Cost: add and remove are the cost of the writer's own add/remove plus
 * O(1) amortized bookkeeping. clear is O(1) when its refSeq is -1 and its
 * client has no recorded add, and otherwise scans the present shapes (for
 * refSeq matches) and that client's recorded adds (for clientSeq matches),
 * then removes what it found.
 * AdditionalSemantics: none.
 * Parts: the read-only ShapeCollection facet built for `model`; the
 * generic event emitter used for `logOperations`.
 * Imports: shape.ts, shapeModel.ts, dataModel.ts, events.ts
 */

import type { ShapeId } from "./shape.ts";
import type {
  ClearShapes,
  RemoveShapes,
  ShapeCollection,
  ShapeCollectionWriter,
  ShapeMessageProcessor,
  ShapeOp,
} from "./shapeModel.ts";
import type { OperationContent, OperationLogEvents, OperationSink } from "./dataModel.ts";
import type { EventEmitter, EventMap } from "./events.ts";

/** A minimal EventEmitter, following EventEmitter's order and snapshot rules. */
class SimpleEmitter<Events extends EventMap> implements EventEmitter<Events> {
  readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    const list = this.#listeners.get(event);
    const asUnknown = listener as unknown as (...args: unknown[]) => void;
    if (list) list.push(asUnknown);
    else this.#listeners.set(event, [asUnknown]);
    return this;
  }

  off<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this {
    const list = this.#listeners.get(event);
    if (!list) return this;
    const at = list.lastIndexOf(listener as unknown as (...args: unknown[]) => void);
    if (at >= 0) list.splice(at, 1);
    return this;
  }

  emit<E extends keyof Events & string>(event: E, ...args: Events[E]): void {
    const list = this.#listeners.get(event);
    if (!list) return;
    for (const listener of list.slice()) listener(...args);
  }
}

/** The read-only facet of writer: only ShapeCollection's members, on and off returning the facet. */
function makeModel(writer: ShapeCollectionWriter): ShapeCollection {
  let model!: ShapeCollection;
  model = {
    get(id) {
      return writer.get(id);
    },
    get size() {
      return writer.size;
    },
    forEach(visit) {
      writer.forEach(visit);
    },
    compareZ(a, b) {
      return writer.compareZ(a, b);
    },
    inRect(r, out) {
      return writer.inRect(r, out);
    },
    atPoint(p, out) {
      return writer.atPoint(p, out);
    },
    on(event, listener) {
      writer.on(event, listener);
      return model;
    },
    off(event, listener) {
      writer.off(event, listener);
      return model;
    },
  };
  return model;
}

/** Where a present shape's add came from: who made it, and its seq once acknowledged. */
interface AddOrigin {
  clientId: string;
  clientSeq: number;
  seq: number;
}

export class ShapeProcessor implements ShapeMessageProcessor {
  readonly clientId: string;
  readonly model: ShapeCollection;
  readonly local: OperationSink<OperationContent<ShapeOp>, ShapeOp>;
  readonly remote: OperationSink<ShapeOp>;
  readonly logOperations: EventEmitter<OperationLogEvents<ShapeOp>>;

  readonly #writer: ShapeCollectionWriter;
  readonly #log = new SimpleEmitter<OperationLogEvents<ShapeOp>>();
  #localQueue: ShapeOp[] = [];
  #remoteQueue: ShapeOp[] = [];
  #nextClientSeq = 0;
  #nextShapeSeq = 0;
  #lastAppliedRemoteSeq = -1;

  /** This client's own adds not yet acknowledged, bottom to top. */
  #pendingOwnAdds: ShapeId[] = [];
  /** Every present shape's add, by id. */
  readonly #addOrigins = new Map<ShapeId, AddOrigin>();
  /** Every client's present adds, by clientId, in clientSeq order (some may since have been removed). */
  readonly #byClient = new Map<string, { id: ShapeId; clientSeq: number }[]>();

  constructor(clientId: string, writer: ShapeCollectionWriter) {
    this.clientId = clientId;
    this.#writer = writer;
    this.model = makeModel(writer);
    this.logOperations = this.#log;
    this.local = { enqueue: (item) => this.#enqueueLocal(item) };
    this.remote = { enqueue: (item) => this.#enqueueRemote(item) };
  }

  newShapeId(): ShapeId {
    return `${this.clientId}#${this.#nextShapeSeq++}` as ShapeId;
  }

  async process(): Promise<void> {
    const localBatch = this.#localQueue;
    this.#localQueue = [];
    for (const op of localBatch) {
      this.#applyOwn(op);
      this.#log.emit("applied", op);
    }

    const remoteBatch = this.#remoteQueue;
    this.#remoteQueue = [];
    for (const op of remoteBatch) {
      if (op.clientId === this.clientId) this.#applyAck(op);
      else this.#applyOther(op);
      this.#lastAppliedRemoteSeq = op.seq;
      this.#log.emit("applied", op);
    }
  }

  #enqueueLocal(item: OperationContent<ShapeOp>): ShapeOp {
    const op = {
      ...item,
      clientId: this.clientId,
      clientSeq: this.#nextClientSeq++,
      refSeq: this.#lastAppliedRemoteSeq,
      seq: -1,
    } as ShapeOp;
    this.#localQueue.push(op);
    return op;
  }

  #enqueueRemote(item: ShapeOp): ShapeOp {
    this.#remoteQueue.push(item);
    return item;
  }

  /** Applies a local op, dequeued for the first time: always a fresh application. */
  #applyOwn(op: ShapeOp): void {
    if (op.type === "add") {
      this.#writer.add(op.id, op.shape);
      this.#recordAdd(op.id, op.clientId, op.clientSeq, op.seq);
      this.#pendingOwnAdds.push(op.id);
    } else if (op.type === "remove") {
      this.#applyRemove(op);
    } else {
      this.#applyClear(op);
    }
  }

  /** Applies a remote op from another client: always a fresh application. */
  #applyOther(op: ShapeOp): void {
    if (op.type === "add") {
      this.#writer.add(op.id, op.shape, this.#pendingOwnAdds[0]);
      this.#recordAdd(op.id, op.clientId, op.clientSeq, op.seq);
    } else if (op.type === "remove") {
      this.#applyRemove(op);
    } else {
      this.#applyClear(op);
    }
  }

  /** A remote op that is this client's own acknowledgment: no model effect, already applied as it was enqueued locally. */
  #applyAck(op: ShapeOp): void {
    if (op.type === "add") {
      const origin = this.#addOrigins.get(op.id);
      if (origin) origin.seq = op.seq;
      const at = this.#pendingOwnAdds.indexOf(op.id);
      if (at >= 0) this.#pendingOwnAdds.splice(at, 1);
    }
  }

  #applyRemove(op: RemoveShapes): void {
    this.#writer.remove(op.ids);
    this.#forget(op.ids);
  }

  #applyClear(op: ClearShapes): void {
    const matched = new Set<ShapeId>();

    if (op.refSeq !== -1) {
      for (const [id, origin] of this.#addOrigins) {
        if (origin.seq !== -1 && origin.seq <= op.refSeq) matched.add(id);
      }
    }

    const own = this.#byClient.get(op.clientId);
    if (own) {
      for (const entry of own) {
        if (entry.clientSeq >= op.clientSeq) break;
        if (this.#addOrigins.has(entry.id)) matched.add(entry.id);
      }
    }

    if (matched.size > 0) {
      const listed = [...matched];
      this.#writer.remove(listed);
      this.#forget(listed);
    }
  }

  #recordAdd(id: ShapeId, clientId: string, clientSeq: number, seq: number): void {
    this.#addOrigins.set(id, { clientId, clientSeq, seq });
    const list = this.#byClient.get(clientId);
    if (list) list.push({ id, clientSeq });
    else this.#byClient.set(clientId, [{ id, clientSeq }]);
  }

  #forget(ids: readonly ShapeId[]): void {
    for (const id of ids) this.#addOrigins.delete(id);
    if (this.#pendingOwnAdds.length > 0) {
      const removing = new Set(ids);
      this.#pendingOwnAdds = this.#pendingOwnAdds.filter((id) => !removing.has(id));
    }
  }
}
