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
import { acknowledged, history, knew, returned } from "./dataModel.vocab.ts";

export * from "./shape.vocab.ts";
export * from "./dataModel.vocab.ts";

/** ShapeCollection's members, its own and those it inherits: all that a read facet may have. */
export const collectionMembers: readonly string[] = ["get", "size", "forEach", "compareZ", "inRect", "atPoint", "on", "off"];

/**
 * Whether every property of o, its own and those along its prototype chain
 * short of Object.prototype, is one of members (a class's constructor
 * aside). Properties that hold the writer, or anything else, fail. A
 * TypeScript private field is a property at run time and fails; a
 * JavaScript #private field isn't one.
 */
export function onlyMembers(o: object, members: readonly string[]): boolean {
  for (let p: object | null = o; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Reflect.ownKeys(p)) {
      if (key === "constructor" && p !== o) continue;
      if (!members.includes(String(key))) return false;
    }
  }
  return true;
}

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

/** The IDs p's newShapeId has returned, in order. */
export function newIds(p: object): ShapeId[] {
  return returned(p, "newShapeId") as ShapeId[];
}

/** The adds enqueued on p's local queue, as stamped, in order. */
export function localAdds(p: object): AddShape[] {
  return history(p).filter((c) => c.member === "local.enqueue").map((c) => c.result as ShapeOp).filter(isAdd);
}

/** The workloads ShapeCollectionWriter.log-amortized is measured on. */
export const writerWorkloads = [
  "adds, each directly below the same shape",
  "adds, each directly below the one added before it",
  "adds at the bottom",
  "adds below random present shapes",
  "removes of random present shapes, mixed with adds",
  "compareZ on random pairs",
] as const;

/** The workloads ShapeMessageProcessor.log-amortized is measured on. */
export const processorWorkloads = [
  "remote adds while one local add is pending, then local adds",
  "remote removes of random present shapes",
  "remote clears that remove nothing, from a client that knew no shape",
] as const;
