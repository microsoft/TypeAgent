/**
 * A List with one fault switched on: the shared base of the undo list's
 * adversaries. Without faults it behaves as the reference (../listkit.ts).
 * Imports: ../list.ts, ../list.vocab.ts
 */

import type { List, Op } from "../list.ts";
import { apply, unapply } from "../list.vocab.ts";

export interface Faults {
  /** add appends, ignoring its index. */
  readonly addAppends?: boolean;
  /** add leaves future as it was, so redo still offers what was undone. */
  readonly addKeepsFuture?: boolean;
  /** remove records "" instead of the text it removed. */
  readonly removeForgetsText?: boolean;
  /** undo of a replace puts back the new text instead of the old. */
  readonly undoReplaceKeepsText?: boolean;
  /** redo reapplies the last op in future instead of the first. */
  readonly redoFromEnd?: boolean;
  /** canUndo is updated by changes but not by undo. */
  readonly staleCanUndo?: boolean;
  /** get(index) reads the item after index. */
  readonly getOffByOne?: boolean;
}

export function faultyList(f: Faults): List {
  let items: readonly string[] = [];
  let past: readonly Op[] = [];
  let future: readonly Op[] = [];
  let canUndo = false;
  const change = (op: Op) => {
    items = f.addAppends && op.kind === "add" ? [...items, op.text] : apply(op, items);
    past = [...past, op];
    if (!(f.addKeepsFuture && op.kind === "add")) future = [];
    canUndo = true;
  };
  return {
    get items() { return items; },
    get length() { return items.length; },
    get past() { return past; },
    get future() { return future; },
    get canUndo() { return f.staleCanUndo ? canUndo : past.length > 0; },
    get canRedo() { return future.length > 0; },
    get: (index) => items[f.getOffByOne ? index + 1 : index],
    add: (index, text) => change({ kind: "add", index, text }),
    remove: (index) => change({ kind: "remove", index, text: f.removeForgetsText ? "" : items[index] }),
    replace: (index, text) => change({ kind: "replace", index, text, was: items[index] }),
    undo() {
      const op = past.at(-1);
      if (!op) return;
      items = f.undoReplaceKeepsText && op.kind === "replace" ? items : unapply(op, items);
      past = past.slice(0, -1);
      future = [op, ...future];
    },
    redo() {
      const op = f.redoFromEnd ? future.at(-1) : future[0];
      if (!op) return;
      items = apply(op, items);
      past = [...past, op];
      future = f.redoFromEnd ? future.slice(0, -1) : future.slice(1);
    },
  };
}
