/**
 * Display frames. Each window is on one display, has that display's
 * refresh, and has its own FrameScheduler.
 *
 * The two rules below bind whatever handles a platform's input events,
 * such as a controller given events by an EventDistributor (layout.ts).
 * There is no controller interface to hold them.
 *
 * Rules follow the format described in rules.ts.
 *
 * @ensures complete  Each input event's handler sends every operation of its action (LocalSend, dataModel.ts) before it returns, so no frame shows part of an action: once the message infrastructure has processed what was sent, running the frames and processing again don't change the model.
 * @budget fraction-of-frame  Sending and processing the operations of an eraser move, or of finishing a pen stroke, takes under 5% of a 120 Hz frame (about 0.42 ms), with 10,000 strokes in the model.
 * @module
 */

/** Something that does its work during a display frame. */
export interface FrameHandler {
  /** timeMs is the frame's timestamp in milliseconds, on the window's monotonic clock. */
  frame(timeMs: number): void;
}

/**
 * Calls handlers before the window's next display refresh. Implemented with
 * requestAnimationFrame on the web, CADisplayLink on iOS and Choreographer
 * on Android.
 */
export interface FrameScheduler {
  /**
   * Asks for one call to handler.frame() before the next display refresh.
   * Different handlers are called in no particular order.
   *
   * @ensures merged  Repeated requests with the same handler before a frame call its frame() once in that frame.
   * @ensures not-synchronous  Never calls frame() before requestFrame returns.
   * @ensures next-frame  A request made during a frame calls frame() in the following frame, not the current one.
   */
  requestFrame(handler: FrameHandler): void;
}
