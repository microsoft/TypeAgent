/**
 * Data models changed only by operations. A model has a read side, which
 * anyone may hold, and a write side, which only its MessageProcessor holds.
 * Operations come from two queues: local, from this client's controllers,
 * and remote, from the collaboration protocol (peer to peer or through a
 * server). The processor applies them, interleaving the two queues, and
 * the model emits change events.
 *
 * The message infrastructure owns the processor: it enqueues on both
 * queues and decides when to call process. A controller holds only the
 * model's read side and a LocalSend. The infrastructure itself is not
 * specified yet; LocalSend is the part of it that controllers see.
 *
 * Each distributed data structure (DDS) defines its operations as a
 * discriminated union on type, and its own rules for how interleaving and
 * sequence numbers decide the result. There is no order common to every
 * DDS: a shape collection puts pending local adds on top, for example,
 * while a sequence puts a local insert after remote inserts at the same
 * position.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { EventEmitter, EventMap } from "./events.ts";

/** A model's change events. Each model names its own. */
export interface ModelChangeEvents extends EventMap {}

/** The read side of a data model. */
export interface DataModelReader<E extends ModelChangeEvents = ModelChangeEvents> extends EventEmitter<E> {
    // Observers in derived interfaces.
}

/**
 * The write side of a data model: modification methods in derived
 * interfaces. Only the model's MessageProcessor holds it.
 */
export interface DataModel {
    // Modification methods in derived interfaces.
}

/**
 * One change to a data model. Each distributed data structure (DDS) has
 * operations that form a discriminated union on type.
 *
 * clientId and clientSeq identify the operation: the client that made it,
 * and its place among that client's operations. seq is its place in the
 * order the collaboration protocol assigns. A local operation has seq -1
 * (pending) until it is acknowledged, when it appears in the remote queue
 * with the same clientId and clientSeq and its assigned seq.
 *
 * refSeq is what the client knew when it made the operation: the seq of
 * the last remote operation it had applied, or -1 if none. The client also
 * knew its own earlier operations. A DDS may use this, for example so that
 * an operation affects only what its client knew about.
 *
 * @valid seq-range  seq is -1 or a non-negative integer.
 *   seq === -1 || (Number.isInteger(seq) && seq >= 0)
 * @valid client-seq-range  clientSeq is a non-negative integer.
 *   Number.isInteger(clientSeq) && clientSeq >= 0
 * @valid ref-seq-range  refSeq is -1 or a non-negative integer, and less than seq when seq is assigned.
 *   (refSeq === -1 || (Number.isInteger(refSeq) && refSeq >= 0)) && (seq === -1 || refSeq < seq)
 */
export interface Operation {
    readonly type: string;
    readonly clientId: string;
    readonly clientSeq: number;
    readonly refSeq: number;
    seq: number;
}

/**
 * What a controller forms: an operation without the fields the processor
 * stamps on it. Distributes over a union, so the result is still
 * discriminated on type.
 */
export type OperationContent<T extends Operation> =
    T extends Operation ? Omit<T, Exclude<keyof Operation, "type">> : never;

/**
 * How a controller changes a model: it sends each local operation it forms
 * to the message infrastructure. The infrastructure enqueues it on the
 * processor's local queue before returning, sends the stamped operation
 * that enqueue returns to collaborators, and later calls process.
 */
export type LocalSend<TOp extends Operation> = (content: OperationContent<TOp>) => void;

/** Where producers put operations. */
export interface OperationSink<T> {
    enqueue(item: T): void;
}

/**
 * A queue of operations, read by the processor. For the message
 * infrastructure, which is not specified yet.
 */
export interface OperationQueue<T> extends OperationSink<T> {
    /** The oldest item, removed; undefined when the queue is empty. */
    dequeue(): T | undefined;
}

/**
 * A processor's local queue. enqueue stamps the operation and returns it,
 * so that the infrastructure can send it to collaborators; that is the
 * only way a local operation leaves the processor.
 */
export interface LocalQueue<TOp extends Operation> {
    /**
     * Stamps content (MessageProcessor.stamps), queues it, and returns the
     * stamped operation.
     *
     * @ensures own-copy  The returned operation is the caller's own: nothing the processor does later, such as acknowledging it, changes it.
     */
    enqueue(content: OperationContent<TOp>): TOp;
}

/**
 * Applies operations to a data model: the only thing that changes it.
 * The message infrastructure enqueues to local what controllers send
 * through a LocalSend, and to remote what the collaboration protocol
 * delivers, including the acknowledgments of local operations. The
 * processor holds the model's write side privately and exposes only the
 * read side.
 *
 * Rules marked @abstract are observable only through the semantics of a
 * distributed data structure (DDS); each DDS's processor refines them.
 *
 * A local operation's contents are relative to the model as its controller
 * read it, so the processor stamps it when it is enqueued, and sending it to
 * collaborators keeps those stamps. Since process is asynchronous, forming
 * an operation and enqueuing it in one synchronous turn means nothing is
 * applied in between.
 *
 * @requires formed-now  A controller sends each local operation in the same synchronous turn in which it read the model to form it.
 * @requires infrastructure-only  Only the message infrastructure enqueues and calls process; controllers send through a LocalSend.
 * @requires remote-seq  Each remote operation has an assigned seq, greater than any earlier remote operation's.
 * @requires unique-identity  No two operations share a clientId and clientSeq, except a local operation and its acknowledgment.
 * @ensures stamps  enqueue on local returns the operation stamped with this processor's clientId, a clientSeq greater than any earlier local operation's, seq -1, and as refSeq the seq of the last remote operation process had applied when enqueue was called, or -1 if none.
 * @deferred snapshot  A processor can start from a snapshot: a model with the seq of the last operation it includes. Its first refSeq is that seq, and the IDs in the snapshot count as already made, for a DDS's ID rules.
 *   when: the collaboration protocol, or saving and loading a model, is specified.
 *   how: the processor contract gains a factory that takes a snapshot; it checks that a processor loaded from a snapshot taken after some operations then reaches the same model as one that applied those operations, given the same later remote operations, and that stamps' refSeq starts at the snapshot's seq; with adversaries that start refSeq at -1 and that reuse a snapshot ID.
 * @ensures sole-writer  The model changes only during process: reading it, and enqueuing, change nothing and emit none of its events.
 * @ensures passive  Never calls process itself: until the infrastructure calls it, queued operations stay unapplied.
 * @ensures enqueue-defers  enqueue on either queue doesn't change the model or emit any of the model's events before it returns.
 * @abstract local-order  Local operations are applied in the order they were enqueued.
 * @abstract remote-order  Remote operations are applied in the order they were enqueued.
 * @abstract once  Each operation is applied once: the acknowledgment of a local operation that was already applied, recognized by its clientId and clientSeq, replaces the pending seq with the assigned one and isn't applied again.
 * @abstract atomic  A change listener never sees part of an operation's effect: each change event is emitted after the operation it reports is fully applied.
 * @ensures converges  Processors whose remote queues deliver the same operations in the same order reach equal models once each one's local operations are acknowledged and process has settled, whatever the interleaving of their local and remote queues.
 */
export interface MessageProcessor<TR extends DataModelReader, TOp extends Operation> {
    /** The client whose local operations this processor applies. */
    readonly clientId: string;

    /** The model's read side. */
    readonly model: TR;

    /** Where the infrastructure puts the operations controllers send. */
    readonly local: LocalQueue<TOp>;

    /** Where the collaboration protocol puts sequenced operations. */
    readonly remote: OperationSink<TOp>;

    /**
     * Applies the queued operations, interleaving local and remote, and
     * emits the model's change events. Only the message infrastructure
     * calls it; it settles once the queues are empty.
     */
    process(): Promise<void>;
}
