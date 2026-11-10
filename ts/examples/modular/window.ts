/**
 * Interfaces for a window's input and frames. A window gets input events
 * and display frames from its platform, and both are per window: each window
 * is on one display, and so has that display's refresh. Views, which are
 * drawn in a window's frames, are in view.ts. Rules follow the format
 * described in rules.ts.
 *
 * Timing: each input event updates the model completely before its handler
 * returns, in a small fraction of a frame. Nothing is left pending, so code
 * such as autosave or export can read the model at any time. Views draw only
 * in frames, and request a frame only when something they show changes: a
 * layer, or their own viewport. When nothing changes, no frame work runs.
 *
 * Changes are reported as events (events.ts). Producers don't know who
 * listens.
 *
 * Raw input events and their routing are left to each platform. Events
 * such as PointerEvent, UITouch and MotionEvent differ in ways that matter
 * (coalesced and predicted samples, tilt, hover), so there is no shared
 * raw event type. Gestures that every platform recognizes are shared: the
 * platform recognizes them from its own events and reports them through a
 * source such as TapSource below, and a view passes them on in canonical
 * coordinates.
 *
 * @ensures complete  Each input event updates the model completely before its handler returns, so nothing is left pending and no frame shows part of an action: running the frames afterward changes neither the model nor the controls presented.
 * @budget fraction-of-frame  A pen move or an eraser move updates the model in under 5% of a 120 Hz frame (about 0.42 ms), with 10,000 strokes in the document.
 * @module
 */

import type { Point } from "./geometry.ts";
import type { Emitter } from "./events.ts";

/** Something that does its work during a display frame. */
export interface FrameHandler {
  /** timeMs is the frame's timestamp in milliseconds, on the window's monotonic clock. */
  frame(timeMs: number): void;
}

/**
 * Calls handlers before the window's next display refresh. Implemented with
 * requestAnimationFrame on the web, CADisplayLink on iOS and Choreographer
 * on Android. Each window has its own.
 */
export interface FrameScheduler {
  /**
   * Asks for one call to handler.frame() before the next display refresh.
   * Repeated requests with the same handler before that frame result in a
   * single call. Never calls frame() synchronously. Different handlers are
   * called in no particular order. A request made during a frame, including
   * from inside handler.frame(), asks for the following frame, as
   * requestAnimationFrame does; that is how an animation keeps running.
   *
   * @ensures merged  Repeated requests with the same handler before a frame call its frame() once in that frame.
   * @ensures not-synchronous  Never calls frame() before requestFrame returns.
   * @ensures next-frame  A request made during a frame calls frame() in the following frame, not the current one.
   */
  requestFrame(handler: FrameHandler): void;
}

/**
 * Taps on one surface, as its platform recognizes them: a press and release
 * close together in place and time, by mouse, pen or touch. Recognizing a
 * tap from the platform's own events is the platform's job; a tap carries
 * only where it happened, in the surface's coordinates: layout units, with
 * (0, 0) at its top left.
 */
export interface TapSource extends Emitter<{ tap: [Point] }> {}
