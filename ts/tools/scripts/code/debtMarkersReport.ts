// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Debt-markers report + hard gate for the TypeAgent ts/ tree.
 *
 * A lightweight, dependency-free scan (line-level regex, so treat hits as
 * candidates) for debt markers that the heavier engines do not cover:
 *   - TODO / FIXME / HACK / XXX comments
 *   - @deprecated annotations (APIs kept alive past their use-by date)
 *   - Skipped tests: .skip( / .skip.each( / xit( / xdescribe(  (empty-body
 *     "() => {}" stubs are conditional/placeholder skips, not disabled tests)
 *   - Focused tests: .only( / .only.each( / fit( / fdescribe(  (never committed)
 *
 * Unlike lint and circular deps (large problems -> ratchet), skipped/focused
 * tests are a small, fixable problem, so this ships a *hard gate* rather than a
 * ratchet:
 *   - Gate (--gate --base <ref>): fail if any changed file contains a focused
 *     test, or introduces a new skipped test versus the base. TODO/@deprecated
 *     are reported but not gated (tracked, not blocked).
 *
 * Outputs (written to --out-dir, default tools/scripts/code/debt-report):
 *   - markers.csv : every marker (file, line, type, text)
 *   - report.json : structured metrics (per-type, per-package)
 *   - report.html : a self-contained, sortable report
 *
 * Usage:
 *   npx tsx tools/scripts/code/debtMarkersReport.ts [options]
 *   npm run code-debt -- [options]
 *
 * Options:
 *   --top <n>        Number of rows to print / embed (default 25).
 *   --root <path>    Directory to scan (default: the ts/ root).
 *   --out-dir <path> Output directory (default tools/scripts/code/debt-report).
 *   --gate           CI gate: fail on focused tests / new skipped tests vs --base.
 *   --base <ref>     Base git ref for --gate (default origin/main).
 *   --exceptions-file <path>  Baseline exceptions (file:line) ignored by --gate.
 *   --help           Show this help.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_SUBDIRS = ["packages", "examples", "extensions", "tools"];

const CODE_EXTS = new Set([
    ".ts",
    ".mts",
    ".cts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
]);

const IGNORE_DIR_NAMES = new Set([
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    "bin",
    "obj",
    ".turbo",
    ".next",
    "bundle",
    ".git",
    ".jscpd",
    "complexity-report",
    "duplication-report",
    "consistency-report",
    "lint-report",
    "circular-report",
    "deadcode-report",
    "debt-report",
]);

// Marker matchers. Each returns the count of matches on a line.
const MARKERS: {
    type: string;
    re: RegExp;
    gate: "focused" | "skip" | "none";
}[] = [
    { type: "TODO", re: /\bTODO\b/g, gate: "none" },
    { type: "FIXME", re: /\bFIXME\b/g, gate: "none" },
    { type: "HACK", re: /\bHACK\b/g, gate: "none" },
    { type: "XXX", re: /\bXXX\b/g, gate: "none" },
    { type: "@deprecated", re: /@deprecated\b/g, gate: "none" },
    {
        type: "skipped-test",
        re: /\b(?:it|test|describe)\.skip(?:\.each)?\s*[(`]|\bxit\s*\(|\bxdescribe\s*\(/g,
        gate: "skip",
    },
    {
        type: "focused-test",
        re: /\b(?:it|test|describe)\.only(?:\.each)?\s*[(`]|\bfit\s*\(|\bfdescribe\s*\(/g,
        gate: "focused",
    },
];

// Focused/skipped test markers are only meaningful in test files.
const FOCUSED_RE =
    /\b(?:it|test|describe)\.only(?:\.each)?\s*[(`]|\bfit\s*\(|\bfdescribe\s*\(/g;
const SKIP_RE =
    /\b(?:it|test|describe)\.skip(?:\.each)?\s*[(`]|\bxit\s*\(|\bxdescribe\s*\(/g;

// A skip whose callback is an empty arrow body `() => {}` on the same line is a
// *conditional* or *placeholder* skip -- the key-gated `testIf`/`describeIf`
// helpers, or data-driven `if (fixture === undefined) it.skip(name, () => {})`
// placeholders -- not a genuinely disabled test. A real disabled test keeps its
// body, so its `.skip(` opener is not an empty stub. Excluding the empty stubs
// makes the count reflect tests that are actually turned off.
const EMPTY_SKIP_STUB_RE = /=>\s*\{\s*\}/;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    top: number;
    gate: boolean;
    base: string;
    exceptionsFile?: string;
    help: boolean;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        root: path.resolve(__dirname, "..", "..", ".."),
        outDir: path.join(__dirname, "debt-report"),
        top: 25,
        gate: false,
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
            case "--top":
                if (next === undefined || !/^\d+$/.test(next)) {
                    throw new Error("--top requires a positive integer");
                }
                opts.top = parseInt(next, 10);
                i++;
                break;
            case "--gate":
                opts.gate = true;
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

const HELP = `Debt-markers report + hard gate for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/debtMarkersReport.ts [options]
  npm run code-debt -- [options]

Options:
  --top <n>        Number of rows to print / embed (default 25).
  --root <path>    Directory to scan (default: the ts/ root).
  --out-dir <path> Output directory (default: tools/scripts/code/debt-report).
  --gate           CI gate: fail on focused tests / new skipped tests vs --base.
  --base <ref>     Base git ref for --gate (default origin/main).
  --exceptions-file <path>
                   Optional JSON baseline-exception file. Focused/skipped tests
                   listed in it (by file:line) are ignored by the --gate check.
  --help           Show this help.`;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function* walk(dir: string): Generator<string> {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!IGNORE_DIR_NAMES.has(e.name)) {
                yield* walk(full);
            }
        } else if (e.isFile()) {
            yield full;
        }
    }
}

function isCodeFile(name: string): boolean {
    if (/\.d\.(ts|mts|cts)$/.test(name)) {
        return false;
    }
    return CODE_EXTS.has(path.extname(name));
}

function isTestFile(rel: string): boolean {
    return (
        /\.(spec|test)\./.test(rel) ||
        /(^|\/)(test|tests|__tests__)\//.test(rel)
    );
}

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

interface Marker {
    file: string;
    line: number;
    type: string;
    text: string;
}

function scanContent(rel: string, content: string, isTest: boolean): Marker[] {
    const markers: Marker[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const m of MARKERS) {
            // Skipped/focused test markers only count in test files.
            if ((m.gate === "skip" || m.gate === "focused") && !isTest) {
                continue;
            }
            // Conditional/placeholder skips (empty `() => {}` bodies) aren't debt.
            if (m.gate === "skip" && EMPTY_SKIP_STUB_RE.test(line)) {
                continue;
            }
            m.re.lastIndex = 0;
            const hits = line.match(m.re);
            if (hits) {
                for (let h = 0; h < hits.length; h++) {
                    markers.push({
                        file: rel,
                        line: i + 1,
                        type: m.type,
                        text: line.trim().slice(0, 200),
                    });
                }
            }
        }
    }
    return markers;
}

// Count genuinely disabled skipped tests in a file, excluding conditional /
// placeholder stubs (empty `() => {}` bodies) so the gate only trips on real
// newly-disabled tests, not on key-gated or data-driven runtime skips.
function countSkips(content: string): number {
    let n = 0;
    for (const line of content.split(/\r?\n/)) {
        if (EMPTY_SKIP_STUB_RE.test(line)) {
            continue;
        }
        SKIP_RE.lastIndex = 0;
        const hits = line.match(SKIP_RE);
        if (hits) {
            n += hits.length;
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string | number): string {
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
// Report mode
// ---------------------------------------------------------------------------

function collect(root: string): Marker[] {
    const markers: Marker[] = [];
    for (const sub of SCAN_SUBDIRS) {
        const abs = path.join(root, sub);
        if (!fs.existsSync(abs)) {
            continue;
        }
        for (const full of walk(abs)) {
            if (!isCodeFile(full)) {
                continue;
            }
            const rel = path.relative(root, full).split(path.sep).join("/");
            let content: string;
            try {
                content = fs.readFileSync(full, "utf8");
            } catch {
                continue;
            }
            markers.push(...scanContent(rel, content, isTestFile(rel)));
        }
    }
    return markers;
}

function runReport(opts: Options): number {
    const started = Date.now();
    const markers = collect(opts.root);

    const byType = new Map<string, number>();
    for (const m of MARKERS) {
        byType.set(m.type, 0);
    }
    for (const mk of markers) {
        byType.set(mk.type, (byType.get(mk.type) ?? 0) + 1);
    }

    const byPkg = new Map<string, number>();
    for (const mk of markers) {
        const p = packageKeyOf(mk.file);
        byPkg.set(p, (byPkg.get(p) ?? 0) + 1);
    }
    const perPackage = [...byPkg.entries()]
        .map(([pkg, count]) => ({ pkg, count }))
        .sort((a, b) => b.count - a.count || a.pkg.localeCompare(b.pkg));

    const byFile = new Map<string, number>();
    for (const mk of markers) {
        byFile.set(mk.file, (byFile.get(mk.file) ?? 0) + 1);
    }
    const perFile = [...byFile.entries()]
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count);

    fs.mkdirSync(opts.outDir, { recursive: true });

    // CSV
    const header = ["Type", "Package", "File", "Line", "Text"].join(",");
    const rows = markers.map((mk) =>
        [mk.type, packageKeyOf(mk.file), mk.file, mk.line, mk.text]
            .map(csvEscape)
            .join(","),
    );
    const csv = path.join(opts.outDir, "markers.csv");
    fs.writeFileSync(csv, [header, ...rows].join("\n") + "\n", "utf8");

    // JSON
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        totals: {
            markers: markers.length,
            byType: Object.fromEntries(byType),
        },
        perPackage,
        perFile,
    };
    const json = path.join(opts.outDir, "report.json");
    fs.writeFileSync(json, JSON.stringify(payload, null, 2) + "\n", "utf8");

    // HTML
    const typeRows = [...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
            ([t, c]) =>
                `<tr><td>${htmlEscape(t)}</td><td class="n">${num(c)}</td></tr>`,
        )
        .join("\n");
    const pkgRows = perPackage
        .slice(0, Math.max(opts.top, 60))
        .map(
            (p) =>
                `<tr><td>${htmlEscape(p.pkg)}</td><td class="n">${num(p.count)}</td></tr>`,
        )
        .join("\n");
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent debt-markers report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  h1 { margin: 0 0 .25rem; } h2 { margin-top: 2rem; }
  .sub { color: #888; margin-bottom: 1.5rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 140px; }
  .card .big { font-size: 1.6rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: Canvas; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent debt-markers report</h1>
<div class="sub">generated ${htmlEscape(new Date().toISOString())} &middot; ${num(markers.length)} markers &middot; line-level scan</div>
<div class="cards">
  <div class="card"><div class="big">${num(byType.get("skipped-test") ?? 0)}</div>skipped tests</div>
  <div class="card"><div class="big">${num(byType.get("focused-test") ?? 0)}</div>focused tests</div>
  <div class="card"><div class="big">${num(byType.get("@deprecated") ?? 0)}</div>@deprecated</div>
  <div class="card"><div class="big">${num((byType.get("TODO") ?? 0) + (byType.get("FIXME") ?? 0) + (byType.get("HACK") ?? 0) + (byType.get("XXX") ?? 0))}</div>TODO/FIXME/HACK/XXX</div>
</div>
<h2>By type</h2>
<table class="sortable"><thead><tr><th>Type</th><th class="n">Count</th></tr></thead>
<tbody>${typeRows}</tbody></table>
<h2>By package</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Count</th></tr></thead>
<tbody>${pkgRows}</tbody></table>
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
    fs.writeFileSync(path.join(opts.outDir, "report.html"), html, "utf8");

    console.log("");
    console.log("Debt-markers report (line-level scan)");
    console.log(
        `Markers: ${num(markers.length)}  |  elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    console.log("");
    console.log("By type:");
    for (const [t, c] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(c).padStart(6)}  ${t}`);
    }
    console.log("");
    console.log(`Top ${opts.top} packages:`);
    for (const p of perPackage.slice(0, opts.top)) {
        console.log(`  ${String(p.count).padStart(6)}  ${p.pkg}`);
    }
    console.log("");
    console.log("Reports written to:");
    for (const f of ["markers.csv", "report.json", "report.html"]) {
        console.log(
            `  ${path.relative(opts.root, path.join(opts.outDir, f)).split(path.sep).join("/")}`,
        );
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Gate mode (CI hard gate)
// ---------------------------------------------------------------------------

const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/;
const IGNORE_PATH_RE =
    /(^|\/)(node_modules|dist|build|out|coverage|bin|obj|\.turbo|\.next|bundle)\//;
const GENERATED_FILE_RE = /(\.d\.ts|\.min\.js|\.bundle\.js)$/;

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    });
}

interface DiffEntry {
    head: string;
    base: string | null;
}

function parseNameStatus(raw: string): DiffEntry[] {
    const entries: DiffEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
        if (!line) {
            continue;
        }
        const parts = line.split("\t");
        const status = parts[0];
        if (status.startsWith("R") || status.startsWith("C")) {
            entries.push({ base: parts[1], head: parts[2] });
        } else if (status === "A") {
            entries.push({ base: null, head: parts[1] });
        } else if (status === "D") {
            continue;
        } else {
            entries.push({ base: parts[1], head: parts[1] });
        }
    }
    return entries;
}

function isSource(rel: string): boolean {
    return (
        SOURCE_EXT_RE.test(rel) &&
        !IGNORE_PATH_RE.test(rel) &&
        !GENERATED_FILE_RE.test(rel)
    );
}

// Baseline exceptions: a JSON file of { file, line } entries (or
// { exceptions: [...] }) whose file:line focused/skipped tests the gate ignores.
// Lets a deliberately retained marker be grandfathered without weakening the
// gate for everything else.
function normalizeExceptionPath(file: string): string {
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
    return normalized.replace(/^ts\//, "");
}

function exceptionKey(file: string, line: number): string {
    return `${normalizeExceptionPath(file)}:${line}`;
}

function loadExceptionSet(exceptionsFile: string | undefined): Set<string> {
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
        : ((raw as { exceptions?: Array<{ file?: string; line?: number }> })
              .exceptions ?? []);
    const out = new Set<string>();
    for (const entry of entries) {
        const file = normalizeExceptionPath(entry?.file ?? "");
        const line = entry?.line;
        if (!file || typeof line !== "number" || line <= 0) {
            continue;
        }
        out.add(`${file}:${line}`);
    }
    return out;
}

function runGate(opts: Options): number {
    const exceptions = loadExceptionSet(opts.exceptionsFile);
    let repoRoot: string;
    let mergeBase: string;
    try {
        repoRoot = git(["rev-parse", "--show-toplevel"], opts.root).trim();
        mergeBase = git(["merge-base", opts.base, "HEAD"], opts.root).trim();
    } catch {
        console.error(
            `Gate: could not resolve base ref "${opts.base}" via git. ` +
                "Pass --base <ref> (e.g. origin/main) and ensure it is fetched.",
        );
        return 2;
    }

    const entries = parseNameStatus(
        git(["diff", "--name-status", "-M", mergeBase, "HEAD"], opts.root),
    ).filter((e) => {
        if (!isSource(e.head)) {
            return false;
        }
        const relToRoot = path.relative(
            opts.root,
            path.resolve(repoRoot, e.head),
        );
        return !relToRoot.startsWith("..") && !path.isAbsolute(relToRoot);
    });

    if (entries.length === 0) {
        console.log("Gate: no changed source files to check. OK.");
        return 0;
    }

    const focusedHits: string[] = [];
    const skipHits: string[] = [];
    let headSkips = 0;
    let baseSkips = 0;

    for (const e of entries) {
        if (!isTestFile(e.head)) {
            continue; // focused/skipped tests only matter in test files
        }
        const headAbs = path.resolve(repoRoot, e.head);
        if (fs.existsSync(headAbs)) {
            const content = fs.readFileSync(headAbs, "utf8");
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                // A baseline exception (file:line) grandfathers whatever
                // focused/skipped marker sits on that head line.
                if (exceptions.has(exceptionKey(e.head, i + 1))) {
                    continue;
                }
                FOCUSED_RE.lastIndex = 0;
                if (FOCUSED_RE.test(lines[i])) {
                    focusedHits.push(
                        `  ${e.head}:${i + 1}  ${lines[i].trim()}`,
                    );
                }
                // Match countSkips(): ignore empty stub bodies (`() => {}`) so
                // the gate only trips on genuinely disabled tests.
                if (EMPTY_SKIP_STUB_RE.test(lines[i])) {
                    continue;
                }
                SKIP_RE.lastIndex = 0;
                const skipsOnLine = lines[i].match(SKIP_RE)?.length ?? 0;
                if (skipsOnLine > 0) {
                    headSkips += skipsOnLine;
                    skipHits.push(`  ${e.head}:${i + 1}  ${lines[i].trim()}`);
                }
            }
        }
        if (e.base && isTestFile(e.base)) {
            try {
                const baseContent = git(
                    ["show", `${mergeBase}:${e.base}`],
                    repoRoot,
                );
                baseSkips += countSkips(baseContent);
            } catch {
                /* file did not exist at base */
            }
        }
    }

    console.log(
        `Gate: ${entries.length} changed source file(s)  |  skipped tests base ${baseSkips} -> head ${headSkips}`,
    );
    if (exceptions.size > 0) {
        console.log(
            `  Baseline exceptions ignored: ${exceptions.size} (file:line).`,
        );
    }

    let failed = false;
    if (focusedHits.length > 0) {
        failed = true;
        console.error(
            `\nGate FAILED: focused test(s) must not be committed (.only/fit/fdescribe):`,
        );
        focusedHits.forEach((h) => console.error(h));
    }
    if (headSkips > baseSkips) {
        failed = true;
        console.error(
            `\nGate FAILED: changed files add ${headSkips - baseSkips} skipped test(s) ` +
                "(.skip/xit/xdescribe). Un-skip or delete them.",
        );
        if (skipHits.length > 0) {
            console.error("Skipped tests in the changed files:");
            skipHits.forEach((h) => console.error(h));
        }
    }

    if (failed) {
        return 1;
    }
    console.log("Gate OK: no focused tests and no new skipped tests.");
    return 0;
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
        process.exitCode = 2;
        return;
    }

    if (opts.help) {
        console.log(HELP);
        return;
    }

    process.exitCode = opts.gate ? runGate(opts) : runReport(opts);
}

main();
