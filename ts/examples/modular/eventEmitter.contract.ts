// Contract tests for EventEmitter (events.ts), through an emitter's change
// event. Wired by the contracts of things that emit change, such as
// ShapeCollectionWriter's. Test names are rule IDs.
//
// The suite runs random sequences of changes, on and off. A reference
// listener stays registered throughout. Three more functions are
// registered, sometimes more than once each, and removed, sometimes when
// they have no registration left. A meddling listener adds or removes one
// of them during a change, when armed. Every listener logs its calls, and
// each change should call the registrations made before it, in order.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { EventEmitter } from "./events.ts";
import { coverage } from "./testkit.ts";

/** An emitter, and a way to make it emit change exactly once, synchronously. */
export interface EmitterSubject {
  emitter: EventEmitter<{ change: [] }>;
  change(): void;
}

const pool = 3;

type Op =
  | { op: "change" }
  | { op: "on"; k: number }
  | { op: "off"; k: number }
  | { op: "meddle"; action: "on" | "off"; k: number }
  | { op: "cycle" };

const poolIndex = fc.nat({ max: pool - 1 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Op>({ op: "change" }) },
  { weight: 2, arbitrary: poolIndex.map((k): Op => ({ op: "on", k })) },
  { weight: 1, arbitrary: poolIndex.map((k): Op => ({ op: "off", k })) },
  {
    weight: 1,
    arbitrary: fc.record({ action: fc.constantFrom("on" as const, "off" as const), k: poolIndex })
      .map((a): Op => ({ op: "meddle", ...a })),
  },
  { weight: 1, arbitrary: fc.constant<Op>({ op: "cycle" }) },
);
const sequence = fc.array(opArb, { minLength: 1, maxLength: 40, size: "max" });

/** A listener, as its calls are logged: the reference, the meddler, or a pool function's index. */
type Token = "ref" | "meddler" | number;

interface Step {
  op: Op;
  /** Every listener call during this step, in order. */
  log: Token[];
  /** The registrations before this step, in the order they were made. */
  registered: Token[];
  /** Whether off has been called for each pool function, up to the end of this step. */
  removed: boolean[];
  /** For off, whether the function had no registration. */
  offEmpty: boolean;
  /** For cycle, whether nothing was registered once the reference and meddler were removed. */
  none: boolean;
  /** What the meddler did during this step, if anything. */
  meddled: "on" | "off" | null;
  /** For on and off, whether the call returned the emitter. */
  returnedThis: boolean;
}

const sameTokens = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Runs ops against a fresh emitter, calling check after each one. */
function run(make: () => EmitterSubject, opList: Op[], check: (s: Step) => void): void {
  const { emitter, change } = make();
  const log: Token[] = [];
  // The registrations the emitter should have, in order; off removes the most recent.
  const registered: Token[] = [];
  const unregister = (t: Token) => {
    const i = registered.lastIndexOf(t);
    if (i >= 0) registered.splice(i, 1);
    return i >= 0;
  };
  const fns = Array.from({ length: pool }, (_, k) => () => void log.push(k));
  const removed = fns.map(() => false);
  const refListener = () => void log.push("ref");
  let armed: { action: "on" | "off"; k: number } | null = null;
  let meddled: "on" | "off" | null = null;
  const meddler = () => {
    log.push("meddler");
    if (armed === null) return;
    const { action, k } = armed;
    armed = null;
    meddled = action;
    if (action === "on") {
      emitter.on("change", fns[k]);
      registered.push(k);
    } else {
      emitter.off("change", fns[k]);
      unregister(k);
      removed[k] = true;
    }
  };
  // Not chained, so that on returning something else fails only returns-this.
  emitter.on("change", refListener);
  emitter.on("change", meddler);
  registered.push("ref", "meddler");
  for (const op of opList) {
    const registeredBefore = [...registered];
    log.length = 0;
    meddled = null;
    let offEmpty = false;
    let none = false;
    let returnedThis = true;
    switch (op.op) {
      case "change":
        change();
        break;
      case "on":
        returnedThis = emitter.on("change", fns[op.k]) === emitter;
        registered.push(op.k);
        break;
      case "off":
        returnedThis = emitter.off("change", fns[op.k]) === emitter;
        offEmpty = !unregister(op.k);
        removed[op.k] = true;
        break;
      case "meddle":
        armed = { action: op.action, k: op.k };
        break;
      case "cycle":
        // Removes the reference and the meddler and registers them again, so
        // that an emitter sometimes has no listeners at all, and the order
        // of registrations varies.
        emitter.off("change", refListener);
        emitter.off("change", meddler);
        unregister("ref");
        unregister("meddler");
        none = registered.length === 0;
        emitter.on("change", meddler);
        emitter.on("change", refListener);
        registered.push("meddler", "ref");
        break;
    }
    check({ op, log: [...log], registered: registeredBefore, removed: [...removed], offEmpty, none, meddled, returnedThis });
  }
}

/** The input classes one sequence reaches, for the coverage test. */
function labelsOf(make: () => EmitterSubject, opList: Op[]): Set<string> {
  const seen = new Set<string>();
  run(make, opList, (s) => {
    if (s.offEmpty) seen.add("off with nothing registered");
    if (s.none) seen.add("no listeners at all");
    if (s.meddled === "on") seen.add("listener added during a change");
    if (s.meddled === "off") seen.add("listener removed during a change");
    if (s.op.op !== "change") return;
    const count = (k: number) => s.registered.filter((t) => t === k).length;
    const ks = Array.from({ length: pool }, (_, k) => k);
    if (ks.some((k) => count(k) >= 2)) seen.add("change with a function registered twice");
    if (ks.filter((k) => count(k) > 0).length >= 2) seen.add("change with two functions listening");
    if (ks.some((k) => s.removed[k] && count(k) === 0)) seen.add("change after a listener was removed");
    if (ks.some((k) => s.removed[k] && count(k) > 0)) seen.add("change after one of two registrations was removed");
  });
  return seen;
}

export function eventEmitterContract(make: () => EmitterSubject): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(sequence, (opList) => {
        run(make, opList, (s) => assert.ok(check(s), id));
      }));
    });

  describe("EventEmitter", () => {
    // A change emits once, so its log should be the registrations made
    // before it, in order. Any other step emits nothing.
    const emitted = (s: Step) => (s.op.op === "change" ? sameTokens(s.log, s.registered) : s.log.length === 0);

    rule("EventEmitter.on.notified", (s) => s.op.op !== "change" || s.registered.every((t) =>
      typeof t !== "number" || s.removed[t] ||
      s.log.filter((u) => u === t).length === s.registered.filter((u) => u === t).length));

    rule("EventEmitter.off.removes-one", (s) => !s.removed.some(Boolean) || emitted(s));

    rule("EventEmitter.on.returns-this", (s) => s.op.op !== "on" || s.returnedThis);

    rule("EventEmitter.off.returns-this", (s) => s.op.op !== "off" || s.returnedThis);

    rule("EventEmitter.order", (s) => s.meddled !== null || emitted(s));

    rule("EventEmitter.snapshot", (s) => s.meddled === null || emitted(s));

    test("EventEmitter input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sequence", sequence, (opList) => labelsOf(make, opList), {
        "change with two functions listening": 0.31, "change with a function registered twice": 0.28,
        "change after a listener was removed": 0.34, "change after one of two registrations was removed": 0.29,
        "off with nothing registered": 0.27, "no listeners at all": 0.15,
        "listener added during a change": 0.21, "listener removed during a change": 0.23,
      });
    });
  });
}
