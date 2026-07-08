// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Circular-dependency report + ratchet gate for the TypeAgent ts/ tree.
 *
 * The engine is madge — the de-facto-standard dependency-graph tool — driven
 * through its Node API (loaded via createRequire because the npx shim cannot
 * resolve local bins in this environment). Type-only imports are excluded
 * (skipTypeImports), so the cycles reported are real runtime import cycles, the
 * ones that cause initialization-order bugs.
 *
 * Two modes:
 *   - Report (default): scan the source subtrees and write CSV/JSON/HTML + a
 *     console summary (cycle count, size distribution, per-package rollup,
 *     which cycles cross package boundaries).
 *   - Ratchet (--ratchet --base <ref>): a stateless CI gate. It builds the
 *     cycle set for HEAD and for the merge base (checked out into a throwaway
 *     git worktree) and fails if HEAD introduces any cycle that is not already
 *     present at the base. The base branch is the baseline, so cycles can only
 *     trend down. Unlike the per-file lint/complexity ratchets, cycles are a
 *     whole-graph property, hence the worktree.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/circular-report):
 *   - cycles.csv  : every cycle, ranked by length
 *   - report.json : structured metrics
 *   - report.html : a self-contained, sortable report
 *
 * Usage:
 *   npx tsx tools/scripts/code/circularDepsReport.ts [options]
 *   npm run code-circular -- [options]
 *
 * Options:
 *   --include-tests    Include test files (excluded by default).
 *   --top <n>          Number of cycles to print / embed (default 25).
 *   --root <path>      Directory to scan (default: the ts/ root).
 *   --out-dir <path>   Output directory (default tools/scripts/code/circular-report).
 *   --ratchet          CI gate: fail if changed code introduces new cycles vs --base.
 *   --base <ref>       Base git ref for --ratchet (default origin/main).
 *   --exceptions-file <path>  Baseline exceptions (known cycles) ignored by --ratchet.
 *   --help             Show this help.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_SUBDIRS = ["packages", "examples", "extensions", "tools"];

const FILE_EXTENSIONS = ["ts", "mts", "cts", "tsx"];

// madge excludeRegExp entries (matched against file paths).
const BASE_EXCLUDES = [
    "/dist/",
    "/node_modules/",
    "\\.d\\.ts$",
    "/bin/",
    "/build/",
    "/out/",
];
const TEST_EXCLUDES = [
    "/test/",
    "/tests/",
    "/__tests__/",
    "\\.spec\\.",
    "\\.test\\.",
];

// Cycle-length distribution buckets.
const BUCKETS: { label: string; lo: number; hi: number }[] = [
    { label: "2 files", lo: 2, hi: 2 },
    { label: "3 files", lo: 3, hi: 3 },
    { label: "4-5 files", lo: 4, hi: 5 },
    { label: "6+ files", lo: 6, hi: Infinity },
];

// ---------------------------------------------------------------------------
// madge Node API
// ---------------------------------------------------------------------------

interface MadgeResult {
    circular(): string[][];
    obj(): Record<string, string[]>;
}
type MadgeFn = (
    pathOrPaths: string | string[],
    opts?: Record<string, unknown>,
) => Promise<MadgeResult>;

function madgeOptions(includeTests: boolean): Record<string, unknown> {
    return {
        fileExtensions: FILE_EXTENSIONS,
        excludeRegExp: includeTests
            ? BASE_EXCLUDES
            : [...BASE_EXCLUDES, ...TEST_EXCLUDES],
        detectiveOptions: {
            ts: { skipTypeImports: true },
            tsx: { skipTypeImports: true },
        },
    };
}

const norm = (p: string) => p.replace(/\\/g, "/");

/** Run madge from `cwd` over the existing SCAN_SUBDIRS; return cycles + file count. */
async function runMadge(
    cwd: string,
    includeTests: boolean,
): Promise<{ cycles: string[][]; files: number }> {
    const madge = require("madge") as MadgeFn;
    const prev = process.cwd();
    process.chdir(cwd);
    try {
        const targets = SCAN_SUBDIRS.filter((d) => fs.existsSync(d));
        if (targets.length === 0) {
            return { cycles: [], files: 0 };
        }
        const res = await madge(targets, madgeOptions(includeTests));
        const cycles = res.circular().map((c) => c.map(norm));
        return { cycles, files: Object.keys(res.obj()).length };
    } finally {
        process.chdir(prev);
    }
}

/** Rotate a cycle to start at its lexicographically smallest node (rotation-invariant key). */
function canonicalKey(cycle: string[]): string {
    if (cycle.length === 0) {
        return "";
    }
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
        if (cycle[i] < cycle[minIdx]) {
            minIdx = i;
        }
    }
    return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join(" > ");
}

// Baseline exceptions: a JSON file of known cycles the ratchet should ignore.
// Each entry is either a "cycle" (array of module paths) or a "key" string
// ("a > b > c"); both are canonicalized the same way as detected cycles, so a
// grandfathered cycle matches regardless of rotation. Lets a pre-existing cycle
// that a refactor merely relocates pass without weakening the gate.
function normalizeCycleNode(node: string): string {
    return node
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^ts\//, "");
}

function loadCycleExceptionSet(
    exceptionsFile: string | undefined,
): Set<string> {
    if (!exceptionsFile) {
        return new Set();
    }
    const filePath = path.isAbsolute(exceptionsFile)
        ? exceptionsFile
        : path.resolve(process.cwd(), exceptionsFile);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Exceptions file not found: ${filePath}`);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Invalid JSON in exceptions file ${filePath}: ${message}`,
        );
    }
    const entries = Array.isArray(raw)
        ? raw
        : ((raw as { exceptions?: Array<{ cycle?: string[]; key?: string }> })
              .exceptions ?? []);
    const out = new Set<string>();
    for (const entry of entries) {
        let nodes: string[] = [];
        if (Array.isArray(entry?.cycle)) {
            nodes = entry.cycle.map(normalizeCycleNode).filter(Boolean);
        } else if (typeof entry?.key === "string") {
            nodes = entry.key.split(">").map(normalizeCycleNode).filter(Boolean);
        }
        if (nodes.length > 0) {
            out.add(canonicalKey(nodes));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    includeTests: boolean;
    top: number;
    ratchet: boolean;
    base: string;
    exceptionsFile?: string;
    help: boolean;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        root: path.resolve(__dirname, "..", "..", ".."),
        outDir: path.join(__dirname, "circular-report"),
        includeTests: false,
        top: 25,
        ratchet: false,
        base: "origin/main",
        exceptionsFile: undefined,
        help: false,
    };

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
            case "--top":
                if (next === undefined || !/^\d+$/.test(next)) {
                    throw new Error("--top requires a positive integer");
                }
                opts.top = parseInt(next, 10);
                i++;
                break;
            case "--ratchet":
                opts.ratchet = true;
                break;
            case "--base":
                if (next === undefined) {
                    throw new Error("--base requires a git ref");
                }
                opts.base = next;
                i++;
                break;
            case "--exceptions-file":
            case "--exceptionsFile":
                if (next === undefined) {
                    throw new Error(`${arg} requires a path`);
                }
                opts.exceptionsFile = next;
                i++;
                break;
            case "--root":
                if (next === undefined) {
                    throw new Error("--root requires a path");
                }
                opts.root = path.resolve(next);
                i++;
                break;
            case "--out-dir":
            case "--outDir":
                if (next === undefined) {
                    throw new Error("--out-dir requires a path");
                }
                opts.outDir = path.resolve(next);
                i++;
                break;
            default:
                console.warn(`Ignoring unrecognized argument: ${arg}`);
                break;
        }
    }

    if (opts.top <= 0) {
        throw new Error("--top must be greater than 0");
    }
    return opts;
}

const HELP = `Circular-dependency report + ratchet gate for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/circularDepsReport.ts [options]
  npm run code-circular -- [options]

Options:
  --include-tests    Include test files (excluded by default).
  --top <n>          Number of cycles to print / embed (default 25).
  --root <path>      Directory to scan (default: the ts/ root).
  --out-dir <path>   Output directory (default: tools/scripts/code/circular-report).
  --ratchet          CI gate: fail if changed code introduces new cycles vs --base.
  --base <ref>       Base git ref for --ratchet (default origin/main).
  --exceptions-file <path>
                     Optional JSON baseline-exception file. Cycles listed in it
                     (as a "cycle" node array or a "key" string) are ignored by
                     the --ratchet gate.
  --help             Show this help.`;

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

function packageKeyOf(rel: string): string {
    const f = rel.replace(/\\/g, "/");
    const i = f.indexOf("/src/");
    if (i >= 0) {
        return f.slice(0, i);
    }
    const parts = f.split("/");
    if (parts[0] === "packages" && parts[1] === "agents") {
        return parts.slice(0, 3).join("/");
    }
    if (
        parts[0] === "packages" ||
        parts[0] === "examples" ||
        parts[0] === "extensions"
    ) {
        return parts.slice(0, 2).join("/");
    }
    return parts.slice(0, Math.min(2, parts.length)).join("/");
}

interface CycleRecord {
    length: number;
    crossPackage: boolean;
    packages: string[];
    nodes: string[];
}

interface AnalysisResult {
    cycles: CycleRecord[];
    files: number;
    perPackage: { pkg: string; cycles: number }[];
    crossPackageCount: number;
    elapsedMs: number;
}

function toRecords(cycles: string[][]): CycleRecord[] {
    return cycles
        .map((nodes) => {
            const packages = [...new Set(nodes.map(packageKeyOf))].sort();
            return {
                length: nodes.length,
                crossPackage: packages.length > 1,
                packages,
                nodes,
            };
        })
        .sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string | number | boolean): string {
    const s = String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function htmlEscape(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function num(n: number): string {
    return n.toLocaleString("en-US");
}

function distribution(cycles: CycleRecord[]): number[] {
    const counts = new Array(BUCKETS.length).fill(0);
    for (const c of cycles) {
        const idx = BUCKETS.findIndex(
            (b) => c.length >= b.lo && c.length <= b.hi,
        );
        if (idx >= 0) {
            counts[idx]++;
        }
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Report writers
// ---------------------------------------------------------------------------

function writeCsv(outDir: string, cycles: CycleRecord[]): string {
    const header = ["Length", "CrossPackage", "Packages", "Cycle"].join(",");
    const rows = cycles.map((c) =>
        [c.length, c.crossPackage, c.packages.join(" | "), c.nodes.join(" > ")]
            .map(csvEscape)
            .join(","),
    );
    const file = path.join(outDir, "cycles.csv");
    fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
    return file;
}

function writeJson(outDir: string, opts: Options, r: AnalysisResult): string {
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        includeTests: opts.includeTests,
        totals: {
            cycles: r.cycles.length,
            files: r.files,
            crossPackageCycles: r.crossPackageCount,
        },
        distribution: BUCKETS.map((b, i) => ({
            label: b.label,
            count: distribution(r.cycles)[i],
        })),
        perPackage: r.perPackage,
        cycles: r.cycles,
    };
    const file = path.join(outDir, "report.json");
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return file;
}

function writeHtml(outDir: string, opts: Options, r: AnalysisResult): string {
    const dist = distribution(r.cycles);
    const maxDist = Math.max(1, ...dist);
    const distRows = BUCKETS.map((b, i) => {
        const w = Math.round((dist[i] / maxDist) * 100);
        return `<tr><td>${htmlEscape(b.label)}</td><td class="n">${num(dist[i])}</td>
      <td class="bar"><span style="width:${w}%"></span></td></tr>`;
    }).join("\n");

    const pkgRows = r.perPackage
        .slice(0, 60)
        .map(
            (p) =>
                `<tr><td>${htmlEscape(p.pkg)}</td><td class="n">${num(p.cycles)}</td></tr>`,
        )
        .join("\n");

    const cycleRows = r.cycles
        .slice(0, Math.max(opts.top, 100))
        .map(
            (c) =>
                `<tr class="${c.crossPackage ? "cross" : ""}"><td class="n">${c.length}</td>
        <td>${c.crossPackage ? "yes" : ""}</td><td>${htmlEscape(c.nodes.join(" &rarr; "))}</td></tr>`,
        )
        .join("\n");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent circular-dependency report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  h1 { margin: 0 0 .25rem; } h2 { margin-top: 2rem; }
  .sub { color: #888; margin-bottom: 1.5rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 160px; }
  .card .big { font-size: 1.6rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: Canvas; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.bar { width: 40%; } td.bar span { display: inline-block; height: 12px; border-radius: 3px; background: #ef5350; }
  tr.cross { background: #ffca2822; }
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent circular-dependency report</h1>
<div class="sub">engine: madge (runtime imports only) &middot; generated ${htmlEscape(new Date().toISOString())} &middot;
  tests ${opts.includeTests ? "included" : "excluded"}</div>

<div class="cards">
  <div class="card"><div class="big">${num(r.cycles.length)}</div>cycles</div>
  <div class="card"><div class="big">${num(r.crossPackageCount)}</div>cross-package cycles</div>
  <div class="card"><div class="big">${num(r.files)}</div>files in graph</div>
</div>

<h2>Cycle size distribution</h2>
<table><thead><tr><th>Bucket</th><th class="n">Cycles</th><th>&nbsp;</th></tr></thead>
<tbody>${distRows}</tbody></table>

<h2>Packages by cycle count</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Cycles</th></tr></thead>
<tbody>${pkgRows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>

<h2>Cycles</h2>
<table class="sortable"><thead><tr><th class="n">Length</th><th>Cross</th><th>Cycle</th></tr></thead>
<tbody>${cycleRows || '<tr><td colspan="3">None found</td></tr>'}</tbody></table>

<script>
document.querySelectorAll("table.sortable th").forEach((th, idx) => {
  th.addEventListener("click", () => {
    const tb = th.closest("table").tBodies[0];
    const rows = [...tb.rows];
    const numeric = th.classList.contains("n");
    const dir = th.dataset.dir === "asc" ? -1 : 1;
    th.dataset.dir = dir === 1 ? "asc" : "desc";
    rows.sort((a, b) => {
      const x = a.cells[idx].innerText.replace(/,/g, "");
      const y = b.cells[idx].innerText.replace(/,/g, "");
      return numeric ? (Number(x) - Number(y)) * dir : x.localeCompare(y) * dir;
    });
    rows.forEach((r) => tb.appendChild(r));
  });
});
</script>
</body></html>`;
    const file = path.join(outDir, "report.html");
    fs.writeFileSync(file, html, "utf8");
    return file;
}

// ---------------------------------------------------------------------------
// Report mode
// ---------------------------------------------------------------------------

async function runReport(opts: Options): Promise<number> {
    const started = Date.now();
    const { cycles, files } = await runMadge(opts.root, opts.includeTests);
    const records = toRecords(cycles);

    const pkgMap = new Map<string, number>();
    for (const c of records) {
        for (const p of c.packages) {
            pkgMap.set(p, (pkgMap.get(p) ?? 0) + 1);
        }
    }
    const perPackage = [...pkgMap.entries()]
        .map(([pkg, n]) => ({ pkg, cycles: n }))
        .sort((a, b) => b.cycles - a.cycles || a.pkg.localeCompare(b.pkg));

    const result: AnalysisResult = {
        cycles: records,
        files,
        perPackage,
        crossPackageCount: records.filter((c) => c.crossPackage).length,
        elapsedMs: Date.now() - started,
    };

    fs.mkdirSync(opts.outDir, { recursive: true });
    const csv = writeCsv(opts.outDir, records);
    const json = writeJson(opts.outDir, opts, result);
    const html = writeHtml(opts.outDir, opts, result);

    const dist = distribution(records);
    console.log("");
    console.log("Circular-dependency report (engine: madge, runtime imports)");
    console.log(
        `Graph: ${num(files)} files  |  elapsed ${(result.elapsedMs / 1000).toFixed(1)}s`,
    );
    console.log("");
    console.log(
        `Cycles: ${num(records.length)}  |  cross-package: ${num(result.crossPackageCount)}`,
    );
    console.log("");
    console.log("Size distribution:");
    BUCKETS.forEach((b, i) =>
        console.log(`  ${b.label.padEnd(10)} ${num(dist[i])}`),
    );
    console.log("");
    console.log(
        `Top ${Math.min(opts.top, perPackage.length)} packages by cycles:`,
    );
    for (const p of perPackage.slice(0, opts.top)) {
        console.log(`  ${String(p.cycles).padStart(4)}  ${p.pkg}`);
    }
    console.log("");
    console.log(`Largest cycles (top ${Math.min(opts.top, records.length)}):`);
    for (const c of records.slice(0, opts.top)) {
        console.log(
            `  ${String(c.length).padStart(2)}  ${c.nodes.join(" > ")}${c.crossPackage ? "  [cross-pkg]" : ""}`,
        );
    }
    console.log("");
    console.log("Reports written to:");
    for (const f of [csv, json, html]) {
        console.log(
            `  ${path.relative(opts.root, f).split(path.sep).join("/")}`,
        );
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Ratchet mode (CI gate)
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    });
}

async function runRatchet(opts: Options): Promise<number> {
    const exceptions = loadCycleExceptionSet(opts.exceptionsFile);
    let repoRoot: string;
    let mergeBase: string;
    try {
        repoRoot = git(["rev-parse", "--show-toplevel"], opts.root).trim();
        mergeBase = git(["merge-base", opts.base, "HEAD"], opts.root).trim();
    } catch {
        console.error(
            `Ratchet: could not resolve base ref "${opts.base}" via git. ` +
                "Pass --base <ref> (e.g. origin/main) and ensure it is fetched.",
        );
        return 2;
    }

    // HEAD cycles (current working tree).
    const head = await runMadge(opts.root, opts.includeTests);
    const headKeys = new Map<string, string[]>();
    for (const c of head.cycles) {
        headKeys.set(canonicalKey(c), c);
    }

    // BASE cycles: check the merge base out into a throwaway worktree.
    // Use a path git creates itself (worktree add refuses a pre-existing dir).
    const worktree = path.join(
        os.tmpdir(),
        `circular-base-${process.pid}-${Date.now()}`,
    );
    const baseKeys = new Set<string>();
    try {
        git(["worktree", "add", "--detach", worktree, mergeBase], repoRoot);
        // opts.root is the ts/ dir relative to the repo root; mirror it in the worktree.
        const rootRel = path.relative(repoRoot, opts.root);
        const baseRoot = path.join(worktree, rootRel);
        const base = await runMadge(baseRoot, opts.includeTests);
        for (const c of base.cycles) {
            baseKeys.add(canonicalKey(c));
        }
    } catch (e) {
        console.error(`Ratchet: failed to analyze base worktree: ${e}`);
        return 2;
    } finally {
        try {
            git(["worktree", "remove", "--force", worktree], repoRoot);
        } catch {
            fs.rmSync(worktree, { recursive: true, force: true });
        }
    }

    const newCycles: string[][] = [];
    for (const [key, cycle] of headKeys) {
        if (!baseKeys.has(key) && !exceptions.has(key)) {
            newCycles.push(cycle);
        }
    }

    console.log(
        `Ratchet: cycles base ${baseKeys.size} -> head ${headKeys.size}`,
    );
    if (exceptions.size > 0) {
        console.log(
            `  Baseline exceptions ignored: ${exceptions.size} cycle(s).`,
        );
    }

    if (newCycles.length > 0) {
        console.error(
            `\nRatchet FAILED: ${newCycles.length} new circular dependency(ies) introduced vs the base:`,
        );
        for (const c of newCycles) {
            console.error(`  ${c.join(" > ")}`);
        }
        console.error(
            "\nBreak the cycle (e.g. extract the shared piece into a third module) before merging.",
        );
        return 1;
    }
    console.log("Ratchet OK: no new circular dependencies.");
    return 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    let opts: Options;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 2;
        return;
    }

    if (opts.help) {
        console.log(HELP);
        return;
    }

    const code = opts.ratchet ? await runRatchet(opts) : await runReport(opts);
    process.exitCode = code;
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
