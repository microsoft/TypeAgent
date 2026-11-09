// The reference chrome: a Chrome (chrome.ts) written directly from the
// vocabulary in chrome.vocab.ts, as simply as possible. Tests of the parts
// around a chrome use it, and scenario tests compare an app against an app
// built from it. helpers.check.ts runs the Chrome contract on it. The
// chrome's own generation task never sees this file.

import type { Point } from "./geometry.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { ItemId } from "./view.ts";
import type { SemanticNode, Size, UiEvent } from "./ui.ts";
import type { Chrome, ChromeOptions, ChromeState, MakeCircle } from "./chrome.ts";
import { byKey, controls, deepEqual, ids, minimumSize, snapRadius } from "./chrome.vocab.ts";
import { Events } from "./eventkit.ts";

export class RefChrome extends Events<{ change: [] }> implements Chrome {
  private current: ChromeState;
  private disposed = false;
  private readonly layer: DrawingLayer;
  private readonly options: ChromeOptions;
  private readonly makeCircle: MakeCircle;
  private readonly onLayer = () => this.update({ ...this.current, count: this.layer.size });

  constructor(layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle) {
    super();
    this.layer = layer;
    this.options = options;
    this.makeCircle = makeCircle;
    this.current = { mode: "draw", color: 0, radius: options.radius.initial, count: layer.size };
    layer.on("change", this.onLayer);
  }

  get state(): ChromeState {
    return { ...this.current };
  }

  private update(next: ChromeState): void {
    if (deepEqual(next, this.current)) return;
    this.current = next;
    this.emit("change");
  }

  dispatch(event: UiEvent): void {
    if (this.disposed) return;
    const node = byKey(controls(this.options, this.current, minimumSize(this.options)), event.key);
    if (!node || !node.enabled) return;
    if (event.kind === "activate" && node.role === "radio") {
      if (event.key === "mode.draw" || event.key === "mode.erase") {
        this.update({ ...this.current, mode: event.key === "mode.draw" ? "draw" : "erase" });
      } else {
        this.update({ ...this.current, color: Number(event.key.slice("color.".length)) });
      }
    } else if (event.kind === "activate" && node.role === "button") {
      this.layer.removeMultiple(ids(this.layer));
    } else if (event.kind === "set-value" && node.role === "slider") {
      this.update({ ...this.current, radius: snapRadius(this.options.radius, event.value) });
    }
  }

  tap(p: Point): void {
    if (this.disposed) return;
    if (this.current.mode === "draw") {
      const color = this.options.palette[this.current.color].color;
      this.layer.add(this.makeCircle({ center: { x: p.x, y: p.y }, radius: this.current.radius, color }));
      return;
    }
    const found: ItemId[] = [];
    this.layer.atPoint(p, found);
    const top = found.sort((a, b) => this.layer.compareZ(a, b)).at(-1);
    if (top !== undefined) this.layer.remove(top);
  }

  present(size: Size): SemanticNode {
    return controls(this.options, this.current, size);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.layer.off("change", this.onLayer);
  }
}
