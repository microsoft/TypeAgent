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
 * expression: the rule's formal statement. The headline is a gloss on it,
 * and where they differ the expression is the rule. A rule with only a
 * headline is defined by the test with its ID; the rules of shapeModel.ts
 * all have expressions, and the others are to follow. Tests evaluate the
 * expressions themselves, compiled from the interface files, rather than
 * restating them. The tags say whose obligation a rule is and when it must
 * hold:
 * - @requires: the caller's, on entry to a call. A rule that uses
 *   nested(this) is about the calls the caller makes back into the object
 *   during the call, so it is checked on return.
 * - @ensures: the implementation's, on return from a call. A rule in an
 *   interface's doc holds for calls of that interface's members, its own
 *   and those it inherits.
 * - @invariant: the implementation's, for one object: true once it is made,
 *   after every call, and whenever the object emits an event, so that a
 *   listener sees an object whose invariants hold.
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
 * - @budget: the implementation's, a limit on time or memory. Its
 *   expression names a complexity class (Complexity below), which has its
 *   usual mathematical meaning, and a measurement that stands in for it. A
 *   bench script (bench.ts) makes the measurement and reports the result,
 *   labeled with the rule's ID. Passing the measurement with an algorithm
 *   outside the class still breaks the rule.
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
 * - old(e) is the value of e just before the call, and atEvent(i, e) its
 *   value when the call emitted its i-th event.
 * - history(o) is the calls made on o from outside it, ending with the call
 *   the rule is about. It is the only state a rule may use beyond what the
 *   interfaces expose: what an observer of o records, calls and the events
 *   emitted during them. Vocabulary defines everything else a rule needs
 *   from it.
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

/**
 * The value of e when the call emitted its i-th event (from 0), or
 * undefined if it emitted fewer. Rewritten by the rule tooling; never
 * called.
 */
export declare function atEvent<T>(i: number, e: T): T | undefined;

/** An event emitted during a call: its name, and the arguments its listeners got. */
export interface Emitted {
  readonly event: string;
  readonly args: readonly unknown[];
}

/** One call made on an object, as seen from outside it. */
export interface Call {
  /** The member called, such as "add"; a member of a member is "local.enqueue". Reading a property is a call. */
  readonly member: string;
  /** The arguments, as they were when the call was made. */
  readonly args: readonly unknown[];
  /** The return value, as it was on return; for an asynchronous call, the value its promise settled with. */
  readonly result: unknown;
  /** The events the object emitted during the call, in order. */
  readonly emitted: readonly Emitted[];
  /** The calls made on the object during this one, such as by a listener or a visit callback, in order. */
  readonly nested: readonly Call[];
}

const histories = new WeakMap<object, Call[]>();

/** The calls made on o from outside it, in order, ending with the call a rule is about. */
export function history(o: object): readonly Call[] {
  return histories.get(o) ?? [];
}

/**
 * Adds call to o's history, and returns a function that takes it out again
 * (for a call made during another, which belongs in that one's nested once
 * its own rules are checked). Only rule checking calls it.
 */
export function recordCall(o: object, call: Call): () => void {
  const calls = histories.get(o) ?? [];
  histories.set(o, calls);
  calls.push(call);
  return () => {
    const at = calls.lastIndexOf(call);
    if (at >= 0) calls.splice(at, 1);
  };
}

/** The names of the events the call a rule is about emitted, in order. */
export function emitted(o: object): string[] {
  return (history(o).at(-1)?.emitted ?? []).map((e) => e.event);
}

/** The calls made on o during the call a rule is about. */
export function nested(o: object): readonly Call[] {
  return history(o).at(-1)?.nested ?? [];
}

/** What o's calls to member returned, in order. */
export function returned(o: object, member: string): unknown[] {
  return history(o).filter((c) => c.member === member).map((c) => c.result);
}

export function disjoint<T>(a: readonly T[], b: readonly T[]): boolean {
  const sb = new Set(b);
  return a.every((x) => !sb.has(x));
}

/**
 * Complexity classes a @budget names, in n, the size its rule states:
 * time per operation, amortized over any sequence of operations, or
 * expected over the implementation's own random choices (as in a treap),
 * never over the sequence.
 */
export type Complexity = "constant" | "logarithmic" | "linear";

/**
 * A budget: each workload's operations take time per operation in the
 * class c, and the time per operation at 100,000 against 1,000 is at most
 * limit. Measured by a bench script; never called.
 */
export declare function within(c: Complexity, limit: number, workloads: readonly string[]): boolean;

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
