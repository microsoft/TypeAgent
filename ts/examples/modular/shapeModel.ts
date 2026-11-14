/**
 * Shapes as a data model (dataModel.ts). ShapeCollection is the read side,
 * ShapeCollectionWriter the write side, ShapeOp the operations, and
 * ShapeMessageProcessor applies them with the writer's methods.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Shape, ShapeId, ShapeLocatorQueries } from "./shape.ts";
import type { DataModel, DataModelReader, MessageProcessor, Operation } from "./dataModel.ts";

export type ShapeCollectionEvents = { change: [] };

/**
 * Shapes in z-order, found by location. The read side: views and
 * controllers hold this. The queries (ShapeLocatorQueries in shape.ts) are
 * about the present shapes: indexed(this) is the shapes forEach visits,
 * under the same IDs.
 *
 * @invariant size  size counts the shapes forEach visits.
 *   this.size === ids(this).length
 * @invariant z-order  forEach visits each shape once, from bottom to top.
 *   isStrictlySorted(ids(this), (a, b) => this.compareZ(a, b))
 * @invariant get-agrees  get returns exactly the shapes forEach visits, under the same IDs.
 *   (id: ShapeId) => entries(this).every(([i, s]) => this.get(i) === s) &&
 *     implies(this.get(id) !== undefined, ids(this).includes(id))
 * @ensures read-only  Calling ShapeCollection's members (get, size, forEach, compareZ, inRect, atPoint, on and off) changes no shape and emits nothing.
 *   deepEqual(entries(this), old(entries(this))) && emitted(this).length === 0
 */
export interface ShapeCollection<S extends Shape = Shape> extends DataModelReader<ShapeCollectionEvents>, ShapeLocatorQueries {
  /** The shape with this ID, or undefined if no such shape exists. */
  get(id: ShapeId): S | undefined;

  /** The number of shapes. */
  readonly size: number;

  /**
   * Calls visit for each shape, bottom to top.
   *
   * @requires no-change  visit calls only ShapeCollection's members, so it changes nothing.
   *   nested(this).every((c) => collectionMembers.includes(c.member))
   */
  forEach(visit: (id: ShapeId, shape: S) => void): void;

  /**
   * Negative if a is below b, positive if above.
   *
   * @requires present  Both shapes are in the collection.
   *   ids(this).includes(a) && ids(this).includes(b)
   * @ensures zero-iff-same  Returns 0 only when comparing a shape with itself.
   *   (result === 0) === (a === b)
   * @ensures antisymmetric  Swapping the arguments flips the sign.
   *   Math.sign(result) === -Math.sign(this.compareZ(b, a))
   */
  compareZ(a: ShapeId, b: ShapeId): number;
}

/**
 * The write side. Only a ShapeMessageProcessor holds it.
 *
 * @ensures notifies  A call that changes the shapes emits change once, when the shapes are already final; a call that changes nothing emits nothing. (A listener's queries then agree with the shapes by the queries' own rules.)
 *   deepEqual(entries(this), old(entries(this))) ? emitted(this).length === 0
 *     : deepEqual(emitted(this), ["change"]) && deepEqual(atEvent(0, entries(this)), entries(this))
 * @budget log-amortized  add, remove (per ID listed) and compareZ take time logarithmic in the number of shapes, on each of the writer's workloads, growing at most 16 times from 1,000 shapes to 100,000.
 *   within("logarithmic", 16, writerWorkloads)
 */
export interface ShapeCollectionWriter<S extends Shape = Shape> extends ShapeCollection<S>, DataModel {
  /**
   * Adds shape under id: directly below the shape below, or on top when
   * below is undefined.
   *
   * @requires new-id  id isn't present.
   *   !ids(this).includes(id)
   * @requires below-present  below, when given, is present.
   *   below === undefined || ids(this).includes(below)
   * @requires in-range  The shape's bounding box lies within ±1e300, right and bottom edges included.
   *   inRange(shape.boundingBox(), 1e300)
   * @ensures placed  The shape is retrievable under id, directly below below or on top; the other shapes stay, in the same order.
   *   deepEqual(entries(this), below === undefined ? [...old(entries(this)), [id, shape]] :
   *     old(entries(this)).flatMap((e) => (e[0] === below ? [[id, shape], e] : [e])))
   */
  add(id: ShapeId, shape: S, below?: ShapeId): void;

  /**
   * Removes every listed shape that is present; repeats and absent IDs are
   * ignored. Returns the number removed.
   *
   * @ensures removed  None of the listed shapes is present; the others stay, in the same order; returns how many were removed.
   *   deepEqual(entries(this), old(entries(this)).filter(([i]) => !listed.includes(i))) &&
   *     result === old(this.size) - this.size
   */
  remove(listed: readonly ShapeId[]): number;
}

/** Adds shape under id. */
export interface AddShape extends Operation {
  readonly type: "add";
  readonly id: ShapeId;
  readonly shape: Shape;
}

/** Removes the listed shapes that are present. */
export interface RemoveShapes extends Operation {
  readonly type: "remove";
  readonly ids: readonly ShapeId[];
}

/** Removes the shapes its client knew about (refSeq in dataModel.ts). */
export interface ClearShapes extends Operation {
  readonly type: "clear";
}

export type ShapeOp = AddShape | RemoveShapes | ClearShapes;

/**
 * Applies ShapeOps to a ShapeCollection through its writer.
 *
 * Z-order. Shapes added by acknowledged adds are ordered by the adds' seq,
 * and lie below the shapes of pending local adds, which are ordered by
 * clientSeq. A client's pending adds get later seqs than anything it has
 * applied, so every client ends with the same z-order, and an
 * acknowledgment moves nothing. Given remote-seq and the stamps, this
 * comes to: a local add goes on top, and a remote add goes directly below
 * the lowest shape of a pending local add, or on top if there is none. So
 * the shapes of acknowledged adds are always a contiguous bottom part of
 * the z-order, in seq order, with the pending ones above them.
 *
 * Order of the queues. A processor that applies remote operations before
 * a local operation whose acknowledgment has arrived must apply that
 * local operation when its acknowledgment comes, as acknowledged;
 * otherwise a remote remove or clear sequenced after it would miss it.
 *
 * Knowing. An operation's client knew an add when the add's seq is
 * assigned and at most the operation's refSeq, or when the add is the same
 * client's, with a smaller clientSeq.
 *
 * The rules use applied(this) (dataModel.vocab.ts), the operations the
 * processor has applied, and are checked whenever process settles.
 *
 * @requires fresh-add-id  Each local add's id came from this processor's newShapeId, and no other local add has it. (Remote adds' IDs are their own processors' new-ids.)
 *   localAdds(this).every((a) => newIds(this).includes(a.id)) && unique(localAdds(this).map((a) => a.id))
 * @requires in-range  Each add's shape has its bounding box within ±1e300, right and bottom edges included.
 *   applied(this).filter(isAdd).every((a) => inRange(a.shape.boundingBox(), 1e300))
 * @ensures new-ids  newShapeId never returns an ID twice, nor one that a processor with a different clientId has returned.
 *   (q: ShapeMessageProcessor) => unique(newIds(this)) && (q.clientId === this.clientId || disjoint(newIds(this), newIds(q)))
 * @ensures read-facet  model has only ShapeCollection's members, own or inherited, and its on and off return the model itself, so whoever holds it can't reach the writer through it.
 *   (f: () => void) => onlyMembers(this.model, collectionMembers) &&
 *     this.model.on("change", f) === this.model && this.model.off("change", f) === this.model
 * @ensures add-on-z  The shapes are in compareOrder of their adds (shapeModel.vocab.ts).
 *   isStrictlySorted(ids(this.model), (a, b) => compareOrder(addOf(applied(this), a)!, addOf(applied(this), b)!))
 * @ensures kept  Each applied add's shape is present, under its id, unless an applied remove lists it or an applied clear knew its add.
 *   applied(this).filter(isAdd).every((a) => removedBy(applied(this), a) || deepEqual(this.model.get(a.id), a.shape))
 * @ensures remove-listed  No shape that an applied remove lists is present.
 *   applied(this).filter(isRemove).every((r) => r.ids.every((id) => this.model.get(id) === undefined))
 * @ensures clear-known  No shape whose add an applied clear knew is present.
 *   applied(this).filter(isClear).every((c) => ids(this.model).every((id) => !knew(c, addOf(applied(this), id)!)))
 * @ensures ack-keeps-z  Applying an acknowledgment doesn't change the shapes or their z-order, or emit change.
 *   steps(this).every((s) => !isAckOf(this, s.op) || (s.changes.length === 0 &&
 *     deepEqual(atEvent(s.at, entries(this.model)), s.from < 0 ? old(entries(this.model)) : atEvent(s.from, entries(this.model)))))
 * @ensures one-change  Each operation that changes the shapes emits change once, when the shapes already show its whole effect, and before logOperations reports the operation; one that changes nothing emits nothing; and no change is emitted apart from an operation.
 *   steps(this).every((s) => s.changes.length ===
 *     (deepEqual(atEvent(s.at, entries(this.model)), s.from < 0 ? old(entries(this.model)) : atEvent(s.from, entries(this.model))) ? 0 : 1) &&
 *     s.changes.every((i) => deepEqual(atEvent(i, entries(this.model)), atEvent(s.at, entries(this.model))))) &&
 *   emitted(this).filter((e) => e.startsWith("model.")).length === steps(this).reduce((n, s) => n + s.changes.length, 0)
 * @budget log-amortized  process takes time per operation logarithmic in the number of shapes, on each of the processor's workloads (in none of which a clear removes shapes), growing at most 16 times from 1,000 shapes to 100,000.
 *   within("logarithmic", 16, processorWorkloads)
 * @refines MessageProcessor.once  ack-keeps-z
 * @refines MessageProcessor.atomic  one-change
 */
export interface ShapeMessageProcessor<S extends Shape = Shape> extends MessageProcessor<ShapeCollection<S>, ShapeOp> {
  /** An ID for a new shape, for an AddShape this client makes. */
  newShapeId(): ShapeId;
}
