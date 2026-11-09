// A Chrome for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the Chrome contract against it with no bug.

import type { Point } from "../geometry.ts";
import type { DrawingLayer } from "../shapeView.ts";
import type { ItemId } from "../view.ts";
import type { SemanticNode, Size, UiEvent } from "../ui.ts";
import type { Chrome, ChromeOptions, ChromeState, MakeCircle } from "../chrome.ts";
import { byKey, controls, deepEqual, entries, ids, minimumSize, snapRadius } from "../chrome.vocab.ts";
import { Events } from "../eventkit.ts";

export type ChromeBug =
  | "none"
  | "starts-erase"            // a new chrome is in erase mode
  | "listens-twice"           // listens to its layer twice
  | "counts-own-edits-only"   // count follows only the chrome's own edits
  | "emits-always"            // every dispatch emits change, even when nothing changed
  | "emits-before-update"     // emits change before updating its state
  | "state-live"              // state returns the chrome's own object, which later changes alter
  | "mode-toggles"            // activating either mode radio toggles the mode
  | "color-off-by-one"        // activating color.<i> sets color i + 1, wrapping
  | "radius-unsnapped"        // set-value only clamps the radius to the range
  | "radius-floors"           // set-value rounds down to a step instead of to the nearest
  | "clear-one-by-one"        // clear removes each item with remove
  | "disabled-acts"           // events for disabled controls still act
  | "set-value-on-radio"      // set-value on a radio acts like activating it
  | "draws-initial-radius"    // taps draw with the initial radius, not the current one
  | "erases-bottom"           // erase removes the bottommost item at the point
  | "erases-by-box"           // erase removes the topmost item whose bounding box contains the point
  | "status-stale"            // present shows the count from before the last change
  | "present-emits"           // present emits change
  | "dispose-keeps-listener"; // dispose leaves the layer listener

export class TestChrome extends Events<{ change: [] }> implements Chrome {
  private current: ChromeState;
  private previousCount: number;
  private disposed = false;
  private readonly layer: DrawingLayer;
  private readonly options: ChromeOptions;
  private readonly makeCircle: MakeCircle;
  private readonly bug: ChromeBug;
  private readonly onLayer = () => {
    if (this.bug === "counts-own-edits-only" && !this.editing) return;
    this.update({ ...this.current, count: this.layer.size });
  };
  private editing = false;

  constructor(layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle, bug: ChromeBug = "none") {
    super();
    this.layer = layer;
    this.options = options;
    this.makeCircle = makeCircle;
    this.bug = bug;
    this.current = { mode: bug === "starts-erase" ? "erase" : "draw", color: 0, radius: options.radius.initial, count: layer.size };
    this.previousCount = layer.size;
    layer.on("change", this.onLayer);
    if (bug === "listens-twice") layer.on("change", this.onLayer);
  }

  get state(): ChromeState {
    return this.bug === "state-live" ? this.current : { ...this.current };
  }

  private update(next: ChromeState): void {
    if (deepEqual(next, this.current)) {
      return;
    }
    if (this.bug === "emits-before-update") this.emit("change");
    this.previousCount = this.current.count;
    if (this.bug === "state-live") Object.assign(this.current, next);
    else this.current = next;
    if (this.bug !== "emits-before-update") this.emit("change");
  }

  private edit(action: () => void): void {
    this.editing = true;
    try { action(); } finally { this.editing = false; }
  }

  dispatch(event: UiEvent): void {
    if (this.disposed) return;
    if (this.bug === "emits-always") this.emit("change");
    const node = byKey(controls(this.options, this.current, minimumSize(this.options)), event.key);
    if (!node || (!node.enabled && this.bug !== "disabled-acts")) return;
    const activates = event.kind === "activate" || (this.bug === "set-value-on-radio" && node.role === "radio");
    if (activates && node.role === "radio") {
      if (event.key === "mode.draw" || event.key === "mode.erase") {
        const mode = this.bug === "mode-toggles" ? (this.current.mode === "draw" ? "erase" : "draw")
          : event.key === "mode.draw" ? "draw" : "erase";
        this.update({ ...this.current, mode });
      } else {
        const i = Number(event.key.slice("color.".length));
        this.update({ ...this.current, color: this.bug === "color-off-by-one" ? (i + 1) % this.options.palette.length : i });
      }
    } else if (event.kind === "activate" && node.role === "button") {
      this.edit(() => {
        if (this.bug === "clear-one-by-one") for (const id of ids(this.layer)) this.layer.remove(id);
        else this.layer.removeMultiple(ids(this.layer));
      });
    } else if (event.kind === "set-value" && node.role === "slider") {
      const { min, max, step } = this.options.radius;
      const radius = this.bug === "radius-unsnapped" ? Math.min(max, Math.max(min, event.value))
        : this.bug === "radius-floors" ? Math.min(max, Math.max(min, min + Math.floor((event.value - min) / step) * step))
        : snapRadius(this.options.radius, event.value);
      this.update({ ...this.current, radius });
    }
  }

  tap(p: Point): void {
    if (this.disposed) return;
    if (this.current.mode === "draw") {
      const color = this.options.palette[this.current.color].color;
      const radius = this.bug === "draws-initial-radius" ? this.options.radius.initial : this.current.radius;
      this.edit(() => this.layer.add(this.makeCircle({ center: { x: p.x, y: p.y }, radius, color })));
      return;
    }
    const hits: ItemId[] = this.bug === "erases-by-box"
      ? entries(this.layer).filter(([, s]) => {
        const b = s.boundingBox();
        return b.x <= p.x && p.x < b.x + b.width && b.y <= p.y && p.y < b.y + b.height;
      }).map(([id]) => id)
      : (() => { const out: ItemId[] = []; this.layer.atPoint(p, out); return out; })();
    const sorted = hits.sort((a, b) => this.layer.compareZ(a, b));
    const target = this.bug === "erases-bottom" ? sorted[0] : sorted.at(-1);
    if (target !== undefined) this.edit(() => this.layer.remove(target));
  }

  present(size: Size): SemanticNode {
    if (this.bug === "present-emits") this.emit("change");
    const state = this.bug === "status-stale" ? { ...this.current, count: this.previousCount } : this.current;
    return controls(this.options, state, size);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bug !== "dispose-keeps-listener") this.layer.off("change", this.onLayer);
  }
}

/** Makes a TestChrome with the bug, in the Chrome contract's shape. */
export const makeTestChrome = (bug: ChromeBug = "none") =>
  (layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle) => new TestChrome(layer, options, makeCircle, bug);
