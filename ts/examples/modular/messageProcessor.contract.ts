// Contract tests for MessageProcessor and OperationSource (dataModel.ts),
// with Operation's @valid rules checked on the operations a processor
// stamps. Each DDS runs this suite through a ProcessorSubject. Test names
// are rule IDs.
//
// A run plays a collaboration: three clients form operations from their
// own models, a sequencer assigns seqs to their outgoing operations, one
// client's at a time and each client's in order, and delivers each to every
// client's remote queue (to its own client, as the acknowledgment) and to
// an observer that forms nothing. Each client's process is called at random
// moments, so local and remote operations interleave differently on each.
// At the end everything is sequenced and every client processes. The
// harness is the message processing infrastructure: process runs only when
// a step calls it.
//
// The harness records what each client has applied (applied(p) in
// dataModel.vocab.ts) and every rule violation it sees, by rule ID. A DDS's
// contract adds its own checks through Hooks.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { DataModelReader, MessageProcessor, Operation, OperationContent } from "./dataModel.ts";
import { deepEqual } from "./dataModel.vocab.ts";
import { coverage } from "./testkit.ts";

/** What a DDS gives the suite. */
export interface ProcessorSubject<TR extends DataModelReader, TOp extends Operation> {
  make(clientId: string): MessageProcessor<TR, TOp>;
  /** An operation formed from p's model as it is now; pick chooses among the possibilities. */
  form(p: MessageProcessor<TR, TOp>, pick: number): OperationContent<TOp>;
  /** Equal for two models exactly when the models are equal. */
  snapshot(model: TR): unknown;
  /** The names of the model's events. */
  readonly events: readonly string[];
}

export type Step =
  | { readonly do: "form"; readonly client: number; readonly pick: number }
  | { readonly do: "sequence"; readonly client: number }
  | { readonly do: "process"; readonly client: number };

const clientIds = ["A", "B", "C"];
const client = fc.nat({ max: clientIds.length - 1 });
export const steps: fc.Arbitrary<Step[]> = fc.array(fc.oneof(
  { weight: 3, arbitrary: fc.record({ do: fc.constant("form" as const), client, pick: fc.nat(999) }) },
  { weight: 3, arbitrary: fc.record({ do: fc.constant("sequence" as const), client }) },
  { weight: 2, arbitrary: fc.record({ do: fc.constant("process" as const), client }) },
), { minLength: 12, maxLength: 40 });

/** One client in a run, and what the harness knows of it. */
export interface Client<TR extends DataModelReader, TOp extends Operation> {
  readonly id: string;
  readonly p: MessageProcessor<TR, TOp>;
  /** applied(p): the operations p has applied, with seqs as p knows them. */
  readonly applied: TOp[];
  /** Local operations enqueued since the last process, as stamped. */
  readonly enqueued: TOp[];
  /** Remote operations delivered since the last process. */
  readonly delivered: TOp[];
  /** Copies of the stamped operations waiting for the sequencer, oldest first. */
  readonly outbox: TOp[];
  /** Each operation p emitted, with a copy taken when it was emitted. */
  readonly sent: [TOp, TOp][];
  /** The seq of the last remote operation applied, or -1. */
  lastApplied: number;
  lastClientSeq: number;
  events: number;
  outgoing: number;
  enqueuing: boolean;
}

/** Per-operation checks a DDS's contract adds. */
export interface Hooks<TR extends DataModelReader, TOp extends Operation> {
  /** Called after each process settles, with what it applied and the client's snapshot and event count before. */
  processed?(c: Client<TR, TOp>, newly: TOp[], before: unknown, eventsBefore: number, violation: Violation): void;
  /** Called on each model event during a process. */
  event?(c: Client<TR, TOp>, violation: Violation): void;
  /** Called after an operation is formed. */
  formed?(c: Client<TR, TOp>, content: OperationContent<TOp>, violation: Violation): void;
  /** Called after the run settles. */
  end?(clients: Client<TR, TOp>[], violation: Violation): void;
}

export type Violation = (rule: string, detail: string) => void;

/** A copy of an operation's fields, with arrays copied. */
export function copyOp<TOp extends Operation>(op: TOp): TOp {
  return Object.fromEntries(Object.entries(op).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])) as TOp;
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Plays steps, and returns the violations seen, by rule ID. */
export async function play<TR extends DataModelReader, TOp extends Operation>(
  subject: ProcessorSubject<TR, TOp>, stepList: readonly Step[], hooks: Hooks<TR, TOp> = {}, flush = false,
): Promise<Map<string, string[]>> {
  const violations = new Map<string, string[]>();
  const violation: Violation = (rule, detail) => violations.set(rule, [...(violations.get(rule) ?? []), detail]);
  const snap = (c: Client<TR, TOp>) => subject.snapshot(c.p.model);

  const newClient = (id: string): Client<TR, TOp> => {
    const c: Client<TR, TOp> = {
      id, p: subject.make(id), applied: [], enqueued: [], delivered: [], outbox: [], sent: [],
      lastApplied: -1, lastClientSeq: -Infinity, events: 0, outgoing: 0, enqueuing: false,
    };
    for (const e of subject.events) {
      c.p.model.on(e, () => {
        c.events++;
        hooks.event?.(c, violation);
      });
    }
    c.p.on("outgoing", (op: TOp) => {
      c.outgoing++;
      const copy = copyOp(op);
      c.sent.push([op, copy]);
      if (!c.enqueuing) violation("OperationSource.outgoing-once", `${id} emitted outgoing outside enqueue`);
      if (!(op.seq === -1 || (Number.isInteger(op.seq) && op.seq >= 0))) violation("Operation.seq-range", `seq ${op.seq}`);
      if (!(Number.isInteger(op.clientSeq) && op.clientSeq >= 0)) violation("Operation.client-seq-range", `clientSeq ${op.clientSeq}`);
      if (!((op.refSeq === -1 || (Number.isInteger(op.refSeq) && op.refSeq >= 0)) && (op.seq === -1 || op.refSeq < op.seq))) {
        violation("Operation.ref-seq-range", `refSeq ${op.refSeq}, seq ${op.seq}`);
      }
      if (op.clientId !== id || op.seq !== -1 || !(op.clientSeq > c.lastClientSeq) || op.refSeq !== c.lastApplied) {
        violation("MessageProcessor.stamps",
          `${id} stamped clientId ${op.clientId}, seq ${op.seq}, clientSeq ${op.clientSeq} after ${c.lastClientSeq}, refSeq ${op.refSeq} with ${c.lastApplied} applied`);
      }
      c.lastClientSeq = op.clientSeq;
      c.outbox.push(copyOp(copy));
      c.enqueued.push(copyOp(copy));
    });
    return c;
  };

  const clients = clientIds.map(newClient);
  const observer = newClient("O");
  const everyone = [...clients, observer];
  let nextSeq = 0;

  /** Runs a step that isn't process, checking that no model changes during it. */
  const quietly = async (what: string, action: () => void) => {
    const before = everyone.map((c) => [snap(c), c.events] as const);
    action();
    everyone.forEach((c, i) => {
      if (!deepEqual(snap(c), before[i][0]) || c.events !== before[i][1]) {
        violation("MessageProcessor.sole-writer", `${c.id}'s model changed during ${what}`);
        if (what === "enqueue") violation("MessageProcessor.enqueue-defers", `${c.id}'s model changed during enqueue`);
      }
    });
    if (flush) {
      const settled = everyone.map((c) => [snap(c), c.events] as const);
      await nextTurn();
      everyone.forEach((c, i) => {
        if (!deepEqual(snap(c), settled[i][0]) || c.events !== settled[i][1]) {
          violation("MessageProcessor.passive", `${c.id}'s model changed with no process call, after ${what}`);
        }
      });
    }
  };

  const form = async (c: Client<TR, TOp>, pick: number) => {
    const content = subject.form(c.p, pick);
    hooks.formed?.(c, content, violation);
    const outgoing = c.outgoing;
    await quietly("enqueue", () => {
      c.enqueuing = true;
      c.p.local.enqueue(content);
      c.enqueuing = false;
    });
    if (c.outgoing - outgoing !== 1) violation("OperationSource.outgoing-once", `${c.id} emitted outgoing ${c.outgoing - outgoing} times in one enqueue`);
  };

  const sequence = async (c: Client<TR, TOp>) => {
    const op = c.outbox.shift();
    if (!op) return;
    const seq = nextSeq++;
    await quietly("enqueue", () => {
      for (const d of everyone) {
        const delivered = { ...copyOp(op), seq };
        d.delivered.push(copyOp(delivered));
        d.p.remote.enqueue(delivered);
      }
    });
  };

  const processOn = async (c: Client<TR, TOp>) => {
    const before = snap(c);
    const eventsBefore = c.events;
    await c.p.process();
    const newly: TOp[] = [];
    for (const op of c.enqueued.splice(0)) {
      c.applied.push(op);
      newly.push(op);
    }
    for (const op of c.delivered.splice(0)) {
      c.lastApplied = op.seq;
      const own = op.clientId === c.id ? c.applied.find((a) => a.clientSeq === op.clientSeq && a.clientId === c.id) : undefined;
      if (own) own.seq = op.seq;
      else c.applied.push(op);
      newly.push(op);
    }
    hooks.processed?.(c, newly, before, eventsBefore, violation);
  };

  for (const step of stepList) {
    const c = clients[step.client];
    if (step.do === "form") await form(c, step.pick);
    else if (step.do === "sequence") await sequence(c);
    else await processOn(c);
  }
  while (clients.some((c) => c.outbox.length > 0)) {
    for (const c of clients) await sequence(c);
  }
  for (const c of everyone) await processOn(c);

  for (const c of clients) {
    if (!deepEqual(snap(c), snap(observer))) violation("MessageProcessor.converges", `${c.id}'s model differs from the observer's`);
  }
  for (const c of everyone) {
    for (const [op, copy] of c.sent) {
      if (!deepEqual(op, copy)) violation("OperationSource.outgoing-copy", `${c.id}'s emitted operation changed after it was emitted`);
    }
  }
  hooks.end?.(everyone, violation);
  return violations;
}

// Plays are deterministic, and every rule test with the same seed generates
// the same step lists, so the rule tests of one suite share each play.
const plays = new WeakMap<object, WeakMap<object, Map<string, Promise<Map<string, string[]>>>>>();
const noHooks = {};

function playOnce<TR extends DataModelReader, TOp extends Operation>(
  subject: ProcessorSubject<TR, TOp>, stepList: readonly Step[], hooks: Hooks<TR, TOp>, flush: boolean,
): Promise<Map<string, string[]>> {
  const bySubject = plays.get(subject) ?? new WeakMap();
  plays.set(subject, bySubject);
  const byHooks = bySubject.get(hooks) ?? new Map();
  bySubject.set(hooks, byHooks);
  const key = `${flush}:${JSON.stringify(stepList)}`;
  if (!byHooks.has(key)) byHooks.set(key, play(subject, stepList, hooks, flush));
  return byHooks.get(key)!;
}

/**
 * A test named id that plays the given cases, then random runs, and fails
 * on any violation of id.
 */
export function ruleTest<TR extends DataModelReader, TOp extends Operation>(
  id: string, subject: ProcessorSubject<TR, TOp>, hooks: Hooks<TR, TOp> = noHooks, flush = false,
  cases: readonly (readonly Step[])[] = [],
): void {
  test(id, async () => {
    for (const stepList of cases) {
      const found = (await playOnce(subject, stepList, hooks, flush)).get(id) ?? [];
      assert.deepEqual(found.slice(0, 3), [], `${id}, case ${JSON.stringify(stepList)}`);
    }
    await fc.assert(fc.asyncProperty(steps, async (stepList) => {
      const found = (await playOnce(subject, stepList, hooks, flush)).get(id) ?? [];
      assert.deepEqual(found.slice(0, 3), [], id);
    }), { numRuns: flush ? 40 : 100 });
  });
}

/**
 * Classes of runs, worked out from the steps alone: what each client has
 * waiting at the sequencer and in its queues.
 */
export function labelsOf(stepList: readonly Step[]): Set<string> {
  const labels = new Set<string>();
  const outbox = clientIds.map(() => [] as number[]);
  const unprocessedLocal = clientIds.map(() => new Set<number>());
  const unackedApplied = clientIds.map(() => new Set<number>());
  const delivered = clientIds.map(() => [] as { from: number; n: number }[]);
  let n = 0;
  for (const s of stepList) {
    if (s.do === "form") {
      outbox[s.client].push(n);
      unprocessedLocal[s.client].add(n++);
    } else if (s.do === "sequence") {
      const op = outbox[s.client].shift();
      if (op !== undefined) delivered.forEach((d) => d.push({ from: s.client, n: op }));
    } else {
      const c = s.client;
      for (const { from, n: op } of delivered[c]) {
        if (from !== c && unackedApplied[c].size > 0) labels.add("remote applied while local pending");
        if (from === c && unprocessedLocal[c].has(op)) labels.add("operation and its ack in one process");
        if (from === c && unackedApplied[c].has(op)) labels.add("ack after its operation was applied");
        if (from === c) unackedApplied[c].delete(op);
      }
      for (const op of unprocessedLocal[c]) {
        if (delivered[c].every((d) => d.from !== c || d.n !== op)) unackedApplied[c].add(op);
      }
      unprocessedLocal[c].clear();
      delivered[c] = [];
    }
  }
  if (outbox.some((o) => o.length > 0)) labels.add("left for the final sequencing");
  return labels;
}

export function messageProcessorContract<TR extends DataModelReader, TOp extends Operation>(
  subject: ProcessorSubject<TR, TOp>, hooks: Hooks<TR, TOp> = noHooks,
): void {
  describe("MessageProcessor", () => {
    for (const id of [
      "Operation.seq-range", "Operation.client-seq-range", "Operation.ref-seq-range",
      "OperationSource.outgoing-once", "OperationSource.outgoing-copy",
      "MessageProcessor.stamps", "MessageProcessor.sole-writer", "MessageProcessor.enqueue-defers",
      "MessageProcessor.converges",
    ]) ruleTest(id, subject, hooks);
    ruleTest("MessageProcessor.passive", subject, hooks, true);

    test("MessageProcessor input coverage", () => {
      // Minimums are about half the shares measured on seeds 1-3.
      coverage("steps", steps, labelsOf, {
        "remote applied while local pending": 0.15, "operation and its ack in one process": 0.2,
        "ack after its operation was applied": 0.15, "left for the final sequencing": 0.3,
      });
    });
  });
}
