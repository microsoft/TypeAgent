// The reference EventDistributor (layout.ts): a list of registrations,
// searched on each event. helpers.check.ts runs the EventDistributor
// contract against it.

import type { Point, Rectangle } from "./geometry.ts";
import type { EventDistributor, LayoutObject, Listener } from "./layout.ts";
import { rectContains, within } from "./geometry.vocab.ts";

interface Registration<M> {
  eventName: keyof M;
  listener: Listener<M, keyof M>;
  target: LayoutObject;
}

export class RefDistributor<M> implements EventDistributor<M> {
  region: Rectangle;
  readonly locate: (event: M[keyof M]) => Point;
  private registrations: Registration<M>[] = [];

  constructor(region: Rectangle, locate: (event: M[keyof M]) => Point) {
    this.region = region;
    this.locate = locate;
  }

  on<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void {
    this.registrations.push({ eventName, listener: listener as Listener<M, keyof M>, target });
  }

  off<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void {
    for (let i = this.registrations.length - 1; i >= 0; i--) {
      const r = this.registrations[i];
      if (r.eventName === eventName && r.listener === (listener as Listener<M, keyof M>) && r.target === target) {
        this.registrations.splice(i, 1);
        return;
      }
    }
  }

  // An arrow function, so that it works detached, as a listener.
  distribute = <E extends keyof M & string>(eventName: E, event: M[E], except?: LayoutObject): boolean => {
    const p = this.locate(event);
    // A copy, so that registrations changed by listeners don't affect this call.
    const mine = this.registrations.filter((r) => r.eventName === eventName);
    const containing = [...new Set(mine.map((r) => r.target))].filter((t) => t !== except && rectContains(t.region, p));
    const inner = containing.find((t) => containing.every((u) => within(t.region, u.region)));
    if (inner === undefined) return false;
    for (const r of mine) if (r.target === inner) r.listener(eventName, event);
    return true;
  };
}
