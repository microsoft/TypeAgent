// A TapRecognizer for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the TapRecognizer contract against it with no bug.

import type { Point } from "../geometry.ts";
import type { PointerEvent, Region, TapRecognizer } from "../pointer.ts";
import { Events } from "../eventkit.ts";

export type TapBug =
  | "none"
  | "tap-on-down"        // emits the tap at the down, before the up
  | "up-point"           // the tap is at the up's point, not the down's
  | "slop-ignored"       // any press is a tap
  | "moves-ignored"      // only the up's distance counts
  | "slop-strict"        // a distance equal to the slop is too far
  | "inside-only"        // an up outside the region isn't a tap
  | "listens-twice"      // listens to down twice
  | "dispose-keeps";     // dispose leaves its listeners

export class TestTaps extends Events<{ tap: [Point] }> implements TapRecognizer {
  private readonly region: Region;
  private readonly slop: number;
  private readonly bug: TapBug;
  private start: Point | undefined;
  private still = false;
  private disposed = false;
  private far(p: Point): boolean {
    const d = Math.hypot(p.x - this.start!.x, p.y - this.start!.y);
    return this.bug === "slop-ignored" ? false : this.bug === "slop-strict" ? d >= this.slop : d > this.slop;
  }
  private readonly onDown = (e: PointerEvent) => {
    this.start = e.point;
    this.still = true;
    if (this.bug === "tap-on-down") this.emit("tap", e.point);
  };
  private readonly onMove = (e: PointerEvent) => {
    if (this.start && this.bug !== "moves-ignored" && this.far(e.point)) this.still = false;
  };
  private readonly onUp = (e: PointerEvent) => {
    const outside = e.point.x < 0 || e.point.y < 0 || e.point.x >= this.region.bounds.width || e.point.y >= this.region.bounds.height;
    if (this.start && this.still && !this.far(e.point) && this.bug !== "tap-on-down" && !(this.bug === "inside-only" && outside)) {
      this.emit("tap", this.bug === "up-point" ? e.point : this.start);
    }
    this.start = undefined;
  };

  constructor(region: Region, slop: number, bug: TapBug = "none") {
    super();
    this.region = region;
    this.slop = slop;
    this.bug = bug;
    region.on("down", this.onDown).on("move", this.onMove).on("up", this.onUp);
    if (bug === "listens-twice") region.on("down", this.onDown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bug !== "dispose-keeps") this.region.off("down", this.onDown).off("move", this.onMove).off("up", this.onUp);
  }
}

export const makeTestTaps = (bug: TapBug = "none") => (region: Region, slop: number): TapRecognizer => new TestTaps(region, slop, bug);
