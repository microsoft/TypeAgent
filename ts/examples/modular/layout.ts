/**
 * Layout and event distribution: where things are in a window, and which of
 * them gets each of a platform's positional events.
 *
 * The platform defines its events: their names and their structures, as an
 * event map such as the DOM's HTMLElementEventMap. Nothing here restates
 * them. A distributor passes each event, unchanged, to the listeners on the
 * innermost layout object it falls in, among those registered for that
 * event's name.
 *
 * A distributor is itself a layout object, and its distribute has a
 * listener's signature, so it can be registered with another distributor
 * and redistribute to the listeners within it:
 *   parent.on("click", child.distribute, child)
 * The platform calls the root distributor's distribute.
 *
 * Coordinates. Every region, and every point locate returns, is in the
 * window's coordinates (geometry.ts), however deeply distributors nest.
 *
 * No capture. An event goes to the listener at its point, even during a
 * press that began elsewhere.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Point, Rectangle } from "./geometry.ts";

/** Something placed in a region of a window. */
export interface LayoutObject {
  /**
   * Where it is, in the window's coordinates. Whoever places it may change
   * it; a distributor reads it at each event.
   */
  region: Rectangle;
}

/** Gets one of a platform's events: its name, and the platform's event object. */
export type Listener<M, E extends keyof M> = (eventName: E, event: M[E]) => void;

/**
 * Passes a platform's positional events to listeners by where they fall.
 * M is the platform's event map, limited to the positional events it
 * distributes.
 *
 * A registration is an event name, a listener and a target. Registrations
 * belong to one distributor; a nested distributor has its own. Delivering
 * to a target means calling each listener registered for the event's name
 * on it, once per registration, in registration order, with the event's
 * name and event unchanged, before returning.
 *
 * The requirements hold whenever distribute is called, since regions may
 * change between calls.
 *
 * @requires within  Each registered target's region lies within this distributor's region.
 * @requires nested-or-disjoint  For each event name, the regions of two different targets registered for it are disjoint, or one lies strictly within the other.
 * @ensures live-regions  distribute uses each target's region as it is when it is called.
 * @ensures snapshot  distribute calls the registrations that existed when it started: one added during the call isn't called by it, and one removed during it still is.
 */
export interface EventDistributor<M> extends LayoutObject {
  /** Where event happened, in the window's coordinates. */
  locate(event: M[keyof M]): Point;

  /**
   * Registers listener for eventName on target.
   *
   * @ensures registers  Adds one registration, even if the same one exists already.
   */
  on<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void;

  /**
   * Removes the most recent registration of listener for eventName on
   * target; does nothing if there is none.
   *
   * @ensures removes-one  Removes exactly one registration, the most recent with the same event name, listener and target, when there is one, and nothing otherwise.
   */
  off<E extends keyof M & string>(eventName: E, listener: Listener<M, E>, target: LayoutObject): void;

  /**
   * Passes event to the innermost target, among those registered for
   * eventName other than except, that contains it. Targets registered only
   * for other event names don't affect which. Returns whether a target
   * took the event, so that a nested distributor's listener can pass a miss
   * back to its parent, with itself as except.
   *
   * @ensures innermost  Delivers to the innermost target registered for eventName, other than except, whose region contains locate(event), and to no other target.
   * @ensures only-enclosed  When no such target exists, calls no listener.
   * @ensures reports  Returns true when it delivered to a target, and false otherwise.
   * @ensures detached  Behaves the same when called as a plain function, as a listener is, rather than as a method of the distributor.
   */
  distribute<E extends keyof M & string>(eventName: E, event: M[E], except?: LayoutObject): boolean;
}
