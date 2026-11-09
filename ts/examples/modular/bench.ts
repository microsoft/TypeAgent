/**
 * bench implements no interface: it is the benchmark that supplies the measured numbers in the Cost and Choose when fields of listLocator.ts and quadTreeLocator.ts.
 *
 * How: For 100, 1,000 and 10,000 ink strokes scattered over a 10,000 x 10,000 canvas by a hand-written seeded generator (mulberry32), it times each locator building the index, answering 1,000 eraser-sized (20 x 20) inRect queries and 1,000 atPoint queries, and one removeMultiple of a random 10% of the strokes. Each measurement is the median of 9 runs after 2 warm-up runs; every run rebuilds from the same strokes. Run with npm run bench.
 * Choose when: Re-run after changing a locator or InkStroke, and update the headers it feeds.
 * Cost: About 3 seconds; dominated by ListLocator's 10,000-stroke queries.
 * AdditionalSemantics: Prints the machine (CPU model, OS, Node version) with the table. The hits columns count all IDs reported over a run's queries; both locators must agree, and the script exits with an error if they don't.
 * Parts: The seeded generator and the median timer could become shared test utilities.
 * Imports: geometry.ts, shape.ts, listLocator.ts, quadTreeLocator.ts, inkStroke.ts, node:os
 */

import { cpus, release, type as osType } from "node:os";
import type { Point, Rectangle } from "./geometry.ts";
import type { InkStroke, ShapeId, ShapeLocator } from "./shape.ts";
import { ListLocator } from "./listLocator.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { makeInkStroke } from "./inkStroke.ts";

const CANVAS = 10_000;
const ERASER = 20;
const QUERIES = 1_000;
const RUNS = 9;
const WARMUP = 2;
const COUNTS = [100, 1_000, 10_000];

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

function workload(count: number): Workload {
  const rand = seeded(0x5eed + count);
  const strokes = Array.from({ length: count }, () => randomStroke(rand));
  const rects = Array.from({ length: QUERIES }, () => ({
    x: rand() * CANVAS, y: rand() * CANVAS, width: ERASER, height: ERASER,
  }));
  // Half the points land on a stroke's vertex, so that atPoint finds something; half are anywhere.
  const points = Array.from({ length: QUERIES }, (_, i) => {
    if (i % 2 === 0) return { x: rand() * CANVAS, y: rand() * CANVAS };
    const s = strokes[Math.floor(rand() * count)];
    return s.points[Math.floor(rand() * s.points.length)];
  });
  const ids = strokes.map((_, i) => (i + 1) as ShapeId);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { strokes, rects, points, toRemove: ids.slice(0, Math.floor(count / 10)) };
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
  w.strokes.forEach((s, i) => locator.add((i + 1) as ShapeId, s));
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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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

const fmt = (v: number, digits: number) => v.toFixed(digits);
const rows: string[][] = [[
  "strokes", "locator", "build ms", "add us", "inRect us/query", "atPoint us/query",
  "removeMultiple 10% ms", "inRect hits", "atPoint hits",
]];
let disagree = false;

for (const count of COUNTS) {
  const w = workload(count);
  const results = locators.map(([name, make]) => [name, measure(make, w)] as const);
  const [, first] = results[0];
  for (const [name, r] of results) {
    if (r.rectHits !== first.rectHits || r.pointHits !== first.pointHits) disagree = true;
    rows.push([
      count.toLocaleString("en-US"), name, fmt(r.build, 3), fmt((r.build * 1000) / count, 3),
      fmt((r.inRect * 1000) / QUERIES, 3), fmt((r.atPoint * 1000) / QUERIES, 3),
      fmt(r.removeMultiple, 3), String(r.rectHits), String(r.pointHits),
    ]);
  }
}

const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
const line = (r: string[]) => r.map((v, c) => (c < 2 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join("  ");
console.log(`Machine: ${cpus()[0]?.model.trim() ?? "unknown CPU"}, ${osType()} ${release()}, Node ${process.version}`);
console.log(`Canvas ${CANVAS} x ${CANVAS}, eraser ${ERASER} x ${ERASER}, ${QUERIES} queries of each kind, median of ${RUNS} runs after ${WARMUP} warm-up runs\n`);
console.log(line(rows[0]));
console.log(widths.map((n) => "-".repeat(n)).join("  "));
for (const r of rows.slice(1)) console.log(line(r));
if (disagree) {
  console.error("\nThe locators reported different hit counts.");
  process.exitCode = 1;
}
