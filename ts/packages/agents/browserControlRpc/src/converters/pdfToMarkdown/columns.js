// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/columns.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/columns.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// Text columns of a page, from block boxes alone — a port of src/papero_extract/columns.py.
// A gutter is a vertical strip that (almost) no text crosses, with text on both sides; a
// title or figure spanning the columns may cross it. The layout pass measures alignment
// against the block's own column, and the exporters turn columns into HTML/Word columns.

const STEP = 2; // pt per coverage bin
const MIN_GUTTER = 6; // pt

// code-complexity-allow: pinned Papero column gutter algorithm
export function gutters(boxes) {
  if (boxes.length < 3) return [];
  const left = Math.min(...boxes.map((b) => b[0])), right = Math.max(...boxes.map((b) => b[2]));
  const n = Math.floor((right - left) / STEP) + 1;
  if (n < 20) return [];
  // How much text height crosses each strip. Blocks as wide as the page (a table and a
  // figure over two short columns of text) say nothing about a gutter: they are counted
  // apart, only to tell how much of the page the columns are.
  const cover = new Array(n).fill(0), everything = new Array(n).fill(0);
  for (const [x0, y0, x1, y1] of boxes) {
    const wide = x1 - x0 > (right - left) * 0.6;
    const to = Math.min(n, Math.floor((x1 - left) / STEP));
    for (let k = Math.max(0, Math.floor((x0 - left) / STEP) + 1); k < to; k++) {
      everything[k] += y1 - y0;
      if (!wide) cover[k] += y1 - y0;
    }
  }
  const peak = Math.max(...cover);
  if (peak <= 0) return [];
  const whole = Math.max(...everything);
  const out = [];
  let k = 0;
  while (k < n) {
    if (cover[k] > peak * 0.4) { k++; continue; }
    let j = k;
    while (j < n && cover[j] <= peak * 0.4) j++;
    // The valley floor: what crosses it is only titles, figures… spanning the columns.
    const floor = Math.min(...cover.slice(k, j));
    let a = k;
    while (a < j) {
      if (cover[a] > floor + peak * 0.02) { a++; continue; }
      let b = a;
      while (b < j && cover[b] <= floor + peak * 0.02) b++;
      if (a > 0 && b < n && (b - a) * STEP >= MIN_GUTTER) {
        const sides = Math.min(Math.max(...cover.slice(0, a)), Math.max(...cover.slice(b)));
        if (sides >= Math.max(peak, whole * 0.6) * 0.25 && floor <= sides * 0.4) out.push([left + a * STEP, left + b * STEP]);
      }
      a = b;
    }
    k = j;
  }
  // A column of text is wide. A strip of equation numbers down the margin, or the labels
  // beside a picture, is not a column: the gutter that would make one goes.
  const narrow = Math.max(60, (right - left) * 0.12);
  while (out.length) {
    const edges = [left, ...out.map(([g0, g1]) => (g0 + g1) / 2), right];
    const thin = edges.findIndex((e, i) => i + 1 < edges.length && edges[i + 1] - e < narrow);
    if (thin < 0) break;
    out.splice(Math.min(thin, out.length - 1), 1);
  }
  return out;
}

// Left/right edge of each column (one column when there is no gutter).
export function columns(boxes) {
  if (!boxes.length) return [];
  const mids = gutters(boxes).map((g) => (g[0] + g[1]) / 2);
  const left = Math.min(...boxes.map((b) => b[0])), right = Math.max(...boxes.map((b) => b[2]));
  const los = [left - 1, ...mids], his = [...mids, right + 1];
  return los.map((lo, i) => {
    const inside = boxes.filter((b) => b[0] >= lo && b[2] <= his[i]);
    return inside.length ? [Math.min(...inside.map((b) => b[0])), Math.max(...inside.map((b) => b[2]))] : [lo, his[i]];
  });
}

const overlaps = (box, c) => Math.min(box[2], c[1]) - Math.max(box[0], c[0]) > 1;

// Index of the column the box sits in; null when it spans more than one.
export function columnOf(box, cols) {
  const hits = cols.map((c, i) => (overlaps(box, c) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 1) return hits[0];
  if (hits.length) return null;
  const mid = (box[0] + box[2]) / 2; // in a gutter: the nearest column
  let best = 0;
  cols.forEach((c, i) => { if (Math.abs((c[0] + c[1]) / 2 - mid) < Math.abs((cols[best][0] + cols[best][1]) / 2 - mid)) best = i; });
  return best;
}

// The text area a block lays out against: its column, or the columns it spans.
export function areaOf(box, cols) {
  const i = columnOf(box, cols);
  if (i !== null) return cols[i];
  const hits = cols.filter((c) => overlaps(box, c));
  return [hits[0][0], hits[hits.length - 1][1]];
}

// Split a page's blocks (in reading order) into horizontal bands: full-width runs and
// multi-column runs, each column keeping its blocks in reading order.
// -> [{ columns: [[x0, x1], …], blocks: [[…], […]] }]
export function bands(blocks) {
  // Figures don't count: a grid of pictures has gaps that are not gutters.
  const cols = columns(blocks.filter((b) => b.bbox && b.type !== "figure").map((b) => b.bbox));
  if (cols.length < 2) return blocks.length ? [{ columns: cols, blocks: [[...blocks]] }] : [];
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const i = b.bbox ? columnOf(b.bbox, cols) : (last && last.blocks.length > 1 ? 0 : null);
    if (i === null) {
      if (!last || last.blocks.length > 1) out.push({ columns: [[cols[0][0], cols[cols.length - 1][1]]], blocks: [[]] });
      out[out.length - 1].blocks[0].push(b);
    } else {
      if (!last || last.blocks.length === 1) out.push({ columns: cols.map((c) => [...c]), blocks: cols.map(() => []) });
      out[out.length - 1].blocks[i].push(b);
    }
  }
  return out;
}
