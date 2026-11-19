/**
 * The reference List, for checking: the scenario judge plays allowed
 * scenarios on it, so that the rules are evaluated on its states. It uses
 * the vocabulary's apply and unapply, so its undo and redo are the rules'
 * own definitions.
 * Imports: list.ts, list.vocab.ts
 */

import type { List, Op } from "./list.ts";
import { apply, unapply } from "./list.vocab.ts";

export function makeList(): List {
  let items: readonly string[] = [];
  let past: readonly Op[] = [];
  let future: readonly Op[] = [];
  const change = (op: Op) => {
    items = apply(op, items);
    past = [...past, op];
    future = [];
  };
  return {
    get items() { return items; },
    get length() { return items.length; },
    get past() { return past; },
    get future() { return future; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get: (index) => items[index],
    add: (index, text) => change({ kind: "add", index, text }),
    remove: (index) => change({ kind: "remove", index, text: items[index] }),
    replace: (index, text) => change({ kind: "replace", index, text, was: items[index] }),
    undo() {
      const op = past.at(-1);
      if (!op) return;
      items = unapply(op, items);
      past = past.slice(0, -1);
      future = [op, ...future];
    },
    redo() {
      const op = future[0];
      if (!op) return;
      items = apply(op, items);
      past = [...past, op];
      future = future.slice(1);
    },
  };
}
