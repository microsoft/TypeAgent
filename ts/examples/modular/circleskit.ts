// The reference circles app on the test platform: a controller that gets
// taps from an EventDistributor (layout.ts), with the view's surface as
// their target, and edits the drawing group; the view shows the change.
// helpers.check.ts runs the scenarios on it.

import type { Point } from "./geometry.ts";
import type { ItemId } from "./view.ts";
import type { CirclesParts, TapEvent, TestCirclesApp } from "./driver.ts";
import type { Mode } from "./scenarios.ts";
import { ids } from "./rules.ts";

export class RefCircles implements TestCirclesApp {
  private readonly parts: CirclesParts;
  private current: Mode = "draw";
  private colorIndex = 0;
  private radiusNow: number;
  private readonly onTap = (_: "tap", event: TapEvent) => {
    const r = this.parts.surface.region;
    // In the view's coordinates. ShapeView's viewport is the identity, so these are canonical too.
    const p: Point = { x: event.at.x - r.x, y: event.at.y - r.y };
    const { group, settings, makeCircle } = this.parts;
    if (this.current === "draw") {
      group.add(makeCircle({ center: p, radius: this.radiusNow, color: settings.palette[this.colorIndex].color }));
      return;
    }
    let top: ItemId | undefined;
    group.forEach((id, shape) => {
      if (shape.contains(p)) top = id;
    });
    if (top !== undefined) group.remove(top);
  };

  constructor(parts: CirclesParts) {
    this.parts = parts;
    this.radiusNow = parts.settings.radius.initial;
    parts.distributor.on("tap", this.onTap, parts.surface);
  }

  color(label: string): void {
    const i = this.parts.settings.palette.findIndex((p) => p.label === label);
    if (i >= 0) this.colorIndex = i;
  }

  radius(value: number): void {
    this.radiusNow = value;
  }

  mode(mode: Mode): void {
    this.current = mode;
  }

  clear(): void {
    const all = ids(this.parts.group);
    if (all.length > 0) this.parts.group.removeMultiple(all);
  }

  dispose(): void {
    this.parts.distributor.off("tap", this.onTap, this.parts.surface);
  }
}
