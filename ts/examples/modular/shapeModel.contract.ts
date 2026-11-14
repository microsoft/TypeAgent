// Contract tests for the shape model (shapeModel.ts): ShapeCollectionWriter,
// with ShapeCollection's rules and the ShapeLocatorQueries rules it
// inherits, and ShapeMessageProcessor, which also runs the MessageProcessor
// suite (messageProcessor.contract.ts). Test names are rule IDs.
//
// The writer suite runs random adds (on top or below a present shape) and
// removes (with repeats and absent IDs) against a list kept by the test,
// and runs the EventEmitter suite (eventEmitter.contract.ts) on the
// writer's change event.
// The processor suite plays collaborations and checks, each time a client's
// process settles, its model against applied(p): the operations the client
// has applied (shapesAfter in shapeModel.vocab.ts gives the shapes they
// should leave).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import type { OperationContent } from "./dataModel.ts";
import type { ShapeCollection, ShapeCollectionWriter, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";
import {
  collectionMembers, onlyMembers, addOf, compareOrder, deepEqual, entries, ids, isAdd, isClear, isRemove, isStrictlySorted, knew, removedBy, sameSet, unique,
} from "./shapeModel.vocab.ts";
import { messageProcessorContract, play, ruleTest, steps, type Client, type Hooks, type ProcessorSubject, type Step } from "./messageProcessor.contract.ts";
import { eventEmitterContract } from "./eventEmitter.contract.ts";
import { coverage, TestBox, TestTriangle } from "./testkit.ts";
import { checkInvariants, observe, type ObserveOptions } from "./ruleCheck.ts";

type Check = (rule: string, ok: boolean, detail?: string) => void;

// Queries over the test shapes (below): boxes 2 x 2 at (i, i) for i from 0
// to 3, and a triangle in the box from (3, 3) to (6, 6). The point (5.5,
// 5.5) and the rectangle at (4.5, 4.5) are in the triangle's bounding box
// but not in the triangle.
const queryRects: readonly Rectangle[] = [
  { x: 0, y: 0, width: 6, height: 6 }, { x: 1.5, y: 0, width: 1, height: 2 }, { x: 4.5, y: 4.5, width: 1, height: 1 },
];
const queryPoints: readonly Point[] = [{ x: 1.5, y: 1.5 }, { x: 3.5, y: 3.5 }, { x: 5.5, y: 5.5 }];

/** Each collection's recent query out arrays, with copies, for no-retain. */
const filled = new WeakMap<ShapeCollection, [ShapeId[], ShapeId[]][]>();

/** The ShapeLocatorQueries rules, with indexed(c) the shapes in list. */
function checkQueries(c: ShapeCollection, list: readonly [ShapeId, Shape][], check: Check): void {
  const kept = filled.get(c) ?? [];
  filled.set(c, kept);
  check("ShapeLocatorQueries.no-retain", kept.every(([out, copy]) => deepEqual(out, copy)), "an earlier out array changed");
  const prefix = ["prefilled" as ShapeId];
  const one = (query: "inRect" | "atPoint", where: string, run: (out: ShapeId[]) => number, matches: (s: Shape) => boolean) => {
    const out = [...prefix];
    const n = run(out);
    const found = out.slice(prefix.length);
    const expected = list.filter(([, s]) => matches(s)).map(([id]) => id);
    check(`ShapeLocatorQueries.${query}.exact`, sameSet(found, expected), `${query} ${where} found ${found.join(", ")}`);
    check(`ShapeLocatorQueries.${query}.once`, unique(found), `${query} ${where} found ${found.join(", ")}`);
    check(`ShapeLocatorQueries.${query}.append`, out[0] === prefix[0], `${query} ${where} changed out[0]`);
    check(`ShapeLocatorQueries.${query}.count`, n === found.length, `${query} ${where} returned ${n}, appended ${found.length}`);
    kept.push([out, [...out]]);
  };
  for (const r of queryRects) one("inRect", JSON.stringify(r), (out) => c.inRect(r, out), (s) => s.intersects(r));
  for (const p of queryPoints) one("atPoint", JSON.stringify(p), (out) => c.atPoint(p, out), (s) => s.contains(p));
  kept.splice(0, Math.max(0, kept.length - 24));
}

/**
 * ShapeCollection's rules, checked on c as it is now: its invariants
 * (compiled), and its members called through the observing proxy c, so
 * that read-only, zero-iff-same and antisymmetric (compiled) are checked
 * on each call. The ShapeLocatorQueries rules are checked here by hand,
 * until shape.ts's rules are compiled.
 */
function checkCollection(c: ShapeCollection, raw: ShapeCollection, options: ObserveOptions, check: Check): void {
  const list = entries(raw);
  const events: string[] = [];
  const count = () => events.push("change");
  raw.on("change", count);
  checkInvariants(raw, options);
  checkQueries(c, list, check);
  // Every pair while the collection is small; past that, neighbors, and
  // each shape with the bottom and the top, to keep long runs fast.
  const all = list.map(([id]) => id);
  const pairs: [ShapeId, ShapeId][] = all.length <= 30
    ? all.flatMap((a) => all.map((b): [ShapeId, ShapeId] => [a, b]))
    : all.flatMap((a, i): [ShapeId, ShapeId][] => [[a, a], [a, all[0]], [a, all[all.length - 1]], ...(i > 0 ? [[all[i - 1], a] as [ShapeId, ShapeId]] : [])]);
  for (const [a, b] of pairs) c.compareZ(a, b);
  raw.off("change", count);
  check("ShapeLocatorQueries.read-only", deepEqual(entries(raw), list) && events.length === 0);
}

/** How the contracts observe a collection: its change events, and get-agrees checked on probes and an absent ID. */
function collectionOptions(as: string, check: Check, probes: () => readonly ShapeId[]): ObserveOptions {
  return {
    as,
    violation: (rule, detail) => check(rule, false, detail),
    events: { "": ["change"] },
    samples: (id) => (id === "ShapeCollection.get-agrees" ? [...probes(), "absent" as ShapeId].map((p) => [p]) : []),
  };
}

// ---- The writer ------------------------------------------------------------

type WriterOp =
  | { readonly op: "add"; readonly below: number | undefined; readonly shape: number }
  | { readonly op: "remove"; readonly ids: readonly number[] }
  | { readonly op: "burst"; readonly at: number; readonly n: number; readonly newest: boolean };

// A burst is many adds in a row, each directly below the same shape, or
// below the one just added: what a client sees when remote adds keep
// arriving under one pending local add. It exhausts order keys that halve
// a gap. About a quarter of sequences have one.
const writerOps: fc.Arbitrary<WriterOp[]> = fc.array(fc.oneof(
  { weight: 30, arbitrary: fc.record({ op: fc.constant("add" as const), below: fc.option(fc.nat(20), { nil: undefined }), shape: fc.nat(4) }) },
  { weight: 20, arbitrary: fc.record({ op: fc.constant("remove" as const), ids: fc.array(fc.nat(20), { maxLength: 4 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("burst" as const), at: fc.nat(20), n: fc.integer({ min: 64, max: 100 }), newest: fc.boolean() }) },
), { minLength: 5, maxLength: 25 });

const testShapes: Shape[] = [
  ...[0, 1, 2, 3].map((i) => new TestBox({ x: i, y: i, width: 2, height: 2 })),
  new TestTriangle({ x: 3, y: 3, width: 3, height: 3 }),
];

/** The ShapeLocatorQueries rules, which ShapeCollection inherits. */
const queryRules = [
  ...["inRect", "atPoint"].flatMap((q) => ["exact", "once", "append", "count"].map((slug) => `ShapeLocatorQueries.${q}.${slug}`)),
  "ShapeLocatorQueries.no-retain", "ShapeLocatorQueries.read-only",
];

/**
 * Plays ops on a writer through an observing proxy, so that the compiled
 * rules are checked on each call, and checks the collection after each op.
 * IDs are w0, w1, … in order of adding; below and removes pick among those.
 */
function playWriter(make: () => ShapeCollectionWriter, ops: readonly WriterOp[], check: Check, checking = true): Set<string> {
  const labels = new Set<string>();
  const raw = make();
  const made: ShapeId[] = [];
  const options = collectionOptions("ShapeCollectionWriter", check, () => made);
  const w = checking ? observe(raw, options) : raw;
  // A query a listener makes during the change already agrees with the
  // shapes, by the queries' own rules.
  if (checking) w.on("change", () => checkQueries(w, entries(w), check));
  for (const o of ops) {
    const before = entries(raw);
    if (o.op === "burst") {
      const present = before.map(([i]) => i);
      let below = present.length === 0 ? undefined : present[o.at % present.length];
      labels.add(o.newest ? "burst below each new shape" : "burst below one shape");
      for (let k = 0; k < o.n; k++) {
        const id = `w${made.length}` as ShapeId;
        w.add(id, testShapes[k % testShapes.length], below);
        made.push(id);
        if (o.newest) below = id;
      }
    } else if (o.op === "add") {
      const id = `w${made.length}` as ShapeId;
      const present = before.map(([i]) => i);
      const below = o.below === undefined || present.length === 0 ? undefined : present[o.below % present.length];
      labels.add(below === undefined ? "add on top" : below === present[0] ? "add at the bottom" : "add in the middle");
      w.add(id, testShapes[o.shape], below);
      made.push(id);
    } else {
      const listed = o.ids.map((n) => (n < made.length ? made[n] : (`absent${n}` as ShapeId)));
      if (listed.some((id) => before.some(([i]) => i === id))) labels.add("remove present");
      if (listed.some((id) => !before.some(([i]) => i === id))) labels.add("remove absent");
      if (!unique(listed)) labels.add("remove lists an ID twice");
      w.remove(listed);
    }
    if (checking) checkCollection(w, raw, options, check);
  }
  return labels;
}

// Every writer rule test generates the same op lists with the same seed, so
// they share each play: the violations it found, by rule ID.
const writerPlays = new WeakMap<object, Map<string, Map<string, string[]>>>();

function writerViolations(make: () => ShapeCollectionWriter, ops: readonly WriterOp[]): Map<string, string[]> {
  let byOps = writerPlays.get(make);
  if (!byOps) writerPlays.set(make, (byOps = new Map()));
  const key = JSON.stringify(ops);
  let found = byOps.get(key);
  if (!found) {
    const violations = new Map<string, string[]>();
    playWriter(make, ops, (rule, ok, detail) => {
      if (!ok) violations.set(rule, [...(violations.get(rule) ?? []), detail ?? ""]);
    });
    byOps.set(key, (found = violations));
  }
  return found;
}

export function shapeCollectionWriterContract(make: () => ShapeCollectionWriter): void {
  describe("ShapeCollectionWriter", () => {
    for (const id of [
      "ShapeCollectionWriter.add.placed", "ShapeCollectionWriter.remove.removed", "ShapeCollectionWriter.notifies",
      "ShapeCollection.size", "ShapeCollection.z-order", "ShapeCollection.get-agrees", "ShapeCollection.read-only",
      "ShapeCollection.compareZ.zero-iff-same", "ShapeCollection.compareZ.antisymmetric", ...queryRules,
    ]) {
      test(id, () => {
        fc.assert(fc.property(writerOps, (ops) => {
          const failed = writerViolations(make, ops).get(id);
          assert.ok(!failed, `${id}: ${failed?.[0]}`);
        }));
      });
    }

    test("ShapeCollectionWriter input coverage", () => {
      coverage("writer ops", writerOps, (ops) => playWriter(make, ops, () => {}, false), {
        "add on top": 0.4, "add at the bottom": 0.2, "add in the middle": 0.2,
        "remove present": 0.3, "remove absent": 0.3, "remove lists an ID twice": 0.1,
        "burst below one shape": 0.05, "burst below each new shape": 0.05,
      });
    });
  });

  eventEmitterContract(() => {
    const w = make();
    let n = 0;
    return { emitter: w, change: () => w.add(`e${n++}` as ShapeId, testShapes[0]) };
  });
}

// ---- The processor ---------------------------------------------------------

/** Forms adds, removes of present (and sometimes absent) shapes, and clears. */
function form(p: ShapeMessageProcessor, pick: number): OperationContent<ShapeOp> {
  const kind = pick % 10;
  if (kind < 6) return { type: "add", id: p.newShapeId(), shape: testShapes[pick % testShapes.length] };
  if (kind < 9) {
    const present = ids(p.model);
    const listed = present.filter((_, i) => (pick >> i) % 3 === 0).slice(0, 3);
    return { type: "remove", ids: pick % 7 === 0 ? [...listed, "absent" as ShapeId] : listed };
  }
  return { type: "clear" };
}

// Fixed cases, as steps: pick 0 forms an add, 6 a remove of the first two
// present shapes, and 9 a clear (see form).
const add = { do: "form", client: 0, pick: 0 } as const;
const process0 = { do: "process", client: 0 } as const;
const cases: Record<string, readonly (readonly Step[])[]> = {
  // A remove of two shapes, and a clear of two, each applied alone.
  "ShapeMessageProcessor.one-change": [
    [add, add, process0, { do: "form", client: 0, pick: 6 }, process0],
    [add, add, process0, { do: "form", client: 0, pick: 9 }, process0],
  ],
  // A clear of the client's own pending adds, applied with and without them.
  "ShapeMessageProcessor.clear-known": [
    [add, process0, { do: "form", client: 0, pick: 9 }, process0],
    [add, add, { do: "form", client: 0, pick: 9 }, process0],
  ],
};

const subject = (make: (clientId: string) => ShapeMessageProcessor): ProcessorSubject<ShapeCollection, ShapeOp> => ({
  make,
  form: (p, pick) => form(p as ShapeMessageProcessor, pick),
  snapshot: (model) => entries(model),
  events: ["change"],
  as: "ShapeMessageProcessor",
  samples: (rule, processors) =>
    rule === "ShapeMessageProcessor.new-ids" ? processors.map((q) => [q])
    : rule === "ShapeMessageProcessor.read-facet" ? [[() => {}]]
    : [],
});

type SC = Client<ShapeCollection, ShapeOp>;

/** Each client's model, observed as a ShapeCollection; get-agrees is checked on the IDs of the adds it applied. */
const observedModels = new WeakMap<SC, { model: ShapeCollection; options: ObserveOptions }>();
function observedModel(c: SC, violation: (rule: string, detail: string) => void): { model: ShapeCollection; options: ObserveOptions } {
  let found = observedModels.get(c);
  if (!found) {
    const check: Check = (rule, ok, detail) => { if (!ok) violation(rule, `${c.id}: ${detail ?? ""}`); };
    const options = collectionOptions("ShapeCollection", check, () => c.applied.filter(isAdd).map((a) => a.id));
    found = { model: observe(c.p.model, options), options };
    observedModels.set(c, found);
  }
  return found;
}

/** The shape rules, checked each time a client's process settles. */
const hooks: Hooks<ShapeCollection, ShapeOp> = {
  // A query a listener makes during a change agrees with the shapes, by
  // the queries' own rules.
  event(c, violation) {
    const check: Check = (rule, ok, detail) => { if (!ok) violation(rule, `${c.id}: ${detail ?? ""}`); };
    const { model } = observedModel(c, violation);
    checkQueries(model, entries(c.p.model), check);
  },
  // read-facet, add-on-z, kept, remove-listed, clear-known, new-ids,
  // ack-keeps-z and one-change are compiled, and checked as each call
  // through c.p returns; here, the collection's own rules.
  processed(c, _newly, _before, _eventsBefore, violation) {
    const check: Check = (rule, ok, detail) => { if (!ok) violation(rule, `${c.id}: ${detail ?? ""}`); };
    const model = c.p.model;
    const observed = observedModel(c, violation);
    checkCollection(observed.model, model, observed.options, check);
  },
};

export function shapeMessageProcessorContract(make: (clientId: string) => ShapeMessageProcessor): void {
  const s = subject(make);
  messageProcessorContract(s, hooks);
  describe("ShapeMessageProcessor", () => {
    // Client IDs that a careless join of client ID and counter confuses.
    test("ShapeMessageProcessor.new-ids", () => {
      const found: string[] = [];
      const processors: ShapeMessageProcessor[] = [];
      const options: ObserveOptions = {
        as: "ShapeMessageProcessor", violation: (rule, detail) => found.push(`${rule}: ${detail}`),
        unobserved: ["model", "clientId", "logOperations"], samples: () => processors.map((q) => [q]),
      };
      for (const clientId of ["a", "a1", "a#1", "1", "", "a#", "#"]) {
        const raw = make(clientId);
        processors.push(raw);
        const p = observe(raw, options);
        for (let k = 0; k < 20; k++) p.newShapeId();
      }
      assert.deepEqual(found.slice(0, 3), []);
    });

    for (const id of [
      "ShapeMessageProcessor.new-ids", "ShapeMessageProcessor.read-facet", "ShapeMessageProcessor.add-on-z",
      "ShapeMessageProcessor.kept", "ShapeMessageProcessor.remove-listed", "ShapeMessageProcessor.clear-known",
      "ShapeMessageProcessor.ack-keeps-z", "ShapeMessageProcessor.one-change",
      "ShapeCollection.size", "ShapeCollection.z-order", "ShapeCollection.get-agrees", "ShapeCollection.read-only",
      "ShapeCollection.compareZ.zero-iff-same", "ShapeCollection.compareZ.antisymmetric", ...queryRules,
    ]) ruleTest(id, s, hooks, false, cases[id]);

    test("ShapeMessageProcessor input coverage", async () => {
      const runs = fc.sample(steps, 200);
      const counts = new Map<string, number>();
      for (const stepList of runs) {
        const labels = new Set<string>();
        await play(s, stepList, {
          processed(c, newly) {
            const now = ids(c.p.model);
            for (const op of newly) {
              if (isClear(op) && now.some((id) => !knew(op, addOf(c.applied, id)!))) labels.add("clear leaves a shape it didn't know");
              if (isClear(op) && op.clientId !== c.id && c.applied.some((a) => isAdd(a) && a.seq === -1)) labels.add("remote clear while local adds pending");
              if (isAdd(op) && op.clientId !== c.id && now.some((id) => addOf(c.applied, id)!.seq === -1)) labels.add("remote add below pending local adds");
              if (isRemove(op) && op.ids.some((id) => !now.includes(id))) labels.add("remove lists a shape not present");
            }
          },
        });
        for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      const share = (l: string) => (counts.get(l) ?? 0) / runs.length;
      if (process.env.COVERAGE) console.log("shape steps", Object.fromEntries([...counts.keys()].map((l) => [l, share(l).toFixed(2)])));
      // Minimums are about half the shares measured on seeds 1-3.
      const mins: Record<string, number> = {
        "clear leaves a shape it didn't know": 0.25, "remote clear while local adds pending": 0.05,
        "remote add below pending local adds": 0.2, "remove lists a shape not present": 0.2,
      };
      assert.deepEqual(Object.entries(mins).filter(([l, m]) => share(l) < m).map(([l]) => `${l}: ${share(l).toFixed(2)}`), []);
    });
  });
}
