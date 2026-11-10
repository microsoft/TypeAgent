// Contract tests for ShapeCollection (geometry.ts). Every implementation runs
// this suite, including every RenderGroup. Test names are rule IDs.
//
// The suite runs random sequences of add, remove and removeMultiple, and
// checks the rules after every step. Removals pick among every ID the
// collection has returned, plus one it never returned, so they hit present,
// removed and unknown IDs. Some adds repeat a shape object added before.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Shape, ShapeCollection, ShapeId } from "./shape.ts";
import { deepEqual, entries, ids, isStrictlySorted } from "./shape.vocab.ts";
import { coverage, shape } from "./testkit.ts";

type Op =
  | { op: "add"; shape: Shape; sameAs: number | null }
  | { op: "remove"; pick: number }
  | { op: "removeMultiple"; picks: number[] }
  | { op: "read"; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ shape, sameAs: fc.option(fc.nat(), { freq: 5 }) }).map((a): Op => ({ op: "add", ...a })) },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "remove", pick })) },
  { weight: 1, arbitrary: fc.array(fc.nat(), { maxLength: 6 }).map((picks): Op => ({ op: "removeMultiple", picks })) },
  { weight: 1, arbitrary: fc.nat().map((pick): Op => ({ op: "read", pick })) },
);
const sequence = fc.array(opArb, { minLength: 1, maxLength: 40, size: "max" });

/** Builds up many shapes, then removes most of them in one batch. */
const drain: fc.Arbitrary<Op[]> = fc.tuple(
  fc.array(shape, { minLength: 20, maxLength: 60 }),
  fc.array(fc.nat(), { minLength: 10, maxLength: 80 }),
).map(([shapes, picks]) => [
  ...shapes.map((s): Op => ({ op: "add", shape: s, sameAs: null })),
  { op: "removeMultiple", picks },
]);

interface Step {
  op: Op;
  collection: ShapeCollection;
  before: [ShapeId, Shape][];
  /** For add, the ID returned; for removals, the IDs listed. */
  ids: ShapeId[];
  /** For add, the shape object added. */
  shape: Shape | undefined;
  /** For remove, what get returned for the ID just before the call. */
  getBefore: Shape | undefined;
  result: unknown;
  /** Every ID returned before this step. */
  returned: ReadonlySet<ShapeId>;
  /** An ID the collection has never returned. */
  unknown: ShapeId;
}

/** A number that isn't in returned, so the collection has never returned it. */
const unknownId = (returned: ReadonlySet<ShapeId>): ShapeId =>
  (Math.max(0, ...[...returned].filter(Number.isFinite)) + 1) as ShapeId;

/** Runs ops against a fresh collection, calling check after each one. */
function run(make: () => ShapeCollection, opList: Op[], check: (s: Step) => void): void {
  const collection = make();
  const returned = new Set<ShapeId>();
  const added: Shape[] = [];
  for (const op of opList) {
    const unknown = unknownId(returned);
    const pool = [...returned, unknown];
    const pickId = (n: number) => pool[n % pool.length];
    const before = entries(collection);
    const returnedBefore = new Set(returned);
    let ids: ShapeId[] = [];
    let shape: Shape | undefined;
    let getBefore: Shape | undefined;
    let result: unknown;
    switch (op.op) {
      case "add": {
        shape = op.sameAs !== null && added.length > 0 ? added[op.sameAs % added.length] : op.shape;
        const id = collection.add(shape);
        added.push(shape);
        returned.add(id);
        ids = [id];
        result = id;
        break;
      }
      case "remove":
        ids = [pickId(op.pick)];
        getBefore = collection.get(ids[0]);
        result = collection.remove(ids[0]);
        break;
      case "removeMultiple":
        ids = op.picks.map(pickId);
        result = collection.removeMultiple(ids);
        break;
      case "read": {
        // Every observer, on a present ID when there is one.
        const id = before.length > 0 ? before[op.pick % before.length][0] : pickId(op.pick);
        collection.get(id);
        void collection.size;
        collection.forEach(() => {});
        if (collection.get(id) !== undefined) collection.compareZ(id, id);
        ids = [id];
        break;
      }
    }
    check({ op, collection, before, ids, shape, getBefore, result, returned: returnedBefore, unknown });
  }
}

/** The input classes one sequence reaches, for the coverage test. */
function labelsOf(make: () => ShapeCollection, opList: Op[]): Set<string> {
  const seen = new Set<string>();
  run(make, opList, (s) => {
    const present = s.before.map(([id]) => id);
    if (s.op.op === "add") {
      if (s.before.some(([, shape]) => shape === s.shape)) seen.add("add same shape twice");
      return;
    }
    if (s.op.op === "read") return;
    for (const id of s.ids) {
      const at = present.indexOf(id);
      seen.add(at >= 0 ? "remove present" : s.returned.has(id) ? "remove removed" : "remove unknown");
      if (present.length >= 3 && at === present.length - 1) seen.add("remove the top shape");
      if (present.length >= 3 && at === 0) seen.add("remove the bottom shape");
      if (at > 0 && at < present.length - 1) seen.add("remove a middle shape");
    }
    if (s.op.op === "removeMultiple" && s.ids.length !== new Set(s.ids).size) seen.add("batch lists an ID twice");
    if (s.op.op === "removeMultiple" && present.length >= 20 && (s.result as number) * 2 >= present.length) {
      seen.add("batch removes half of many");
    }
    if (present.length > 0 && s.collection.size === 0) seen.add("emptied");
  });
  return seen;
}

export function shapeCollectionContract(make: () => ShapeCollection): void {
  /** Checks a rule after every step of every sequence. */
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      for (const ops of [sequence, drain]) {
        fc.assert(fc.property(ops, (opList) => {
          run(make, opList, (s) => assert.ok(check(s), id));
        }));
      }
    });

  describe("ShapeCollection", () => {
    rule("ShapeCollection.observers-read-only",
      (s) => s.op.op !== "read" || deepEqual(entries(s.collection), s.before));

    rule("ShapeCollection.size", (s) => s.collection.size === ids(s.collection).length);

    rule("ShapeCollection.z-order",
      (s) => isStrictlySorted(ids(s.collection), (a, b) => s.collection.compareZ(a, b)));

    rule("ShapeCollection.get-agrees", (s) => {
      const c = s.collection;
      const present = ids(c);
      return entries(c).every(([i, shape]) => c.get(i) === shape) &&
        [...s.returned, ...s.ids, s.unknown].every((id) => c.get(id) === undefined || present.includes(id));
    });

    rule("ShapeCollection.add.gettable", (s) => s.op.op !== "add" || s.collection.get(s.ids[0]) === s.shape);

    rule("ShapeCollection.add.on-top", (s) =>
      s.op.op !== "add" ||
      ids(s.collection).every((other) => other === s.ids[0] || s.collection.compareZ(s.ids[0], other) > 0));

    rule("ShapeCollection.add.fresh-id", (s) => s.op.op !== "add" || !s.returned.has(s.ids[0]));

    rule("ShapeCollection.add.others-kept", (s) =>
      s.op.op !== "add" || deepEqual(entries(s.collection).filter(([i]) => i !== s.ids[0]), s.before));

    rule("ShapeCollection.remove.result", (s) => s.op.op !== "remove" || s.result === (s.getBefore !== undefined));

    rule("ShapeCollection.remove.gone", (s) => s.op.op !== "remove" || s.collection.get(s.ids[0]) === undefined);

    rule("ShapeCollection.remove.others-kept", (s) =>
      s.op.op !== "remove" || deepEqual(entries(s.collection), s.before.filter(([i]) => i !== s.ids[0])));

    rule("ShapeCollection.removeMultiple.count",
      (s) => s.op.op !== "removeMultiple" || s.result === s.before.length - s.collection.size);

    rule("ShapeCollection.removeMultiple.gone",
      (s) => s.op.op !== "removeMultiple" || s.ids.every((id) => s.collection.get(id) === undefined));

    test("ShapeCollection.removeMultiple.same-as-remove", () => {
      // Two collections get the same shapes; one removes with removeMultiple
      // and the other with remove() in a shuffled order. They must end with
      // the same shapes in the same order, under the IDs add returned.
      fc.assert(fc.property(
        fc.array(shape, { minLength: 1, maxLength: 20 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        fc.boolean(),
        (shapes, picks, reverse) => {
          const a = make();
          const b = make();
          const idsA = shapes.map((s) => a.add(s));
          const idsB = shapes.map((s) => b.add(s));
          // Index shapes.length stands for an ID neither collection returned.
          const listed = picks.map((n) => n % (shapes.length + 1));
          const idOf = (ids: ShapeId[], i: number) => (i < ids.length ? ids[i] : unknownId(new Set(ids)));
          const removedA = a.removeMultiple(listed.map((i) => idOf(idsA, i)));
          const order = reverse ? [...listed].reverse() : listed;
          let removedB = 0;
          for (const i of order) if (b.remove(idOf(idsB, i))) removedB++;
          assert.equal(removedA, removedB, "same number removed");
          assert.deepEqual(entries(a).map(([, s]) => s), entries(b).map(([, s]) => s), "same shapes, same order");
          // Each collection keeps the IDs it returned for the shapes it kept.
          const kept = (c: ShapeCollection, ids: ShapeId[]) =>
            entries(c).every(([id, s]) => ids.some((i, k) => i === id && shapes[k] === s));
          assert.ok(kept(a, idsA) && kept(b, idsB), "same IDs");
        }));
    });

    const pairsRule = (id: string, check: (c: ShapeCollection, a: ShapeId, b: ShapeId) => boolean) =>
      rule(id, (s) => {
        const present = ids(s.collection);
        return present.every((a) => present.every((b) => check(s.collection, a, b)));
      });

    pairsRule("ShapeCollection.compareZ.zero-iff-same", (c, a, b) => (c.compareZ(a, b) === 0) === (a === b));

    pairsRule("ShapeCollection.compareZ.antisymmetric",
      (c, a, b) => Math.sign(c.compareZ(a, b)) === -Math.sign(c.compareZ(b, a)));

    test("ShapeCollection input coverage", () => {
      const labels = (opList: Op[]) => labelsOf(make, opList);
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("sequence", sequence, labels, {
        "remove present": 0.4, "remove removed": 0.3, "remove unknown": 0.4, "batch lists an ID twice": 0.35,
        "remove the top shape": 0.2, "remove the bottom shape": 0.25, "remove a middle shape": 0.3,
        "add same shape twice": 0.4, "emptied": 0.2,
      });
      coverage("drain", drain, labels, {
        "batch removes half of many": 0.15, "batch lists an ID twice": 0.45,
        "remove the top shape": 0.2, "remove the bottom shape": 0.15,
      });
    });
  });
}
