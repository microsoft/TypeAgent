// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Lint report + ratchet gate for the TypeAgent ts/ tree.
 *
 * The engine is ESLint (with typescript-eslint), the de-facto standard, run
 * against a throwaway in-memory flat config so the repo needs no committed
 * ESLint configuration — the same approach as the sibling complexityReport.ts.
 * It harvests a curated, high-signal rule set rather than enforcing a full
 * style guide:
 *
 *   Syntactic (always on — fast, no type information required):
 *     - @typescript-eslint/no-explicit-any   (erodes type safety)
 *     - no-console (allow warn/error)         (stray console.log; use `debug`)
 *     - @typescript-eslint/no-unused-vars     (dead code)
 *     - no-debugger, no-var, prefer-const
 *
 *   Type-aware (opt-in via --type-aware — slower, needs the TS project):
 *     - @typescript-eslint/no-floating-promises  (unawaited promises: the
 *                                                 single highest-value bug
 *                                                 class in an async agent system)
 *     - @typescript-eslint/no-misused-promises
 *     - @typescript-eslint/no-deprecated         (use of @deprecated APIs)
 *
 * Two modes:
 *   - Report (default): scan the tree and write CSV/JSON/HTML + a console
 *     summary (per-rule, per-package, worst files).
 *   - Ratchet (--ratchet --base <ref>): a stateless CI gate. It lints only the
 *     files changed since the merge base, on both their HEAD content and their
 *     content at the base, and fails if the change introduces more violations
 *     than it removes. The base branch is the baseline (no committed baseline
 *     file), so violations in touched code can only trend down. Ratchet uses
 *     the syntactic rules only, so HEAD and the base (materialized to a temp
 *     dir, where the TS project is unavailable) are compared like-for-like.
 *     On failure it prints where the new violations are — the file:line of the
 *     regressed rules in each changed file.
 *     On failure it prints where the new violations are — the file:line of the
 *     regressed rules in each changed file.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/lint-report):
 *   - violations.csv : every violation, ranked
 *   - report.json    : structured metrics (per-rule, per-package, per-file)
 *   - report.html    : a self-contained, sortable report
 *
 * Usage:
 *   npx tsx tools/scripts/code/lintReport.ts [options]
 *   npm run code-lint -- [options]
 *
 * Options:
 *   --include-tests    Include test files (excluded by default).
 *   --type-aware       Also run the type-aware rules (slower; needs the TS
 *                      project). Report mode only.
 *   --top <n>          Number of worst offenders to print / embed (default 25).
 *   --root <path>      Directory to scan (default: the ts/ root).
 *   --out-dir <path>   Output directory (default tools/scripts/code/lint-report).
 *   --ratchet          CI gate: fail if changed files add violations vs --base.
 *   --base <ref>       Base git ref for --ratchet (default origin/main).
 *   --new-file-max <n> With --ratchet, also fail if any NEW file has more than
 *                      <n> violations (-1 = disabled, the default).
 *   --fix              Apply the auto-fixable rules (no-var, prefer-const).
 *   --changed          With --fix, only fix files changed since --base.
 *   --exceptions-file <path>  Baseline exceptions (file:line) ignored by --ratchet.
 *                      (Deprecated: prefer inline `// code-lint-allow <rule>: <reason>`.)
 *   --help             Show this help.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

// node_modules and .git are ignored by ESLint's flat config by default.
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
    "**/webview-dist/**",
];

const IGNORE_FILES = ["**/*.d.ts", "**/*.min.js", "**/*.bundle.js"];

const TEST_GLOBS = [
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/*.spec.*",
    "**/*.test.*",
];

const SYNTACTIC_RULES: Linter.RulesRecord = {
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-debugger": "warn",
    "no-var": "warn",
    "prefer-const": ["warn", { ignoreReadBeforeAssign: true }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
        "warn",
        {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrors: "none",
        },
    ],
};

const TYPE_AWARE_RULES: Linter.RulesRecord = {
    "@typescript-eslint/no-floating-promises": "warn",
    "@typescript-eslint/no-misused-promises": "warn",
    "@typescript-eslint/no-deprecated": "warn",
};

// Auto-fixable rules applied by --fix. Kept deliberately narrow: both are
// mechanical, semantics-preserving fixes, so a bulk fix is safe to land.
const FIX_RULES: Linter.RulesRecord = {
    "no-var": "warn",
    "prefer-const": ["warn", { ignoreReadBeforeAssign: true }],
};

// Rules that must stay at zero in changed files (trivially auto-fixable, so
// there is never a reason to introduce one). The ratchet fails if a changed
// file contains any of these, independent of the net count.
const ZERO_TOLERANCE_RULES = ["no-var", "prefer-const"];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    includeTests: boolean;
    typeAware: boolean;
    top: number;
    ratchet: boolean;
    base: string;
    newFileMax: number;
    fix: boolean;
    changed: boolean;
    exceptionsFile?: string;
    help: boolean;
}

function parseIntArg(arg: string, next: string | undefined): number {
    if (next === undefined || !/^-?\d+$/.test(next)) {
        throw new Error(`${arg} requires an integer value`);
    }
    return parseInt(next, 10);
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        root: path.resolve(__dirname, "..", "..", ".."),
        outDir: path.join(__dirname, "lint-report"),
        includeTests: false,
        typeAware: false,
        top: 25,
        ratchet: false,
        base: "origin/main",
        newFileMax: -1,
        fix: false,
        changed: false,
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
            case "--type-aware":
                opts.typeAware = true;
                break;
            case "--fix":
                opts.fix = true;
                break;
            case "--changed":
                opts.changed = true;
                break;
            case "--exceptions-file":
            case "--exceptionsFile":
                if (next === undefined) {
                    throw new Error(`${arg} requires a path`);
                }
                opts.exceptionsFile = next;
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
            case "--new-file-max":
                opts.newFileMax = parseIntArg(arg, next);
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

const HELP = `Lint report + ratchet gate for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/lintReport.ts [options]
  npm run code-lint -- [options]

Options:
  --include-tests    Include test files (excluded by default).
  --type-aware       Also run type-aware rules (no-floating-promises,
                     no-misused-promises, no-deprecated). Slower; report only.
  --fix              Apply the auto-fixable rules (no-var, prefer-const) in
                     place. Review + rebuild before committing.
  --changed          With --fix, only fix files changed since --base (instead
                     of the whole tree). Keeps a PR self-contained.
  --exceptions-file <path>
                     Optional JSON baseline-exception file. Violations listed
                     in it (by file:line) are ignored by the --ratchet gate.
                     (Deprecated: prefer inline markers below.)
  --top <n>          Number of worst offenders to print / embed (default 25).
  --root <path>      Directory to scan (default: the ts/ root).
  --out-dir <path>   Output directory (default: tools/scripts/code/lint-report).
  --ratchet          CI gate: fail if changed files add violations vs --base.
  --base <ref>       Base git ref for --ratchet (default origin/main).
  --new-file-max <n> With --ratchet, fail if any NEW file exceeds <n>
                     violations (-1 = disabled, the default).
  --help             Show this help.

Inline suppression (preferred over --exceptions-file):
  Put "// code-lint-allow <rule>[,<rule>]: <reason>" trailing a line (applies to
  that line) or as a standalone comment above it (applies to the next line) to
  grandfather those rule(s) there out of --ratchet. The rule qualifier and a
  non-placeholder reason are required; report mode still counts the violation.`;

// ---------------------------------------------------------------------------
// ESLint plumbing
// ---------------------------------------------------------------------------

interface Violation {
    file: string; // repo-relative, forward-slash separated
    line: number;
    column: number;
    rule: string;
    severity: number; // 1 = warn, 2 = error
    message: string;
}

interface LintOutput {
    violations: Violation[];
    parseErrorFiles: number;
    filesAnalyzed: number;
}

// CLI scripts and build/analysis tooling under tools/scripts write to stdout via
// console by design, so `no-console` does not apply to them. The leading **/
// keeps this matching whether ESLint's cwd is ts/ (report mode) or the repo root
// (ratchet mode).
const CONSOLE_ALLOWED_GLOBS = [
    "**/tools/scripts/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
];

function buildConfig(
    typeAware: boolean,
    useIgnores: boolean,
    includeTests: boolean,
    tsconfigRootDir: string,
): Linter.Config[] {
    const rules: Linter.RulesRecord = {
        ...SYNTACTIC_RULES,
        ...(typeAware ? TYPE_AWARE_RULES : {}),
    };

    const config: Linter.Config[] = [];
    if (useIgnores) {
        const ignores = [...IGNORE_DIRS, ...IGNORE_FILES];
        if (!includeTests) {
            ignores.push(...TEST_GLOBS);
        }
        config.push({ ignores } as Linter.Config);
    }

    const parserOptions: Linter.ParserOptions = typeAware
        ? {
              projectService: true,
              tsconfigRootDir,
              ecmaFeatures: { jsx: true },
          }
        : {
              ecmaVersion: "latest",
              sourceType: "module",
              ecmaFeatures: { jsx: true },
          };

    config.push({
        files: [SOURCE_GLOB],
        languageOptions: {
            parser: tseslint.parser as unknown as Linter.Parser,
            parserOptions,
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin as unknown as ESLint.Plugin,
        },
        rules,
    });
    // CLI/build scripts legitimately use console for their output.
    config.push({
        files: CONSOLE_ALLOWED_GLOBS,
        rules: { "no-console": "off" },
    } as Linter.Config);
    return config;
}

function parseResults(
    results: ESLint.LintResult[],
    cwd: string,
): { violations: Violation[]; parseErrorFiles: number } {
    const violations: Violation[] = [];
    let parseErrorFiles = 0;
    for (const res of results) {
        const rel = path.relative(cwd, res.filePath).split(path.sep).join("/");
        let hadFatal = false;
        for (const msg of res.messages) {
            if (msg.fatal) {
                hadFatal = true;
                continue;
            }
            violations.push({
                file: rel,
                line: msg.line ?? 0,
                column: msg.column ?? 0,
                rule: msg.ruleId ?? "(unknown)",
                severity: msg.severity,
                message: msg.message,
            });
        }
        if (hadFatal) {
            parseErrorFiles++;
        }
    }
    return { violations, parseErrorFiles };
}

async function lint(
    cwd: string,
    patterns: string[],
    opts: { typeAware: boolean; useIgnores: boolean; includeTests: boolean },
    tsconfigRootDir: string,
): Promise<LintOutput> {
    const eslint = new ESLint({
        cwd,
        errorOnUnmatchedPattern: false,
        overrideConfigFile: true,
        overrideConfig: buildConfig(
            opts.typeAware,
            opts.useIgnores,
            opts.includeTests,
            tsconfigRootDir,
        ),
    });
    const results = await eslint.lintFiles(patterns);
    const { violations, parseErrorFiles } = parseResults(results, cwd);
    return { violations, parseErrorFiles, filesAnalyzed: results.length };
}

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

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
    const m = new Map<string, number>();
    for (const it of items) {
        const k = key(it);
        m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
}

function sortedEntries(
    m: Map<string, number>,
): { name: string; count: number }[] {
    return [...m.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
// Report writers
// ---------------------------------------------------------------------------

function writeCsv(outDir: string, violations: Violation[]): string {
    const header = [
        "File",
        "Line",
        "Column",
        "Rule",
        "Severity",
        "Message",
    ].join(",");
    const rows = violations.map((v) =>
        [
            v.file,
            v.line,
            v.column,
            v.rule,
            v.severity === 2 ? "error" : "warn",
            v.message,
        ]
            .map(csvEscape)
            .join(","),
    );
    const file = path.join(outDir, "violations.csv");
    fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
    return file;
}

function writeJson(
    outDir: string,
    opts: Options,
    out: LintOutput,
    perRule: { name: string; count: number }[],
    perPackage: { name: string; count: number }[],
    perFile: { name: string; count: number }[],
): string {
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        includeTests: opts.includeTests,
        typeAware: opts.typeAware,
        totals: {
            violations: out.violations.length,
            filesAnalyzed: out.filesAnalyzed,
            filesWithViolations: perFile.length,
            parseErrorFiles: out.parseErrorFiles,
        },
        perRule,
        perPackage,
        perFile,
    };
    const file = path.join(outDir, "report.json");
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return file;
}

function writeHtml(
    outDir: string,
    opts: Options,
    out: LintOutput,
    perRule: { name: string; count: number }[],
    perPackage: { name: string; count: number }[],
    perFile: { name: string; count: number }[],
): string {
    const row2 = (a: string, b: number) =>
        `<tr><td>${htmlEscape(a)}</td><td class="n">${num(b)}</td></tr>`;

    const ruleRows = perRule.map((r) => row2(r.name, r.count)).join("\n");
    const pkgRows = perPackage
        .slice(0, 60)
        .map((r) => row2(r.name, r.count))
        .join("\n");
    const fileRows = perFile
        .slice(0, Math.max(opts.top, 100))
        .map((r) => row2(r.name, r.count))
        .join("\n");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent lint report</title>
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
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent lint report</h1>
<div class="sub">engine: ESLint + typescript-eslint &middot; generated ${htmlEscape(new Date().toISOString())} &middot;
  ${opts.typeAware ? "syntactic + type-aware" : "syntactic"} &middot;
  tests ${opts.includeTests ? "included" : "excluded"}</div>

<div class="cards">
  <div class="card"><div class="big">${num(out.violations.length)}</div>violations</div>
  <div class="card"><div class="big">${num(perFile.length)}</div>files with violations</div>
  <div class="card"><div class="big">${num(out.filesAnalyzed)}</div>files analyzed</div>
  <div class="card"><div class="big">${num(perRule.length)}</div>rules triggered</div>
</div>

<h2>Violations by rule</h2>
<table class="sortable"><thead><tr><th>Rule</th><th class="n">Count</th></tr></thead>
<tbody>${ruleRows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>

<h2>Violations by package</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Count</th></tr></thead>
<tbody>${pkgRows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>

<h2>Worst files</h2>
<table class="sortable"><thead><tr><th>File</th><th class="n">Count</th></tr></thead>
<tbody>${fileRows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>

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
    if (opts.typeAware) {
        console.log(
            "Type-aware rules enabled — this uses the TS project service and is slower.",
        );
    }
    const out = await lint(
        opts.root,
        [SOURCE_GLOB],
        {
            typeAware: opts.typeAware,
            useIgnores: true,
            includeTests: opts.includeTests,
        },
        opts.root,
    );

    const perRule = sortedEntries(countBy(out.violations, (v) => v.rule));
    const perPackage = sortedEntries(
        countBy(out.violations, (v) => packageKeyOf(v.file)),
    );
    const perFile = sortedEntries(countBy(out.violations, (v) => v.file));

    fs.mkdirSync(opts.outDir, { recursive: true });
    const csv = writeCsv(opts.outDir, out.violations);
    const json = writeJson(
        opts.outDir,
        opts,
        out,
        perRule,
        perPackage,
        perFile,
    );
    const html = writeHtml(
        opts.outDir,
        opts,
        out,
        perRule,
        perPackage,
        perFile,
    );

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log("");
    console.log("Lint report (engine: ESLint + typescript-eslint)");
    console.log(
        `Analyzed ${num(out.filesAnalyzed)} files  |  elapsed ${elapsed}s  |  ` +
            `${opts.typeAware ? "syntactic + type-aware" : "syntactic"}`,
    );
    console.log("");
    console.log(
        `Violations: ${num(out.violations.length)} in ${num(perFile.length)} files` +
            (out.parseErrorFiles
                ? `  |  parse errors in ${num(out.parseErrorFiles)} files`
                : ""),
    );
    console.log("");
    console.log("By rule:");
    for (const r of perRule) {
        console.log(`  ${String(r.count).padStart(6)}  ${r.name}`);
    }
    console.log("");
    console.log(`Top ${opts.top} packages:`);
    for (const p of perPackage.slice(0, opts.top)) {
        console.log(`  ${String(p.count).padStart(6)}  ${p.name}`);
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

const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/;
const IGNORE_PATH_RE =
    /(^|\/)(node_modules|dist|build|out|coverage|bin|obj|\.turbo|\.next|bundle|webview-dist)\//;
const GENERATED_FILE_RE = /(\.d\.ts|\.min\.js|\.bundle\.js)$/;
const TEST_PATH_RE =
    /(^|\/)(test|tests|__tests__)\/|\.(spec|test)\.[cm]?[jt]sx?$/;

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

interface ChangedSources {
    repoRoot: string;
    mergeBase: string;
    entries: DiffEntry[];
}

// Resolve the merge base against --base and collect the changed source files
// (respecting ignores/tests). Returns null if the base ref cannot be resolved.
function collectChangedSources(opts: Options): ChangedSources | null {
    let repoRoot: string;
    let mergeBase: string;
    try {
        repoRoot = git(["rev-parse", "--show-toplevel"], opts.root).trim();
        mergeBase = git(["merge-base", opts.base, "HEAD"], opts.root).trim();
    } catch {
        console.error(
            `Could not resolve base ref "${opts.base}" via git. ` +
                "Pass --base <ref> (e.g. origin/main) and ensure it is fetched.",
        );
        return null;
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

    return { repoRoot, mergeBase, entries };
}

// A rule that got worse in a specific changed file: the HEAD content has more
// occurrences than the base did. These are the locations a PR introduced.
interface RegressionGroup {
    file: string;
    rule: string;
    delta: number;
    locations: Violation[];
}

// Compute per-file, per-rule regressions: HEAD occurrences minus the base
// occurrences (mapped through renames). Only positive deltas are regressions.
function locateRegressions(
    entries: DiffEntry[],
    head: LintOutput,
    base: LintOutput,
): RegressionGroup[] {
    const baseToHead = new Map<string, string>();
    for (const e of entries) {
        if (e.base) {
            baseToHead.set(
                e.base.replace(/\\/g, "/"),
                e.head.replace(/\\/g, "/"),
            );
        }
    }

    const SEP = "\u0000";
    const headByFileRule = new Map<string, Violation[]>();
    for (const v of head.violations) {
        const key = `${v.file}${SEP}${v.rule}`;
        const list = headByFileRule.get(key);
        if (list) {
            list.push(v);
        } else {
            headByFileRule.set(key, [v]);
        }
    }

    const baseCountByFileRule = new Map<string, number>();
    for (const v of base.violations) {
        const headFile = baseToHead.get(v.file) ?? v.file;
        const key = `${headFile}${SEP}${v.rule}`;
        baseCountByFileRule.set(key, (baseCountByFileRule.get(key) ?? 0) + 1);
    }

    const regressions: RegressionGroup[] = [];
    for (const [key, locations] of headByFileRule) {
        const delta = locations.length - (baseCountByFileRule.get(key) ?? 0);
        if (delta > 0) {
            const sep = key.indexOf(SEP);
            regressions.push({
                file: key.slice(0, sep),
                rule: key.slice(sep + 1),
                delta,
                locations: [...locations].sort(
                    (a, b) => a.line - b.line || a.column - b.column,
                ),
            });
        }
    }
    regressions.sort(
        (a, b) =>
            b.delta - a.delta ||
            a.file.localeCompare(b.file) ||
            a.rule.localeCompare(b.rule),
    );
    return regressions;
}

// Print, per changed file, the rules that regressed and the HEAD locations to
// look at. This answers "where is the regression?" without a committed baseline.
// Everything is printed: the set is bounded by the files this PR changed, so a
// developer can fix them all in one pass rather than re-running to find more.
function printRegressionLocations(regressions: RegressionGroup[]): void {
    if (regressions.length === 0) {
        return;
    }
    const byFile = new Map<string, RegressionGroup[]>();
    for (const g of regressions) {
        const arr = byFile.get(g.file);
        if (arr) {
            arr.push(g);
        } else {
            byFile.set(g.file, [g]);
        }
    }

    console.error("\nWhere the new violations are (changed files):");
    for (const [file, groups] of byFile) {
        console.error(`  ${file}`);
        for (const g of groups) {
            console.error(`    ${g.rule}  (+${g.delta})`);
            for (const v of g.locations) {
                console.error(`      ${v.line}:${v.column}  ${v.message}`);
            }
        }
    }
}

// Baseline exceptions: a JSON file of { file, line } entries (or
// { exceptions: [...] }) whose file:line violations the ratchet ignores. Lets a
// known pre-existing violation — e.g. one surfaced by a file move that git
// rename detection misses — be grandfathered without weakening the gate.
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
    console.warn(
        "  Note: --exceptions-file is deprecated; prefer inline " +
            "// code-lint-allow <rule>: <reason> markers.",
    );
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

// ---------------------------------------------------------------------------
// Inline suppression markers
// ---------------------------------------------------------------------------

// A `// code-lint-allow <rule>[,<rule>]: <reason>` comment grandfathers the
// listed rule(s) on one line out of the --ratchet gate. Trailing on a code line
// it applies to that line; as a standalone comment it applies to the next line
// (like eslint-disable-next-line). The rule qualifier is required so a marker
// can't mask an unrelated future violation on the same line, and the reason must
// be non-empty and non-placeholder. Report mode ignores markers entirely.
const LINT_ALLOW_TOKEN = "code-lint-allow";
const PLACEHOLDER_REASON_RE = /^(temp|tbd|todo|fixme|xxx|n\/?a|\?+|-+|\.+)$/i;

function isValidMarkerReason(reason: string): boolean {
    const r = reason.trim();
    return r.length >= 3 && !PLACEHOLDER_REASON_RE.test(r);
}

interface ParsedLintAllow {
    rules: Set<string>;
    valid: boolean;
}

function parseLintAllow(lineText: string): ParsedLintAllow | undefined {
    const i = lineText.indexOf(LINT_ALLOW_TOKEN);
    if (i < 0) {
        return undefined;
    }
    const after = lineText
        .slice(i + LINT_ALLOW_TOKEN.length)
        .replace(/\*\/\s*$/, "");
    const m = /^\s*([^:]*?)\s*:\s*(.*)$/.exec(after);
    if (!m) {
        return { rules: new Set(), valid: false };
    }
    const rules = new Set(
        m[1]
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
    );
    return { rules, valid: rules.size > 0 && isValidMarkerReason(m[2]) };
}

interface FileLintMarkers {
    byLine: Map<number, Set<string>>; // 1-based target line -> allowed rules
    invalidLines: number[];
}

function collectLintMarkers(lines: string[]): FileLintMarkers {
    const byLine = new Map<number, Set<string>>();
    const invalidLines: number[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
        const parsed = parseLintAllow(lines[idx]);
        if (!parsed) {
            continue;
        }
        if (!parsed.valid) {
            invalidLines.push(idx + 1);
            continue;
        }
        const trimmed = lines[idx].trim();
        const standalone =
            trimmed.startsWith("//") ||
            trimmed.startsWith("/*") ||
            trimmed.startsWith("*");
        const target = standalone ? idx + 2 : idx + 1;
        const set = byLine.get(target) ?? new Set<string>();
        for (const r of parsed.rules) {
            set.add(r);
        }
        byLine.set(target, set);
    }
    return { byLine, invalidLines };
}

// Drop violations whose rule is allowed by a marker on their line. `linesOf`
// returns a file's content lines (keyed by its repo-relative path) for the side
// being filtered, or undefined when unavailable.
function filterByLintMarkers(
    violations: Violation[],
    linesOf: (file: string) => string[] | undefined,
): { kept: Violation[]; suppressed: number; invalid: string[] } {
    const cache = new Map<string, FileLintMarkers | null>();
    const markersFor = (file: string): FileLintMarkers | null => {
        if (!cache.has(file)) {
            const lines = linesOf(file);
            cache.set(file, lines ? collectLintMarkers(lines) : null);
        }
        return cache.get(file) ?? null;
    };
    const kept: Violation[] = [];
    let suppressed = 0;
    for (const v of violations) {
        const allowed = markersFor(v.file)?.byLine.get(v.line);
        if (allowed && allowed.has(v.rule)) {
            suppressed++;
        } else {
            kept.push(v);
        }
    }
    const invalid: string[] = [];
    for (const [file, m] of cache) {
        if (m) {
            for (const ln of m.invalidLines) {
                invalid.push(`${file}:${ln}`);
            }
        }
    }
    return { kept, suppressed, invalid };
}

async function runRatchet(opts: Options): Promise<number> {
    const changed = collectChangedSources(opts);
    if (!changed) {
        return 2;
    }
    const { repoRoot, mergeBase, entries } = changed;

    if (entries.length === 0) {
        console.log("Ratchet: no changed source files to check. OK.");
        return 0;
    }

    const exceptions = loadExceptionSet(opts.exceptionsFile);

    const lintOpts = {
        typeAware: false,
        useIgnores: false,
        includeTests: opts.includeTests,
    };

    // HEAD side.
    const headPaths = entries
        .map((e) => path.resolve(repoRoot, e.head))
        .filter((p) => fs.existsSync(p));
    const head = headPaths.length
        ? await lint(repoRoot, headPaths, lintOpts, opts.root)
        : { violations: [], parseErrorFiles: 0, filesAnalyzed: 0 };

    // BASE side: materialize each changed file's base content into a temp dir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-base-"));
    let base: LintOutput = {
        violations: [],
        parseErrorFiles: 0,
        filesAnalyzed: 0,
    };
    const baseLinesByRel = new Map<string, string[]>();
    try {
        const basePaths: string[] = [];
        for (const e of entries) {
            if (!e.base || !isReportableSource(e.base, opts.includeTests)) {
                continue;
            }
            let content: string;
            try {
                content = git(["show", `${mergeBase}:${e.base}`], repoRoot);
            } catch {
                continue;
            }
            const dest = path.join(tmp, e.base);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, "utf8");
            basePaths.push(dest);
            baseLinesByRel.set(e.base, content.split(/\r?\n/));
        }
        if (basePaths.length) {
            base = await lint(tmp, basePaths, lintOpts, opts.root);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Baseline exceptions: drop known violations (by file:line) from both sides
    // so they neither count toward the totals nor trip the new-file / zero-
    // tolerance checks. Applied before any rollup below.
    if (exceptions.size > 0) {
        head.violations = head.violations.filter(
            (v) => !exceptions.has(exceptionKey(v.file, v.line)),
        );
        base.violations = base.violations.filter(
            (v) => !exceptions.has(exceptionKey(v.file, v.line)),
        );
    }

    // Inline markers: drop rule-scoped allowed violations from each side,
    // reading each side's own content so a marker added in the PR relaxes HEAD
    // while the still-unmarked base keeps counting.
    const headLineCache = new Map<string, string[] | null>();
    const headFiltered = filterByLintMarkers(head.violations, (file) => {
        const abs = path.resolve(repoRoot, file);
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
    });
    head.violations = headFiltered.kept;
    base.violations = filterByLintMarkers(base.violations, (file) =>
        baseLinesByRel.get(file),
    ).kept;

    // Compare per-rule and totals.
    const headTotal = head.violations.length;
    const baseTotal = base.violations.length;
    const headByRule = countBy(head.violations, (v) => v.rule);
    const baseByRule = countBy(base.violations, (v) => v.rule);

    console.log(
        `Ratchet: ${entries.length} changed source file(s)  |  ` +
            `violations base ${baseTotal} -> head ${headTotal}`,
    );
    if (exceptions.size > 0) {
        console.log(
            `  Baseline exceptions ignored: ${exceptions.size} (file:line).`,
        );
    }
    if (headFiltered.suppressed > 0) {
        console.log(
            `  Inline code-lint-allow markers honored: ${headFiltered.suppressed}.`,
        );
    }
    if (headFiltered.invalid.length > 0) {
        console.log(
            `  WARNING: ${headFiltered.invalid.length} code-lint-allow ` +
                `marker(s) ignored (need "<rule>: <reason>" with a real ` +
                `reason): ${headFiltered.invalid.join(", ")}`,
        );
    }

    const worsened: string[] = [];
    for (const rule of new Set([...headByRule.keys(), ...baseByRule.keys()])) {
        const h = headByRule.get(rule) ?? 0;
        const b = baseByRule.get(rule) ?? 0;
        if (h > b) {
            worsened.push(`  ${rule}: ${b} -> ${h} (+${h - b})`);
        }
    }

    // New-file cap.
    const newFileFailures: string[] = [];
    if (opts.newFileMax >= 0) {
        const headByFile = countBy(head.violations, (v) =>
            path
                .relative(repoRoot, path.resolve(repoRoot, v.file))
                .split(path.sep)
                .join("/"),
        );
        for (const e of entries) {
            if (e.base !== null) {
                continue; // not a new file
            }
            const rel = e.head.replace(/\\/g, "/");
            const count = headByFile.get(rel) ?? 0;
            if (count > opts.newFileMax) {
                newFileFailures.push(`  ${rel}: ${count} > ${opts.newFileMax}`);
            }
        }
    }

    const regressions = locateRegressions(entries, head, base);

    let failed = false;
    if (headTotal > baseTotal) {
        failed = true;
        console.error(
            `\nRatchet FAILED: changed files add ${headTotal - baseTotal} ` +
                "violation(s) versus the base. Rules that worsened:",
        );
        worsened.forEach((w) => console.error(w));
    }
    if (newFileFailures.length) {
        failed = true;
        console.error(
            `\nRatchet FAILED: new file(s) exceed --new-file-max ${opts.newFileMax}:`,
        );
        newFileFailures.forEach((w) => console.error(w));
    }

    // Zero-tolerance rules: must not appear in changed files at all.
    const zeroToleranceFailures = ZERO_TOLERANCE_RULES.map((rule) => ({
        rule,
        h: headByRule.get(rule) ?? 0,
    }))
        .filter((x) => x.h > 0)
        .map((x) => `  ${x.rule}: ${x.h}`);
    if (zeroToleranceFailures.length) {
        failed = true;
        console.error(
            "\nRatchet FAILED: zero-tolerance rules present in changed files " +
                "(auto-fixable — run `npm run code-lint -- --fix --changed`):",
        );
        zeroToleranceFailures.forEach((w) => console.error(w));
    }

    if (failed) {
        printRegressionLocations(regressions);
        console.error(
            "\nNext steps:\n" +
                "  - Fix the locations listed above in the files this PR changes.\n" +
                "  - Mechanical rules (no-var, prefer-const) can be auto-fixed:\n" +
                "      npm run code-lint -- --fix --changed\n" +
                "  - Re-check with:\n" +
                `      npm run code-lint -- --ratchet --base ${opts.base}\n` +
                "  - Why this gate exists: ts/tools/scripts/code/README.md#ci-gates",
        );
        return 1;
    }
    console.log("Ratchet OK: changed files do not add lint violations.");
    return 0;
}

// ---------------------------------------------------------------------------
// Fix mode (apply the mechanical, auto-fixable rules in place)
// ---------------------------------------------------------------------------

function buildFixConfig(
    useIgnores: boolean,
    includeTests: boolean,
): Linter.Config[] {
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
        rules: FIX_RULES,
    });
    return config;
}

async function runFix(opts: Options): Promise<number> {
    const started = Date.now();

    let cwd = opts.root;
    let patterns: string[] = [SOURCE_GLOB];
    let useIgnores = true;
    if (opts.changed) {
        const changed = collectChangedSources(opts);
        if (!changed) {
            return 2;
        }
        cwd = changed.repoRoot;
        patterns = changed.entries
            .map((e) => path.resolve(changed.repoRoot, e.head))
            .filter((p) => fs.existsSync(p));
        useIgnores = false;
        if (patterns.length === 0) {
            console.log("No changed source files to fix.");
            return 0;
        }
    }

    const eslint = new ESLint({
        cwd,
        errorOnUnmatchedPattern: false,
        overrideConfigFile: true,
        overrideConfig: buildFixConfig(useIgnores, opts.includeTests),
        fix: true,
    });
    const results = await eslint.lintFiles(patterns);
    await ESLint.outputFixes(results);

    let fixedFiles = 0;
    let unfixable = 0;
    for (const r of results) {
        if (r.output !== undefined) {
            fixedFiles++;
        }
        unfixable += r.messages.length;
    }

    console.log("");
    console.log(
        `Lint auto-fix (${opts.changed ? "changed files" : "whole tree"}; rules: ${Object.keys(FIX_RULES).join(", ")})`,
    );
    console.log(
        `Rewrote ${num(fixedFiles)} file(s) in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
    );
    if (unfixable > 0) {
        console.log(
            `${num(unfixable)} occurrence(s) could not be auto-fixed; run \`npm run code-lint\` to see them.`,
        );
    }
    console.log(
        "Review the diff, run prettier, and rebuild before committing.",
    );
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

    if (opts.fix) {
        process.exitCode = await runFix(opts);
        return;
    }

    const code = opts.ratchet ? await runRatchet(opts) : await runReport(opts);
    process.exitCode = code;
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
