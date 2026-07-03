// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Copy/paste (code duplication) report for the TypeAgent ts/ tree.
 *
 * The analysis engine is jscpd — the de-facto-standard copy/paste detector for
 * source code — so the numbers come from a well-known, widely-used token-based
 * implementation (Rabin-Karp fingerprinting) rather than a bespoke heuristic.
 * This mirrors the sibling complexityReport.ts, which harvests its metrics from
 * ESLint.
 *
 * jscpd@4 ships a programmatic API, but its ESM entry pulls a dependency
 * (`colors/safe`) that breaks under Node's native ESM loader. We therefore load
 * its CommonJS build via `createRequire`, which resolves that dependency
 * correctly while keeping this script itself an ES module.
 *
 * On top of the raw jscpd output this report adds two things that matter for a
 * maintainability pass:
 *   - Cross-package clones: clone pairs whose two sides live in different
 *     packages. These are the real consolidation targets (shared helpers),
 *     as opposed to within-file/within-package repetition.
 *   - Per-package rollups: which packages carry the most duplicated lines.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/duplication-report):
 *   - clones.csv  : every detected clone pair, ranked by duplicated lines
 *   - report.json : structured metrics (totals, per-format, per-package, clones)
 *   - report.html : a self-contained, sortable report (open in a browser)
 * plus a console summary (totals + the worst offenders + cross-package hotspots).
 *
 * Usage:
 *   npx tsx tools/scripts/code/duplicationReport.ts [options]
 *   npm run code-duplication -- [options]
 *
 * Options:
 *   --include-tests    Include test files (*.spec.*, *.test.*, test dirs).
 *                      Excluded by default.
 *   --min-tokens <n>   Minimum token length of a clone (default 50, jscpd's
 *                      default). Lower = more, smaller clones.
 *   --min-lines <n>    Minimum line length of a clone (default 5).
 *   --top <n>          Number of worst offenders to print / embed (default 25).
 *   --root <path>      Directory to scan (default: the ts/ root).
 *   --out-dir <path>   Output directory (default tools/scripts/code/duplication-report).
 *   --help             Show this help.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Source subtrees scanned by default (relative to --root). Restricting to these
// keeps jscpd away from node_modules / build output entirely.
const SCAN_SUBDIRS = ["packages", "examples", "extensions", "tools"];

// jscpd formats to consider, plus the extension map so .mts/.cts/.mjs/.cjs are
// treated as TypeScript/JavaScript (the repo uses .mts heavily for agents).
const CODE_FORMATS = "typescript,tsx,javascript";
const FORMATS_EXTS = "typescript:ts,tsx,mts,cts;javascript:js,jsx,mjs,cjs";

// Generated / build-output / vendored directories that are never source.
const IGNORE_DIRS = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/coverage/**",
    "**/bin/**",
    "**/obj/**",
    "**/.turbo/**",
    "**/.next/**",
    "**/bundle/**",
    "**/complexity-report/**",
    "**/duplication-report/**",
];

// Generated single-file artifacts (declarations, bundles, minified, sourcemaps).
const IGNORE_FILES = [
    "**/*.d.ts",
    "**/*.d.mts",
    "**/*.min.js",
    "**/*.bundle.js",
    "**/*.map",
];

// Test files and directories, excluded unless --include-tests is passed.
const TEST_GLOBS = [
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/*.spec.*",
    "**/*.test.*",
];

// Distribution buckets for the clone-size histogram (by duplicated lines).
const BUCKETS: { label: string; lo: number; hi: number; color: string }[] = [
    { label: "5-9 lines", lo: 5, hi: 9, color: "#9ccc65" },
    { label: "10-19 lines", lo: 10, hi: 19, color: "#ffca28" },
    { label: "20-49 lines", lo: 20, hi: 49, color: "#ffa726" },
    { label: "50-99 lines", lo: 50, hi: 99, color: "#ef5350" },
    { label: "100+ lines", lo: 100, hi: Infinity, color: "#e53935" },
];

// ---------------------------------------------------------------------------
// jscpd report shape (only the fields we consume)
// ---------------------------------------------------------------------------

interface JscpdFileRef {
    name: string;
    start: number;
    end: number;
}

interface JscpdDuplicate {
    format: string;
    lines: number;
    tokens: number;
    firstFile: JscpdFileRef;
    secondFile: JscpdFileRef;
}

interface JscpdTotals {
    lines: number;
    tokens: number;
    sources: number;
    clones: number;
    duplicatedLines: number;
    duplicatedTokens: number;
    percentage: number;
    percentageTokens: number;
}

interface JscpdReport {
    statistics: { detectionDate?: string; total: JscpdTotals };
    duplicates: JscpdDuplicate[];
}

type JscpdFn = (
    argv: string[],
    exitCallback?: (code: number) => {},
) => Promise<unknown[]>;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    includeTests: boolean;
    minTokens: number;
    minLines: number;
    top: number;
    help: boolean;
}

function parseIntArg(arg: string, next: string | undefined): number {
    if (next === undefined || !/^\d+$/.test(next)) {
        throw new Error(`${arg} requires a non-negative integer value`);
    }
    return parseInt(next, 10);
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        root: path.resolve(__dirname, "..", "..", ".."),
        outDir: path.join(__dirname, "duplication-report"),
        includeTests: false,
        minTokens: 50,
        minLines: 5,
        top: 25,
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
            case "--min-tokens":
                opts.minTokens = parseIntArg(arg, next);
                i++;
                break;
            case "--min-lines":
                opts.minLines = parseIntArg(arg, next);
                i++;
                break;
            case "--top":
                opts.top = parseIntArg(arg, next);
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

    if (opts.top <= 0) {
        throw new Error("--top must be greater than 0");
    }

    return opts;
}

const HELP = `Copy/paste (code duplication) report for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/duplicationReport.ts [options]
  npm run code-duplication -- [options]

Options:
  --include-tests    Include test files (excluded by default).
  --min-tokens <n>   Minimum token length of a clone (default 50).
  --min-lines <n>    Minimum line length of a clone (default 5).
  --top <n>          Number of worst offenders to print / embed (default 25).
  --root <path>      Directory to scan (default: the ts/ root).
  --out-dir <path>   Output directory (default: tools/scripts/code/duplication-report).
  --help             Show this help.`;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface CloneRecord {
    format: string;
    lines: number;
    tokens: number;
    crossPackage: boolean;
    packageA: string;
    fileA: string;
    startA: number;
    endA: number;
    packageB: string;
    fileB: string;
    startB: number;
    endB: number;
}

interface PackageRollup {
    pkg: string;
    clones: number;
    duplicatedLines: number;
    crossPackageClones: number;
}

interface AnalysisResult {
    clones: CloneRecord[];
    totals: JscpdTotals;
    perFormat: { format: string; clones: number; duplicatedLines: number }[];
    perPackage: PackageRollup[];
    crossPackagePairs: {
        a: string;
        b: string;
        clones: number;
        lines: number;
    }[];
    elapsedMs: number;
}

/**
 * Derive a package key for a repo-relative file path. Everything before the
 * first `/src/` segment identifies the package (handles nested packages such as
 * `packages/dispatcher/dispatcher`). Falls back to the leading path segments.
 */
function packageKeyOf(file: string): string {
    const f = file.replace(/\\/g, "/");
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

async function analyze(opts: Options): Promise<AnalysisResult> {
    const started = Date.now();

    // Scan relative to the root so jscpd emits root-relative paths.
    const originalCwd = process.cwd();
    process.chdir(opts.root);

    const rawDir = path.join(opts.outDir, ".jscpd");
    fs.rmSync(rawDir, { recursive: true, force: true });
    fs.mkdirSync(rawDir, { recursive: true });

    const scanTargets = SCAN_SUBDIRS.filter((d) => fs.existsSync(d));
    if (scanTargets.length === 0) {
        throw new Error(
            `No source subdirectories (${SCAN_SUBDIRS.join(", ")}) found under ${opts.root}`,
        );
    }

    const ignores = [...IGNORE_DIRS, ...IGNORE_FILES];
    if (!opts.includeTests) {
        ignores.push(...TEST_GLOBS);
    }

    const argv = [
        process.execPath,
        "jscpd",
        ...scanTargets,
        "--min-tokens",
        String(opts.minTokens),
        "--min-lines",
        String(opts.minLines),
        "--format",
        CODE_FORMATS,
        "--formats-exts",
        FORMATS_EXTS,
        "--reporters",
        "json",
        "--mode",
        "mild",
        "--output",
        rawDir,
        "--ignore",
        ignores.join(","),
        "--gitignore",
        "--silent",
    ];

    const { jscpd } = require("jscpd") as { jscpd: JscpdFn };
    // The exit callback intercepts jscpd's process.exit (it exits non-zero when
    // a duplication threshold is crossed); we only want the report.
    await jscpd(argv, (() => ({})) as (code: number) => {});

    process.chdir(originalCwd);

    const reportPath = path.join(rawDir, "jscpd-report.json");
    if (!fs.existsSync(reportPath)) {
        throw new Error(`jscpd did not produce a report at ${reportPath}`);
    }
    const report = JSON.parse(
        fs.readFileSync(reportPath, "utf8"),
    ) as JscpdReport;

    const norm = (p: string) => p.replace(/\\/g, "/");
    const clones: CloneRecord[] = (report.duplicates ?? []).map((d) => {
        const fileA = norm(d.firstFile.name);
        const fileB = norm(d.secondFile.name);
        const packageA = packageKeyOf(fileA);
        const packageB = packageKeyOf(fileB);
        return {
            format: d.format,
            lines: d.lines,
            tokens: d.tokens,
            crossPackage: packageA !== packageB,
            packageA,
            fileA,
            startA: d.firstFile.start,
            endA: d.firstFile.end,
            packageB,
            fileB,
            startB: d.secondFile.start,
            endB: d.secondFile.end,
        };
    });
    clones.sort((a, b) => b.lines - a.lines);

    // Per-format rollup.
    const fmtMap = new Map<
        string,
        { clones: number; duplicatedLines: number }
    >();
    for (const c of clones) {
        const r = fmtMap.get(c.format) ?? { clones: 0, duplicatedLines: 0 };
        r.clones++;
        r.duplicatedLines += c.lines;
        fmtMap.set(c.format, r);
    }
    const perFormat = [...fmtMap.entries()]
        .map(([format, v]) => ({ format, ...v }))
        .sort((a, b) => b.duplicatedLines - a.duplicatedLines);

    // Per-package rollup (a clone contributes to both of its packages).
    const pkgMap = new Map<string, PackageRollup>();
    const bump = (pkg: string, lines: number, cross: boolean) => {
        const r =
            pkgMap.get(pkg) ??
            ({
                pkg,
                clones: 0,
                duplicatedLines: 0,
                crossPackageClones: 0,
            } as PackageRollup);
        r.clones++;
        r.duplicatedLines += lines;
        if (cross) {
            r.crossPackageClones++;
        }
        pkgMap.set(pkg, r);
    };
    for (const c of clones) {
        bump(c.packageA, c.lines, c.crossPackage);
        if (c.packageB !== c.packageA) {
            bump(c.packageB, c.lines, c.crossPackage);
        }
    }
    const perPackage = [...pkgMap.values()].sort(
        (a, b) => b.duplicatedLines - a.duplicatedLines,
    );

    // Cross-package pair rollup (the consolidation targets).
    const pairMap = new Map<
        string,
        { a: string; b: string; clones: number; lines: number }
    >();
    for (const c of clones) {
        if (!c.crossPackage) {
            continue;
        }
        const [a, b] = [c.packageA, c.packageB].sort();
        const key = `${a}\u0000${b}`;
        const r = pairMap.get(key) ?? { a, b, clones: 0, lines: 0 };
        r.clones++;
        r.lines += c.lines;
        pairMap.set(key, r);
    }
    const crossPackagePairs = [...pairMap.values()].sort(
        (x, y) => y.lines - x.lines,
    );

    return {
        clones,
        totals: report.statistics.total,
        perFormat,
        perPackage,
        crossPackagePairs,
        elapsedMs: Date.now() - started,
    };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function distribution(clones: CloneRecord[]): number[] {
    const counts = new Array(BUCKETS.length).fill(0);
    for (const c of clones) {
        const idx = BUCKETS.findIndex(
            (b) => c.lines >= b.lo && c.lines <= b.hi,
        );
        if (idx >= 0) {
            counts[idx]++;
        }
    }
    return counts;
}

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

// ---------------------------------------------------------------------------
// Report writers
// ---------------------------------------------------------------------------

function writeCsv(outDir: string, clones: CloneRecord[]): string {
    const header = [
        "DuplicatedLines",
        "Tokens",
        "Format",
        "CrossPackage",
        "PackageA",
        "FileA",
        "StartA",
        "EndA",
        "PackageB",
        "FileB",
        "StartB",
        "EndB",
    ].join(",");
    const rows = clones.map((c) =>
        [
            c.lines,
            c.tokens,
            c.format,
            c.crossPackage,
            c.packageA,
            c.fileA,
            c.startA,
            c.endA,
            c.packageB,
            c.fileB,
            c.startB,
            c.endB,
        ]
            .map(csvEscape)
            .join(","),
    );
    const file = path.join(outDir, "clones.csv");
    fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
    return file;
}

function writeJson(
    outDir: string,
    opts: Options,
    result: AnalysisResult,
): string {
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        includeTests: opts.includeTests,
        thresholds: { minTokens: opts.minTokens, minLines: opts.minLines },
        totals: result.totals,
        crossPackageClones: result.clones.filter((c) => c.crossPackage).length,
        distribution: BUCKETS.map((b, i) => ({
            label: b.label,
            lo: b.lo,
            hi: b.hi === Infinity ? null : b.hi,
            count: distribution(result.clones)[i],
        })),
        perFormat: result.perFormat,
        perPackage: result.perPackage,
        crossPackagePairs: result.crossPackagePairs,
        clones: result.clones,
    };
    const file = path.join(outDir, "report.json");
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return file;
}

function writeHtml(
    outDir: string,
    opts: Options,
    result: AnalysisResult,
): string {
    const t = result.totals;
    const dist = distribution(result.clones);
    const maxDist = Math.max(1, ...dist);
    const crossCount = result.clones.filter((c) => c.crossPackage).length;

    const distRows = BUCKETS.map((b, i) => {
        const w = Math.round((dist[i] / maxDist) * 100);
        return `<tr><td>${htmlEscape(b.label)}</td><td class="n">${num(dist[i])}</td>
      <td class="bar"><span style="width:${w}%;background:${b.color}"></span></td></tr>`;
    }).join("\n");

    const pkgRows = result.perPackage
        .slice(0, 40)
        .map(
            (p) =>
                `<tr><td>${htmlEscape(p.pkg)}</td><td class="n">${num(p.duplicatedLines)}</td>
        <td class="n">${num(p.clones)}</td><td class="n">${num(p.crossPackageClones)}</td></tr>`,
        )
        .join("\n");

    const pairRows = result.crossPackagePairs
        .slice(0, opts.top)
        .map(
            (p) =>
                `<tr><td class="n">${num(p.lines)}</td><td class="n">${num(p.clones)}</td>
        <td>${htmlEscape(p.a)}</td><td>${htmlEscape(p.b)}</td></tr>`,
        )
        .join("\n");

    const cloneRows = result.clones
        .slice(0, Math.max(opts.top, 100))
        .map(
            (c) =>
                `<tr class="${c.crossPackage ? "cross" : ""}">
        <td class="n">${num(c.lines)}</td><td class="n">${num(c.tokens)}</td>
        <td>${c.crossPackage ? "yes" : ""}</td>
        <td>${htmlEscape(c.fileA)}:${c.startA}-${c.endA}</td>
        <td>${htmlEscape(c.fileB)}:${c.startB}-${c.endB}</td></tr>`,
        )
        .join("\n");

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent duplication report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  h1 { margin: 0 0 .25rem; } h2 { margin-top: 2rem; }
  .sub { color: #888; margin-bottom: 1.5rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 160px; }
  .card .big { font-size: 1.6rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; vertical-align: top; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: Canvas; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.bar { width: 40%; } td.bar span { display: inline-block; height: 12px; border-radius: 3px; }
  tr.cross { background: #ffca2822; }
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent duplication report</h1>
<div class="sub">engine: jscpd &middot; generated ${htmlEscape(new Date().toISOString())} &middot;
  min-tokens ${opts.minTokens}, min-lines ${opts.minLines} &middot;
  tests ${opts.includeTests ? "included" : "excluded"}</div>

<div class="cards">
  <div class="card"><div class="big">${num(t.clones)}</div>clone pairs</div>
  <div class="card"><div class="big">${num(t.duplicatedLines)}</div>duplicated lines (${t.percentage}%)</div>
  <div class="card"><div class="big">${num(crossCount)}</div>cross-package clones</div>
  <div class="card"><div class="big">${num(t.sources)}</div>files scanned</div>
  <div class="card"><div class="big">${num(t.lines)}</div>lines scanned</div>
</div>

<h2>Clone size distribution</h2>
<table><thead><tr><th>Bucket</th><th class="n">Clones</th><th>&nbsp;</th></tr></thead>
<tbody>${distRows}</tbody></table>

<h2>Cross-package hotspots (consolidation targets)</h2>
<table class="sortable"><thead><tr><th class="n">Dup lines</th><th class="n">Clones</th><th>Package A</th><th>Package B</th></tr></thead>
<tbody>${pairRows || '<tr><td colspan="4">None</td></tr>'}</tbody></table>

<h2>Packages by duplicated lines</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Dup lines</th><th class="n">Clones</th><th class="n">Cross-pkg</th></tr></thead>
<tbody>${pkgRows}</tbody></table>

<h2>Largest clones</h2>
<table class="sortable"><thead><tr><th class="n">Lines</th><th class="n">Tokens</th><th>Cross</th><th>Location A</th><th>Location B</th></tr></thead>
<tbody>${cloneRows}</tbody></table>

<script>
// Minimal click-to-sort for tables marked .sortable.
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
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(opts: Options, result: AnalysisResult): void {
    const t = result.totals;
    const dist = distribution(result.clones);
    const crossCount = result.clones.filter((c) => c.crossPackage).length;

    console.log("");
    console.log("Duplication report (engine: jscpd)");
    console.log(
        `Scanned ${num(t.sources)} files, ${num(t.lines)} lines  |  ` +
            `elapsed ${(result.elapsedMs / 1000).toFixed(1)}s  |  ` +
            `min-tokens ${opts.minTokens}, min-lines ${opts.minLines}`,
    );
    console.log("");
    console.log(
        `Clones: ${num(t.clones)}  |  Duplicated: ${num(t.duplicatedLines)} lines ` +
            `(${t.percentage}%), ${num(t.duplicatedTokens)} tokens (${t.percentageTokens}%)`,
    );
    console.log(`Cross-package clones: ${num(crossCount)}`);

    console.log("");
    console.log("Clone size distribution:");
    BUCKETS.forEach((b, i) => {
        console.log(`  ${b.label.padEnd(14)} ${num(dist[i])}`);
    });

    const topClones = result.clones.slice(0, opts.top);
    if (topClones.length) {
        console.log("");
        console.log(`Largest clones (top ${topClones.length}):`);
        for (const c of topClones) {
            const tag = c.crossPackage ? " [cross-pkg]" : "";
            console.log(
                `  ${String(c.lines).padStart(4)}L  ${c.fileA}:${c.startA}-${c.endA}` +
                    `  <->  ${c.fileB}:${c.startB}-${c.endB}${tag}`,
            );
        }
    }

    if (result.crossPackagePairs.length) {
        console.log("");
        console.log("Cross-package hotspots (consolidation targets):");
        for (const p of result.crossPackagePairs.slice(0, opts.top)) {
            console.log(
                `  ${String(p.lines).padStart(4)}L / ${String(p.clones).padStart(2)} clones  ` +
                    `${p.a}  <->  ${p.b}`,
            );
        }
    }
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

    fs.mkdirSync(opts.outDir, { recursive: true });
    const result = await analyze(opts);

    const csv = writeCsv(opts.outDir, result.clones);
    const json = writeJson(opts.outDir, opts, result);
    const html = writeHtml(opts.outDir, opts, result);
    fs.writeFileSync(path.join(opts.outDir, "report.html"), html, "utf8");

    printSummary(opts, result);
    console.log("");
    console.log("Reports written to:");
    console.log(`  ${path.relative(opts.root, csv).split(path.sep).join("/")}`);
    console.log(
        `  ${path.relative(opts.root, json).split(path.sep).join("/")}`,
    );
    console.log(
        `  ${path.relative(opts.root, path.join(opts.outDir, "report.html")).split(path.sep).join("/")}`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
