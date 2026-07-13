// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cyclomatic + cognitive complexity report for the TypeAgent ts/ tree.
 *
 * The analysis engine is ESLint — the de-facto standard linter for JS/TS — so
 * the numbers come from well-known, widely-used implementations rather than a
 * bespoke metric:
 *   - Cyclomatic complexity: ESLint core `complexity` rule. This is the McCabe
 *     metric, the same one Visual Studio's Code Metrics reports.
 *   - Cognitive complexity: `eslint-plugin-sonarjs` `cognitive-complexity`
 *     rule (SonarSource's metric). Better than cyclomatic at surfacing code
 *     that is hard for a human to follow. Optional — if the plugin cannot be
 *     loaded the report still produces cyclomatic numbers.
 *
 * The repo does not need an ESLint configuration. This script builds a
 * throwaway flat config in memory and runs it purely to harvest metrics, so it
 * never interferes with the rest of the monorepo.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/complexity-report):
 *   - functions.csv : every analyzed function, ranked by cyclomatic complexity
 *   - report.json   : structured metrics (functions, per-file rollups, totals)
 *   - report.html   : a self-contained, sortable report (open in a browser)
 * plus a console summary (distribution + the worst offenders).
 *
 * Usage:
 *   npx tsx tools/scripts/code/complexityReport.ts [options]
 *   npm run code-complexity -- [options]
 *
 * Options:
 *   --include-tests    Include test files (*.spec.*, *.test.*, test dirs).
 *                      Excluded by default.
 *   --cyclomatic <n>   Cyclomatic "budget"; functions above it are counted as
 *                      over budget (default 10, the classic McCabe limit).
 *   --cognitive <n>    Cognitive "budget" (default 15, SonarSource's default).
 *   --top <n>          Number of worst offenders to print / embed (default 25).
 *   --root <path>      Directory to scan (default: the ts/ root).
 *   --out-dir <path>   Output directory (default tools/scripts/code/complexity-report).
 *   --ratchet          CI gate: exit non-zero if the files changed since
 *                      --base contain more over-budget functions than they did
 *                      at the merge base. The base branch is the baseline (no
 *                      baseline file), so the count only ratchets down.
 *   --base <ref>       Base git ref for --ratchet (default origin/main).
 *   --new-file-cyclomatic <n>  With --ratchet, fail if any function in a newly
 *                      added file exceeds cyclomatic <n> (0 = off, default).
 *   --new-file-cognitive <n>   Same, for cognitive complexity.
 *   --help             Show this help.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

// Generated / build-output directories that are never source. node_modules and
// .git are ignored by ESLint's flat config by default.
const IGNORE_DIRS = [
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/coverage/**",
    "**/bin/**",
    "**/obj/**",
    "**/.turbo/**",
    "**/.next/**",
    "**/bundle/**",
];

// Generated single-file artifacts (declarations, bundles, minified output).
const IGNORE_FILES = ["**/*.d.ts", "**/*.min.js", "**/*.bundle.js"];

// Test files and directories, excluded unless --include-tests is passed.
const TEST_GLOBS = [
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/*.spec.*",
    "**/*.test.*",
];

// ESLint renders the metric into the message text; these pull the number back
// out. Core `complexity`: "Function 'foo' has a complexity of 12. Maximum ..."
const CYCLOMATIC_RE = /^(.*?) has a complexity of (\d+)\./;
// sonarjs: "Refactor this function to reduce its Cognitive Complexity from 21 .."
const COGNITIVE_RE = /Cognitive Complexity from (\d+)/;

// Distribution buckets for the cyclomatic histogram. hi is inclusive.
const BUCKETS: { label: string; lo: number; hi: number; color: string }[] = [
    { label: "1-5 (low)", lo: 1, hi: 5, color: "#66bb6a" },
    { label: "6-10 (moderate)", lo: 6, hi: 10, color: "#9ccc65" },
    { label: "11-15 (high)", lo: 11, hi: 15, color: "#ffca28" },
    { label: "16-20 (very high)", lo: 16, hi: 20, color: "#ffa726" },
    { label: "21-30 (severe)", lo: 21, hi: 30, color: "#ef5350" },
    { label: "31+ (extreme)", lo: 31, hi: Infinity, color: "#e53935" },
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    includeTests: boolean;
    cyclomaticBudget: number;
    cognitiveBudget: number;
    top: number;
    ratchet: boolean;
    base: string;
    newCyclomaticCap: number;
    newCognitiveCap: number;
    exceptionsFile?: string;
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
        outDir: path.join(__dirname, "complexity-report"),
        includeTests: false,
        cyclomaticBudget: 10,
        cognitiveBudget: 15,
        top: 25,
        ratchet: false,
        base: "origin/main",
        newCyclomaticCap: 0,
        newCognitiveCap: 0,
        exceptionsFile: undefined,
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
            case "--cyclomatic":
                opts.cyclomaticBudget = parseIntArg(arg, next);
                i++;
                break;
            case "--cognitive":
                opts.cognitiveBudget = parseIntArg(arg, next);
                i++;
                break;
            case "--top":
                opts.top = parseIntArg(arg, next);
                i++;
                break;
            case "--ratchet":
                opts.ratchet = true;
                break;
            case "--base":
                if (next === undefined) {
                    throw new Error(`${arg} requires a git ref`);
                }
                opts.base = next;
                i++;
                break;
            case "--new-file-cyclomatic":
                opts.newCyclomaticCap = parseIntArg(arg, next);
                i++;
                break;
            case "--new-file-cognitive":
                opts.newCognitiveCap = parseIntArg(arg, next);
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

const HELP = `Cyclomatic + cognitive complexity report for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/complexityReport.ts [options]
  npm run code-complexity -- [options]

Options:
  --include-tests    Include test files (excluded by default).
  --cyclomatic <n>   Cyclomatic budget; functions above it count as over
                     budget (default 10, the classic McCabe limit).
  --cognitive <n>    Cognitive budget (default 15, SonarSource's default).
  --top <n>          Number of worst offenders to print / embed (default 25).
  --root <path>      Directory to scan (default: the ts/ root).
  --out-dir <path>   Output directory (default: tools/scripts/code/complexity-report).
  --ratchet          CI gate: fail if changed files add complexity vs --base.
  --base <ref>       Base git ref for --ratchet (default origin/main).
  --new-file-cyclomatic <n>
                     With --ratchet, fail if any function in a NEW file exceeds
                     cyclomatic <n> (0 = disabled, the default).
  --new-file-cognitive <n>
                     Same, for cognitive complexity.
  --exceptions-file <path>
                     Optional JSON baseline-exception file. Functions listed in
                     it are ignored for over-budget counts and ratchet checks.
                     (Deprecated: prefer inline markers below.)
  --help             Show this help.

Inline suppression (preferred over --exceptions-file):
  Put "// code-complexity-allow: <reason>" on a function's declaration line or a
  comment/decorator line directly above it to grandfather it out of --ratchet.
  The marker moves with the code under reformatting; report mode still measures
  and shows the function. A non-empty, non-placeholder reason is required.`;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface FuncRecord {
    file: string; // repo-relative, forward-slash separated
    line: number;
    name: string;
    cyclomatic: number;
    cognitive: number;
}

interface FileRollup {
    file: string;
    functions: number;
    totalCyclomatic: number;
    maxCyclomatic: number;
    maxCognitive: number;
}

interface AnalysisResult {
    functions: FuncRecord[];
    filesAnalyzed: number;
    parseErrorFiles: number;
    cognitiveEnabled: boolean;
    elapsedMs: number;
}

interface ExceptionsFile {
    exceptions?: Array<{
        file?: string;
        line?: number;
    }>;
}

function normalizeExceptionPath(file: string): string {
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
    return normalized.replace(/^ts\//, "");
}

function functionExceptionKey(file: string, line: number): string {
    return `${normalizeExceptionPath(file)}:${line}`;
}

function toFunctionExceptionKey(f: FuncRecord): string {
    return functionExceptionKey(f.file, f.line);
}

function loadExceptionSet(opts: Options): Set<string> {
    if (!opts.exceptionsFile) {
        return new Set();
    }
    console.warn(
        "  Note: --exceptions-file is deprecated; prefer inline " +
            "// code-complexity-allow: <reason> markers.",
    );

    const filePath = path.isAbsolute(opts.exceptionsFile)
        ? opts.exceptionsFile
        : path.resolve(process.cwd(), opts.exceptionsFile);
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
        : ((raw as ExceptionsFile).exceptions ?? []);
    const out = new Set<string>();
    for (const entry of entries) {
        const file = normalizeExceptionPath(entry?.file ?? "");
        const line = entry?.line;
        if (!file || typeof line !== "number" || line <= 0) {
            continue;
        }
        out.add(functionExceptionKey(file, line));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Inline suppression markers
// ---------------------------------------------------------------------------

// A `// code-complexity-allow: <reason>` comment on a function's declaration
// line, or on a contiguous comment/decorator line directly above it,
// grandfathers that function out of the --ratchet gate. Because the comment is
// attached to the function it moves with the code under reformatting, unlike the
// file:line JSON baseline. Report mode ignores markers (every function is still
// measured and shown); only --ratchet honors them. A marker needs a non-empty,
// non-placeholder reason or it is ignored (and warned about) so it cannot
// silently grandfather debt.
const COMPLEXITY_ALLOW_TOKEN = "code-complexity-allow";
const PLACEHOLDER_REASON_RE = /^(temp|tbd|todo|fixme|xxx|n\/?a|\?+|-+|\.+)$/i;

function isValidMarkerReason(reason: string): boolean {
    const r = reason.trim();
    return r.length >= 3 && !PLACEHOLDER_REASON_RE.test(r);
}

/** Extract the reason text following a marker token on a comment line. */
function complexityMarkerReason(lineText: string): string {
    const i = lineText.indexOf(COMPLEXITY_ALLOW_TOKEN);
    if (i < 0) {
        return "";
    }
    return lineText
        .slice(i + COMPLEXITY_ALLOW_TOKEN.length)
        .replace(/^\s*:?/, "") // optional leading colon
        .replace(/\*\/\s*$/, "") // trailing block-comment terminator
        .trim();
}

/** True if a line is a comment or decorator (part of a function's preamble). */
function isPreambleLine(trimmed: string): boolean {
    return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.endsWith("*/") ||
        trimmed.startsWith("@")
    );
}

interface MarkerScan {
    suppressed: boolean;
    invalid: boolean; // marker present but reason missing/placeholder
}

// Scan a function's declaration line and the contiguous comment/decorator lines
// directly above it for a valid allow-marker.
function scanComplexityMarker(
    lines: string[],
    funcLine1Based: number,
): MarkerScan {
    const idx = funcLine1Based - 1;
    if (idx < 0 || idx >= lines.length) {
        return { suppressed: false, invalid: false };
    }
    const classify = (text: string): MarkerScan | undefined => {
        if (!text.includes(COMPLEXITY_ALLOW_TOKEN)) {
            return undefined;
        }
        return isValidMarkerReason(complexityMarkerReason(text))
            ? { suppressed: true, invalid: false }
            : { suppressed: false, invalid: true };
    };
    const trailing = classify(lines[idx]);
    if (trailing) {
        return trailing;
    }
    for (let i = idx - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t === "" || !isPreambleLine(t)) {
            break;
        }
        const res = classify(lines[i]);
        if (res) {
            return res;
        }
    }
    return { suppressed: false, invalid: false };
}

// For the given functions, return the file:line keys of those carrying a valid
// marker plus the list of those whose marker was malformed (for a warning).
function collectComplexitySuppressions(
    functions: FuncRecord[],
    linesOf: (f: FuncRecord) => string[] | undefined,
): { suppressed: Set<string>; invalid: FuncRecord[] } {
    const suppressed = new Set<string>();
    const invalid: FuncRecord[] = [];
    for (const f of functions) {
        const lines = linesOf(f);
        if (!lines) {
            continue;
        }
        const scan = scanComplexityMarker(lines, f.line);
        if (scan.suppressed) {
            suppressed.add(toFunctionExceptionKey(f));
        } else if (scan.invalid) {
            invalid.push(f);
        }
    }
    return { suppressed, invalid };
}

/** Load the optional sonarjs plugin, returning undefined if unavailable. */
async function loadSonar(): Promise<unknown> {
    try {
        const mod = (await import("eslint-plugin-sonarjs")) as {
            default?: unknown;
        };
        return mod.default ?? mod;
    } catch {
        return undefined;
    }
}

/** Build the throwaway flat config used purely to harvest metrics. */
function buildComplexityConfig(
    sonar: unknown,
    useIgnores: boolean,
    includeTests: boolean,
): Linter.Config[] {
    // The core `complexity` rule reports when complexity > max, and the minimum
    // complexity of any function is 1. max:0 therefore flags every function so
    // we capture the whole distribution, not just the ones over some limit.
    const rules: Linter.RulesRecord = {
        complexity: ["warn", { max: 0 }],
    };
    const plugins: Record<string, ESLint.Plugin> = {};
    if (sonar) {
        plugins.sonarjs = sonar as ESLint.Plugin;
        rules["sonarjs/cognitive-complexity"] = ["warn", 0];
    }

    const config: Linter.Config[] = [];
    if (useIgnores) {
        const ignores = [...IGNORE_DIRS, ...IGNORE_FILES];
        if (!includeTests) {
            ignores.push(...TEST_GLOBS);
        }
        config.push({ ignores } as Linter.Config);
    }
    config.push({
        files: [SOURCE_GLOB],
        languageOptions: {
            parser: tseslint.parser as unknown as Linter.Parser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                ecmaFeatures: { jsx: true },
            },
        },
        plugins,
        rules,
    });
    return config;
}

/** Turn ESLint results into FuncRecords, keyed relative to `cwd`. */
function parseEslintResults(
    results: ESLint.LintResult[],
    cwd: string,
): { functions: FuncRecord[]; parseErrorFiles: number } {
    const functions: FuncRecord[] = [];
    let parseErrorFiles = 0;

    for (const res of results) {
        const rel = path.relative(cwd, res.filePath).split(path.sep).join("/");

        // Collect cognitive complexity keyed by the function's start line so we
        // can attach it to the matching cyclomatic record below.
        const cognitiveByLine = new Map<number, number>();
        let hadFatal = false;
        for (const msg of res.messages) {
            if (msg.fatal) {
                hadFatal = true;
                continue;
            }
            if (msg.ruleId === "sonarjs/cognitive-complexity") {
                const m = COGNITIVE_RE.exec(msg.message);
                if (m) {
                    cognitiveByLine.set(msg.line, parseInt(m[1], 10));
                }
            }
        }
        if (hadFatal) {
            parseErrorFiles++;
        }

        for (const msg of res.messages) {
            if (msg.ruleId !== "complexity") {
                continue;
            }
            const m = CYCLOMATIC_RE.exec(msg.message);
            if (!m) {
                continue;
            }
            functions.push({
                file: rel,
                line: msg.line,
                name: m[1],
                cyclomatic: parseInt(m[2], 10),
                cognitive: cognitiveByLine.get(msg.line) ?? 0,
            });
        }
    }

    return { functions, parseErrorFiles };
}

interface LintOutput {
    functions: FuncRecord[];
    parseErrorFiles: number;
    filesAnalyzed: number;
}

/** Run ESLint over `patterns` (globs or explicit paths) relative to `cwd`. */
async function lintToFunctions(
    cwd: string,
    patterns: string[],
    sonar: unknown,
    useIgnores: boolean,
    includeTests: boolean,
): Promise<LintOutput> {
    const eslint = new ESLint({
        cwd,
        errorOnUnmatchedPattern: false,
        // Ignore any eslint config in the repo; use only what we define here.
        overrideConfigFile: true,
        overrideConfig: buildComplexityConfig(sonar, useIgnores, includeTests),
    });
    const results = await eslint.lintFiles(patterns);
    const { functions, parseErrorFiles } = parseEslintResults(results, cwd);
    return { functions, parseErrorFiles, filesAnalyzed: results.length };
}

async function analyze(opts: Options): Promise<AnalysisResult> {
    const started = Date.now();
    const sonar = await loadSonar();
    const { functions, parseErrorFiles, filesAnalyzed } = await lintToFunctions(
        opts.root,
        [SOURCE_GLOB],
        sonar,
        true,
        opts.includeTests,
    );
    return {
        functions,
        filesAnalyzed,
        parseErrorFiles,
        cognitiveEnabled: sonar !== undefined,
        elapsedMs: Date.now() - started,
    };
}

// ---------------------------------------------------------------------------
// Rollups + formatting helpers
// ---------------------------------------------------------------------------

function rollupByFile(functions: FuncRecord[]): FileRollup[] {
    const map = new Map<string, FileRollup>();
    for (const f of functions) {
        let r = map.get(f.file);
        if (!r) {
            r = {
                file: f.file,
                functions: 0,
                totalCyclomatic: 0,
                maxCyclomatic: 0,
                maxCognitive: 0,
            };
            map.set(f.file, r);
        }
        r.functions++;
        r.totalCyclomatic += f.cyclomatic;
        r.maxCyclomatic = Math.max(r.maxCyclomatic, f.cyclomatic);
        r.maxCognitive = Math.max(r.maxCognitive, f.cognitive);
    }
    return [...map.values()];
}

function distribution(functions: FuncRecord[]): number[] {
    const counts = new Array(BUCKETS.length).fill(0);
    for (const f of functions) {
        const idx = BUCKETS.findIndex(
            (b) => f.cyclomatic >= b.lo && f.cyclomatic <= b.hi,
        );
        if (idx >= 0) {
            counts[idx]++;
        }
    }
    return counts;
}

function csvEscape(value: string | number): string {
    const s = String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function htmlEscape(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Format an integer with thousands separators for human-readable output. */
function fmt(n: number): string {
    return n.toLocaleString("en-US");
}

/**
 * Build an escaped vscode:// deep link that opens the file (optionally at a
 * given line) in VS Code when the path is clicked in a browser.
 */
function vscodeLink(root: string, relFile: string, line?: number): string {
    const abs = path.resolve(root, relFile).split(path.sep).join("/");
    const target = line !== undefined ? `${abs}:${line}` : abs;
    return htmlEscape(encodeURI(`vscode://file/${target}`));
}

function formatDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}`
    );
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(
    opts: Options,
    analysis: AnalysisResult,
    byCyclomatic: FuncRecord[],
    byCognitive: FuncRecord[],
    counts: number[],
    exceptions: Set<string>,
): void {
    const { functions } = analysis;
    const overCyclomatic = functions.filter(
        (f) =>
            f.cyclomatic > opts.cyclomaticBudget &&
            !exceptions.has(toFunctionExceptionKey(f)),
    ).length;
    const overCognitive = functions.filter(
        (f) =>
            f.cognitive > opts.cognitiveBudget &&
            !exceptions.has(toFunctionExceptionKey(f)),
    ).length;

    console.log("");
    console.log(
        `Analyzed ${fmt(functions.length)} functions in ` +
            `${fmt(analysis.filesAnalyzed)} files ` +
            `(${(analysis.elapsedMs / 1000).toFixed(1)}s).`,
    );
    if (!analysis.cognitiveEnabled) {
        console.log(
            "  Cognitive complexity unavailable (eslint-plugin-sonarjs not loaded).",
        );
    }
    if (analysis.parseErrorFiles > 0) {
        console.log(
            `  ${fmt(analysis.parseErrorFiles)} file(s) could not be parsed and were skipped.`,
        );
    }

    console.log("");
    console.log("Cyclomatic complexity distribution:");
    const maxCount = Math.max(...counts, 1);
    const barWidth = 32;
    BUCKETS.forEach((b, i) => {
        const c = counts[i];
        const bar = "#".repeat(Math.round((c / maxCount) * barWidth));
        console.log(`  ${b.label.padEnd(18)} ${fmt(c).padStart(8)}  ${bar}`);
    });

    console.log("");
    console.log(
        `Over budget: ${fmt(overCyclomatic)} function(s) > cyclomatic ${opts.cyclomaticBudget}` +
            (analysis.cognitiveEnabled
                ? `, ${fmt(overCognitive)} > cognitive ${opts.cognitiveBudget}`
                : ""),
    );
    if (exceptions.size > 0) {
        console.log(
            `  (${fmt(exceptions.size)} baseline exception(s) ignored by file:line)`,
        );
    }

    const printTable = (title: string, rows: FuncRecord[]): void => {
        console.log("");
        console.log(title);
        console.log("   CC   Cog  Location");
        for (const f of rows) {
            console.log(
                `  ${String(f.cyclomatic).padStart(3)}  ${String(
                    f.cognitive,
                ).padStart(4)}  ${f.file}:${f.line}  ${f.name}`,
            );
        }
    };

    printTable(
        `Top ${opts.top} functions by cyclomatic complexity:`,
        byCyclomatic.slice(0, opts.top),
    );
    if (analysis.cognitiveEnabled) {
        printTable(
            `Top ${opts.top} functions by cognitive complexity:`,
            byCognitive.slice(0, opts.top),
        );
    }
}

// ---------------------------------------------------------------------------
// File outputs
// ---------------------------------------------------------------------------

function writeCsv(filePath: string, functions: FuncRecord[]): void {
    const sorted = [...functions].sort((a, b) => b.cyclomatic - a.cyclomatic);
    const lines = ["File,Line,Function,Cyclomatic,Cognitive"];
    for (const f of sorted) {
        lines.push(
            [
                csvEscape(f.file),
                csvEscape(f.line),
                csvEscape(f.name),
                csvEscape(f.cyclomatic),
                csvEscape(f.cognitive),
            ].join(","),
        );
    }
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function writeJson(
    filePath: string,
    opts: Options,
    analysis: AnalysisResult,
    files: FileRollup[],
    counts: number[],
    exceptions: Set<string>,
): void {
    const { functions } = analysis;
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        includeTests: opts.includeTests,
        cognitiveEnabled: analysis.cognitiveEnabled,
        exceptionsFile: opts.exceptionsFile ?? null,
        baselineExceptions: exceptions.size,
        thresholds: {
            cyclomatic: opts.cyclomaticBudget,
            cognitive: opts.cognitiveBudget,
        },
        totals: {
            functions: functions.length,
            filesAnalyzed: analysis.filesAnalyzed,
            parseErrorFiles: analysis.parseErrorFiles,
            overCyclomatic: functions.filter(
                (f) => f.cyclomatic > opts.cyclomaticBudget,
            ).length,
            overCognitive: functions.filter(
                (f) => f.cognitive > opts.cognitiveBudget,
            ).length,
            overCyclomaticNet: functions.filter(
                (f) =>
                    f.cyclomatic > opts.cyclomaticBudget &&
                    !exceptions.has(toFunctionExceptionKey(f)),
            ).length,
            overCognitiveNet: functions.filter(
                (f) =>
                    f.cognitive > opts.cognitiveBudget &&
                    !exceptions.has(toFunctionExceptionKey(f)),
            ).length,
        },
        distribution: BUCKETS.map((b, i) => ({
            label: b.label,
            lo: b.lo,
            hi: b.hi === Infinity ? null : b.hi,
            count: counts[i],
        })),
        files: [...files].sort((a, b) => b.totalCyclomatic - a.totalCyclomatic),
        functions: [...functions].sort((a, b) => b.cyclomatic - a.cyclomatic),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function distributionBarsHtml(counts: number[]): string {
    const max = Math.max(...counts, 1);
    return BUCKETS.map((b, i) => {
        const c = counts[i];
        const pct = ((c / max) * 100).toFixed(1);
        return `    <div class="drow">
      <div class="dlabel">${htmlEscape(b.label)}</div>
      <div class="dtrack"><div class="dfill" style="width:${pct}%;background:${b.color}"></div></div>
      <div class="dcount">${fmt(c)}</div>
    </div>`;
    }).join("\n");
}

function funcRowsHtml(
    root: string,
    functions: FuncRecord[],
    budgetCc: number,
): string {
    return functions
        .map((f) => {
            const over = f.cyclomatic > budgetCc ? " over" : "";
            return `      <tr>
        <td class="num${over}" data-v="${f.cyclomatic}">${fmt(f.cyclomatic)}</td>
        <td class="num" data-v="${f.cognitive}">${fmt(f.cognitive)}</td>
        <td class="path" data-v="${htmlEscape(f.file)}"><a href="${vscodeLink(root, f.file, f.line)}">${htmlEscape(f.file)}:${f.line}</a></td>
        <td data-v="${htmlEscape(f.name)}">${htmlEscape(f.name)}</td>
      </tr>`;
        })
        .join("\n");
}

function fileRowsHtml(root: string, files: FileRollup[]): string {
    return files
        .map((f) => {
            return `      <tr>
        <td class="num" data-v="${f.totalCyclomatic}">${fmt(f.totalCyclomatic)}</td>
        <td class="num" data-v="${f.maxCyclomatic}">${fmt(f.maxCyclomatic)}</td>
        <td class="num" data-v="${f.functions}">${fmt(f.functions)}</td>
        <td class="path" data-v="${htmlEscape(f.file)}"><a href="${vscodeLink(root, f.file)}">${htmlEscape(f.file)}</a></td>
      </tr>`;
        })
        .join("\n");
}

function buildHtml(
    opts: Options,
    analysis: AnalysisResult,
    byCyclomatic: FuncRecord[],
    files: FileRollup[],
    counts: number[],
    exceptions: Set<string>,
): string {
    const { functions } = analysis;
    const overCyclomatic = functions.filter(
        (f) =>
            f.cyclomatic > opts.cyclomaticBudget &&
            !exceptions.has(toFunctionExceptionKey(f)),
    ).length;
    const topFns = byCyclomatic.slice(0, Math.max(opts.top, 100));
    const topFiles = [...files]
        .sort((a, b) => b.totalCyclomatic - a.totalCyclomatic)
        .slice(0, 50);

    const genDate = formatDate(new Date());
    const testNote = opts.includeTests ? "includes tests" : "excludes tests";
    const cogNote = analysis.cognitiveEnabled
        ? "cyclomatic + cognitive"
        : "cyclomatic only (sonarjs not loaded)";
    const exceptionNote =
        exceptions.size > 0
            ? ` · ${fmt(exceptions.size)} baseline exception(s)`
            : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TypeAgent ts/ — Complexity Report</title>
<style>
  :root { color-scheme: dark light; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    margin: 0; padding: 24px 32px;
    background: #1e1e1e; color: #e8e8e8;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 12px; color: #cfd2d5; }
  .sub { color: #9aa0a6; font-size: 13px; margin-bottom: 20px; }
  .stats { display: flex; gap: 28px; margin-bottom: 22px; flex-wrap: wrap; }
  .stat .n { font-size: 26px; font-weight: 600; color: #4fc3f7; }
  .stat .n.warn { color: #ef5350; }
  .stat .l { font-size: 12px; color: #9aa0a6; text-transform: uppercase; letter-spacing: .5px; }
  .dist { background: #252526; border: 1px solid #333; border-radius: 10px; padding: 16px 18px; }
  .drow { display: flex; align-items: center; gap: 12px; margin: 5px 0; }
  .dlabel { width: 150px; font-size: 12px; color: #cfd2d5; }
  .dtrack { flex: 1; background: #333; border-radius: 4px; height: 16px; overflow: hidden; }
  .dfill { height: 100%; border-radius: 4px; }
  .dcount { width: 60px; text-align: right; font-variant-numeric: tabular-nums; color: #ffcc80; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
  th { color: #9aa0a6; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; cursor: pointer; user-select: none; }
  th:hover { color: #e8e8e8; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; color: #ffcc80; }
  td.num.over { color: #ef5350; font-weight: 700; }
  td.path { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; color: #b0bec5; }
  td.path a { color: inherit; text-decoration: none; }
  td.path a:hover { color: #4fc3f7; text-decoration: underline; }
</style>
</head>
<body>
  <h1>TypeAgent <code>ts/</code> — Complexity Report</h1>
    <div class="sub">${cogNote} · generated ${genDate} · ${testNote}${exceptionNote} · budgets: cyclomatic ${opts.cyclomaticBudget}, cognitive ${opts.cognitiveBudget}</div>

  <div class="stats">
    <div class="stat"><div class="n">${fmt(functions.length)}</div><div class="l">functions</div></div>
    <div class="stat"><div class="n">${fmt(analysis.filesAnalyzed)}</div><div class="l">files</div></div>
    <div class="stat"><div class="n warn">${fmt(overCyclomatic)}</div><div class="l">over cyclomatic ${opts.cyclomaticBudget}</div></div>
  </div>

  <h2>Cyclomatic complexity distribution</h2>
  <div class="dist">
${distributionBarsHtml(counts)}
  </div>

  <h2>Worst offenders (top ${topFns.length} by cyclomatic complexity)</h2>
  <table id="fnTable">
    <thead><tr>
      <th onclick="sortTable('fnTable', 0, true)">Cyclomatic</th>
      <th onclick="sortTable('fnTable', 1, true)">Cognitive</th>
      <th onclick="sortTable('fnTable', 2, false)">Location</th>
      <th onclick="sortTable('fnTable', 3, false)">Function</th>
    </tr></thead>
    <tbody>
${funcRowsHtml(opts.root, topFns, opts.cyclomaticBudget)}
    </tbody>
  </table>

  <h2>Heaviest files (top ${topFiles.length} by total cyclomatic complexity)</h2>
  <table id="fileTable">
    <thead><tr>
      <th onclick="sortTable('fileTable', 0, true)">Total CC</th>
      <th onclick="sortTable('fileTable', 1, true)">Max CC</th>
      <th onclick="sortTable('fileTable', 2, true)">Functions</th>
      <th onclick="sortTable('fileTable', 3, false)">File</th>
    </tr></thead>
    <tbody>
${fileRowsHtml(opts.root, topFiles)}
    </tbody>
  </table>

<script>
function sortTable(id, col, numeric) {
  var table = document.getElementById(id);
  var tbody = table.tBodies[0];
  var rows = Array.prototype.slice.call(tbody.rows);
  var asc = !(table.getAttribute('data-col') === String(col)
    && table.getAttribute('data-dir') === 'asc');
  rows.sort(function (a, b) {
    var x = a.cells[col].getAttribute('data-v');
    var y = b.cells[col].getAttribute('data-v');
    if (numeric) { x = parseFloat(x); y = parseFloat(y); }
    if (x < y) { return asc ? -1 : 1; }
    if (x > y) { return asc ? 1 : -1; }
    return 0;
  });
  rows.forEach(function (r) { tbody.appendChild(r); });
  table.setAttribute('data-col', String(col));
  table.setAttribute('data-dir', asc ? 'asc' : 'desc');
}
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Ratchet (CI gate)
// ---------------------------------------------------------------------------

// Path predicates mirroring the ESLint ignores above, for filtering the raw
// file list that `git diff` returns.
const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/;
const IGNORE_PATH_RE =
    /(^|\/)(node_modules|dist|build|out|coverage|bin|obj|\.turbo|\.next|bundle)\//;
const GENERATED_FILE_RE = /(\.d\.ts|\.min\.js|\.bundle\.js)$/;
const TEST_PATH_RE =
    /(^|\/)(test|tests|__tests__)\/|\.(spec|test)\.[cm]?[jt]sx?$/;

const EMPTY_LINT: LintOutput = {
    functions: [],
    parseErrorFiles: 0,
    filesAnalyzed: 0,
};

function isReportableSource(relPath: string, includeTests: boolean): boolean {
    if (!SOURCE_EXT_RE.test(relPath)) {
        return false;
    }
    if (IGNORE_PATH_RE.test(relPath) || GENERATED_FILE_RE.test(relPath)) {
        return false;
    }
    if (!includeTests && TEST_PATH_RE.test(relPath)) {
        return false;
    }
    return true;
}

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    });
}

interface DiffEntry {
    head: string; // path in HEAD
    base: string | null; // path at the merge base, or null if newly added
}

/** Parse `git diff --name-status -M` into HEAD/base path pairs. */
function parseNameStatus(raw: string): DiffEntry[] {
    const entries: DiffEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
        if (!line) {
            continue;
        }
        const parts = line.split("\t");
        const status = parts[0];
        if (status.startsWith("R") || status.startsWith("C")) {
            entries.push({ base: parts[1], head: parts[2] }); // rename/copy
        } else if (status === "A") {
            entries.push({ base: null, head: parts[1] }); // added
        } else if (status === "D") {
            continue; // deleted in HEAD — nothing to lint
        } else {
            entries.push({ base: parts[1], head: parts[1] }); // modified, etc.
        }
    }
    return entries;
}

function countOver(
    functions: FuncRecord[],
    opts: Options,
    exceptions: Set<string>,
): { overCyclomatic: number; overCognitive: number } {
    return {
        overCyclomatic: functions.filter(
            (f) =>
                f.cyclomatic > opts.cyclomaticBudget &&
                !exceptions.has(toFunctionExceptionKey(f)),
        ).length,
        overCognitive: functions.filter(
            (f) =>
                f.cognitive > opts.cognitiveBudget &&
                !exceptions.has(toFunctionExceptionKey(f)),
        ).length,
    };
}

/**
 * Compare the files changed since --base against their content at the merge
 * base. Fails (exit 1) if the changed files contain more over-budget functions
 * than they did before, so complexity in touched code can only ratchet down.
 * There is no committed baseline: the base branch itself is the baseline.
 * Returns the desired process exit code.
 */
async function runRatchet(opts: Options): Promise<number> {
    const exceptions = loadExceptionSet(opts);
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

    const entries = parseNameStatus(
        git(["diff", "--name-status", "-M", mergeBase, "HEAD"], opts.root),
    ).filter((e) => {
        if (!isReportableSource(e.head, opts.includeTests)) {
            return false;
        }
        const relToRoot = path.relative(
            opts.root,
            path.resolve(repoRoot, e.head),
        );
        return !relToRoot.startsWith("..") && !path.isAbsolute(relToRoot);
    });

    if (entries.length === 0) {
        console.log("Ratchet: no changed source files to check. OK.");
        return 0;
    }

    const sonar = await loadSonar();

    const isOver = (f: FuncRecord): boolean =>
        f.cyclomatic > opts.cyclomaticBudget ||
        f.cognitive > opts.cognitiveBudget;

    // HEAD side: the changed files as they are in the working tree.
    const headPaths = entries
        .map((e) => path.resolve(repoRoot, e.head))
        .filter((p) => fs.existsSync(p));
    const head = headPaths.length
        ? await lintToFunctions(
              repoRoot,
              headPaths,
              sonar,
              false,
              opts.includeTests,
          )
        : EMPTY_LINT;

    // Inline allow-markers on the HEAD files, read from the working tree.
    // Computed per side (see the base side below) so a marker added in the PR
    // suppresses HEAD while the still-unmarked base keeps counting.
    const headLineCache = new Map<string, string[] | null>();
    const headMarkers = collectComplexitySuppressions(
        head.functions.filter(isOver),
        (f) => {
            const abs = path.resolve(repoRoot, f.file);
            if (!headLineCache.has(abs)) {
                try {
                    headLineCache.set(
                        abs,
                        fs.readFileSync(abs, "utf8").split(/\r?\n/),
                    );
                } catch {
                    headLineCache.set(abs, null);
                }
            }
            return headLineCache.get(abs) ?? undefined;
        },
    );

    // BASE side: the same files' content at the merge base, materialized into a
    // temp dir so we compare like-for-like without any committed baseline.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "complexity-base-"));
    let base: LintOutput = EMPTY_LINT;
    let baseMarkers: { suppressed: Set<string>; invalid: FuncRecord[] } = {
        suppressed: new Set(),
        invalid: [],
    };
    try {
        const basePaths: string[] = [];
        const baseLinesByRel = new Map<string, string[]>();
        for (const e of entries) {
            if (!e.base || !isReportableSource(e.base, opts.includeTests)) {
                continue;
            }
            let content: string;
            try {
                content = git(["show", `${mergeBase}:${e.base}`], repoRoot);
            } catch {
                continue; // not present at the base
            }
            const dest = path.join(tmp, e.base);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, "utf8");
            basePaths.push(dest);
            baseLinesByRel.set(e.base, content.split(/\r?\n/));
        }
        if (basePaths.length) {
            base = await lintToFunctions(
                tmp,
                basePaths,
                sonar,
                false,
                opts.includeTests,
            );
            baseMarkers = collectComplexitySuppressions(
                base.functions.filter(isOver),
                (f) => baseLinesByRel.get(f.file),
            );
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Fold inline markers into the per-side exception sets (JSON baseline plus
    // markers). Report mode is unaffected; this only relaxes the gate.
    const headExceptions = new Set([...exceptions, ...headMarkers.suppressed]);
    const baseExceptions = new Set([...exceptions, ...baseMarkers.suppressed]);

    const headOver = countOver(head.functions, opts, headExceptions);
    const baseOver = countOver(base.functions, opts, baseExceptions);
    const dCyc = headOver.overCyclomatic - baseOver.overCyclomatic;
    const dCog = headOver.overCognitive - baseOver.overCognitive;
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

    console.log("");
    console.log(
        `Ratchet vs ${opts.base} (merge-base ${mergeBase.slice(0, 9)}): ` +
            `${entries.length} changed source file(s).`,
    );
    console.log(
        `  Over cyclomatic ${opts.cyclomaticBudget}: ` +
            `${fmt(baseOver.overCyclomatic)} -> ${fmt(headOver.overCyclomatic)} ` +
            `(${sign(dCyc)})`,
    );
    if (sonar) {
        console.log(
            `  Over cognitive ${opts.cognitiveBudget}: ` +
                `${fmt(baseOver.overCognitive)} -> ${fmt(headOver.overCognitive)} ` +
                `(${sign(dCog)})`,
        );
    }

    // Absolute cap on brand-new files: they have no baseline to ratchet
    // against, so hold them to a hard ceiling instead of just "no worse".
    const newFiles = new Set(
        entries.filter((e) => e.base === null).map((e) => e.head),
    );
    const capEnabled =
        newFiles.size > 0 &&
        (opts.newCyclomaticCap > 0 || opts.newCognitiveCap > 0);
    const capViolations = capEnabled
        ? head.functions
              .filter(
                  (f) =>
                      newFiles.has(f.file) &&
                      !headExceptions.has(toFunctionExceptionKey(f)) &&
                      ((opts.newCyclomaticCap > 0 &&
                          f.cyclomatic > opts.newCyclomaticCap) ||
                          (opts.newCognitiveCap > 0 &&
                              f.cognitive > opts.newCognitiveCap)),
              )
              .sort((a, b) => b.cyclomatic - a.cyclomatic)
        : [];

    if (capEnabled) {
        const parts: string[] = [];
        if (opts.newCyclomaticCap > 0) {
            parts.push(`cyclomatic ${opts.newCyclomaticCap}`);
        }
        if (opts.newCognitiveCap > 0) {
            parts.push(`cognitive ${opts.newCognitiveCap}`);
        }
        console.log(
            `  New-file cap (${parts.join(", ")}): ${newFiles.size} new file(s), ` +
                `${capViolations.length} function(s) over.`,
        );
    }
    if (exceptions.size > 0) {
        console.log(
            `  Baseline exceptions ignored: ${fmt(exceptions.size)} (file:line).`,
        );
    }
    if (headMarkers.suppressed.size > 0) {
        console.log(
            `  Inline code-complexity-allow markers honored: ` +
                `${fmt(headMarkers.suppressed.size)}.`,
        );
    }
    if (headMarkers.invalid.length > 0) {
        console.log(
            `  WARNING: ${fmt(headMarkers.invalid.length)} ` +
                `code-complexity-allow marker(s) ignored (missing or ` +
                `placeholder reason — add a real reason after the colon):`,
        );
        for (const f of headMarkers.invalid) {
            console.log(`    ${f.file}:${f.line}  ${f.name}`);
        }
    }

    const printTable = (title: string, rows: FuncRecord[]): void => {
        console.log("");
        console.log(title);
        console.log("   CC   Cog  Location");
        for (const f of rows) {
            console.log(
                `  ${String(f.cyclomatic).padStart(3)}  ${String(
                    f.cognitive,
                ).padStart(4)}  ${f.file}:${f.line}  ${f.name}`,
            );
        }
    };

    const regressed = dCyc > 0 || dCog > 0;

    if (regressed) {
        const offenders = head.functions
            .filter(
                (f) =>
                    (f.cyclomatic > opts.cyclomaticBudget ||
                        f.cognitive > opts.cognitiveBudget) &&
                    !headExceptions.has(toFunctionExceptionKey(f)),
            )
            .sort((a, b) => b.cyclomatic - a.cyclomatic);
        printTable(
            "Ratchet FAILED — reduce complexity in the changed files:",
            offenders,
        );
    }

    if (capViolations.length > 0) {
        printTable(
            "New-file cap FAILED — new files must be simpler than the cap:",
            capViolations,
        );
    }

    if (!regressed && capViolations.length === 0) {
        console.log("Ratchet: OK — changed files did not add complexity.");
        return 0;
    }
    console.error(
        "\nWhy the complexity ratchet exists — and how to reproduce & fix it " +
            "locally: ts/tools/scripts/code/README.md#ci-gates",
    );
    return 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(HELP);
        return;
    }

    if (opts.ratchet) {
        process.exitCode = await runRatchet(opts);
        return;
    }

    const exceptions = loadExceptionSet(opts);

    console.log(`Scanning ${opts.root} for complexity metrics...`);
    const analysis = await analyze(opts);

    if (analysis.functions.length === 0) {
        console.log("No functions found. Nothing to report.");
        return;
    }

    const byCyclomatic = [...analysis.functions].sort(
        (a, b) => b.cyclomatic - a.cyclomatic || b.cognitive - a.cognitive,
    );
    const byCognitive = [...analysis.functions].sort(
        (a, b) => b.cognitive - a.cognitive || b.cyclomatic - a.cyclomatic,
    );
    const files = rollupByFile(analysis.functions);
    const counts = distribution(analysis.functions);

    printSummary(opts, analysis, byCyclomatic, byCognitive, counts, exceptions);

    fs.mkdirSync(opts.outDir, { recursive: true });
    const csvPath = path.join(opts.outDir, "functions.csv");
    const jsonPath = path.join(opts.outDir, "report.json");
    const htmlPath = path.join(opts.outDir, "report.html");
    writeCsv(csvPath, analysis.functions);
    writeJson(jsonPath, opts, analysis, files, counts, exceptions);
    fs.writeFileSync(
        htmlPath,
        buildHtml(opts, analysis, byCyclomatic, files, counts, exceptions),
        "utf8",
    );

    console.log("");
    console.log("Wrote:");
    console.log(`  ${csvPath}`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${htmlPath}`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
