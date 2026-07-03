// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Pattern-consistency report for the TypeAgent ts/ tree.
 *
 * Where complexityReport.ts and duplicationReport.ts wrap standard engines
 * (ESLint, jscpd) to produce metrics, this report performs cross-file
 * *structural* analysis that those per-file engines cannot: it surfaces places
 * that stray from established repo patterns and candidates for consolidation.
 * Its findings are heuristic — they are candidates to review, not hard errors.
 *
 * Three checks, each targeting a known TypeAgent convention:
 *
 *   1. Duplicate exports across packages. The same exported function/const/
 *      class name defined in N different packages usually means a utility that
 *      should live in one shared package (e.g. delay, ensureDir, withTimeout).
 *      Complements jscpd, which finds copy-paste but misses re-implementations
 *      that drifted apart. Bare lifecycle names (instantiate, activate, ...)
 *      are ignored.
 *
 *   2. Direct process.env access in packages/. The convention is to read
 *      configuration through @typeagent/config (loadConfigSync) and the
 *      aiclient runtime config, not process.env scattered through the code.
 *      The canonical readers (packages/config, aiclient runtimeConfig) are
 *      excluded.
 *
 *   3. Agent layout conformance. Each agent under packages/agents should ship a
 *      <name>Manifest.json and a handler that exports instantiate(). Agents
 *      missing either are flagged.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/consistency-report):
 *   - duplicate-exports.csv : every cross-package duplicate export
 *   - report.json           : structured results for all three checks
 *   - report.html           : a self-contained, sortable report
 * plus a console summary.
 *
 * Usage:
 *   npx tsx tools/scripts/code/consistencyReport.ts [options]
 *   npm run code-consistency -- [options]
 *
 * Options:
 *   --include-tests     Include test files (excluded by default).
 *   --min-packages <n>  Report an export only if it appears in at least this
 *                       many packages (default 3).
 *   --top <n>           Number of rows to print / embed (default 30).
 *   --root <path>       Directory to scan (default: the ts/ root).
 *   --out-dir <path>    Output directory (default consistency-report).
 *   --help              Show this help.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_SUBDIRS = ["packages", "examples", "extensions", "tools"];

// process.env check is scoped to production packages only.
const ENV_SCAN_PREFIX = "packages/";

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
]);

// Bare export names that are conventions/lifecycle, not shareable utilities.
const EXPORT_DENYLIST = new Set([
    "instantiate",
    "activate",
    "deactivate",
    "run",
    "main",
    "default",
    "handlers",
    "getCommands",
    "register",
    "start",
    "stop",
]);

// Canonical config readers that are allowed to touch process.env directly.
const ENV_ALLOWED = (rel: string): boolean =>
    rel.startsWith("packages/config/") ||
    rel === "packages/aiclient/src/runtimeConfig.ts";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    includeTests: boolean;
    minPackages: number;
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
        outDir: path.join(__dirname, "consistency-report"),
        includeTests: false,
        minPackages: 3,
        top: 30,
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
            case "--min-packages":
                opts.minPackages = parseIntArg(arg, next);
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
    if (opts.minPackages < 2) {
        throw new Error("--min-packages must be at least 2");
    }

    return opts;
}

const HELP = `Pattern-consistency report for the TypeAgent ts/ tree.

Usage:
  npx tsx tools/scripts/code/consistencyReport.ts [options]
  npm run code-consistency -- [options]

Options:
  --include-tests     Include test files (excluded by default).
  --min-packages <n>  Report an export only if it appears in at least this many
                      packages (default 3).
  --top <n>           Number of rows to print / embed (default 30).
  --root <path>       Directory to scan (default: the ts/ root).
  --out-dir <path>    Output directory (default: tools/scripts/code/consistency-report).
  --help              Show this help.`;

// ---------------------------------------------------------------------------
// File walking
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

/** Package key: everything before the first `/src/`, else leading segments. */
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

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const EXPORT_RES = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+(?:const|let|var)\s+(?!enum\b)([A-Za-z_$][\w$]*)/gm,
    /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
];

interface DuplicateExport {
    name: string;
    packageCount: number;
    packages: string[];
    files: string[];
}

interface EnvFile {
    file: string;
    pkg: string;
    refs: number;
}

interface EnvPackage {
    pkg: string;
    refs: number;
    files: number;
}

interface AgentStatus {
    agent: string;
    hasManifest: boolean;
    hasInstantiate: boolean;
}

interface AnalysisResult {
    filesScanned: number;
    duplicateExports: DuplicateExport[];
    envPackages: EnvPackage[];
    envFiles: EnvFile[];
    envTotalRefs: number;
    agents: AgentStatus[];
    agentIssues: AgentStatus[];
    elapsedMs: number;
}

function analyze(opts: Options): AnalysisResult {
    const started = Date.now();

    const files: string[] = [];
    for (const sub of SCAN_SUBDIRS) {
        const abs = path.join(opts.root, sub);
        if (!fs.existsSync(abs)) {
            continue;
        }
        for (const full of walk(abs)) {
            if (!isCodeFile(full)) {
                continue;
            }
            const rel = path
                .relative(opts.root, full)
                .split(path.sep)
                .join("/");
            if (!opts.includeTests && isTestFile(rel)) {
                continue;
            }
            files.push(rel);
        }
    }

    // name -> packageKey -> set(files)
    const exportMap = new Map<string, Map<string, Set<string>>>();
    const envByFile: EnvFile[] = [];

    for (const rel of files) {
        let content: string;
        try {
            content = fs.readFileSync(path.join(opts.root, rel), "utf8");
        } catch {
            continue;
        }
        const pkg = packageKeyOf(rel);

        // Check 1: exported symbol names.
        for (const re of EXPORT_RES) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(content)) !== null) {
                const name = m[1];
                if (EXPORT_DENYLIST.has(name)) {
                    continue;
                }
                let byPkg = exportMap.get(name);
                if (!byPkg) {
                    byPkg = new Map();
                    exportMap.set(name, byPkg);
                }
                let set = byPkg.get(pkg);
                if (!set) {
                    set = new Set();
                    byPkg.set(pkg, set);
                }
                set.add(rel);
            }
        }

        // Check 2: direct process.env access (production packages only).
        if (rel.startsWith(ENV_SCAN_PREFIX) && !ENV_ALLOWED(rel)) {
            const matches = content.match(/process\.env\b/g);
            if (matches && matches.length > 0) {
                envByFile.push({ file: rel, pkg, refs: matches.length });
            }
        }
    }

    // Duplicate exports: names in >= minPackages different packages.
    const duplicateExports: DuplicateExport[] = [];
    for (const [name, byPkg] of exportMap) {
        if (byPkg.size >= opts.minPackages) {
            const packages = [...byPkg.keys()].sort();
            const fileList: string[] = [];
            for (const set of byPkg.values()) {
                fileList.push(...set);
            }
            duplicateExports.push({
                name,
                packageCount: byPkg.size,
                packages,
                files: fileList.sort(),
            });
        }
    }
    duplicateExports.sort(
        (a, b) =>
            b.packageCount - a.packageCount || a.name.localeCompare(b.name),
    );

    // process.env rollups.
    const envPkgMap = new Map<string, EnvPackage>();
    let envTotalRefs = 0;
    for (const e of envByFile) {
        envTotalRefs += e.refs;
        const r = envPkgMap.get(e.pkg) ?? { pkg: e.pkg, refs: 0, files: 0 };
        r.refs += e.refs;
        r.files += 1;
        envPkgMap.set(e.pkg, r);
    }
    const envPackages = [...envPkgMap.values()].sort((a, b) => b.refs - a.refs);
    const envFiles = envByFile.sort((a, b) => b.refs - a.refs);

    // Check 3: agent conformance.
    const agents = analyzeAgents(opts.root);
    const agentIssues = agents.filter(
        (a) => !a.hasManifest || !a.hasInstantiate,
    );

    return {
        filesScanned: files.length,
        duplicateExports,
        envPackages,
        envFiles,
        envTotalRefs,
        agents,
        agentIssues,
        elapsedMs: Date.now() - started,
    };
}

function analyzeAgents(root: string): AgentStatus[] {
    const agentsDir = path.join(root, "packages", "agents");
    if (!fs.existsSync(agentsDir)) {
        return [];
    }
    const result: AgentStatus[] = [];
    for (const e of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (!e.isDirectory() || IGNORE_DIR_NAMES.has(e.name)) {
            continue;
        }
        const dir = path.join(agentsDir, e.name);
        if (!fs.existsSync(path.join(dir, "package.json"))) {
            continue;
        }
        let hasManifest = false;
        let hasInstantiate = false;
        for (const f of walk(dir)) {
            const base = path.basename(f);
            if (/manifest\.json$/i.test(base)) {
                hasManifest = true;
            }
            if (isCodeFile(f) && !hasInstantiate) {
                try {
                    if (/\binstantiate\b/.test(fs.readFileSync(f, "utf8"))) {
                        hasInstantiate = true;
                    }
                } catch {
                    /* ignore */
                }
            }
            if (hasManifest && hasInstantiate) {
                break;
            }
        }
        result.push({
            agent: `packages/agents/${e.name}`,
            hasManifest,
            hasInstantiate,
        });
    }
    return result.sort((a, b) => a.agent.localeCompare(b.agent));
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

// ---------------------------------------------------------------------------
// Report writers
// ---------------------------------------------------------------------------

function writeCsv(outDir: string, dups: DuplicateExport[]): string {
    const header = ["Export", "PackageCount", "Packages"].join(",");
    const rows = dups.map((d) =>
        [d.name, d.packageCount, d.packages.join(" | ")]
            .map(csvEscape)
            .join(","),
    );
    const file = path.join(outDir, "duplicate-exports.csv");
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
        minPackages: opts.minPackages,
        filesScanned: result.filesScanned,
        duplicateExports: result.duplicateExports,
        processEnv: {
            totalRefs: result.envTotalRefs,
            totalFiles: result.envFiles.length,
            perPackage: result.envPackages,
            files: result.envFiles,
        },
        agents: {
            total: result.agents.length,
            conforming: result.agents.length - result.agentIssues.length,
            issues: result.agentIssues,
            all: result.agents,
        },
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
    const dupRows = result.duplicateExports
        .slice(0, Math.max(opts.top, 100))
        .map(
            (d) =>
                `<tr><td>${htmlEscape(d.name)}</td><td class="n">${d.packageCount}</td>
        <td>${d.packages.map(htmlEscape).join("<br/>")}</td></tr>`,
        )
        .join("\n");

    const envRows = result.envPackages
        .slice(0, Math.max(opts.top, 60))
        .map(
            (p) =>
                `<tr><td>${htmlEscape(p.pkg)}</td><td class="n">${num(p.refs)}</td><td class="n">${num(p.files)}</td></tr>`,
        )
        .join("\n");

    const agentRows = result.agents
        .map((a) => {
            const ok = a.hasManifest && a.hasInstantiate;
            return `<tr class="${ok ? "" : "bad"}"><td>${htmlEscape(a.agent)}</td>
        <td>${a.hasManifest ? "yes" : "<b>MISSING</b>"}</td>
        <td>${a.hasInstantiate ? "yes" : "<b>MISSING</b>"}</td></tr>`;
        })
        .join("\n");

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent consistency report</title>
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
  tr.bad { background: #ef535022; }
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent consistency report</h1>
<div class="sub">generated ${htmlEscape(new Date().toISOString())} &middot;
  ${num(result.filesScanned)} files &middot; min-packages ${opts.minPackages} &middot;
  tests ${opts.includeTests ? "included" : "excluded"} &middot; heuristic — review candidates</div>

<div class="cards">
  <div class="card"><div class="big">${num(result.duplicateExports.length)}</div>cross-package duplicate exports</div>
  <div class="card"><div class="big">${num(result.envTotalRefs)}</div>direct process.env refs</div>
  <div class="card"><div class="big">${num(result.envFiles.length)}</div>files using process.env</div>
  <div class="card"><div class="big">${num(result.agentIssues.length)}</div>non-conforming agents</div>
</div>

<h2>Duplicate exports across packages</h2>
<table class="sortable"><thead><tr><th>Export</th><th class="n">Packages</th><th>Where</th></tr></thead>
<tbody>${dupRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table>

<h2>Direct process.env usage (packages/, excl. config)</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Refs</th><th class="n">Files</th></tr></thead>
<tbody>${envRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table>

<h2>Agent layout conformance</h2>
<table class="sortable"><thead><tr><th>Agent</th><th>Manifest</th><th>instantiate()</th></tr></thead>
<tbody>${agentRows}</tbody></table>

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
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(opts: Options, result: AnalysisResult): void {
    console.log("");
    console.log("Consistency report (heuristic — review candidates)");
    console.log(
        `Scanned ${num(result.filesScanned)} files  |  elapsed ${(result.elapsedMs / 1000).toFixed(1)}s`,
    );

    console.log("");
    console.log(
        `1. Duplicate exports across >=${opts.minPackages} packages: ${num(result.duplicateExports.length)}`,
    );
    for (const d of result.duplicateExports.slice(0, opts.top)) {
        console.log(
            `   ${String(d.packageCount).padStart(2)} pkgs  ${d.name.padEnd(26)} ${d.packages.join(", ")}`,
        );
    }

    console.log("");
    console.log(
        `2. Direct process.env in packages/ (excl. config): ${num(result.envTotalRefs)} refs in ${num(result.envFiles.length)} files`,
    );
    for (const p of result.envPackages.slice(0, opts.top)) {
        console.log(
            `   ${String(p.refs).padStart(4)} refs / ${String(p.files).padStart(2)} files  ${p.pkg}`,
        );
    }

    console.log("");
    console.log(
        `3. Agent conformance: ${result.agents.length - result.agentIssues.length}/${result.agents.length} conform`,
    );
    if (result.agentIssues.length === 0) {
        console.log("   All agents ship a Manifest + instantiate().");
    } else {
        for (const a of result.agentIssues) {
            const miss = [
                a.hasManifest ? null : "Manifest",
                a.hasInstantiate ? null : "instantiate()",
            ]
                .filter(Boolean)
                .join(" + ");
            console.log(`   ${a.agent} — missing ${miss}`);
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
        process.exitCode = 2;
        return;
    }

    if (opts.help) {
        console.log(HELP);
        return;
    }

    fs.mkdirSync(opts.outDir, { recursive: true });
    const result = analyze(opts);

    const csv = writeCsv(opts.outDir, result.duplicateExports);
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

main();
