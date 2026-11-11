// The reference circles app on the test platform: a controller that gets
// taps from an EventDistributor (layout.ts), with the view's surface as
// their target, and sends operations on the model; the view shows the
// change once the infrastructure has processed them. helpers.check.ts runs
// the scenarios on it.

import type { Point } from "./geometry.ts";
import type { ShapeId } from "./shape.ts";
import type { CirclesParts, TapEvent, TestCirclesApp } from "./driver.ts";
import type { Mode } from "./scenarios.ts";

export class RefCircles implements TestCirclesApp {
  private readonly parts: CirclesParts;
  private current: Mode = "draw";
  private colorIndex = 0;
  private radiusNow: number;
  private readonly onTap = (_: "tap", event: TapEvent) => {
    const r = this.parts.surface.region;
    // In the view's coordinates. ShapeView's viewport is the identity, so these are canonical too.
    const p: Point = { x: event.at.x - r.x, y: event.at.y - r.y };
    const { model, localSend, newShapeId, settings, makeCircle } = this.parts;
    if (this.current === "draw") {
      const shape = makeCircle({ center: p, radius: this.radiusNow, color: settings.palette[this.colorIndex].color });
      localSend({ type: "add", id: newShapeId(), shape });
      return;
    }
    const here: ShapeId[] = [];
    model.atPoint(p, here);
    if (here.length === 0) return;
    const top = here.reduce((a, b) => (model.compareZ(a, b) > 0 ? a : b));
    localSend({ type: "remove", ids: [top] });
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
    this.parts.localSend({ type: "clear" });
  }

  dispose(): void {
    this.parts.distributor.off("tap", this.onTap, this.parts.surface);
  }
}
