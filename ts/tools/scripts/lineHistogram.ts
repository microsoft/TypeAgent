// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Line-count histogram for the TypeAgent ts/ tree.
 *
 * Scans for source files, buckets them by line count, and emits:
 *   - files-by-lines.csv  : every file with its line count and bucket
 *   - histogram.json      : the bucketed histogram data
 *   - histogram.html      : a self-contained bar chart (open in a browser)
 * plus a console summary (histogram, totals, top 25 largest files).
 *
 * Usage:
 *   npx tsx tools/scripts/lineHistogram.ts [options]
 *   npm run line-histogram -- [options]
 *
 * Options:
 *   --include-tests        Include test files (*.spec.*, *.test.*, and files
 *                          under test/ tests/ __tests__/). Excluded by default.
 *   --verbose [n]          After the histogram, list every file whose line count
 *                          exceeds n. n defaults to 2000 when omitted.
 *   --bucket-size <n>      Histogram bucket size in lines (default 500).
 *   --root <path>          Directory to scan (default: the ts/ root).
 *   --out-dir <path>       Output directory (default: tools/scripts/line-histogram).
 *   --help                 Show this help.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_VERBOSE_THRESHOLD = 2000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
]);

// Generated / build-output directories that are never source.
const EXCLUDE_DIRS = new Set([
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".git",
    "bin",
    "obj",
    ".turbo",
    ".next",
    "bundle",
]);

// Test directories.
const TEST_DIRS = new Set(["test", "tests", "__tests__"]);

// Generated single-file artifacts (bundles, minified, type declarations).
const EXCLUDE_NAME_RE = /(\.bundle\.js|\.min\.js|\.d\.ts)$/;

// Test files by name: foo.spec.ts, foo.test.mts, etc.
const TEST_NAME_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    bucketSize: number;
    outDir: string;
    includeTests: boolean;
    verboseThreshold: number | null;
    help: boolean;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        root: path.resolve(__dirname, "..", ".."),
        bucketSize: 500,
        outDir: path.join(__dirname, "line-histogram"),
        includeTests: false,
        verboseThreshold: null,
        help: false,
    };

    // Normalize "--key=value" into ["--key", "value"].
    const tokens: string[] = [];
    for (const raw of argv) {
        const m = /^(--[\w-]+)=(.*)$/.exec(raw);
        if (m) {
            tokens.push(m[1], m[2]);
        } else {
            tokens.push(raw);
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const arg = tokens[i];
        const next = tokens[i + 1];
        switch (arg) {
            case "--help":
            case "-h":
                opts.help = true;
                break;
            case "--include-tests":
                opts.includeTests = true;
                break;
            case "--verbose":
            case "-v":
                opts.verboseThreshold = DEFAULT_VERBOSE_THRESHOLD;
                if (next !== undefined && /^\d+$/.test(next)) {
                    opts.verboseThreshold = parseInt(next, 10);
                    i++;
                }
                break;
            case "--bucket-size":
            case "--bucketSize":
                if (next === undefined || !/^\d+$/.test(next)) {
                    throw new Error(`${arg} requires a numeric value`);
                }
                opts.bucketSize = parseInt(next, 10);
                i++;
                break;
            case "--root":
                if (next === undefined) {
                    throw new Error(`${arg} requires a path`);
                }
                opts.root = path.resolve(next);
                i++;
                break;
            case "--out-dir":
            case "--outDir":
                if (next === undefined) {
                    throw new Error(`${arg} requires a path`);
                }
                opts.outDir = path.resolve(next);
                i++;
                break;
            default:
                console.warn(`Ignoring unrecognized argument: ${arg}`);
                break;
        }
    }

    if (opts.bucketSize <= 0) {
        throw new Error("--bucket-size must be greater than 0");
    }

    return opts;
}

const HELP = `Line-count histogram for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/lineHistogram.ts [options]
  npm run line-histogram -- [options]

Options:
  --include-tests      Include test files (excluded by default).
  --verbose [n]        List files exceeding n lines after the histogram
                       (n defaults to ${DEFAULT_VERBOSE_THRESHOLD}).
  --bucket-size <n>    Histogram bucket size in lines (default 500).
  --root <path>        Directory to scan (default: the ts/ root).
  --out-dir <path>     Output directory (default: tools/scripts/line-histogram).
  --help               Show this help.`;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

interface FileRecord {
    path: string; // repo-relative, forward-slash separated
    ext: string;
    lines: number;
    bucket: number;
}

/** Count lines the way a ReadLine loop would: trailing newline is not a line. */
function countLines(fullPath: string): number {
    const buf = fs.readFileSync(fullPath);
    if (buf.length === 0) {
        return 0;
    }
    let nl = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
            nl++;
        }
    }
    // Add the final line when the file does not end with a newline.
    return buf[buf.length - 1] === 0x0a ? nl : nl + 1;
}

function walk(
    root: string,
    bucketSize: number,
    includeTests: boolean,
): FileRecord[] {
    const records: FileRecord[] = [];

    const recurse = (dir: string, inTestDir: boolean): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.has(entry.name)) {
                    continue;
                }
                const childInTestDir = inTestDir || TEST_DIRS.has(entry.name);
                if (childInTestDir && !includeTests) {
                    continue;
                }
                recurse(full, childInTestDir);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (!CODE_EXTENSIONS.has(ext)) {
                    continue;
                }
                if (EXCLUDE_NAME_RE.test(entry.name)) {
                    continue;
                }
                const isTest = inTestDir || TEST_NAME_RE.test(entry.name);
                if (isTest && !includeTests) {
                    continue;
                }

                let lines: number;
                try {
                    lines = countLines(full);
                } catch {
                    continue;
                }

                const rel = path.relative(root, full).split(path.sep).join("/");
                records.push({
                    path: rel,
                    ext,
                    lines,
                    bucket: Math.floor(lines / bucketSize),
                });
            }
        }
    };

    recurse(root, false);
    return records;
}

// ---------------------------------------------------------------------------
// Histogram + output
// ---------------------------------------------------------------------------

interface Bucket {
    Bucket: number;
    Label: string;
    Lo: number;
    Hi: number;
    Count: number;
}

function buildHistogram(records: FileRecord[], bucketSize: number): Bucket[] {
    const maxBucket = records.reduce((m, r) => Math.max(m, r.bucket), 0);
    const buckets: Bucket[] = [];
    for (let b = 0; b <= maxBucket; b++) {
        const lo = b * bucketSize;
        const hi = (b + 1) * bucketSize;
        const count = records.filter((r) => r.bucket === b).length;
        buckets.push({
            Bucket: b,
            Label: `${lo}-${hi}`,
            Lo: lo,
            Hi: hi,
            Count: count,
        });
    }
    return buckets;
}

function median(sortedLines: number[]): number {
    if (sortedLines.length === 0) {
        return 0;
    }
    const mid = Math.floor(sortedLines.length / 2);
    if (sortedLines.length % 2 === 0) {
        return Math.round((sortedLines[mid - 1] + sortedLines[mid]) / 2);
    }
    return sortedLines[mid];
}

function csvEscape(value: string | number): string {
    const s = String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function writeCsv(filePath: string, records: FileRecord[]): void {
    const sorted = [...records].sort((a, b) => b.lines - a.lines);
    const lines = ["Path,Ext,Lines,Bucket"];
    for (const r of sorted) {
        lines.push(
            [
                csvEscape(r.path),
                csvEscape(r.ext),
                csvEscape(r.lines),
                csvEscape(r.bucket),
            ].join(","),
        );
    }
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function formatDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}`
    );
}

function buildHtml(
    records: FileRecord[],
    hist: Bucket[],
    bucketSize: number,
    includeTests: boolean,
): string {
    const total = records.length;
    const totalLines = records.reduce((s, r) => s + r.lines, 0);
    const sortedLines = records.map((r) => r.lines).sort((a, b) => a - b);
    const medianLines = median(sortedLines);
    const topFiles = [...records]
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 30)
        .map((r) => ({ Path: r.path, Lines: r.lines, Ext: r.ext }));

    // Escape "<" so a path can never break out of the <script> element.
    const esc = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");
    const histJson = esc(
        hist.map((h) => ({
            Label: h.Label,
            Lo: h.Lo,
            Hi: h.Hi,
            Count: h.Count,
        })),
    );
    const topJson = esc(topFiles);

    const genDate = formatDate(new Date());
    const testExclNote = includeTests ? "includes tests" : "excludes tests";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TypeAgent ts/ — Files by Line Count</title>
<style>
  :root { color-scheme: dark light; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    margin: 0; padding: 24px 32px;
    background: #1e1e1e; color: #e8e8e8;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #9aa0a6; font-size: 13px; margin-bottom: 20px; }
  .stats { display: flex; gap: 28px; margin-bottom: 18px; flex-wrap: wrap; }
  .stat .n { font-size: 26px; font-weight: 600; color: #4fc3f7; }
  .stat .l { font-size: 12px; color: #9aa0a6; text-transform: uppercase; letter-spacing: .5px; }
  .controls { margin-bottom: 12px; }
  button {
    background: #2d2d2d; color: #e8e8e8; border: 1px solid #444;
    padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  }
  button.active { background: #4fc3f7; color: #0a0a0a; border-color: #4fc3f7; font-weight: 600; }
  .chart-wrap { background: #252526; border: 1px solid #333; border-radius: 10px; padding: 18px; margin-bottom: 26px; }
  svg text { fill: #cfd2d5; font-size: 12px; }
  .bar { fill: #4fc3f7; }
  .bar:hover { fill: #82d4f9; }
  .barlabel { fill: #e8e8e8; font-size: 11px; font-weight: 600; }
  .axis { stroke: #555; stroke-width: 1; }
  .grid { stroke: #333; stroke-width: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
  th { color: #9aa0a6; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; color: #ffcc80; }
  td.path { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; color: #b0bec5; }
  h2 { font-size: 15px; margin: 8px 0 12px; color: #cfd2d5; }
</style>
</head>
<body>
  <h1>TypeAgent <code>ts/</code> — Code Files by Line Count</h1>
  <div class="sub">${bucketSize}-line buckets · generated ${genDate} · excludes node_modules, dist, build output, bundles, *.min.js, *.d.ts · ${testExclNote}</div>

  <div class="stats">
    <div class="stat"><div class="n">${total}</div><div class="l">code files</div></div>
    <div class="stat"><div class="n">${totalLines}</div><div class="l">total lines</div></div>
    <div class="stat"><div class="n">${medianLines}</div><div class="l">median lines/file</div></div>
    <div class="stat"><div class="n" id="bigStat">–</div><div class="l">files &gt; 1000 lines</div></div>
  </div>

  <div class="controls">
    <button id="btnLin" class="active" onclick="setScale('lin')">Linear</button>
    <button id="btnLog" onclick="setScale('log')">Log scale</button>
  </div>

  <div class="chart-wrap">
    <svg id="chart" width="100%" viewBox="0 0 1000 460" preserveAspectRatio="xMidYMid meet"></svg>
  </div>

  <h2>Top 30 largest files</h2>
  <table>
    <thead><tr><th>#</th><th>Lines</th><th>File</th></tr></thead>
    <tbody id="topBody"></tbody>
  </table>

<script>
const HIST = ${histJson};
const TOP = ${topJson};
let scale = 'lin';

(function(){
  const big = HIST.filter(h => h.Lo >= 1000).reduce((a,h)=>a+h.Count,0);
  document.getElementById('bigStat').textContent = big;
})();

function setScale(s){
  scale = s;
  document.getElementById('btnLin').classList.toggle('active', s==='lin');
  document.getElementById('btnLog').classList.toggle('active', s==='log');
  draw();
}

function draw(){
  const svg = document.getElementById('chart');
  const W = 1000, H = 460;
  const m = { top: 24, right: 20, bottom: 70, left: 60 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = HIST.length;
  const maxC = Math.max(...HIST.map(h => h.Count), 1);
  const gap = 6;
  const bw = iw / n - gap;

  const yOf = (c) => {
    if (scale === 'log') {
      const lv = c > 0 ? Math.log10(c) : 0;
      const lm = Math.log10(maxC);
      return lm > 0 ? (lv / lm) * ih : 0;
    }
    return (c / maxC) * ih;
  };

  let s = '';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++){
    const y = m.top + ih - (ih * i / ticks);
    let val;
    if (scale === 'log') {
      val = Math.round(Math.pow(10, Math.log10(maxC) * i / ticks));
    } else {
      val = Math.round(maxC * i / ticks);
    }
    s += '<line class="grid" x1="'+m.left+'" y1="'+y+'" x2="'+(W-m.right)+'" y2="'+y+'"/>';
    s += '<text x="'+(m.left-8)+'" y="'+(y+4)+'" text-anchor="end">'+val+'</text>';
  }
  s += '<line class="axis" x1="'+m.left+'" y1="'+m.top+'" x2="'+m.left+'" y2="'+(m.top+ih)+'"/>';
  s += '<line class="axis" x1="'+m.left+'" y1="'+(m.top+ih)+'" x2="'+(W-m.right)+'" y2="'+(m.top+ih)+'"/>';

  HIST.forEach((h, i) => {
    const x = m.left + i * (iw / n) + gap/2;
    const bh = yOf(h.Count);
    const y = m.top + ih - bh;
    if (h.Count > 0) {
      s += '<rect class="bar" x="'+x+'" y="'+y+'" width="'+bw+'" height="'+bh+'"><title>'+h.Label+' lines: '+h.Count+' files</title></rect>';
      s += '<text class="barlabel" x="'+(x+bw/2)+'" y="'+(y-5)+'" text-anchor="middle">'+h.Count+'</text>';
    }
    const lx = x + bw/2;
    const ly = m.top + ih + 14;
    s += '<text x="'+lx+'" y="'+ly+'" text-anchor="end" transform="rotate(-45 '+lx+' '+ly+')">'+h.Label+'</text>';
  });

  s += '<text x="'+(m.left+iw/2)+'" y="'+(H-6)+'" text-anchor="middle" fill="#9aa0a6">Lines per file (bucket)</text>';
  s += '<text transform="rotate(-90 16 '+(m.top+ih/2)+')" x="16" y="'+(m.top+ih/2)+'" text-anchor="middle" fill="#9aa0a6">Number of files ('+(scale==='log'?'log':'linear')+')</text>';

  svg.innerHTML = s;
}

(function(){
  const tb = document.getElementById('topBody');
  tb.innerHTML = TOP.map((f,i) =>
    '<tr><td>'+(i+1)+'</td><td class="num">'+f.Lines+'</td><td class="path">'+f.Path+'</td></tr>'
  ).join('');
})();

draw();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Console reporting
// ---------------------------------------------------------------------------

function printReport(
    records: FileRecord[],
    hist: Bucket[],
    bucketSize: number,
    verboseThreshold: number | null,
): void {
    const total = records.length;
    const totalLines = records.reduce((s, r) => s + r.lines, 0);
    const maxCount = hist.reduce((m, h) => Math.max(m, h.Count), 0) || 1;
    const byLinesDesc = [...records].sort((a, b) => b.lines - a.lines);

    console.log("");
    console.log(
        `=== Histogram (files by line count, ${bucketSize}-line chunks) ===`,
    );
    for (const h of hist) {
        if (h.Count === 0) {
            continue;
        }
        const barLen = Math.round((h.Count / maxCount) * 50);
        console.log(
            `${h.Label.padStart(12)}  ${String(h.Count).padStart(5)}  ${"#".repeat(barLen)}`,
        );
    }
    console.log("");
    console.log(`Total files: ${total}   Total lines: ${totalLines}`);

    console.log("");
    console.log("=== Top 25 largest files ===");
    for (const r of byLinesDesc.slice(0, 25)) {
        console.log(`${String(r.lines).padStart(7)}  ${r.path}`);
    }

    if (verboseThreshold !== null) {
        const over = byLinesDesc.filter((r) => r.lines > verboseThreshold);
        console.log("");
        console.log(
            `=== Files exceeding ${verboseThreshold} lines (${over.length}) ===`,
        );
        if (over.length === 0) {
            console.log("(none)");
        } else {
            for (const r of over) {
                console.log(`${String(r.lines).padStart(7)}  ${r.path}`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    let opts: Options;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
    }

    if (opts.help) {
        console.log(HELP);
        return;
    }

    const testState = opts.includeTests ? "including tests" : "excluding tests";
    console.log(`Scanning ${opts.root} ...`);

    const records = walk(opts.root, opts.bucketSize, opts.includeTests);
    console.log(
        `Matched ${records.length} code files (${testState}). Counting done.`,
    );

    const hist = buildHistogram(records, opts.bucketSize);

    fs.mkdirSync(opts.outDir, { recursive: true });

    const csvPath = path.join(opts.outDir, "files-by-lines.csv");
    writeCsv(csvPath, records);

    const jsonPath = path.join(opts.outDir, "histogram.json");
    fs.writeFileSync(jsonPath, JSON.stringify(hist, null, 2) + "\n", "utf8");

    const htmlPath = path.join(opts.outDir, "histogram.html");
    fs.writeFileSync(
        htmlPath,
        buildHtml(records, hist, opts.bucketSize, opts.includeTests),
        "utf8",
    );

    printReport(records, hist, opts.bucketSize, opts.verboseThreshold);

    console.log("");
    console.log(`CSV : ${csvPath}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`HTML: ${htmlPath}`);
}

main();
