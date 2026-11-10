// A FrameScheduler for adversaries: a scheduler stepped by hand, correct
// unless a bug is switched on. helpers.check.ts runs the FrameScheduler
// contract against it with no bug.

import type { FrameHandler, FrameScheduler } from "../frames.ts";
import type { FrameSchedulerFixture } from "../frameScheduler.contract.ts";

export type SchedulerBug =
  | "none"
  | "list-not-set"   // pending handlers are kept in a list, so a repeated request calls frame() twice
  | "synchronous"    // requestFrame calls frame() at once
  | "live-pending";  // a frame keeps running handlers until none is pending, so a request made during it runs in it

class TestScheduler implements FrameScheduler {
  private pending: FrameHandler[] = [];
  private time = 0;
  private calling = false;
  private readonly bug: SchedulerBug;

  constructor(bug: SchedulerBug) {
    this.bug = bug;
  }

  requestFrame(handler: FrameHandler): void {
    // Not from inside a synchronous call, so that an animating handler can't recurse forever.
    if (this.bug === "synchronous" && !this.calling) {
      this.calling = true;
      try {
        handler.frame(this.time);
      } finally {
        this.calling = false;
      }
      return;
    }
    if (this.bug === "list-not-set" || !this.pending.includes(handler)) this.pending.push(handler);
  }

  runFrame(): void {
    this.time += 1000 / 120;
    if (this.bug === "live-pending") {
      // Bounded, so that an animating handler can't loop forever.
      for (let n = 0; n < 100 && this.pending.length > 0; n++) this.pending.shift()!.frame(this.time);
      return;
    }
    const due = this.pending;
    this.pending = [];
    for (const h of due) h.frame(this.time);
  }
}

export function makeTestScheduler(bug: SchedulerBug = "none"): () => FrameSchedulerFixture {
  return () => {
    const scheduler = new TestScheduler(bug);
    return { scheduler, runFrame: () => scheduler.runFrame() };
  };
}
