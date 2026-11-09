/**
 * The rule language: how rules are written in the interface files
 * (events.ts, geometry.ts, color.ts, shape.ts, window.ts, view.ts,
 * shapeView.ts, pointer.ts, ui.ts, chrome.ts and app.ts), and the generic vocabulary
 * for their expressions. Imports nothing.
 *
 * Vocabulary files. An interface file x.ts that needs vocabulary of its own
 * domain has x.vocab.ts beside it: reference functions and ghost state. It
 * re-exports this file and the vocabulary of the files x.ts imports, and
 * imports nothing else, so what a rule can mention stays within what its
 * interface can see. Tests import the vocabulary of the interface they
 * check.
 *
 * Format. Each rule is a tag, a slug and a one-line headline. The tags are
 * @requires (caller's obligation), @ensures (implementation's obligation)
 * and @invariant (always true of a value). Following indented lines, when
 * present, give the rule as a TypeScript boolean expression. A rule with
 * only a headline needs a hand-written test. @unchecked is a rule with no
 * test yet; its headline gives the reason.
 *
 * IDs. A rule's ID follows its location: Interface.slug for a rule in an
 * interface's doc, Interface.member.slug for one in a member's doc. The test
 * that checks a rule has the rule's ID as its name. A rule inherited from
 * another interface keeps its original ID. A rule in a file's header
 * applies to the whole file.
 *
 * Outside the rules. When a caller breaks a @requires rule, or passes a value
 * that doesn't match its static type, behavior is unspecified. An
 * implementation may throw, and declares what it does under
 * AdditionalSemantics.
 *
 * Numbers are finite. Every number in a value passed to or returned by an
 * interface, including inside its fields, is finite (allFinite below).
 * Passing a non-finite number is outside the rules, like a value of the
 * wrong type.
 *
 * In a rule expression:
 * - Method parameters are in scope by name, `this` is the object under test
 *   and `result` is the method's return value.
 * - A rule written as an arrow function, such as `(p: Point) => …`, holds for
 *   every value of its parameters. Tests generate those values.
 * - old(e) is the value of e just before the call.
 * - The functions below and in the interface file's vocabulary may be used. They are reference
 *   definitions, kept deliberately simple.
 * - Rules mean exact arithmetic when they compare an implementation with the
 *   reference functions. An implementation may compute in a different
 *   order and round differently. Tests use inputs on which floating-point
 *   arithmetic is exact, or skip cases within rounding distance of a tie.
 *   Rules that relate an object's own methods to each other, such as
 *   Shape's implies-box rules, hold as actually computed, with no allowance.
 *
 * @module
 */

/** The value of e just before the call. Rewritten by the rule tooling; never called. */
export declare function old<T>(e: T): T;

export function implies(a: boolean, b: boolean): boolean {
  return !a || b;
}

/** Whether every number in v, including inside nested objects and arrays, is finite. */
export function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "object" || v === null) return true;
  return Object.values(v).every(allFinite);
}

/** Anything that visits IDs and values in order, such as a ShapeCollection or a Layer. */
export interface Visitable<Id, T> {
  forEach(visit: (id: Id, value: T) => void): void;
}

/** The IDs a collection or layer visits, in forEach order. */
export function ids<Id, T>(c: Visitable<Id, T>): Id[] {
  const out: Id[] = [];
  c.forEach((id) => out.push(id));
  return out;
}

/** The IDs and values a collection or layer visits, in forEach order. */
export function entries<Id, T>(c: Visitable<Id, T>): [Id, T][] {
  const out: [Id, T][] = [];
  c.forEach((id, value) => out.push([id, value]));
  return out;
}

export function unique<T>(xs: readonly T[]): boolean {
  return new Set(xs).size === xs.length;
}

export function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Every element compares below every later one. Checks all pairs, not just
 * neighbours, since compare isn't known to be transitive.
 */
export function isStrictlySorted<T>(xs: readonly T[], compare: (a: T, b: T) => number): boolean {
  return xs.every((x, i) => xs.every((y, j) => j <= i || compare(x, y) < 0));
}

/** Structural equality of plain data: same keys and equal values, ignoring prototypes. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
