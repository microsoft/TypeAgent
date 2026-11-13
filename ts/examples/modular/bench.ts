/**
 * bench is a script: it measures the budgets of the locators and of the shape
 * model, and supplies the measured numbers in the Cost and Choose when fields
 * of listLocator.ts, quadTreeLocator.ts, mapShapeCollection.ts and
 * shapeProcessor.ts.
 *
 * How: Three sections, each labeled with the ID of the budget it measures. The
 * locator table times ListLocator and QuadTreeLocator building, querying and
 * bulk-removing 100, 1,000 and 10,000 scattered ink strokes, under string IDs.
 * frames.fraction-of-frame times the circles app's two taps, one that draws a
 * circle and one that erases the top circle under it, through a stand-in for
 * the message infrastructure over a ShapeProcessor on a MapShapeCollection
 * over a QuadTreeLocator holding 10,000 circles from makeCircle, and prints
 * each median as a fraction of 5% of a 120 Hz frame; each tap is timed whole,
 * from the first call the handler makes (newShapeId and makeCircle for a
 * drawing tap, atPoint and compareZ for an erasing one) to the end of process,
 * with the model put back to 10,000 circles afterward, untimed.
 * ShapeCollectionWriter.log-amortized and ShapeMessageProcessor.log-amortized
 * time a batch of operations on a collection holding 1,000 shapes and on one
 * holding 100,000, for eight add, remove, compareZ and clear patterns, and
 * print the time per operation at 100,000 divided by the time at 1,000. Every
 * section prints absolute times, which are the machine's, and the machine with
 * them.
 * Run: npm run bench; about 15 seconds, most of it building the 100,000-shape
 * collections, and it prints its own elapsed time. It exits nonzero when a
 * log-amortized ratio exceeds 16 (4 to 9 is what a logarithmic structure
 * measures at these two sizes), when the two locators disagree on what their
 * queries found, when a clear that should remove nothing removes something, or
 * when a timed erasing tap finds no circle to erase, each of which would make
 * its measurement another measurement entirely; exceeding the frame budget is
 * printed, not a failure, because timing is flaky.
 * Imports: geometry.ts, shape.ts, dataModel.ts, shapeModel.ts, listLocator.ts, quadTreeLocator.ts, inkStroke.ts, circle.ts, mapShapeCollection.ts, shapeProcessor.ts, node:os
 */

import { cpus, release, type as osType } from "node:os";
import type { Point, Rectangle } from "./geometry.ts";
import type { Circle, InkStroke, Shape, ShapeId, ShapeLocator } from "./shape.ts";
import type { OperationContent } from "./dataModel.ts";
import type { ShapeCollection, ShapeOp } from "./shapeModel.ts";
import { ListLocator } from "./listLocator.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { makeInkStroke } from "./inkStroke.ts";
import { makeCircle } from "./circle.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { ShapeProcessor } from "./shapeProcessor.ts";

const CANVAS = 10_000;
const ERASER = 20;
const QUERIES = 1_000;
const RUNS = 9;
const WARMUP = 2;
const COUNTS = [100, 1_000, 10_000];

/** The budgets this script measures, by rule ID (rules.ts). */
const FRAME_RULE = "frames.fraction-of-frame";
const WRITER_RULE = "ShapeCollectionWriter.log-amortized";
const PROCESSOR_RULE = "ShapeMessageProcessor.log-amortized";

/** 5% of a 120 Hz frame, in milliseconds: the frame budget. */
const FRAME_BUDGET = (1000 / 120) * 0.05;
/** The circles in the model the frame budget is measured against. */
const MODEL_CIRCLES = 10_000;
/** The model's circles lie one per cell of a GRID x GRID grid over the canvas. */
const GRID = 100;
const CELL = CANVAS / GRID;
/** Timed taps, and the taps run first to warm the code up. */
const TAPS = 101;
const TAP_WARMUP = 20;

/** The two sizes the log-amortized ratios compare, and the batch timed at each. */
const SMALL = 1_000;
const LARGE = 100_000;
const BATCH = 1_000;
const RATIO_RUNS = 5;
const RATIO_WARMUP = 1;
/**
 * A ratio above this fails the log-amortized budgets. Logarithmic growth is
 * about 2 in the number of steps, and linear growth about 100; measured times
 * grow more than the steps do, because 100,000 shapes don't fit in the caches
 * that hold 1,000, so 4 to 9 is what a logarithmic structure measures here.
 */
const RATIO_LIMIT = 16;
/** The ratios a logarithmic structure measures at these two sizes. */
const RATIO_EXPECTED = "4 to 9";
/** Adds the stand-in queues before it settles, while it fills a model. */
const FILL_CHUNK = 1_000;

/** Sums results the timed loops would otherwise throw away. */
let checksum = 0;

/**
 * Whether every clear of the clear pattern left all the shapes present. A
 * clear that removed some would be measuring something else, so the run fails.
 */
let clearsRemovedNothing = true;

/**
 * Whether every timed erasing tap found a circle under it. A tap that found
 * none would erase nothing, which is another measurement, so the run fails.
 */
let everyTapErased = true;

/** mulberry32: a small seeded generator returning numbers in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const fmt = (v: number, digits: number) => v.toFixed(digits);
const count = (n: number) => n.toLocaleString("en-US");

/** Prints rows as a padded table, left-aligning the first `left` columns. */
function table(rows: string[][], left: number): void {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  const line = (r: string[]) => r.map((v, c) => (c < left ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join("  ").trimEnd();
  console.log(line(rows[0]));
  console.log(widths.map((n) => "-".repeat(n)).join("  ").trimEnd());
  for (const r of rows.slice(1)) console.log(line(r));
}

// ---- The locators ---------------------------------------------------------

/** A hand-drawn-looking stroke: a random walk of 2 to 40 points, a few units per step. */
function randomStroke(rand: () => number): InkStroke {
  const n = 2 + Math.floor(rand() * 39);
  let x = rand() * CANVAS;
  let y = rand() * CANVAS;
  let heading = rand() * 2 * Math.PI;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    points.push({ x, y });
    heading += (rand() - 0.5) * 1.2;
    const step = 1 + rand() * 6;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
  }
  const thickness = 1 + Math.floor(rand() * 8);
  return makeInkStroke({ points, thickness, color: { r: 0, g: 0, b: 0, a: 1 } });
}

interface Workload {
  strokes: InkStroke[];
  rects: Rectangle[];
  points: Point[];
  toRemove: ShapeId[];
}

function workload(size: number): Workload {
  const rand = seeded(0x5eed + size);
  const strokes = Array.from({ length: size }, () => randomStroke(rand));
  const rects = Array.from({ length: QUERIES }, () => ({
    x: rand() * CANVAS, y: rand() * CANVAS, width: ERASER, height: ERASER,
  }));
  // Half the points land on a stroke's vertex, so that atPoint finds something; half are anywhere.
  const points = Array.from({ length: QUERIES }, (_, i) => {
    if (i % 2 === 0) return { x: rand() * CANVAS, y: rand() * CANVAS };
    const s = strokes[Math.floor(rand() * size)];
    return s.points[Math.floor(rand() * s.points.length)];
  });
  const ids = strokes.map((_, i) => String(i + 1) as ShapeId);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { strokes, rects, points, toRemove: ids.slice(0, Math.floor(size / 10)) };
}

interface Run {
  build: number;
  inRect: number;
  atPoint: number;
  removeMultiple: number;
  rectHits: number;
  pointHits: number;
}

function once(make: () => ShapeLocator, w: Workload): Run {
  const out: ShapeId[] = [];
  let t = performance.now();
  const locator = make();
  w.strokes.forEach((s, i) => locator.add(String(i + 1) as ShapeId, s));
  const build = performance.now() - t;

  let rectHits = 0;
  t = performance.now();
  for (const r of w.rects) {
    out.length = 0;
    rectHits += locator.inRect(r, out);
  }
  const inRect = performance.now() - t;

  let pointHits = 0;
  t = performance.now();
  for (const p of w.points) {
    out.length = 0;
    pointHits += locator.atPoint(p, out);
  }
  const atPoint = performance.now() - t;

  t = performance.now();
  locator.removeMultiple(w.toRemove);
  const removeMultiple = performance.now() - t;
  return { build, inRect, atPoint, removeMultiple, rectHits, pointHits };
}

function measure(make: () => ShapeLocator, w: Workload): Run {
  for (let i = 0; i < WARMUP; i++) once(make, w);
  const runs = Array.from({ length: RUNS }, () => once(make, w));
  const m = (k: keyof Run) => median(runs.map((r) => r[k]));
  return {
    build: m("build"), inRect: m("inRect"), atPoint: m("atPoint"), removeMultiple: m("removeMultiple"),
    rectHits: runs[0].rectHits, pointHits: runs[0].pointHits,
  };
}

const locators: [string, () => ShapeLocator][] = [
  ["ListLocator", () => new ListLocator()],
  ["QuadTreeLocator", () => new QuadTreeLocator()],
];

/** Prints the locator table, and whether the locators agreed on what they found. */
function locatorTable(): boolean {
  const rows: string[][] = [[
    "strokes", "locator", "build ms", "add us", "inRect us/query", "atPoint us/query",
    "removeMultiple 10% ms", "inRect hits", "atPoint hits",
  ]];
  let agree = true;
  for (const size of COUNTS) {
    const w = workload(size);
    const results = locators.map(([name, make]) => [name, measure(make, w)] as const);
    const [, first] = results[0];
    for (const [name, r] of results) {
      if (r.rectHits !== first.rectHits || r.pointHits !== first.pointHits) agree = false;
      rows.push([
        count(size), name, fmt(r.build, 3), fmt((r.build * 1000) / size, 3),
        fmt((r.inRect * 1000) / QUERIES, 3), fmt((r.atPoint * 1000) / QUERIES, 3),
        fmt(r.removeMultiple, 3), String(r.rectHits), String(r.pointHits),
      ]);
    }
  }
  console.log(`Canvas ${CANVAS} x ${CANVAS}, eraser ${ERASER} x ${ERASER}, ${QUERIES} queries of each kind, median of ${RUNS} runs after ${WARMUP} warm-up runs\n`);
  table(rows, 2);
  return agree;
}

// ---- The strokes the log-amortized measurements use -----------------------

/** Black ink, for every stroke these measurements make. */
const INK = { r: 0, g: 0, b: 0, a: 1 };

/** A random walk of n points from (x, y), a few units per step. */
function walkFrom(rand: () => number, x: number, y: number, n: number, thickness: number): InkStroke {
  const points: Point[] = [];
  let heading = rand() * 2 * Math.PI;
  let px = x;
  let py = y;
  for (let i = 0; i < n; i++) {
    points.push({ x: px, y: py });
    heading += (rand() - 0.5) * 1.2;
    const step = 1 + rand() * 6;
    px += Math.cos(heading) * step;
    py += Math.sin(heading) * step;
  }
  return makeInkStroke({ points, thickness, color: INK });
}

// ---- The circles app's circles --------------------------------------------
//
// Their sizes, colors and layout are this script's to choose; the output
// states them. A model circle sits in its own cell of the grid, its center
// within JITTER of the cell's center, and is wide enough beside the cell that
// neighbours often overlap, so that a tap finds more than one circle and
// compareZ has something to decide.

/** The colors the circles app paints the model's circles with, taken in turn. */
const PALETTE = [
  { r: 220, g: 70, b: 70, a: 1 },
  { r: 60, g: 140, b: 220, a: 1 },
  { r: 90, g: 180, b: 100, a: 1 },
  { r: 240, g: 190, b: 60, a: 1 },
  { r: 150, g: 90, b: 200, a: 1 },
];
/** The color a tap draws with: the app's current pen. */
const DRAW_COLOR = { r: 40, g: 40, b: 45, a: 1 };
/** How far a model circle's center lies from its cell's center, at most, on each axis. */
const JITTER = CELL / 4;
/**
 * A model circle's radius lies in this range, which reaches past a cell, so
 * that a tap finds two or three circles and compareZ has something to decide.
 */
const MIN_RADIUS = CELL * 0.3;
const MAX_RADIUS = CELL * 1.3;
/** The radius a tap draws with. */
const DRAW_RADIUS = CELL * 0.8;

/** The circle of cell i of the grid: jittered within its cell, in the next color. */
function cellCircle(rand: () => number, i: number): Circle {
  return makeCircle({
    center: {
      x: (i % GRID) * CELL + CELL / 2 + (rand() - 0.5) * 2 * JITTER,
      y: Math.floor(i / GRID) * CELL + CELL / 2 + (rand() - 0.5) * 2 * JITTER,
    },
    radius: MIN_RADIUS + rand() * (MAX_RADIUS - MIN_RADIUS),
    color: PALETTE[i % PALETTE.length],
  });
}

// ---- The stand-in for the message infrastructure --------------------------

/** op with the seq the collaboration protocol assigned it: its acknowledgment. */
function withSeq(op: ShapeOp, seq: number): ShapeOp {
  if (op.type === "add") return { ...op, seq };
  if (op.type === "remove") return { ...op, seq };
  return { ...op, seq };
}

/**
 * A stand-in for the message infrastructure (dataModel.ts): it queues what a
 * controller sends with local.enqueue, gives the operation that returns the
 * next seq and enqueues it on remote as its acknowledgment, delivers a peer
 * client's adds and clears on remote, and calls process. It enqueues nothing
 * while process is pending.
 */
class Infra {
  private readonly target: ShapeProcessor;
  /** Another client, whose adds arrive on the target's remote queue. */
  private readonly peer: ShapeProcessor;
  /** The seq the protocol assigns next. */
  private seq = 0;

  constructor(target: ShapeProcessor, peer: ShapeProcessor) {
    this.target = target;
    this.peer = peer;
  }

  /** The read side a controller holds. */
  get model(): ShapeCollection {
    return this.target.model;
  }

  /** An ID for a shape this client adds. */
  newId(): ShapeId {
    return this.target.newShapeId();
  }

  /** Queues content on the local queue, and returns it stamped. */
  send(content: OperationContent<ShapeOp>): ShapeOp {
    return this.target.local.enqueue(content);
  }

  /** Queues op's acknowledgment, with the seq the protocol gives it. */
  acknowledge(op: ShapeOp): void {
    this.target.remote.enqueue(withSeq(op, this.seq++));
  }

  /** Sends content and acknowledges it at once. */
  sendAcked(content: OperationContent<ShapeOp>): void {
    this.acknowledge(this.send(content));
  }

  /** Queues an add of the peer's, sequenced next. */
  deliverAdd(shape: Shape): void {
    const op = this.peer.local.enqueue({ type: "add", id: this.peer.newShapeId(), shape });
    this.target.remote.enqueue(withSeq(op, this.seq++));
  }

  /**
   * Queues a clear of the peer's, sequenced next. The peer has applied no
   * remote operation, so the processor stamps the clear with refSeq -1: it
   * knew none of the shapes the target holds, and, when the peer has made no
   * adds of its own, the clear removes nothing.
   */
  deliverClear(): void {
    const op = this.peer.local.enqueue({ type: "clear" });
    this.target.remote.enqueue(withSeq(op, this.seq++));
  }

  /** Applies everything queued. */
  settle(): Promise<void> {
    return this.target.process();
  }
}

/** Every processor gets its own client ID, as a client of its own would. */
let clients = 0;

/** A processor over a MapShapeCollection over a QuadTreeLocator, and its infrastructure. */
function wired(): Infra {
  const n = clients++;
  return new Infra(
    new ShapeProcessor(`local-${n}`, new MapShapeCollection(new QuadTreeLocator())),
    new ShapeProcessor(`peer-${n}`, new MapShapeCollection(new QuadTreeLocator())),
  );
}

/** Adds shapes through infra, acknowledged, settling every chunk operations. */
async function fill(infra: Infra, shapes: readonly Shape[], chunk: number, made?: Map<ShapeId, Shape>): Promise<void> {
  for (let i = 0; i < shapes.length; i++) {
    const id = infra.newId();
    made?.set(id, shapes[i]);
    infra.sendAcked({ type: "add", id, shape: shapes[i] });
    if ((i + 1) % chunk === 0) await infra.settle();
  }
  await infra.settle();
}

// ---- The frame budget: frames.fraction-of-frame ---------------------------

interface Budgeted {
  label: string;
  /** Milliseconds, median over the timed taps. */
  median: number;
}

/**
 * Times what one of the circles app's taps forms, sends and processes, with
 * MODEL_CIRCLES circles in the model: a tap that draws a circle, and a tap
 * that erases the top circle under it. Each tap puts the model back to
 * MODEL_CIRCLES circles afterward, untimed, so that every timed tap sees the
 * same number of shapes.
 */
async function frameBudget(): Promise<{ results: Budgeted[]; found: number }> {
  const rand = seeded(0x1cebabe);
  const infra = wired();
  const made = new Map<ShapeId, Shape>();
  const model: Circle[] = [];
  for (let cell = 0; cell < MODEL_CIRCLES; cell++) model.push(cellCircle(rand, cell));
  await fill(infra, model, FILL_CHUNK, made);

  // Where the taps land: a drawing tap anywhere on the canvas, and an erasing
  // tap on the center of one of the model's circles, which that circle
  // contains, so that every timed erasing tap erases one. The two sequences
  // walk the canvas, so that no two taps work the same cells.
  const draws = Array.from({ length: TAP_WARMUP + TAPS }, (): Point => ({
    x: rand() * CANVAS, y: rand() * CANVAS,
  }));
  const erases = Array.from({ length: TAP_WARMUP + TAPS }, (_, i) => model[(i * 97) % MODEL_CIRCLES].center);

  // A tap that draws: a new ID, the circle, the add, and processing it and
  // its acknowledgment.
  const drawing: number[] = [];
  for (let i = 0; i < TAP_WARMUP + TAPS; i++) {
    const at = draws[i];
    const start = performance.now();
    const id = infra.newId();
    const shape = makeCircle({ center: at, radius: DRAW_RADIUS, color: DRAW_COLOR });
    infra.sendAcked({ type: "add", id, shape });
    await infra.settle();
    const ms = performance.now() - start;
    if (i >= TAP_WARMUP) drawing.push(ms);
    // Untimed, so that every timed tap sees MODEL_CIRCLES circles.
    infra.sendAcked({ type: "remove", ids: [id] });
    await infra.settle();
  }

  // A tap that erases: the circles under the tap, the top one of them, the
  // remove, and processing it and its acknowledgment.
  const erasing: number[] = [];
  const under: ShapeId[] = [];
  let found = 0;
  for (let i = 0; i < TAP_WARMUP + TAPS; i++) {
    const at = erases[i];
    under.length = 0;
    const start = performance.now();
    const n = infra.model.atPoint(at, under);
    let top: ShapeId | undefined;
    for (let k = 0; k < n; k++) {
      const id = under[k];
      if (top === undefined || infra.model.compareZ(id, top) > 0) top = id;
    }
    if (top !== undefined) infra.sendAcked({ type: "remove", ids: [top] });
    await infra.settle();
    const ms = performance.now() - start;
    if (i >= TAP_WARMUP) {
      erasing.push(ms);
      found += n;
      if (top === undefined) everyTapErased = false;
    }
    // Untimed: the erased circle goes back, under a fresh ID, so that every
    // timed tap sees MODEL_CIRCLES circles.
    if (top !== undefined) {
      const shape = made.get(top)!;
      made.delete(top);
      const fresh = infra.newId();
      made.set(fresh, shape);
      infra.sendAcked({ type: "add", id: fresh, shape });
      await infra.settle();
    }
  }

  return {
    results: [
      { label: "a tap that draws", median: median(drawing) },
      { label: "a tap that erases", median: median(erasing) },
    ],
    found,
  };
}

// ---- The log-amortized budgets --------------------------------------------

interface Batch {
  /** Milliseconds for the whole batch. */
  ms: number;
  /** The operations in it. */
  ops: number;
}

interface Pattern {
  /** The budget the pattern measures. */
  rule: string;
  label: string;
  /** Times one batch over a collection holding n of the pooled shapes. */
  run(n: number, pool: readonly InkStroke[], rand: () => number): Promise<Batch>;
}

/** A short two-point stroke, anywhere on the canvas. */
function segment(rand: () => number): InkStroke {
  return walkFrom(rand, rand() * CANVAS, rand() * CANVAS, 2, 2);
}

/**
 * A MapShapeCollection over a QuadTreeLocator holding the pool's first n
 * shapes, each added on top, with their IDs from the bottom of the z-order up.
 */
function filled(pool: readonly InkStroke[], n: number): { shapes: MapShapeCollection; ids: ShapeId[] } {
  const shapes = new MapShapeCollection(new QuadTreeLocator());
  const ids: ShapeId[] = [];
  for (let i = 0; i < n; i++) {
    const id = String(i) as ShapeId;
    shapes.add(id, pool[i]);
    ids.push(id);
  }
  return { shapes, ids };
}

/** BATCH numbers in [0, 1), drawn before the clock starts. */
const picks = (rand: () => number) => Array.from({ length: BATCH }, () => rand());

const patterns: Pattern[] = [
  {
    rule: WRITER_RULE,
    label: "adds, each directly below the same shape",
    run: async (n, pool) => {
      const { shapes, ids } = filled(pool, n);
      const below = ids[n >> 1];
      const start = performance.now();
      for (let i = 0; i < BATCH; i++) shapes.add(String(n + i) as ShapeId, pool[n + i], below);
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: WRITER_RULE,
    label: "adds, each directly below the one added before it",
    run: async (n, pool) => {
      const { shapes, ids } = filled(pool, n);
      let below = ids[n - 1];
      const start = performance.now();
      for (let i = 0; i < BATCH; i++) {
        const id = String(n + i) as ShapeId;
        shapes.add(id, pool[n + i], below);
        below = id;
      }
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: WRITER_RULE,
    label: "adds at the bottom",
    run: async (n, pool) => {
      const { shapes, ids } = filled(pool, n);
      let below = ids[0];
      const start = performance.now();
      for (let i = 0; i < BATCH; i++) {
        const id = String(n + i) as ShapeId;
        shapes.add(id, pool[n + i], below);
        below = id;
      }
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: WRITER_RULE,
    label: "adds below random present shapes",
    run: async (n, pool, rand) => {
      const { shapes, ids } = filled(pool, n);
      const present = [...ids];
      const where = picks(rand);
      const start = performance.now();
      for (let i = 0; i < BATCH; i++) {
        const id = String(n + i) as ShapeId;
        shapes.add(id, pool[n + i], present[Math.floor(where[i] * present.length)]);
        present.push(id);
      }
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: WRITER_RULE,
    label: "removes of random present shapes, mixed with adds",
    run: async (n, pool, rand) => {
      const { shapes, ids } = filled(pool, n);
      const present = [...ids];
      const where = picks(rand);
      const start = performance.now();
      // One add on top and one remove of a random present shape, in turn, so
      // the collection stays about n shapes.
      for (let i = 0; i < BATCH; i += 2) {
        const id = String(n + i) as ShapeId;
        shapes.add(id, pool[n + i]);
        present.push(id);
        const j = Math.floor(where[i] * present.length);
        checksum += shapes.remove([present[j]]);
        present[j] = present[present.length - 1];
        present.pop();
      }
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: WRITER_RULE,
    label: "compareZ on random pairs",
    run: async (n, pool, rand) => {
      const { shapes, ids } = filled(pool, n);
      const left = picks(rand);
      const right = picks(rand);
      const start = performance.now();
      for (let i = 0; i < BATCH; i++) {
        checksum += Math.sign(shapes.compareZ(ids[Math.floor(left[i] * n)], ids[Math.floor(right[i] * n)]));
      }
      return { ms: performance.now() - start, ops: BATCH };
    },
  },
  {
    rule: PROCESSOR_RULE,
    label: "remote adds while one local add is pending, then local adds",
    run: async (n, pool) => {
      const infra = wired();
      await fill(infra, pool.slice(0, n), FILL_CHUNK);
      const half = BATCH >> 1;
      const start = performance.now();
      // The local add stays pending through the whole call, so every remote
      // add that follows goes directly below its shape.
      infra.send({ type: "add", id: infra.newId(), shape: pool[n] });
      for (let i = 0; i < half; i++) infra.deliverAdd(pool[n + 1 + i]);
      await infra.settle();
      for (let i = 0; i < half; i++) {
        infra.send({ type: "add", id: infra.newId(), shape: pool[n + 1 + half + i] });
      }
      await infra.settle();
      return { ms: performance.now() - start, ops: 1 + 2 * half };
    },
  },
  {
    rule: PROCESSOR_RULE,
    label: "remote clears that remove nothing, from a client that knew no shape",
    run: async (n, pool) => {
      const infra = wired();
      await fill(infra, pool.slice(0, n), FILL_CHUNK);
      const before = infra.model.size;
      const start = performance.now();
      // The peer made no adds, and its clears' refSeq is from before the
      // target's shapes were added, so each clear knows none of them and every
      // shape stays. The budget allows a clear the time of the shapes it
      // removes, which here is none, not of the shapes present.
      for (let i = 0; i < BATCH; i++) infra.deliverClear();
      await infra.settle();
      const ms = performance.now() - start;
      if (infra.model.size !== before) clearsRemovedNothing = false;
      checksum += infra.model.size - before;
      return { ms, ops: BATCH };
    },
  },
];

interface Ratio {
  rule: string;
  label: string;
  /** Microseconds per operation at SMALL and at LARGE shapes. */
  small: number;
  large: number;
  ratio: number;
}

async function ratios(pool: readonly InkStroke[]): Promise<Ratio[]> {
  const out: Ratio[] = [];
  for (const pattern of patterns) {
    const per: number[] = [];
    for (const n of [SMALL, LARGE]) {
      const samples: number[] = [];
      for (let r = 0; r < RATIO_WARMUP + RATIO_RUNS; r++) {
        const batch = await pattern.run(n, pool, seeded(0xba7c4 + r));
        if (r >= RATIO_WARMUP) samples.push((batch.ms * 1000) / batch.ops);
      }
      per.push(median(samples));
    }
    out.push({ rule: pattern.rule, label: pattern.label, small: per[0], large: per[1], ratio: per[1] / per[0] });
  }
  return out;
}

// ---- Running --------------------------------------------------------------

const started = performance.now();
console.log(`Machine: ${cpus()[0]?.model.trim() ?? "unknown CPU"}, ${osType()} ${release()}, Node ${process.version}`);
console.log("");
const agree = locatorTable();

const frames = await frameBudget();
console.log(`\n${FRAME_RULE}: forming, sending and processing one input event's operations, budget ${fmt(FRAME_BUDGET, 3)} ms (5% of a 120 Hz frame)`);
console.log(`The circles app's taps, with ${count(MODEL_CIRCLES)} circles from makeCircle in the model: one per cell of a ${GRID} x ${GRID} grid over the ${CANVAS} x ${CANVAS} canvas, each centered within ${fmt(JITTER, 0)} units of its cell's center, of radius ${fmt(MIN_RADIUS, 0)} to ${fmt(MAX_RADIUS, 0)} units, in ${PALETTE.length} colors taken in turn, so that neighbours often overlap; through a ShapeProcessor over a MapShapeCollection over a QuadTreeLocator; median of ${TAPS} taps after ${TAP_WARMUP} warm-up taps. A drawing tap makes a circle of radius ${fmt(DRAW_RADIUS, 0)} anywhere on the canvas; an erasing tap lands on the center of one of the model's circles, finds ${fmt(frames.found / TAPS, 2)} circles there on average, and erases the topmost.\n`);
const budgetRows = [["measurement", "median ms", "fraction of budget", ""]];
for (const r of frames.results) {
  budgetRows.push([
    r.label, fmt(r.median, 4), fmt(r.median / FRAME_BUDGET, 3),
    r.median > FRAME_BUDGET ? "OVER BUDGET" : "",
  ]);
}
table(budgetRows, 1);

const pool = (() => {
  const rand = seeded(0x5ca1ab1e);
  return Array.from({ length: LARGE + BATCH + 2 }, () => segment(rand));
})();
const measured = await ratios(pool);
for (const rule of [WRITER_RULE, PROCESSOR_RULE]) {
  const rows = measured.filter((r) => r.rule === rule);
  if (rows.length === 0) continue;
  console.log(`\n${rule}: the time per operation at ${count(LARGE)} shapes divided by the time at ${count(SMALL)} (about 2 steps for logarithmic growth and about ${count(LARGE / SMALL)} for linear, so ${RATIO_EXPECTED} in measured time for a logarithmic structure, which misses the caches at ${count(LARGE)} shapes; above ${RATIO_LIMIT} fails)`);
  console.log(`Batches of ${count(BATCH)} operations on a MapShapeCollection over a QuadTreeLocator, holding two-point strokes of thickness 2 scattered over the ${CANVAS} x ${CANVAS} canvas; median of ${RATIO_RUNS} runs after ${RATIO_WARMUP} warm-up run.`);
  if (rule === PROCESSOR_RULE) {
    console.log("Through a ShapeProcessor and the stand-in for the message infrastructure. The clears come from a peer client that made no adds and whose refSeq is from before the shapes were added, so each knows none of them and all of them stay: the budget allows a clear the time of the shapes it removes, not of the shapes present.");
  }
  console.log("");
  const ratioRows = [["pattern", `us/op at ${count(SMALL)}`, `us/op at ${count(LARGE)}`, "ratio", ""]];
  for (const r of rows) {
    ratioRows.push([
      r.label, fmt(r.small, 3), fmt(r.large, 3), fmt(r.ratio, 2),
      r.ratio > RATIO_LIMIT ? "FAILS THE BUDGET" : "",
    ]);
  }
  table(ratioRows, 1);
}

console.log(`\nChecksum (so that the timed work can't be optimized away): ${checksum}`);
console.log(`Whole run: ${fmt((performance.now() - started) / 1000, 1)} s`);
const over = measured.filter((r) => r.ratio > RATIO_LIMIT);
if (over.length > 0) {
  console.error(`\n${over.map((r) => `${r.rule}: ${r.label} grew by ${fmt(r.ratio, 2)}, above ${RATIO_LIMIT}`).join("\n")}`);
  process.exitCode = 1;
}
if (!agree) {
  console.error("\nThe locators reported different hit counts.");
  process.exitCode = 1;
}
if (!clearsRemovedNothing) {
  console.error("\nA clear that knew none of the shapes present removed some of them, so its measurement isn't of a clear that removes nothing.");
  process.exitCode = 1;
}
if (!everyTapErased) {
  console.error("\nA timed erasing tap found no circle under it, so its measurement isn't of a tap that erases.");
  process.exitCode = 1;
}
