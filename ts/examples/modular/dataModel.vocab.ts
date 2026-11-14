/**
 * Vocabulary for rule expressions about dataModel.ts: what an operation's
 * client knew, and what a processor has applied. Re-exports the rule
 * language's vocabulary.
 *
 * @module
 */

import type { DataModelReader, MessageProcessor, Operation } from "./dataModel.ts";
import { emitted, history, type Call } from "./rules.ts";

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
 * The operations p has applied, from its history: each operation enqueued
 * before p's latest process call (the one a rule is about, if it is one),
 * in the order enqueued, with the seq of its acknowledgment once that was
 * enqueued too. A local operation is as its enqueue returned it, stamped.
 */
export function applied<TOp extends Operation>(p: MessageProcessor<DataModelReader, TOp>): TOp[] {
  const calls = history(p);
  // Rules call this inside comparators, so it is computed once per state
  // of the history; the result is the same either way.
  const cached = appliedCache.get(p);
  if (cached && cached.length === calls.length && cached.last === calls.at(-1)) return cached.value as TOp[];
  let end = calls.length;
  while (end > 0 && calls[end - 1].member !== "process") end--;
  const out: TOp[] = [];
  for (const c of calls.slice(0, Math.max(0, end - 1))) {
    if (c.member === "local.enqueue") out.push(c.result as TOp);
    else if (c.member === "remote.enqueue") {
      const op = c.args[0] as TOp;
      const own = out.findIndex((a) => a.clientId === op.clientId && a.clientSeq === op.clientSeq);
      if (own >= 0) out[own] = { ...out[own], seq: op.seq };
      else out.push(op);
    }
  }
  appliedCache.set(p, { length: calls.length, last: calls.at(-1), value: out });
  return out;
}

const appliedCache = new WeakMap<object, { length: number; last: Call | undefined; value: readonly Operation[] }>();

/** The operations p's log reported during the call a rule is about, in order. */
export function logged<TOp extends Operation>(p: MessageProcessor<DataModelReader, TOp>): TOp[] {
  return (history(p).at(-1)?.emitted ?? []).filter((e) => e.event === "logOperations.applied").map((e) => e.args[0] as TOp);
}

/**
 * The operations queued on p after its previous process call and before
 * the call a rule is about: a local one as its enqueue returned it, a
 * remote one as it was enqueued.
 */
export function queuedSince<TOp extends Operation>(p: MessageProcessor<DataModelReader, TOp>): TOp[] {
  const calls = history(p).slice(0, -1);
  let start = calls.length;
  while (start > 0 && calls[start - 1].member !== "process") start--;
  return calls.slice(start).flatMap((c) =>
    c.member === "local.enqueue" ? [c.result as TOp] : c.member === "remote.enqueue" ? [c.args[0] as TOp] : []);
}

/** Whether a and b hold the same operations, each as often, telling operations apart by clientId, clientSeq and seq. */
export function sameOps(a: readonly Operation[], b: readonly Operation[]): boolean {
  const key = (op: Operation) => JSON.stringify([op.clientId, op.clientSeq, op.seq]);
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Whether op is the acknowledgment of one of p's local operations. */
export function isAckOf(p: MessageProcessor<DataModelReader, Operation>, op: Operation): boolean {
  return op.clientId === p.clientId && op.seq !== -1;
}

/**
 * The operations the call a rule is about applied, from its log, each with
 * the index among emitted(p) of its applied event (at), of the previous
 * operation's (from, or -1 for the first), and of the events p's model
 * emitted in between (changes).
 */
export function steps<TOp extends Operation>(p: MessageProcessor<DataModelReader, TOp>): { op: TOp; at: number; from: number; changes: number[] }[] {
  const names = emitted(p);
  const ops = logged(p);
  const out: { op: TOp; at: number; from: number; changes: number[] }[] = [];
  let from = -1;
  names.forEach((name, i) => {
    if (name !== "logOperations.applied") return;
    const changes = names.map((n, j) => (j > from && j < i && n.startsWith("model.") ? j : -1)).filter((j) => j >= 0);
    out.push({ op: ops[out.length], at: i, from, changes });
    from = i;
  });
  return out;
}
