/**
 * Vocabulary for rule expressions about shapeModel.ts: the order that
 * decides z-order, and the shapes that applied operations should leave.
 * Re-exports the vocabulary of shape.ts and dataModel.ts.
 *
 * @module
 */

import type { Shape, ShapeId } from "./shape.ts";
import type { Operation } from "./dataModel.ts";
import type { AddShape, ClearShapes, RemoveShapes, ShapeOp } from "./shapeModel.ts";
import { acknowledged, knew } from "./dataModel.vocab.ts";

export * from "./shape.vocab.ts";
export * from "./dataModel.vocab.ts";

/**
 * Bottom to top: acknowledged operations by seq, then pending local
 * operations by clientSeq. Negative if a comes first.
 */
export function compareOrder(a: Operation, b: Operation): number {
  if (acknowledged(a) && acknowledged(b)) return a.seq - b.seq;
  if (acknowledged(a) !== acknowledged(b)) return acknowledged(a) ? -1 : 1;
  return a.clientSeq - b.clientSeq;
}

export const isAdd = (op: ShapeOp): op is AddShape => op.type === "add";
export const isRemove = (op: ShapeOp): op is RemoveShapes => op.type === "remove";
export const isClear = (op: ShapeOp): op is ClearShapes => op.type === "clear";

/** The add among ops that made the shape id, if any. */
export function addOf(ops: readonly ShapeOp[], id: ShapeId): AddShape | undefined {
  return ops.filter(isAdd).find((a) => a.id === id);
}

/** Whether some remove in ops lists add's shape, or some clear in ops knew add. */
export function removedBy(ops: readonly ShapeOp[], add: AddShape): boolean {
  return ops.some((op) => (isRemove(op) && op.ids.includes(add.id)) || (isClear(op) && knew(op, add)));
}

/** The shapes ops leave, bottom to top: each add not removed, in compareOrder. */
export function shapesAfter(ops: readonly ShapeOp[]): [ShapeId, Shape][] {
  return ops.filter(isAdd).filter((a) => !removedBy(ops, a))
    .sort(compareOrder).map((a) => [a.id, a.shape]);
}
