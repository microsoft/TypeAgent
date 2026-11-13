/**
 * The rule language: how rules are written in the interface files
 * (events.ts, geometry.ts, color.ts, shape.ts, frames.ts, view.ts,
 * shapeView.ts and layout.ts), and the generic vocabulary
 * for their expressions. Imports nothing.
 *
 * Vocabulary files. An interface file x.ts that needs vocabulary of its own
 * domain has x.vocab.ts beside it: reference functions and ghost state. It
 * re-exports this file and the vocabulary of the files x.ts imports, and
 * imports nothing else, so what a rule can mention stays within what its
 * interface can see. Tests import the vocabulary of the interface they
 * check.
 *
 * Format. Each rule is a tag, a slug and a one-line headline. Following
 * indented lines, when present, give the rule as a TypeScript boolean
 * expression. A rule with only a headline needs a hand-written test. The
 * tags say whose obligation a rule is and when it must hold:
 * - @requires: the caller's, on entry to a call.
 * - @ensures: the implementation's, on return from a call.
 * - @invariant: the implementation's, for one object: true once it is made
 *   and after every call, so tests check it after each operation.
 * - @valid: which values are legal members of a type. Like finite numbers
 *   (below), it holds of every value of the type passed to or returned by
 *   an interface. Passing an invalid one is outside the rules; returning one
 *   breaks the implementation's obligation. Tests check it wherever an
 *   implementation returns values of the type, or, for a type that only
 *   flows into implementations, on the values the tests make.
 * - @abstract: the implementation's, stated for an interface that others
 *   extend, but testable only for each of them. Each interface that
 *   extends it, directly or through others, names the rule of its own that
 *   makes it exact, with a line "@refines <abstract rule's ID>  <own slug>",
 *   and that rule is tested. An @refines in an ancestor covers the
 *   interfaces below it. npm run catalog checks all of this.
 * - @budget: the implementation's, a limit on time or memory. A bench
 *   script (bench.ts) measures it and reports the result, labeled with the
 *   rule's ID; exceeding it is reported, not a test failure, because timing
 *   tests are flaky.
 * - @deferred: the implementation's, for behavior that can't be checked
 *   until a feature exists. Two indented lines follow it instead of an
 *   expression: "when:" names what must exist first, and "how:" says how
 *   it will be checked then. When a test with its ID is written, the rule
 *   becomes @ensures. npm run catalog checks both.
 *
 * IDs. A rule's ID follows its location: Interface.slug for a rule in an
 * interface's doc, Interface.member.slug for one in a member's doc. The test
 * that checks a rule has the rule's ID as its name. A rule inherited from
 * another interface keeps its original ID. A rule in a file's header
 * applies to the whole file; its ID is the file's name without .ts, then
 * the slug, such as frames.complete.
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

/** Anything that visits IDs and values in order, such as a ShapeCollection or a RenderGroup. */
export interface Visitable<Id, T> {
  forEach(visit: (id: Id, value: T) => void): void;
}

/** The IDs a collection or group visits, in forEach order. */
export function ids<Id, T>(c: Visitable<Id, T>): Id[] {
  const out: Id[] = [];
  c.forEach((id) => out.push(id));
  return out;
}

/** The IDs and values a collection or group visits, in forEach order. */
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
