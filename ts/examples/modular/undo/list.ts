/**
 * The undo list: an ordered list of text items whose changes can be
 * undone and redone (brief.md). Rules follow the format described in
 * ../rules.ts.
 *
 * @module
 */

/**
 * One change to the list, as undo and redo see it. Each records what is
 * needed to reverse it: a remove records the text it removed, and a
 * replace the text it replaced.
 */
export type Op =
  | { readonly kind: "add"; readonly index: number; readonly text: string }
  | { readonly kind: "remove"; readonly index: number; readonly text: string }
  | { readonly kind: "replace"; readonly index: number; readonly text: string; readonly was: string };

/**
 * What undo and redo would do next. For observation: tests, debugging and
 * the rules use it.
 */
export interface UndoHistory {
  /** The changes undo would reverse, oldest first. */
  readonly past: readonly Op[];
  /** The changes redo would reapply, next first. */
  readonly future: readonly Op[];
}

/**
 * Reading the list and its history.
 *
 * @ensures read-only  Reading items, length, get, canUndo, canRedo, past or future changes nothing.
 *   deepEqual(snapshot(this), old(snapshot(this)))
 * @invariant length  length is the number of items.
 *   this.length === this.items.length
 * @invariant can-undo  canUndo says whether past has a change to undo.
 *   this.canUndo === this.past.length > 0
 * @invariant can-redo  canRedo says whether future has a change to redo.
 *   this.canRedo === this.future.length > 0
 */
export interface ListReader extends UndoHistory {
  /** The items, first to last. */
  readonly items: readonly string[];
  readonly length: number;

  /**
   * @requires in-range  index is the position of an item.
   *   Number.isInteger(index) && 0 <= index && index < this.length
   * @ensures reads  Returns the item at index.
   *   result === this.items[index]
   */
  get(index: number): string;

  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * The list, with its changes and undo and redo.
 *
 * @initially empty  A list starts with no items and nothing to undo or redo.
 *   this.items.length === 0 && this.past.length === 0 && this.future.length === 0
 */
export interface List extends ListReader {
  /**
   * @requires in-range  index is a position from the start of the list to its end, both included.
   *   Number.isInteger(index) && 0 <= index && index <= this.length
   * @ensures inserts  text is inserted at index; the other items keep their order.
   *   deepEqual(this.items, [...old(this.items).slice(0, index), text, ...old(this.items).slice(index)])
   * @ensures records  The add is appended to past, and future is emptied.
   *   deepEqual(this.past, [...old(this.past), { kind: "add", index, text }]) && this.future.length === 0
   */
  add(index: number, text: string): void;

  /**
   * @requires in-range  index is the position of an item.
   *   Number.isInteger(index) && 0 <= index && index < this.length
   * @ensures removes  The item at index is removed; the others keep their order.
   *   deepEqual(this.items, [...old(this.items).slice(0, index), ...old(this.items).slice(index + 1)])
   * @ensures records  The remove, with the text it removed, is appended to past, and future is emptied.
   *   deepEqual(this.past, [...old(this.past), { kind: "remove", index, text: old(this.items)[index] }]) && this.future.length === 0
   */
  remove(index: number): void;

  /**
   * @requires in-range  index is the position of an item.
   *   Number.isInteger(index) && 0 <= index && index < this.length
   * @ensures replaces  The item at index becomes text; the others are unchanged.
   *   deepEqual(this.items, old(this.items).map((t, i) => (i === index ? text : t)))
   * @ensures records  The replace, with the text it replaced, is appended to past, and future is emptied.
   *   deepEqual(this.past, [...old(this.past), { kind: "replace", index, text, was: old(this.items)[index] }]) && this.future.length === 0
   */
  replace(index: number, text: string): void;

  /**
   * @ensures undoes  Reverses the last change in past and moves it to the front of future; with nothing in past, changes nothing.
   *   deepEqual(this.items, unapply(last(old(this.past)), old(this.items))) &&
   *   deepEqual(this.past, old(this.past).slice(0, -1)) &&
   *   deepEqual(this.future, [...old(this.past).slice(-1), ...old(this.future)])
   */
  undo(): void;

  /**
   * @ensures redoes  Reapplies the first change in future and moves it to the end of past; with nothing in future, changes nothing.
   *   deepEqual(this.items, apply(first(old(this.future)), old(this.items))) &&
   *   deepEqual(this.past, [...old(this.past), ...old(this.future).slice(0, 1)]) &&
   *   deepEqual(this.future, old(this.future).slice(1))
   */
  redo(): void;
}
