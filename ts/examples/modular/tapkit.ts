// The reference tap recognizer (pointer.ts), written as simply as possible
// from the rules. helpers.check.ts runs the TapRecognizer contract on it.
// The recognizer's own generation task never sees this file.

import type { Point } from "./geometry.ts";
import type { Region, TapRecognizer } from "./pointer.ts";
import { Events } from "./eventkit.ts";

export class RefTaps extends Events<{ tap: [Point] }> implements TapRecognizer {
  private readonly region: Region;
  private readonly slop: number;
  private start: Point | undefined;
  private still = false;
  private disposed = false;
  private readonly far = (p: Point) => Math.hypot(p.x - this.start!.x, p.y - this.start!.y) > this.slop;
  private readonly onDown = (e: { point: Point }) => {
    this.start = e.point;
    this.still = true;
  };
  private readonly onMove = (e: { point: Point }) => {
    if (this.start && this.far(e.point)) this.still = false;
  };
  private readonly onUp = (e: { point: Point }) => {
    if (this.start && this.still && !this.far(e.point)) this.emit("tap", this.start);
    this.start = undefined;
  };

  constructor(region: Region, slop: number) {
    super();
    this.region = region;
    this.slop = slop;
    region.on("down", this.onDown).on("move", this.onMove).on("up", this.onUp);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.region.off("down", this.onDown).off("move", this.onMove).off("up", this.onUp);
  }
}
