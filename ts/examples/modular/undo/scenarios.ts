/**
 * Scenarios of the undo list: what a user does with a list, and what they
 * then see. Allowed scenarios must be accepted by the rules; forbidden
 * ones must be rejected. Each is written in the scenario subset
 * (Scenario in ../rules.ts).
 *
 * @module
 */

import type { List } from "./list.ts";
import { deepEqual, expect, scenario } from "./list.vocab.ts";

export const scenarios = [
  scenario("edit-then-undo", "allowed", "Undo reverses the last change, then the one before it, back to the empty list.", (list: List) => {
    list.add(0, "milk");
    list.add(1, "eggs");
    list.replace(0, "oat milk");
    list.undo();
    expect(deepEqual(list.items, ["milk", "eggs"]));
    list.undo();
    list.undo();
    expect(deepEqual(list.items, []));
  }),

  scenario("undo-to-empty", "allowed", "Every change can be undone, in reverse order, back to the empty list.", (list: List, texts: readonly string[]) => {
    texts.forEach((t, i) => list.add(i, t));
    texts.forEach(() => list.undo());
    expect(list.items.length === 0 && !list.canUndo);
  }),

  scenario("redo-after-undo", "allowed", "What was undone can be redone.", (list: List) => {
    list.add(0, "milk");
    list.undo();
    list.redo();
    expect(deepEqual(list.items, ["milk"]) && !list.canRedo);
  }),

  scenario("new-change-clears-redo", "allowed", "A new change ends what can be redone.", (list: List) => {
    list.add(0, "milk");
    list.add(1, "eggs");
    list.undo();
    list.add(1, "bread");
    expect(deepEqual(list.items, ["milk", "bread"]) && !list.canRedo);
  }),

  scenario("undo-nothing", "allowed", "Undo on a new list changes nothing.", (list: List) => {
    list.undo();
    expect(deepEqual(list.items, []) && !list.canUndo && !list.canRedo);
  }),

  scenario("undo-wrong-order", "forbidden", "Undo reverses the first change instead of the last.", (list: List) => {
    list.add(0, "milk");
    list.add(1, "eggs");
    list.undo();
    expect(deepEqual(list.items, ["eggs"]));
  }),

  scenario("redo-survives-change", "forbidden", "Something undone can still be redone after a new change.", (list: List) => {
    list.add(0, "milk");
    list.undo();
    list.add(0, "eggs");
    expect(list.canRedo);
  }),
];
