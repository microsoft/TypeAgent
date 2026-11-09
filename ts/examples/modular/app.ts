/**
 * An app: the parts that make up a window, connected. The parts are made
 * first, each by its platform's code where it has one, and then connected,
 * so that how they talk to each other is the same on every platform.
 *
 * The chrome (chrome.ts) is the only part that changes the model. The
 * renderer (ui.ts) presents the chrome's controls and reports the user's
 * actions on them; the view (shapeView.ts) draws the scene and reports taps.
 * Connecting them is three listeners: renderer input goes to the chrome,
 * view taps go to the chrome, and chrome changes render the chrome's new
 * controls.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { ShapeView } from "./shapeView.ts";
import type { Renderer, Size } from "./ui.ts";
import type { Chrome } from "./chrome.ts";

/**
 * The parts an app connects, each already made, and the window's size.
 *
 * @invariant same-layer  The chrome's layer is one of the layers the view draws.
 *   this.view.scene.layers.includes(layer(this.chrome))
 * @invariant fits  The size is at least the chrome's minimum size.
 *   this.size.width >= minimumSize(options(this.chrome)).width && this.size.height >= minimumSize(options(this.chrome)).height
 */
export interface AppParts {
  readonly chrome: Chrome;
  readonly view: ShapeView;
  readonly renderer: Renderer;
  /** In layout units, fixed for the app's life. */
  readonly size: Size;
}

/**
 * Connected parts. An app is made by a function that takes AppParts and
 * owns them from then on.
 *
 * @ensures starts  When made, renders the chrome's controls for the size, and makes the view interactive.
 *   deepEqual(presented(parts(this).renderer), parts(this).chrome.present(parts(this).size)) && parts(this).view.interactive
 * @ensures renders  Each time the chrome emits change, renders its controls for the size once, before the chrome's emit returns.
 * @ensures forwards-input  Each input the renderer emits goes to the chrome's dispatch once, unchanged, before the renderer's emit returns.
 * @ensures forwards-taps  Each tap the view emits goes to the chrome's tap once, unchanged, before the view's emit returns.
 * @ensures one-listener  Until disposed, has exactly one listener on each of the chrome's change, the renderer's input and the view's tap.
 */
export interface App {
  /**
   * Ends the app: removes its listeners, then disposes the chrome, the view
   * and the renderer, in that order. Calling it again does nothing.
   *
   * @ensures detaches  Afterward, has no listeners on its parts, and each part has been disposed once.
   */
  dispose(): void;
}
