// A circles app for adversaries: the reference controller, correct unless a
// bug is switched on. helpers.check.ts runs the scenarios against it with no
// bug.

import type { Point } from "../geometry.ts";
import type { ShapeId } from "../shape.ts";
import type { AppMakers, CirclesParts, TapEvent, TestCirclesApp } from "../driver.ts";
import type { Mode } from "../scenarios.ts";
import { ids } from "../rules.ts";

export type CirclesBug =
  | "none"
  | "drops-taps"            // never registers for taps
  | "window-points"         // uses a tap's window point as is, so circles land a controls-height too low
  | "color-off-by-one"      // choosing a color picks the next one
  | "draws-initial-radius"  // always draws with the initial radius
  | "erases-bottom"         // erases the bottom circle at the point
  | "erases-any"            // erasing where there is no circle erases the top circle anyway
  | "clear-keeps-top"       // clear leaves the top circle
  | "mode-resets"           // changing mode resets the color and radius
  | "clamps-radius"         // radii above 30 are drawn as 30
  | "edit-in-frame"         // a tap sends its operation in the next frame
  | "sends-later";          // a tap sends its operation in a microtask, after its handler returns

class TestCircles implements TestCirclesApp {
  private readonly parts: CirclesParts;
  private readonly bug: CirclesBug;
  private current: Mode = "draw";
  private colorIndex = 0;
  private radiusNow: number;
  private readonly onTap = (_: "tap", event: TapEvent) => {
    if (this.bug === "edit-in-frame") this.parts.scheduler.requestFrame({ frame: () => this.edit(event) });
    else if (this.bug === "sends-later") queueMicrotask(() => this.edit(event));
    else this.edit(event);
  };

  constructor(parts: CirclesParts, bug: CirclesBug) {
    this.parts = parts;
    this.bug = bug;
    this.radiusNow = parts.settings.radius.initial;
    if (bug !== "drops-taps") parts.distributor.on("tap", this.onTap, parts.surface);
  }

  private edit(event: TapEvent): void {
    const r = this.parts.surface.region;
    const p: Point = this.bug === "window-points" ? event.at : { x: event.at.x - r.x, y: event.at.y - r.y };
    const { model, localSend, newShapeId, settings, makeCircle } = this.parts;
    if (this.current === "draw") {
      const radius = this.bug === "draws-initial-radius" ? settings.radius.initial
        : this.bug === "clamps-radius" ? Math.min(30, this.radiusNow) : this.radiusNow;
      localSend({ type: "add", id: newShapeId(), shape: makeCircle({ center: p, radius, color: settings.palette[this.colorIndex].color }) });
      return;
    }
    const here: ShapeId[] = [];
    model.atPoint(p, here);
    here.sort((a, b) => model.compareZ(a, b));
    const all = ids(model);
    const target = this.bug === "erases-bottom" ? here[0]
      : this.bug === "erases-any" && here.length === 0 ? all[all.length - 1] : here[here.length - 1];
    if (target !== undefined) localSend({ type: "remove", ids: [target] });
  }

  color(label: string): void {
    const i = this.parts.settings.palette.findIndex((p) => p.label === label);
    if (i >= 0) this.colorIndex = this.bug === "color-off-by-one" ? (i + 1) % this.parts.settings.palette.length : i;
  }

  radius(value: number): void {
    this.radiusNow = value;
  }

  mode(mode: Mode): void {
    this.current = mode;
    if (this.bug === "mode-resets") {
      this.colorIndex = 0;
      this.radiusNow = this.parts.settings.radius.initial;
    }
  }

  clear(): void {
    if (this.bug === "clear-keeps-top") this.parts.localSend({ type: "remove", ids: ids(this.parts.model).slice(0, -1) });
    else this.parts.localSend({ type: "clear" });
  }

  dispose(): void {
    this.parts.distributor.off("tap", this.onTap, this.parts.surface);
  }
}

export function makeTestCircles(bug: CirclesBug = "none"): AppMakers["app"] {
  return (parts) => new TestCircles(parts, bug);
}
