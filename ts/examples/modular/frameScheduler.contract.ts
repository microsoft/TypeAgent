// Contract tests for FrameScheduler (window.ts). Every implementation runs
// this suite through a fixture that runs one display frame on demand: a test
// clock for a platform scheduler, or runFrame for ManualScheduler
// (viewkit.ts). Test names are rule IDs.
//
// Each run makes three handlers, then applies a random sequence of requests
// and frames. Some handlers request again from inside frame(), as an
// animation does. A model of the pending set says which handlers each frame
// must call.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { FrameHandler, FrameScheduler } from "./window.ts";
import { deepEqual } from "./rules.ts";

/** A scheduler, and a way to run its next display frame. */
export interface FrameSchedulerFixture {
  scheduler: FrameScheduler;
  runFrame(): void;
}

type Op = { op: "request"; handler: number } | { op: "frame" };

const handlers = 3;
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.nat({ max: handlers - 1 }).map((handler): Op => ({ op: "request", handler })) },
  { weight: 2, arbitrary: fc.constant<Op>({ op: "frame" }) },
);
type Run = { animating: boolean[]; ops: Op[] };
const runArb: fc.Arbitrary<Run> = fc.record({
  // Which handlers request again from inside their frame().
  animating: fc.array(fc.boolean(), { minLength: handlers, maxLength: handlers }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 20 }),
});

/** What one step did, and what the model says it should have done. */
interface Step {
  op: Op;
  /** Calls to frame() made while requestFrame was running. */
  callsDuringRequest: number;
  /** For a frame step: how many times each handler's frame() ran, and which handlers the model expects. */
  calls: number[];
  expected: number[];
}

function run(make: () => FrameSchedulerFixture, { animating, ops }: Run, check: (s: Step) => void): void {
  const { scheduler, runFrame } = make();
  let calls = new Array<number>(handlers).fill(0);
  let pending = new Set<number>();
  const hs: FrameHandler[] = Array.from({ length: handlers }, (_, i) => ({
    frame() {
      calls[i]++;
      if (animating[i]) scheduler.requestFrame(hs[i]);
    },
  }));
  for (const op of ops) {
    calls = new Array<number>(handlers).fill(0);
    if (op.op === "request") {
      scheduler.requestFrame(hs[op.handler]);
      pending.add(op.handler);
      check({ op, callsDuringRequest: calls.reduce((a, b) => a + b, 0), calls, expected: [] });
    } else {
      const due = [...pending].sort();
      pending = new Set(due.filter((i) => animating[i]));
      runFrame();
      check({ op, callsDuringRequest: 0, calls, expected: due });
    }
  }
}

export function frameSchedulerContract(make: () => FrameSchedulerFixture): void {
  const rule = (id: string, check: (s: Step) => boolean) =>
    test(id, () => {
      fc.assert(fc.property(runArb, (r) => {
        run(make, r, (s) => assert.ok(check(s), id));
      }));
    });

  describe("FrameScheduler", () => {
    rule("FrameScheduler.requestFrame.not-synchronous", (s) => s.op.op !== "request" || s.callsDuringRequest === 0);

    rule("FrameScheduler.requestFrame.merged", (s) => s.op.op !== "frame" || s.calls.every((n) => n <= 1));

    // Each handler pending when the frame started runs once, and no other: a
    // request made inside frame() waits for the next frame, even the
    // handler's own.
    rule("FrameScheduler.requestFrame.next-frame", (s) => s.op.op !== "frame" ||
      deepEqual(s.calls, s.calls.map((_, i) => (s.expected.includes(i) ? 1 : 0))));
  });
}
