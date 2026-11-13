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
 * @deferred processed-before-frame  The message infrastructure processes what an input event's handler sent after the handler returns and before the next frame begins, never inside a frame callback, so that the first frame after the event shows it and frames.complete holds on every platform.
 *   when: the message infrastructure is specified.
 *   how: the infrastructure's contract drives a processor, a ManualScheduler and a view; after a handler sends, it runs one frame and checks that the frame shows the operation's effect, as driver.ts's driver does now; with an adversary that processes only on a timer.
 * @budget fraction-of-frame  Forming (including any query of the model), sending and processing the operations of one input event takes under 5% of a 120 Hz frame (about 0.42 ms), with 10,000 shapes in the model. bench.ts measures the circles app's taps: one that draws a circle, and one that erases the top circle at a point.
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
