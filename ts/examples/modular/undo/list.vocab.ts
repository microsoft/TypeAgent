/**
 * Vocabulary for rule expressions about list.ts: what a change does to
 * the items, and what undoing it does. Re-exports the rule language's
 * vocabulary.
 *
 * @module
 */

import type { ListReader, Op } from "./list.ts";

export * from "../rules.ts";

/** The items with op applied; with no op, the items unchanged. */
export function apply(op: Op | undefined, items: readonly string[]): readonly string[] {
  if (op === undefined) return items;
  switch (op.kind) {
    case "add":
      return [...items.slice(0, op.index), op.text, ...items.slice(op.index)];
    case "remove":
      return [...items.slice(0, op.index), ...items.slice(op.index + 1)];
    case "replace":
      return items.map((t, i) => (i === op.index ? op.text : t));
  }
}

/** The items with op reversed; with no op, the items unchanged. */
export function unapply(op: Op | undefined, items: readonly string[]): readonly string[] {
  if (op === undefined) return items;
  switch (op.kind) {
    case "add":
      return [...items.slice(0, op.index), ...items.slice(op.index + 1)];
    case "remove":
      return [...items.slice(0, op.index), op.text, ...items.slice(op.index)];
    case "replace":
      return items.map((t, i) => (i === op.index ? op.was : t));
  }
}

/** The first op, or undefined if there is none. */
export function first(ops: readonly Op[]): Op | undefined {
  return ops[0];
}

/** The last op, or undefined if there is none. */
export function last(ops: readonly Op[]): Op | undefined {
  return ops[ops.length - 1];
}

/** Everything a reader can observe: the items, past and future. */
export function snapshot(l: ListReader): { items: readonly string[]; past: readonly Op[]; future: readonly Op[] } {
  return { items: [...l.items], past: [...l.past], future: [...l.future] };
}
