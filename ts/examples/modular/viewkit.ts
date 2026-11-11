// Test doubles for views: a canvas context that records what it is asked to
// draw and computes what each point shows, a frame scheduler stepped by
// hand, and a circle. Each is correct by construction or checked:
// helpers.check.ts runs the FrameScheduler and Circle contracts on
// ManualScheduler and testCircle.

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";
import type { DrawingContext } from "./canvas.ts";
import type { FrameHandler, FrameScheduler } from "./frames.ts";
import { allFinite, extents, inflate, isEmpty, over, rectContains, rectIntersects, validCircle } from "./shape.vocab.ts";

// ---- Recording context ----------------------------------------------------

/** DrawingContext's members, for the restricted context below. */
const drawingMembers = ["canvas", "fillStyle", "clearRect", "beginPath", "arc", "fill"] as const;
// Fails to compile if the list and DrawingContext's members differ.
const listsEveryMember: [keyof DrawingContext] extends [(typeof drawingMembers)[number]] ? true : never = true;
void listsEveryMember;

/**
 * A view of target that allows only the given members, and throws on any
 * other: an implementation that uses more of the platform than the subset
 * names fails its tests, even through a cast. Symbols pass, for Node's own
 * inspection.
 */
function restrict<T extends object>(target: T, members: readonly string[], subset: string): T {
  const check = (key: string | symbol) => {
    if (typeof key === "string" && !members.includes(key)) {
      throw new Error(`used ${key}, which ${subset} lacks: add it there and to the recording context, or don't use it`);
    }
  };
  return new Proxy(target, {
    get(t, key) {
      check(key);
      const value = Reflect.get(t, key, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
    set(t, key, value) {
      check(key);
      return Reflect.set(t, key, value, t);
    },
    has(t, key) {
      check(key);
      return Reflect.has(t, key);
    },
    defineProperty(_, key) {
      check(key);
      throw new Error(`defined ${String(key)} on the drawing context`);
    },
    deleteProperty(_, key) {
      throw new Error(`deleted ${String(key)} from the drawing context`);
    },
  });
}

type Disk = { x: number; y: number; r: number };
type Op = { clear: Rectangle } | { fill: Color; disks: Disk[] };

/** Parses the only fillStyle form a ShapeView sets: rgba(r, g, b, a). */
function parseRgba(style: unknown): Color {
  const m = typeof style === "string" &&
    /^rgba\(\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s)]+)\s*\)$/.exec(style);
  if (!m) throw new Error(`fillStyle is not rgba(r, g, b, a): ${String(style)}`);
  const [r, g, b, a] = m.slice(1).map(Number);
  if (![r, g, b, a].every(Number.isFinite)) throw new Error(`fillStyle has a non-number: ${style}`);
  return { r, g, b, a };
}

/**
 * A DrawingContext that keeps every clear and fill, and computes what each
 * point shows as a browser canvas would, without antialiasing: a fill
 * paints the points within each full circle of the path, edges included,
 * composited with over. Accepts only full circles (0 to 2 * Math.PI), and
 * only rgba() fill styles.
 *
 * Give an implementation `context`, not the recording context itself:
 * `context` allows only DrawingContext's members.
 */
export class RecordingContext implements DrawingContext {
  readonly canvas: { readonly width: number; readonly height: number };
  fillStyle: string | object = "rgba(0, 0, 0, 1)";
  /** This context, restricted to DrawingContext's members, canvas included. */
  readonly context: DrawingContext;
  private readonly ops: Op[] = [];
  private path: Disk[] = [];

  constructor(width: number, height: number) {
    this.canvas = restrict({ width, height }, ["width", "height"], "DrawingContext.canvas (canvas.ts)");
    this.context = restrict<DrawingContext>(this, drawingMembers, "DrawingContext (canvas.ts)");
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.ops.push({ clear: { x, y, width, height } });
  }

  beginPath(): void {
    this.path = [];
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    if (startAngle !== 0 || endAngle !== 2 * Math.PI) throw new Error("RecordingContext draws only full circles");
    this.path.push({ x, y, r: radius });
  }

  fill(): void {
    this.ops.push({ fill: parseRgba(this.fillStyle), disks: [...this.path] });
  }

  /** What the canvas shows at p: the fills covering p since it was last cleared, composited. */
  painted(p: Point): Color {
    let colors: Color[] = [];
    for (const op of this.ops) {
      if ("clear" in op) {
        if (rectContains(op.clear, p)) colors = [];
      } else if (op.disks.some((d) => Math.hypot(p.x - d.x, p.y - d.y) <= d.r)) {
        colors.push(op.fill);
      }
    }
    return over(colors);
  }
}

// ---- Scheduler ------------------------------------------------------------

/** A FrameScheduler whose frames run only when the test calls runFrame. */
export class ManualScheduler implements FrameScheduler {
  private pending = new Set<FrameHandler>();
  private time = 0;

  requestFrame(handler: FrameHandler): void {
    this.pending.add(handler);
  }

  /** Whether handler has asked for the next frame. */
  isRequested(handler: FrameHandler): boolean {
    return this.pending.has(handler);
  }

  /** Whether any handler has asked for the next frame. */
  anyRequested(): boolean {
    return this.pending.size > 0;
  }

  /** Runs one frame: calls frame() on each handler that asked before it started. */
  runFrame(): void {
    const handlers = [...this.pending];
    this.pending.clear();
    this.time += 1000 / 120;
    for (const h of handlers) h.frame(this.time);
  }
}

// ---- Circle ---------------------------------------------------------------

/** A Circle, so that view tests don't depend on any Circle implementation. */
export function testCircle(fields: { center: Point; radius: number; color: Color }): Circle {
  const { center: c, radius, color: k } = fields;
  if (!allFinite([c.x, c.y, radius, k]) || !validCircle(fields)) throw new RangeError("invalid circle");
  const center = { x: c.x, y: c.y };
  const color = { r: k.r, g: k.g, b: k.b, a: k.a };
  const box = inflate(extents([center]), radius);
  const dist = (p: Point) => Math.hypot(p.x - center.x, p.y - center.y);
  const contains = (p: Point) => rectContains(box, p) && dist(p) <= radius;
  const intersects = (r: Rectangle) => {
    if (isEmpty(r) || !rectIntersects(box, r)) return false;
    // The point of r (edges included) nearest the center.
    const q = {
      x: Math.min(Math.max(center.x, r.x), r.x + r.width),
      y: Math.min(Math.max(center.y, r.y), r.y + r.height),
    };
    const d = dist(q);
    return d !== radius ? d < radius : rectContains(r, q) && contains(q);
  };
  return { kind: "circle", center, radius, color, boundingBox: () => box, contains, intersects };
}
