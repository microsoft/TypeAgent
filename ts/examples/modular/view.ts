/**
 * Views: showing a data model's read side (dataModel.ts) in a window's
 * frames. A view for a particular model, such as ShapeView, draws that
 * model's items for its platform's surface. Nothing here depends on Shape.
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Viewport } from "./geometry.ts";
import type { EventEmitter } from "./events.ts";
import type { FrameHandler } from "./frames.ts";
import type { DataModelReader } from "./dataModel.ts";

/** A model a view can show: its read side, which emits change after each change. */
export type ViewModel = DataModelReader<{ change: [] }>;

/**
 * Shows one model through a viewport, and stays current.
 *
 * What the view shows is the model, plus state that is the view's alone,
 * such as a drag in progress or ink still being drawn. That state isn't in
 * the model, and no operation carries it; showing it to collaborators is
 * presence, which is deferred.
 *
 * A view takes no input.
 *
 * @ensures model-change  When the model emits change, requests a frame and draws nothing until frame().
 * @ensures idle  Requests no frame while nothing it shows changes.
 * @ensures one-listener  Until disposed, has exactly one listener registered on the model.
 * @ensures read-only  Reading model or viewport changes nothing: what it shows, its frame requests and its listeners stay as they were.
 */
export interface View<M extends ViewModel> extends FrameHandler, EventEmitter<{ viewport: [Viewport] }> {
  readonly model: M;

  /**
   * Setting this redraws the view at the next frame and emits viewport with
   * the new value. Setting a value equal to the current one does nothing.
   *
   * @deferred set-redraws  Setting a different viewport requests a frame, and that frame draws through the new viewport.
   *   when: a ShapeView supports viewports other than the identity.
   *   how: shapeView.contract.ts gains a step that sets a random viewport (scale 0.5 to 2, rotation a multiple of 90 degrees, whole-number translation, so mapping is exact) and checks that a frame is requested and that afterward each sample point p shows what the model shows at the viewport's inverse of p; with an adversary that draws through the old viewport.
   * @ensures set-equal  Setting a viewport equal to the current one, field by field, requests no frame and emits nothing.
   * @deferred set-emits  Setting a different viewport emits viewport with the new value before the setter returns.
   *   when: a ShapeView supports viewports other than the identity.
   *   how: the same step checks that each set of a different viewport emits viewport once, with a value equal to the one set, before the setter returns, and that viewport then reads as that value; with adversaries that emit before updating and that emit twice.
   */
  viewport: Viewport;

  /**
   * Ends the view: removes its listener from the model, and requests, draws
   * and emits nothing more. Calling it again does nothing.
   *
   * @ensures detaches  Afterward, the view has no listeners on the model, and model changes request no frame.
   * @ensures inert  Afterward, frame() draws nothing, including a frame requested before dispose.
   */
  dispose(): void;
}
