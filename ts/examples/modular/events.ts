/**
 * Events: how producers report changes. EventEmitter is a subset of Node's
 * EventEmitter (on and off), with Node's behavior.
 *
 * Only the producer emits, so emit is not part of the interface. "Emits e"
 * in a rule means the producer calls e's listeners as the rules here say.
 * A listener that throws is outside the rules.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

/** Each event's name, mapped to the arguments its listeners get. */
export type EventMap = Record<string, unknown[]>;

/**
 * Something that emits events. Each call to on adds one registration of a
 * listener for one event, even if that listener is already registered.
 *
 * @ensures order  An emit calls its listeners in the order they were registered.
 * @ensures snapshot  An emit calls the listeners registered when it started: a listener added during the emit isn't called by it, and one removed during it still is.
 */
export interface EventEmitter<Events extends EventMap> {
  /**
   * Registers listener for event. Returns this.
   *
   * @ensures notified  Each emit of the event calls the listener once for each of its registrations, synchronously, before the emit returns.
   */
  on<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this;

  /**
   * Removes the most recent registration of listener for event; does
   * nothing if it has none. Returns this.
   *
   * @ensures removes-one  Removes exactly one registration, the most recent, when there is one, and nothing otherwise.
   */
  off<E extends keyof Events & string>(event: E, listener: (...args: Events[E]) => void): this;
}
