/**
 * Interfaces for showing data: render groups, the scene they make up, and
 * the views that draw a scene in a window's frames. None of them depends on
 * Shape: a group presents any data model's items. Rules follow the format
 * described in rules.ts.
 *
 * @module
 */

import type { Point, Rectangle, Viewport } from "./geometry.ts";
import type { EventEmitter } from "./events.ts";
import type { FrameHandler } from "./frames.ts";

// ---- Render groups ---------------------------------------------------------------

/**
 * Identifies an item within one group. Branded so that other numbers, and
 * the IDs of the data the group presents, can't be passed as one.
 */
export type ItemId = number & { readonly __brand: "ItemId" };

/**
 * One group of a scene: items in z-order, found by location, emitting
 * change when they change. A group presents some source of data, such as a
 * ShapeCollection with a ShapeLocator, and is read-only: changes are made
 * to the source, and the group shows them. regions(this) is the region of
 * the plane each item covers, as the source defines it (see view.vocab.ts).
 *
 * An ID names the same item for as long as it is present, and is never used
 * again after it's gone, so a changed item gets a new ID.
 *
 * A change listener is called synchronously, after the change is complete.
 * It may add and remove listeners, as EventEmitter allows, but must not change the
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
export interface RenderGroup<T> extends EventEmitter<{ change: [] }> {
  /** The item with this ID, or undefined if no such item is present. */
  get(id: ItemId): T | undefined;

  /** The number of items in the group. */
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
   * @requires present  Both items are in the group.
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
 * What views draw: groups in canonical coordinates, the same for every view,
 * with no viewport. groups[0] is the bottom group. Groups are drawn bottom
 * to top, and each group's items in that group's z-order. A scene is only
 * a list of groups, so scenes can share groups.
 */
export interface Scene<T> {
  readonly groups: readonly RenderGroup<T>[];
}

// ---- Views ----------------------------------------------------------------

/**
 * Shows a scene on screen through a viewport, and stays current. A view for
 * a particular data model, such as ShapeView, draws its items for its
 * platform's surface.
 *
 * A view may cache each item's drawing by ItemId, since an ID names the
 * same item while present and is never reused. When a group's only changes
 * were adds (the IDs it drew are all still there, in the same order, and
 * the new IDs are all above them), drawing the new items over the old
 * drawing gives the same result as redrawing the group.
 *
 * A view takes no input.
 *
 * @ensures group-change  When a group changes, requests a frame and draws nothing until frame().
 * @ensures idle  Requests no frame while nothing it shows changes.
 * @ensures one-listener  Until disposed, has exactly one listener registered on each group of its scene.
 * @ensures read-only  Reading scene or viewport changes nothing: what it shows, its frame requests and its listeners stay as they were.
 */
export interface View<T> extends FrameHandler, EventEmitter<{ viewport: [Viewport] }> {
  readonly scene: Scene<T>;

  /**
   * Setting this redraws the view at the next frame and emits viewport with
   * the new value. Setting a value equal to the current one does nothing.
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
   * Ends the view: removes its listeners from the scene's groups, and
   * requests, draws and emits nothing more. Calling it again does nothing.
   *
   * @ensures detaches  Afterward, the view has no listeners on the scene's groups, and group changes request no frame.
   * @ensures inert  Afterward, frame() draws nothing, including a frame requested before dispose.
   */
  dispose(): void;
}
