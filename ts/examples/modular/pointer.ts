/**
 * Mouse input, routed to nested regions of a window. A region is a
 * rectangle of the window that a component subscribes to with on and off,
 * the same Emitter (events.ts) every other producer uses. Components get a
 * region from their parent, carve child regions for their own parts with
 * the layout operations (RectangleOps in geometry.ts), and never see
 * outside their own: every event's point is in the receiving region's
 * region-local coordinates (geometry.ts).
 *
 * Routing decides only which region emits an event; what happens next is
 * the Emitter's rules. A press or a move goes to the innermost region at
 * the point that has a listener for it, and to no other: there is no
 * bubbling. A press captures: the region that got it gets every event until
 * the release, wherever the pointer goes.
 *
 * The platform feeds the root region the primary button's presses and
 * releases and every move, in window coordinates. Keyboard input, focus,
 * other buttons, touch, and compound gestures such as drag and drop are not
 * covered yet.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Emitter } from "./events.ts";
import type { TapSource } from "./window.ts";

/** One mouse event, as a region receives it. */
export interface PointerEvent {
  /** Where the pointer is, in the receiving region's own coordinates: (0, 0) is its top left. */
  readonly point: Point;
  /** On the window's monotonic clock, in milliseconds. */
  readonly timeMs: number;
}

/** The events a region emits: the primary button's press and release, and moves. */
export type PointerEvents = { down: [PointerEvent]; move: [PointerEvent]; up: [PointerEvent] };

export type PointerKind = keyof PointerEvents;

/**
 * A rectangle of the window that components subscribe to. Its bounds are
 * in its parent's region-local coordinates, or in window coordinates for
 * the root. Regions nest: a child lies inside its parent, and siblings
 * don't overlap, so every point of the window lies in one path of regions
 * from the root.
 */
export interface Region extends Emitter<PointerEvents> {
  readonly bounds: Rectangle;

  /**
   * Makes a child region covering rect, in this region's coordinates.
   *
   * @requires inside  rect lies within this region: from (0, 0) to its width and height.
   *   within(rect, { x: 0, y: 0, width: this.bounds.width, height: this.bounds.height })
   * @requires disjoint  rect doesn't overlap any child this region already has.
   *   children(this).every((c) => !rectIntersects(c.bounds, rect))
   * @requires attached  This region hasn't been removed.
   * @ensures adds  Returns a new region with bounds equal to rect and no children or listeners.
   */
  add(rect: Rectangle): Region;

  /**
   * Detaches this region and every region under it, and frees its space in
   * its parent. Calling it again does nothing. Removing the root is outside
   * the rules.
   *
   * @ensures detaches  Afterward neither it nor any region under it emits anything, and its parent no longer counts it as a child.
   */
  remove(): void;
}

/**
 * The root of a window's regions. The platform delivers mouse events to it
 * in window coordinates; its bounds are the window, at (0, 0).
 *
 * A press is in progress from a delivered down to the next delivered up.
 * "Receives" means the region emits the event, with the point converted to
 * its own coordinates.
 *
 * @requires presses-alternate  The platform delivers down only when no press is in progress. An up may come with no press in progress, from a press that started outside the window.
 * @ensures innermost-listener  With no press in progress, a down, a move or an up at a point is received by the innermost region that contains the point and has a listener for that kind of event, and by no other region; when no region qualifies, by none.
 * @ensures capture  When a region receives a down, it captures the press: every move and up until the press ends is received by that region if it has a listener for that kind, wherever the point is, and by no other region.
 * @ensures released-capture  When the capturing region is removed during a press, the rest of the press's events are received by no region.
 * @ensures uncaptured  When no region receives a down, the rest of its press's events are received by no region.
 * @ensures local  A received event's point is the delivered point minus the receiving region's top left in window coordinates, and its time is the delivered time.
 */
export interface RootRegion extends Region {
  /** A mouse event at point, in window coordinates. */
  deliver(kind: PointerKind, point: Point, timeMs: number): void;
}

/**
 * Taps from a region's presses: a TapSource (window.ts) for a component
 * that needs only taps, such as a view. It is made with a region and a
 * slop, the distance in layout units a press may wander and still be a tap.
 *
 * @ensures taps  When its region receives a down and then the up that ends the press, and neither that up nor any move between is farther than the slop from the down, emits tap once with the down's point, before the up's emit returns.
 * @ensures only-taps  Emits nothing else.
 * @ensures one-listener  Until disposed, has exactly one listener on each of its region's down, move and up.
 */
export interface TapRecognizer extends TapSource {
  /**
   * Stops recognizing. Calling it again does nothing.
   *
   * @ensures detaches  Afterward, has no listeners on its region and emits nothing.
   */
  dispose(): void;
}
