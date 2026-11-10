/**
 * Interfaces for showing data: layers, the scene they make up, the views
 * that draw a scene in a window's frames (see window.ts for timing and
 * input), and exporters that draw it once into a document. None of them
 * depends on Shape: a layer presents any data model's items. Views and
 * exporters for a particular data model, which know how to draw its items,
 * extend these, as ShapeView does in shapeView.ts. Rules follow the format
 * described in rules.ts.
 *
 * @module
 */

import type { Point, Rectangle, Viewport } from "./geometry.ts";
import type { Emitter } from "./events.ts";
import type { FrameHandler } from "./window.ts";

// ---- Layers ---------------------------------------------------------------

/**
 * Identifies an item within one layer. Branded so that other numbers, and
 * the IDs of the data the layer presents, can't be passed as one.
 */
export type ItemId = number & { readonly __brand: "ItemId" };

/**
 * One layer of a scene: items in z-order, found by location, emitting
 * change when they change. A layer presents some source of data, such as a
 * ShapeCollection with a ShapeLocator, and is read-only: changes are made
 * to the source, and the layer shows them. regions(this) is the region of
 * the plane each item covers, as the source defines it (see view.vocab.ts).
 *
 * An ID names the same item for as long as it is present, and is never used
 * again after it's gone, so a changed item gets a new ID. A view can
 * therefore cache each item's drawing by ID, and can tell when the only
 * changes were adds: if the IDs it drew last time are all still there, in
 * the same order, and the new IDs are all above them, drawing the new items
 * over the old drawing gives the same result as redrawing the layer.
 *
 * That's why content that grows, such as ink being drawn, is added as a
 * series of small items, each starting where the last one ended, rather
 * than replaced by a larger item each time. Content that is replaced on
 * every event, such as predicted pen positions, belongs in a layer of its
 * own.
 *
 * A change listener is called synchronously, after the change is complete.
 * It must be cheap, such as marking the layer and requesting a frame. It
 * may add and remove listeners, as Emitter allows, but must not change the
 * source; doing so is outside the rules.
 *
 * @invariant size  size counts the items forEach visits.
 *   this.size === ids(this).length
 * @invariant z-order  forEach visits each item once, from bottom to top.
 *   isStrictlySorted(ids(this), (a, b) => this.compareZ(a, b))
 * @invariant get-agrees  get returns exactly the items forEach visits, under the same IDs.
 *   (id: ItemId) => entries(this).every(([i, item]) => this.get(i) === item) &&
 *     implies(this.get(id) !== undefined, ids(this).includes(id))
 * @ensures stable  While an ID is present, get returns the same item for it.
 * @ensures no-reuse  An ID that has gone never comes back.
 * @ensures read-only  Reading, querying, on and off never change the items.
 * @ensures no-retain  Never keeps a reference to a query's out array after returning: later calls leave earlier out arrays unchanged.
 * @ensures notifies  After a change to the source that changes the items, emits change once before the change returns, when every observer and query already shows the new items.
 * @ensures quiet  Emits change only as notifies says.
 */
export interface Layer<T> extends Emitter<{ change: [] }> {
  /** The item with this ID, or undefined if no such item is present. */
  get(id: ItemId): T | undefined;

  /** The number of items in the layer. */
  readonly size: number;

  /**
   * Calls visit for each item, bottom to top in z-order. visit must not
   * change the source.
   */
  forEach(visit: (id: ItemId, item: T) => void): void;

  /**
   * Compares the z-order of two items. Negative if a is below b, positive if
   * a is above b.
   *
   * @requires present  Both items are in the layer.
   *   this.get(a) !== undefined && this.get(b) !== undefined
   * @ensures zero-iff-same  Returns 0 only when comparing an item with itself.
   *   (result === 0) === (a === b)
   * @ensures antisymmetric  Swapping the arguments flips the sign.
   *   Math.sign(result) === -Math.sign(this.compareZ(b, a))
   */
  compareZ(a: ItemId, b: ItemId): number;

  /**
   * Finds the items whose regions intersect r. Appends to out, in no
   * particular order, and returns the number of IDs appended.
   *
   * @ensures exact  Reports exactly the items whose regions intersect r.
   *   sameSet(out.slice(old(out.length)),
   *     [...regions(this)].filter(([, s]) => s.intersects(r)).map(([id]) => id))
   * @ensures once  Reports each ID at most once.
   *   unique(out.slice(old(out.length)))
   * @ensures append  Leaves what was already in out unchanged.
   *   deepEqual(out.slice(0, old(out.length)), old([...out]))
   * @ensures count  Returns the number of IDs appended.
   *   result === out.length - old(out.length)
   */
  inRect(r: Rectangle, out: ItemId[]): number;

  /**
   * Finds the items whose regions contain p. Appends to out, in no
   * particular order, and returns the number of IDs appended.
   *
   * @ensures exact  Reports exactly the items whose regions contain p.
   *   sameSet(out.slice(old(out.length)),
   *     [...regions(this)].filter(([, s]) => s.contains(p)).map(([id]) => id))
   * @ensures once  Reports each ID at most once.
   *   unique(out.slice(old(out.length)))
   * @ensures append  Leaves what was already in out unchanged.
   *   deepEqual(out.slice(0, old(out.length)), old([...out]))
   * @ensures count  Returns the number of IDs appended.
   *   result === out.length - old(out.length)
   */
  atPoint(p: Point, out: ItemId[]): number;
}

// ---- Scene ----------------------------------------------------------------

/**
 * What views draw: layers in canonical coordinates, the same for every view,
 * with no viewport. layers[0] is the bottom layer. Layers are drawn bottom
 * to top, and each layer's items in that layer's z-order.
 *
 * A scene is only a list of layers, so scenes can share layers. Typically
 * the document's layers are what is saved and exported, and the scene that
 * views draw adds transient layers above them. For example, a pen uses two:
 * one for the stroke so far, which grows by adds, and one for the last few
 * points, which input smoothing and prediction replace on every event. At
 * pen up, the pen empties both and adds the finished stroke to the document.
 *
 * The window around the views, with its native controls, is not part of
 * any scene; see window.ts. Decorations that keep their size on screen, such
 * as selection handles, are each view's own, like its input handling.
 *
 * T is normally an application-defined union of item types, the transient
 * ones included, such as type WhiteboardItem = InkStroke | StickyNote, so
 * that code switching on a kind field narrows to the concrete type.
 */
export interface Scene<T> {
  readonly layers: readonly Layer<T>[];
}

// ---- Views ----------------------------------------------------------------

/**
 * Shows a scene on screen through a viewport, and stays current. A view for
 * a particular data model, such as ShapeView, draws its items for its
 * platform's surface.
 *
 * A view listens for change once on every layer of its scene. When a layer
 * changes, the view marks it and requests a frame; nothing else. In frame() it redraws
 * the visible part of each marked layer, finding the items in the viewport
 * by querying the layer. It may cache drawings by ItemId and draw only a
 * layer's added items, as the Layer doc describes.
 *
 * Input handling is internal to the view and specific to its platform: when
 * interactive, it recognizes the platform's viewport gestures (pinch,
 * rotate, pan) and applies them by setting its own viewport, and handles
 * other input by converting it to canonical coordinates through the
 * viewport and editing the model. It may drop events that carry nothing
 * new, such as a move to the same point.
 *
 * Shared gestures come from sources the view is given when it is made
 * (window.ts). So far there is one: taps, from a TapSource, which the view
 * converts from view to canonical coordinates and emits as tap. What a tap
 * does is up to whoever listens, such as an app's controls (chrome.ts).
 * A TapRecognizer (pointer.ts) on the region that the view's surface covers
 * exactly meets tap-coordinates, since its taps are in that region's local
 * coordinates.
 *
 * @requires tap-coordinates  The tap source is for the view's own surface: it emits points in the view's coordinates.
 * @ensures layer-change  When a layer changes, requests a frame and draws nothing until frame().
 * @ensures idle  Requests no frame while nothing it shows changes.
 * @ensures one-listener  Until disposed, has exactly one listener registered on each layer of its scene, and one on its tap source.
 * @ensures read-only  Reading scene, viewport or interactive changes nothing: what it shows, its frame requests and its listeners stay as they were.
 * @ensures taps  While interactive and not disposed, each tap from its tap source emits tap once, with the tap's point in canonical coordinates, before the source's emit returns; for the identity viewport that is the same point.
 */
export interface View<T> extends FrameHandler, Emitter<{ viewport: [Viewport]; tap: [Point] }> {
  readonly scene: Scene<T>;

  /**
   * Setting this redraws the view at the next frame and emits viewport with
   * the new value. Setting a value equal to the current one does nothing.
   * To prevent feedback loops between views that copy each other's
   * viewport, a listener that sets another view's viewport copies the value
   * as is, without recomputing it.
   *
   * @deferred set-redraws  Setting a different viewport requests a frame, and that frame draws through the new viewport.
   *   when: a ShapeView supports viewports other than the identity.
   *   how: shapeView.contract.ts gains a step that sets a random viewport (scale 0.5 to 2, rotation a multiple of 90 degrees, whole-number translation, so mapping is exact) and checks that a frame is requested and that afterward each sample point p shows what the scene shows at the viewport's inverse of p; with an adversary that draws through the old viewport.
   * @ensures set-equal  Setting a viewport equal to the current one, field by field, requests no frame and emits nothing.
   * @deferred set-emits  Setting a different viewport emits viewport with the new value before the setter returns.
   *   when: a ShapeView supports viewports other than the identity.
   *   how: the same step checks that each set of a different viewport emits viewport once, with a value equal to the one set, before the setter returns, and that viewport then reads as that value; with adversaries that emit before updating and that emit twice.
   */
  viewport: Viewport;

  /**
   * When false, the view ignores all input, gestures included (for example,
   * a minimap that is only for display). A view starts not interactive.
   *
   * @ensures starts-false  A new view is not interactive.
   * @ensures ignores-input  While false, input emits nothing and changes neither the viewport nor the model; so far, taps emit no tap.
   */
  interactive: boolean;

  /**
   * Ends the view: removes its listeners from the scene's layers and its
   * tap source, and requests, draws and emits nothing more. Calling it
   * again does nothing.
   *
   * @ensures detaches  Afterward, the view has no listeners on the scene's layers or its tap source, and layer changes request no frame.
   * @ensures inert  Afterward, frame() draws nothing, including a frame requested before dispose.
   */
  dispose(): void;
}

// ---- Export ---------------------------------------------------------------

/**
 * Produces a document (SVG, PDF and so on) from a scene, once, on request.
 * An exporter for a particular data model draws its items in its format.
 * Not a view: it has no frames, listeners or input. Give it a scene of
 * the document's layers, without the transient ones.
 *
 * The output shows what a view of width x height view units, with this
 * viewport, would show. Out is the format's own result type, such as an SVG
 * string or PDF bytes.
 */
export interface Exporter<T, Out = unknown> {
  export(scene: Scene<T>, viewport: Viewport, width: number, height: number): Out;
}
