// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Dead-code report for the TypeAgent ts/ tree.
 *
 * The engine is knip — the standard unused-files / exports / dependencies
 * detector for JS/TS monorepos. This wrapper runs knip's JSON reporter (via
 * `pnpm exec`, because the npx shim cannot resolve local bins in this
 * environment), then rolls the results up per category and per package and
 * writes CSV/JSON/HTML + a console summary.
 *
 * Important: knip's accuracy depends entirely on its configuration. Out of the
 * box it cannot know which files are entry points (agent action handlers loaded
 * via manifest, CLI/webpack entries, benchmark harnesses), so its raw numbers
 * heavily overcount "unused" files/exports. Tune tools/scripts/code/knip.jsonc
 * (declare entry points, ignore generated output) and the numbers become real.
 * For that reason this tool is report-only — there is no ratchet gate until the
 * configuration produces a trustworthy baseline.
 *
 * Outputs (written to --out-dir, default tools/scripts/code/deadcode-report):
 *   - deadcode.csv : every finding (file, category, item)
 *   - report.json  : structured metrics (per-category, per-package)
 *   - report.html  : a self-contained, sortable report
 *
 * Usage:
 *   npx tsx tools/scripts/code/deadCodeReport.ts [options]
 *   npm run code-deadcode -- [options]
 *
 * Options:
 *   --top <n>        Number of rows to print / embed (default 25).
 *   --root <path>    Directory knip runs in (default: the ts/ root).
 *   --config <path>  knip config (default tools/scripts/code/knip.jsonc).
 *   --out-dir <path> Output directory (default tools/scripts/code/deadcode-report).
 *   --help           Show this help.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// Categories that represent dead code within our source.
const DEAD_CODE_CATS = [
    "files",
    "exports",
    "types",
    "enumMembers",
    "namespaceMembers",
    "duplicates",
];

// Categories that represent dependency / manifest hygiene.
const DEPENDENCY_CATS = [
    "dependencies",
    "devDependencies",
    "optionalPeerDependencies",
    "unlisted",
    "binaries",
    "unresolved",
];

const ALL_CATS = [...DEAD_CODE_CATS, ...DEPENDENCY_CATS];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Options {
    root: string;
    outDir: string;
    config: string;
    top: number;
    help: boolean;
}

function parseArgs(argv: string[]): Options {
    const root = path.resolve(__dirname, "..", "..", "..");
    const opts: Options = {
        root,
        outDir: path.join(__dirname, "deadcode-report"),
        config: path.join(__dirname, "knip.jsonc"),
        top: 25,
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
            case "--root":
                if (next === undefined) {
                    throw new Error("--root requires a path");
                }
                opts.root = path.resolve(next);
                i++;
                break;
            case "--config":
                if (next === undefined) {
                    throw new Error("--config requires a path");
                }
                opts.config = path.resolve(next);
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

const HELP = `Dead-code report for the TypeAgent ts/ tree (engine: knip).

Usage:
  npx tsx tools/scripts/code/deadCodeReport.ts [options]
  npm run code-deadcode -- [options]

Options:
  --top <n>        Number of rows to print / embed (default 25).
  --root <path>    Directory knip runs in (default: the ts/ root).
  --config <path>  knip config (default: tools/scripts/code/knip.jsonc).
  --out-dir <path> Output directory (default: tools/scripts/code/deadcode-report).
  --help           Show this help.`;

// ---------------------------------------------------------------------------
// knip invocation + parsing
// ---------------------------------------------------------------------------

interface KnipIssue {
    file: string;
    [category: string]: unknown;
}

function runKnip(opts: Options): KnipIssue[] {
    const configArg =
        opts.config && fs.existsSync(opts.config)
            ? ` --config "${opts.config}"`
            : "";
    const cmd = `pnpm exec knip --reporter json --no-progress${configArg}`;
    let stdout: string;
    try {
        stdout = execSync(cmd, {
            cwd: opts.root,
            encoding: "utf8",
            maxBuffer: 512 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        // knip exits non-zero when it finds issues; the JSON is still on stdout.
        const err = e as { stdout?: Buffer | string; message?: string };
        stdout = err.stdout ? err.stdout.toString() : "";
        if (!stdout) {
            throw new Error(`knip failed: ${err.message ?? e}`);
        }
    }
    const data = JSON.parse(stdout) as { issues?: KnipIssue[] };
    return data.issues ?? [];
}

/** Extract the human-readable item names for a category value. */
function itemsOf(cat: string, value: unknown, file: string): string[] {
    if (cat === "files") {
        const flagged = Array.isArray(value)
            ? value.length > 0
            : value === true;
        return flagged ? [file] : [];
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        // enumMembers: { EnumName: [member, ...] }
        const out: string[] = [];
        for (const [k, arr] of Object.entries(
            value as Record<string, unknown>,
        )) {
            const members = Array.isArray(arr) ? arr : [];
            for (const m of members) {
                out.push(
                    `${k}.${typeof m === "string" ? m : ((m as { name?: string })?.name ?? String(m))}`,
                );
            }
        }
        return out;
    }
    if (Array.isArray(value)) {
        return value.map((x) => {
            if (typeof x === "string") {
                return x;
            }
            if (Array.isArray(x)) {
                return x
                    .map((y) => (y as { name?: string })?.name ?? String(y))
                    .join(" + ");
            }
            return (x as { name?: string })?.name ?? String(x);
        });
    }
    return [];
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

interface Finding {
    file: string;
    pkg: string;
    category: string;
    item: string;
    deadCode: boolean;
}

interface AnalysisResult {
    findings: Finding[];
    perCategory: { name: string; count: number; deadCode: boolean }[];
    perPackage: { pkg: string; deadCode: number; total: number }[];
    deadCodeTotal: number;
    dependencyTotal: number;
    elapsedMs: number;
}

function analyze(issues: KnipIssue[], startedAt: number): AnalysisResult {
    const findings: Finding[] = [];
    for (const issue of issues) {
        const file = (issue.file ?? "").replace(/\\/g, "/");
        const pkg = packageKeyOf(file);
        for (const cat of ALL_CATS) {
            const items = itemsOf(cat, issue[cat], file);
            const deadCode = DEAD_CODE_CATS.includes(cat);
            for (const item of items) {
                findings.push({ file, pkg, category: cat, item, deadCode });
            }
        }
    }

    const catMap = new Map<string, number>();
    for (const f of findings) {
        catMap.set(f.category, (catMap.get(f.category) ?? 0) + 1);
    }
    const perCategory = ALL_CATS.map((name) => ({
        name,
        count: catMap.get(name) ?? 0,
        deadCode: DEAD_CODE_CATS.includes(name),
    })).sort((a, b) => b.count - a.count);

    const pkgMap = new Map<string, { deadCode: number; total: number }>();
    for (const f of findings) {
        const r = pkgMap.get(f.pkg) ?? { deadCode: 0, total: 0 };
        r.total++;
        if (f.deadCode) {
            r.deadCode++;
        }
        pkgMap.set(f.pkg, r);
    }
    const perPackage = [...pkgMap.entries()]
        .map(([pkg, v]) => ({ pkg, ...v }))
        .sort((a, b) => b.deadCode - a.deadCode || b.total - a.total);

    return {
        findings,
        perCategory,
        perPackage,
        deadCodeTotal: findings.filter((f) => f.deadCode).length,
        dependencyTotal: findings.filter((f) => !f.deadCode).length,
        elapsedMs: Date.now() - startedAt,
    };
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

function writeCsv(outDir: string, findings: Finding[]): string {
    const header = ["Category", "DeadCode", "Package", "File", "Item"].join(
        ",",
    );
    const rows = findings.map((f) =>
        [f.category, f.deadCode, f.pkg, f.file, f.item]
            .map(csvEscape)
            .join(","),
    );
    const file = path.join(outDir, "deadcode.csv");
    fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
    return file;
}

function writeJson(outDir: string, opts: Options, r: AnalysisResult): string {
    const payload = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        config: fs.existsSync(opts.config) ? opts.config : null,
        totals: {
            deadCode: r.deadCodeTotal,
            dependency: r.dependencyTotal,
            findings: r.findings.length,
        },
        perCategory: r.perCategory,
        perPackage: r.perPackage,
        findings: r.findings,
    };
    const file = path.join(outDir, "report.json");
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return file;
}

function writeHtml(outDir: string, opts: Options, r: AnalysisResult): string {
    const catRows = r.perCategory
        .map(
            (c) =>
                `<tr><td>${htmlEscape(c.name)}</td><td>${c.deadCode ? "dead code" : "dependency"}</td>
        <td class="n">${num(c.count)}</td></tr>`,
        )
        .join("\n");

    const pkgRows = r.perPackage
        .slice(0, Math.max(opts.top, 60))
        .map(
            (p) =>
                `<tr><td>${htmlEscape(p.pkg)}</td><td class="n">${num(p.deadCode)}</td><td class="n">${num(p.total)}</td></tr>`,
        )
        .join("\n");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>TypeAgent dead-code report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  h1 { margin: 0 0 .25rem; } h2 { margin-top: 2rem; }
  .sub { color: #888; margin-bottom: 1rem; }
  .warn { background: #ffca2822; border: 1px solid #ffca2866; border-radius: 8px; padding: .5rem .75rem; margin: 1rem 0; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 160px; }
  .card .big { font-size: 1.6rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: Canvas; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  code, td { font-family: ui-monospace, monospace; }
</style></head><body>
<h1>TypeAgent dead-code report</h1>
<div class="sub">engine: knip &middot; generated ${htmlEscape(new Date().toISOString())} &middot;
  config ${fs.existsSync(opts.config) ? htmlEscape(path.basename(opts.config)) : "(none — raw)"}</div>
<div class="warn">Numbers depend on knip's entry-point configuration. Untuned, "unused"
  files/exports are heavily overcounted. Treat these as candidates to review, not deletions.</div>

<div class="cards">
  <div class="card"><div class="big">${num(r.deadCodeTotal)}</div>dead-code findings</div>
  <div class="card"><div class="big">${num(r.dependencyTotal)}</div>dependency findings</div>
</div>

<h2>By category</h2>
<table class="sortable"><thead><tr><th>Category</th><th>Kind</th><th class="n">Count</th></tr></thead>
<tbody>${catRows}</tbody></table>

<h2>Packages by dead-code findings</h2>
<table class="sortable"><thead><tr><th>Package</th><th class="n">Dead code</th><th class="n">Total</th></tr></thead>
<tbody>${pkgRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table>

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

    const started = Date.now();
    console.log("Running knip (this analyzes the whole workspace)...");
    const issues = runKnip(opts);
    const result = analyze(issues, started);

    fs.mkdirSync(opts.outDir, { recursive: true });
    const csv = writeCsv(opts.outDir, result.findings);
    const json = writeJson(opts.outDir, opts, result);
    const html = writeHtml(opts.outDir, opts, result);

    console.log("");
    console.log("Dead-code report (engine: knip)");
    console.log(
        `Config: ${fs.existsSync(opts.config) ? path.relative(opts.root, opts.config).split(path.sep).join("/") : "(none — RAW, heavily overcounted)"}  |  ` +
            `elapsed ${(result.elapsedMs / 1000).toFixed(1)}s`,
    );
    console.log("");
    console.log(
        `Dead-code findings: ${num(result.deadCodeTotal)}  |  dependency findings: ${num(result.dependencyTotal)}`,
    );
    console.log("");
    console.log("By category:");
    for (const c of result.perCategory) {
        console.log(
            `  ${String(c.count).padStart(6)}  ${c.name.padEnd(26)} ${c.deadCode ? "(dead code)" : "(dependency)"}`,
        );
    }
    console.log("");
    console.log(`Top ${opts.top} packages by dead-code findings:`);
    for (const p of result.perPackage.slice(0, opts.top)) {
        if (p.deadCode === 0) {
            break;
        }
        console.log(`  ${String(p.deadCode).padStart(5)}  ${p.pkg}`);
    }
    console.log("");
    console.log(
        "NOTE: tune tools/scripts/code/knip.jsonc (entry points) before trusting these numbers.",
    );
    console.log("Reports written to:");
    for (const f of [csv, json, html]) {
        console.log(
            `  ${path.relative(opts.root, f).split(path.sep).join("/")}`,
        );
    }
}

main();
