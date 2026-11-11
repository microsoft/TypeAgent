/**
 * Vocabulary for rule expressions about dataModel.ts: what an operation's
 * client knew, and ghost state for processors. Re-exports the rule
 * language's vocabulary.
 *
 * @module
 */

import type { MessageProcessor, Operation } from "./dataModel.ts";

export * from "./rules.ts";

/** Whether an operation's seq has been assigned. */
export function acknowledged(op: Operation): boolean {
  return op.seq !== -1;
}

/**
 * Whether op's client knew other when it formed op: other was acknowledged
 * with a seq no later than op's refSeq, or is the same client's, made
 * earlier.
 */
export function knew(op: Operation, other: Operation): boolean {
  return (acknowledged(other) && other.seq <= op.refSeq) ||
    (other.clientId === op.clientId && other.clientSeq < op.clientSeq);
}

/**
 * Ghost state: the operations p has applied, each with its seq as p now
 * knows it (assigned once its acknowledgment is applied), as tracked by the
 * test harness from what it enqueued and when it called process; the
 * interface does not expose them.
 */
export declare function applied<TOp extends Operation>(p: MessageProcessor<never, TOp>): readonly TOp[];
