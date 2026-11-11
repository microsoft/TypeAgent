/**
 * Shapes as a data model (dataModel.ts). ShapeCollection is the read side,
 * ShapeCollectionWriter the write side, ShapeOp the operations, and
 * ShapeMessageProcessor applies them with the writer's methods.
 *
 * Draft: when agreed, this replaces ShapeCollection in shape.ts.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Shape } from "./shape.ts";
import type { DataModel, DataModelReader, MessageProcessor, Operation } from "./dataModel.ts";

/**
 * Identifies a shape on every client. Made by
 * ShapeMessageProcessor.newShapeId; separate from the clientId and
 * clientSeq that identify operations, since a model loaded from a snapshot
 * holds shapes added by many clients.
 */
export type ShapeId = string & { readonly __brand: "ShapeId" };

export type ShapeCollectionEvents = { change: [] };

/**
 * Shapes in z-order. The read side: views, render groups and controllers
 * hold this.
 *
 * @invariant size  size counts the shapes forEach visits.
 *   this.size === ids(this).length
 * @invariant z-order  forEach visits each shape once, from bottom to top.
 *   isStrictlySorted(ids(this), (a, b) => this.compareZ(a, b))
 * @invariant get-agrees  get returns exactly the shapes forEach visits, under the same IDs.
 *   (id: ShapeId) => entries(this).every(([i, s]) => this.get(i) === s) &&
 *     implies(this.get(id) !== undefined, ids(this).includes(id))
 * @ensures read-only  get, size, forEach, compareZ, on and off never change the shapes.
 */
export interface ShapeCollection<S extends Shape = Shape> extends DataModelReader<ShapeCollectionEvents> {
  /** The shape with this ID, or undefined if no such shape exists. */
  get(id: ShapeId): S | undefined;

  /** The number of shapes. */
  readonly size: number;

  /** Calls visit for each shape, bottom to top. visit must not change the collection. */
  forEach(visit: (id: ShapeId, shape: S) => void): void;

  /**
   * Negative if a is below b, positive if above.
   *
   * @requires present  Both shapes are in the collection.
   * @ensures zero-iff-same  Returns 0 only when comparing a shape with itself.
   * @ensures antisymmetric  Swapping the arguments flips the sign.
   */
  compareZ(a: ShapeId, b: ShapeId): number;
}

/**
 * The write side. Only a ShapeMessageProcessor holds it.
 *
 * @ensures notifies  Each call that changes the shapes emits change once, after the change is complete; a call that changes nothing emits nothing.
 */
export interface ShapeCollectionWriter<S extends Shape = Shape> extends ShapeCollection<S>, DataModel {
  /**
   * Adds shape under id: directly below the shape below, or on top when
   * below is undefined.
   *
   * @requires new-id  id isn't present.
   * @requires below-present  below, when given, is present.
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
   *   deepEqual(entries(this), old(entries(this)).filter(([i]) => !ids.includes(i))) &&
   *     result === old(this.size) - this.size
   */
  remove(ids: readonly ShapeId[]): number;
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
 * acknowledgment moves nothing.
 *
 * Knowing. An operation's client knew an add when the add's seq is
 * assigned and at most the operation's refSeq, or when the add is the same
 * client's, with a smaller clientSeq.
 *
 * The rules use applied(this) (dataModel.vocab.ts), the operations the
 * processor has applied, and are checked whenever process settles.
 *
 * @requires fresh-add-id  Each add's id came from newShapeId, and no other add has it.
 * @ensures new-ids  newShapeId never returns an ID that it, or any processor with a different clientId, has returned.
 * @ensures read-facet  model has none of the writer's members, so whoever holds it can't change the shapes through it.
 *   !("add" in this.model) && !("remove" in this.model)
 * @ensures add-on-z  The shapes are in compareOrder of their adds (shapeModel.vocab.ts).
 *   isStrictlySorted(ids(this.model), (a, b) => compareOrder(addOf(applied(this), a)!, addOf(applied(this), b)!))
 * @ensures kept  Each applied add's shape is present, under its id, unless an applied remove lists it or an applied clear knew its add.
 *   applied(this).filter(isAdd).every((a) => removedBy(applied(this), a) || deepEqual(this.model.get(a.id), a.shape))
 * @ensures remove-listed  No shape that an applied remove lists is present.
 *   applied(this).filter(isRemove).every((r) => r.ids.every((id) => this.model.get(id) === undefined))
 * @ensures clear-known  No shape whose add an applied clear knew is present.
 *   applied(this).filter(isClear).every((c) => ids(this.model).every((id) => !knew(c, addOf(applied(this), id)!)))
 * @ensures ack-keeps-z  Applying an acknowledgment doesn't change the shapes or their z-order, or emit change.
 * @ensures one-change  Each operation that changes the shapes emits change once, when the shapes already show its whole effect; one that changes nothing emits nothing.
 * @refines MessageProcessor.local-order  add-on-z
 * @refines MessageProcessor.remote-order  add-on-z
 * @refines MessageProcessor.once  ack-keeps-z
 * @refines MessageProcessor.atomic  one-change
 */
export interface ShapeMessageProcessor<S extends Shape = Shape> extends MessageProcessor<ShapeCollection<S>, ShapeOp> {
  /** An ID for a new shape, for an AddShape this client makes. */
  newShapeId(): ShapeId;
}
