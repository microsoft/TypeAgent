/**
 * The controls around a drawing of circles: the model behind a toolbar for
 * drawing and erasing circles, and its presentation as a semantic tree
 * (ui.ts). It knows nothing of any platform: a renderer presents its tree,
 * and an app (app.ts) passes it the renderer's input and the view's taps.
 *
 * A chrome is made with a DrawingLayer to edit (shapeView.ts), its options,
 * and a function that makes circles (as makeCircle in circle.ts does). It
 * listens to the layer from then until it is disposed, so that its count
 * follows changes from any source. options(chrome) and layer(chrome)
 * (chrome.vocab.ts) are what it was made with.
 *
 * The controls, in a toolbar across the top of the window, left to right:
 *
 * | Key | Role | Label | Value and state |
 * |---|---|---|---|
 * | mode | radio-group | Mode | |
 * | mode.draw, mode.erase | radio | Draw, Erase | selected: the current mode |
 * | color | radio-group | Color | enabled in draw mode |
 * | color.0, color.1, ... | radio | each palette entry's label | selected: the current color; enabled in draw mode |
 * | radius | slider | Radius | the current radius, the options' min, max and step; enabled in draw mode |
 * | clear | button | Clear | enabled when the layer has an item |
 * | status | text | Status | "No circles", "1 circle", or "<n> circles" |
 *
 * Every other node is enabled. The tree's root is a group, key root, label
 * Circles, with two children: the toolbar (key toolbar, label Tools), and
 * below it a view-host (key view, label Drawing) for the view's surface.
 *
 * Layout, in layout units, carved from the window's rectangle with the
 * operations of RectangleOps (geometry.ts):
 * - root: the window. toolbar: a cut of 48 off its top; view: the rest.
 * - The toolbar's controls: the toolbar inset by 8, then cut off its left
 *   in order, with 8 cut off between them: mode, color, radius, clear,
 *   status.
 * - Widths: each radio-group 64 per radio, split evenly among its radios;
 *   radius 160; clear 72; status 112.
 *
 * controls(options, state, size) in chrome.vocab.ts is this description as
 * a function, and the rules use it.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { Emitter } from "./events.ts";
import type { SemanticNode, Size, UiEvent } from "./ui.ts";

export type Mode = "draw" | "erase";

/**
 * What a chrome offers. Options that break these rules are outside
 * the rules.
 *
 * @valid palette  At least one color, and labels that are distinct and not empty.
 *   this.palette.length > 0 && unique(this.palette.map((p) => p.label)) && this.palette.every((p) => p.label !== "")
 * @valid radius-range  0 < min <= initial <= max, step > 0, and max and initial are min plus whole numbers of steps.
 *   0 < this.radius.min && this.radius.min <= this.radius.initial && this.radius.initial <= this.radius.max &&
 *     this.radius.step > 0 && onStep(this.radius, this.radius.max) && onStep(this.radius, this.radius.initial)
 */
export interface ChromeOptions {
  /** The colors offered, in order, each with the label its radio shows. */
  readonly palette: readonly { readonly label: string; readonly color: Color }[];
  /** The radius slider's range and step, and the radius a chrome starts with. */
  readonly radius: { readonly min: number; readonly max: number; readonly step: number; readonly initial: number };
}

/** Everything the controls show. */
export interface ChromeState {
  readonly mode: Mode;
  /** The current color, as an index into the palette. */
  readonly color: number;
  readonly radius: number;
  /** The number of items in the layer. */
  readonly count: number;
}

/**
 * The model behind the controls.
 *
 * @ensures starts  A new chrome is in draw mode, with the first color, the initial radius, and the layer's size as its count.
 * @ensures one-listener  Until disposed, has exactly one change listener on its layer.
 * @ensures counts  After the layer changes, from any source, count is the layer's size before the layer's emit returns.
 *   this.state.count === layer(this).size
 * @ensures emits  Emits change once each time its state changes, after the state is updated, and never when it stays equal.
 */
export interface Chrome extends Emitter<{ change: [] }> {
  /**
   * The current state, as a value.
   *
   * @ensures snapshot  A state read earlier keeps its values when the chrome changes later.
   */
  readonly state: ChromeState;

  /**
   * Applies what the user did with a control, as a renderer reports it.
   *
   * @ensures mode  Activating mode.draw or mode.erase sets that mode.
   * @ensures color  Activating color.<i> sets color i.
   * @ensures radius  Setting radius to v sets the radius to v moved onto the slider's steps and range, as snapRadius says.
   *   implies(event.kind === "set-value" && event.key === "radius" && this.state.mode === "draw",
   *     this.state.radius === snapRadius(options(this).radius, event.value))
   * @ensures clear  Activating clear, when enabled, removes every item from the layer with one removeMultiple.
   * @ensures ignores  An event for a key that isn't a control, for a disabled control, or of the wrong kind for its control changes nothing and emits nothing.
   */
  dispatch(event: UiEvent): void;

  /**
   * A tap on the view at p, in canonical coordinates.
   *
   * @ensures draws  In draw mode, adds to the top of the layer a circle centered at p, with the current radius and color.
   * @ensures erases  In erase mode, removes the topmost item that contains p, if there is one, and otherwise changes nothing.
   */
  tap(p: Point): void;

  /**
   * The controls for the current state, laid out in a window of size.
   *
   * @requires fits  The window is at least minimumSize(options(this)).
   *   size.width >= minimumSize(options(this)).width && size.height >= minimumSize(options(this)).height
   * @ensures exact  Returns the tree the table above describes.
   *   deepEqual(result, controls(options(this), this.state, size))
   * @ensures pure  Changes nothing and emits nothing.
   */
  present(size: Size): SemanticNode;

  /**
   * Ends the chrome. Calling it again does nothing.
   *
   * @ensures detaches  Afterward, has no listener on its layer, and dispatch and tap change nothing and emit nothing.
   */
  dispose(): void;
}

/** Makes circles, as makeCircle in circle.ts does. */
export type MakeCircle = (fields: { center: Point; radius: number; color: Color }) => Circle;
