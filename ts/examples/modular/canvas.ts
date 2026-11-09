/**
 * A platform subset: the part of the web canvas that canvas implementations
 * of view interfaces may use. It is not part of the blueprint. Its names
 * and signatures are the platform's, and so is its meaning, so it has no
 * rules of its own; a browser's context is the reference.
 *
 * Two checks keep it honest. platform/canvas.check.ts compiles with the DOM
 * library and fails unless the browser's context types fit DrawingContext.
 * The recording context in viewkit.ts gives implementations a view of
 * itself that throws on any other member, so an implementation that needs
 * more fails its tests; the fix is to add the member here and teach the
 * recording context what it does.
 *
 * Members are added when an implementation spec decides to use them, not
 * before.
 *
 * @module
 */

/**
 * The part of a CanvasRenderingContext2D that a canvas ShapeView draws with,
 * in the canvas's own pixels with no transform set. A browser's context has
 * all of it. Tests use a recording context that computes what each point of
 * the canvas shows.
 */
export interface DrawingContext {
  /** The size of the drawing surface, in pixels. */
  readonly canvas: { readonly width: number; readonly height: number };

  /**
   * The color of later fills. The browser's type also allows gradients and
   * patterns; object stands for them without the DOM library.
   */
  fillStyle: string | object;

  /** Makes every point in the rectangle transparent. */
  clearRect(x: number, y: number, width: number, height: number): void;

  /** Starts a new, empty path. */
  beginPath(): void;

  /** Adds an arc to the path. A full circle runs from angle 0 to 2 * Math.PI. */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;

  /** Fills the path with fillStyle, composited over what the canvas already shows. */
  fill(): void;
}
