/**
 * bench is a script: it measures the budgets of the locators and of the shape
 * model, and supplies the measured numbers in the Cost and Choose when fields
 * of listLocator.ts, quadTreeLocator.ts, mapShapeCollection.ts and
 * shapeProcessor.ts.
 *
 * How: Three sections, each labeled with the ID of the budget it measures. The
 * locator table times ListLocator and QuadTreeLocator building, querying and
 * bulk-removing 100, 1,000 and 10,000 scattered ink strokes.
 * frames.fraction-of-frame times finishing a stroke and an eraser move
 * through a stand-in for the message infrastructure over a ShapeProcessor on a
 * MapShapeCollection over a QuadTreeLocator holding 10,000 strokes, and prints
 * each median as a fraction of 5% of a 120 Hz frame; each move is timed from
 * the controller's first call to the end of process, with the stroke and the
 * swept rectangle made beforehand, as the view makes them while drawing, and
 * the model put back to 10,000 strokes afterward, untimed.
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
 * queries found, or when a clear that should remove nothing removes something,
 * which would make its measurement another measurement entirely; exceeding the
 * frame budget is printed, not a failure, because timing is flaky.
 * Imports: geometry.ts, shape.ts, dataModel.ts, shapeModel.ts, listLocator.ts, quadTreeLocator.ts, inkStroke.ts, mapShapeCollection.ts, shapeProcessor.ts, node:os
 */

import { cpus, release, type as osType } from "node:os";
import type { Point, Rectangle } from "./geometry.ts";
import type { InkStroke, Shape, ShapeId, ShapeLocator } from "./shape.ts";
import type { OperationContent } from "./dataModel.ts";
import type { ShapeCollection, ShapeOp } from "./shapeModel.ts";
import { ListLocator } from "./listLocator.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { makeInkStroke } from "./inkStroke.ts";
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
/** The strokes in the model the frame budget is measured against. */
const MODEL_STROKES = 10_000;
/** The model's strokes lie one per cell of a GRID x GRID grid over the canvas. */
const GRID = 100;
const CELL = CANVAS / GRID;
/** Timed moves, and the moves run first to warm the code up. */
const MOVES = 101;
const MOVE_WARMUP = 20;

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

// ---- The shapes the model measurements use --------------------------------

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

/** A stroke a hand would draw in one cell of the grid: 2 to 20 points, thickness 1 to 8. */
function cellStroke(rand: () => number, x: number, y: number): InkStroke {
  return walkFrom(rand, x, y, 2 + Math.floor(rand() * 19), 1 + Math.floor(rand() * 8));
}

/** The eraser is a round pen of this diameter, dragged along a move. */
const ERASER_PEN = ERASER;

/**
 * The rectangle an eraser move sweeps: the extents of the pen dragged from a
 * to b, which are those of a two-point stroke of the pen's thickness.
 */
function swept(a: Point, b: Point): Rectangle {
  return makeInkStroke({ points: [a, b], thickness: ERASER_PEN, color: INK }).boundingBox();
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
async function fill(infra: Infra, shapes: readonly InkStroke[], chunk: number, made?: Map<ShapeId, Shape>): Promise<void> {
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
  /** Milliseconds, median over the timed moves. */
  median: number;
}

/**
 * Times what one input event sends and processes, with MODEL_STROKES strokes
 * in the model: finishing a stroke, and an eraser move. Each move puts the
 * model back to MODEL_STROKES strokes afterward, untimed, so that every timed
 * move sees the same number of shapes.
 */
async function frameBudget(): Promise<{ results: Budgeted[]; hits: number }> {
  const rand = seeded(0x1cebabe);
  const infra = wired();
  const made = new Map<ShapeId, Shape>();
  const model: InkStroke[] = [];
  for (let cell = 0; cell < MODEL_STROKES; cell++) {
    const x = (cell % GRID) * CELL + rand() * CELL * 0.6;
    const y = Math.floor(cell / GRID) * CELL + rand() * CELL * 0.6;
    model.push(cellStroke(rand, x, y));
  }
  await fill(infra, model, FILL_CHUNK, made);

  // The strokes a pen finishes, and the rectangles an eraser sweeps: each at
  // its own place on the canvas, so that no two moves work the same cells.
  // Each move starts on a stroke of the model, so that every move erases.
  const drawn = Array.from({ length: MOVE_WARMUP + MOVES }, (_, i) =>
    cellStroke(rand, ((i * 131) % (CANVAS - 200)) + 100, ((i * 71) % (CANVAS - 200)) + 100));
  const sweeps = Array.from({ length: MOVE_WARMUP + MOVES }, (_, i) => {
    const a = model[(i * 97) % MODEL_STROKES].points[0];
    return swept(a, { x: a.x + 15, y: a.y + 10 });
  });

  // Finishing a stroke: the add of the stroke the view has been drawing.
  const finishing: number[] = [];
  for (let i = 0; i < MOVE_WARMUP + MOVES; i++) {
    const shape = drawn[i];
    const start = performance.now();
    const id = infra.newId();
    infra.sendAcked({ type: "add", id, shape });
    await infra.settle();
    const ms = performance.now() - start;
    if (i >= MOVE_WARMUP) finishing.push(ms);
    infra.sendAcked({ type: "remove", ids: [id] });
    await infra.settle();
  }

  // An eraser move: what the swept rectangle hits, removed.
  const erasing: number[] = [];
  const hit: ShapeId[] = [];
  let hits = 0;
  for (let i = 0; i < MOVE_WARMUP + MOVES; i++) {
    const rect = sweeps[i];
    hit.length = 0;
    const start = performance.now();
    infra.model.inRect(rect, hit);
    infra.sendAcked({ type: "remove", ids: hit });
    await infra.settle();
    const ms = performance.now() - start;
    if (i >= MOVE_WARMUP) {
      erasing.push(ms);
      hits += hit.length;
    }
    for (const id of hit) {
      const shape = made.get(id)!;
      made.delete(id);
      const fresh = infra.newId();
      made.set(fresh, shape);
      infra.sendAcked({ type: "add", id: fresh, shape });
    }
    await infra.settle();
  }

  return {
    results: [
      { label: "finishing a stroke", median: median(finishing) },
      { label: "an eraser move", median: median(erasing) },
    ],
    hits,
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
console.log(`\n${FRAME_RULE}: sending and processing one input event's operations, budget ${fmt(FRAME_BUDGET, 3)} ms (5% of a 120 Hz frame)`);
console.log(`${count(MODEL_STROKES)} ink strokes of 2 to 20 points and thickness 1 to 8 in the model, one per cell of a ${GRID} x ${GRID} grid over the ${CANVAS} x ${CANVAS} canvas, through a ShapeProcessor over a MapShapeCollection over a QuadTreeLocator; median of ${MOVES} moves after ${MOVE_WARMUP} warm-up moves. A finished stroke is one more such stroke; an eraser move drags a ${ERASER_PEN}-unit round pen 15 units right and 10 down from a point on a stroke, and hit ${fmt(frames.hits / MOVES, 2)} strokes per move on average.\n`);
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
