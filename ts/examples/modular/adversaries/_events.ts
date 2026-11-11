// An EventEmitter for adversaries: Node's semantics unless a bug is switched
// on. helpers.check.ts runs the EventEmitter contract against it with no
// bug.

import type { EventEmitter } from "../events.ts";
import type { EmitterSubject } from "../eventEmitter.contract.ts";

export type EventsBug =
  | "none"
  | "on-dedupes"                 // a listener registered twice is called once
  | "first-listener-only"        // only the first registration is called
  | "off-ignored"                // off does nothing
  | "off-removes-all"            // off removes every registration of the listener
  | "off-removes-first"          // off removes the earliest registration rather than the most recent
  | "off-absent-removes-another" // off for a listener with no registration removes the most recent one of any listener
  | "emit-live-list"             // an emit walks the live list, so listeners added during it are called and removed ones aren't
  | "emit-newest-first";         // an emit calls the most recent registration first

export class TestEvents implements EventEmitter<{ change: [] }> {
  private listeners: (() => void)[] = [];
  private readonly bug: EventsBug;

  constructor(bug: EventsBug = "none") {
    this.bug = bug;
  }

  on(_: "change", listener: () => void): this {
    if (this.bug === "on-dedupes" && this.listeners.includes(listener)) return this;
    this.listeners.push(listener);
    return this;
  }

  off(_: "change", listener: () => void): this {
    if (this.bug === "off-ignored") return this;
    if (this.bug === "off-removes-all") {
      this.listeners = this.listeners.filter((l) => l !== listener);
      return this;
    }
    const i = this.bug === "off-removes-first" ? this.listeners.indexOf(listener) : this.listeners.lastIndexOf(listener);
    if (i >= 0) this.listeners.splice(i, 1);
    else if (this.bug === "off-absent-removes-another") this.listeners.pop();
    return this;
  }

  emit(): void {
    if (this.bug === "emit-live-list") {
      for (let i = 0; i < this.listeners.length; i++) this.listeners[i]();
      return;
    }
    const listeners = this.bug === "first-listener-only" ? this.listeners.slice(0, 1)
      : this.bug === "emit-newest-first" ? [...this.listeners].reverse() : [...this.listeners];
    for (const listener of listeners) listener();
  }
}

/** A TestEvents with the given bug, as the EventEmitter contract wants it. */
export function makeTestEvents(bug: EventsBug = "none"): () => EmitterSubject {
  return () => {
    const emitter = new TestEvents(bug);
    return { emitter, change: () => emitter.emit() };
  };
}
