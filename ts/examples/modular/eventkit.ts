// An EventEmitter (events.ts) for references and doubles: Node's semantics, plus emit and
// a count of registrations, which the contracts' one-listener rules read.
// Checked through the references and doubles built on it: helpers.check.ts runs their
// contracts.

import type { EventEmitter, EventMap } from "./events.ts";

export class Events<M extends EventMap> implements EventEmitter<M> {
  private readonly lists = new Map<string, unknown[]>();

  on<E extends keyof M & string>(event: E, listener: (...args: M[E]) => void): this {
    this.lists.set(event, [...(this.lists.get(event) ?? []), listener as unknown]);
    return this;
  }

  off<E extends keyof M & string>(event: E, listener: (...args: M[E]) => void): this {
    const list = this.lists.get(event) ?? [];
    const i = list.lastIndexOf(listener as unknown);
    if (i >= 0) this.lists.set(event, list.filter((_, j) => j !== i));
    return this;
  }

  /** Calls the listeners registered when the emit starts, in order. */
  emit<E extends keyof M & string>(event: E, ...args: M[E]): void {
    for (const listener of this.lists.get(event) ?? []) (listener as (...a: M[E]) => void)(...args);
  }

  /** The number of registrations for event. */
  listenerCount(event: keyof M & string): number {
    return this.lists.get(event)?.length ?? 0;
  }
}
