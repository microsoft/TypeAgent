// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * analyze-grammar-collisions
 *
 * Standalone CLI counterpart to the in-shell `@grammar collisions` command.
 * Recursively finds compiled `.ag.json` grammars under a directory, runs
 * the same NFA-product-construction collision detector, and prints a
 * structured JSON report keyed by canonical `"schemaA|schemaB"` so the
 * output is stable across runs and easy to diff in CI / post-process for
 * grammar tuning.
 *
 * Usage:
 *   analyze-grammar-collisions [--dir <path>] [--out <path>] [--quiet]
 *
 *   --dir, -d   Directory to search recursively for `*.ag.json` files.
 *               Defaults to the current working directory.
 *   --out, -o   Write the JSON report to this path.  When omitted, the
 *               report is written to stdout.
 *   --quiet, -q Suppress progress messages on stderr.
 *   --help, -h  Show usage and exit.
 *
 * The report's shape is `CollisionScanResult` (see
 * `grammarCollisionScanner.ts`), with the dispatcher's preload-skip
 * reasons folded in for parity with the in-shell command output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { grammarFromJson, registerBuiltInEntities } from "action-grammar";
import {
    scanGrammarCollisions,
    type SchemaInput,
    type SchemaSkip,
} from "grammar-tools-core";

interface CliOptions {
    dir: string;
    out?: string;
    quiet: boolean;
    help: boolean;
}

function parseArgs(args: string[]): CliOptions {
    const opts: CliOptions = {
        dir: process.cwd(),
        quiet: false,
        help: false,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--dir":
            case "-d":
                opts.dir = args[++i] ?? opts.dir;
                break;
            case "--out":
            case "-o":
                opts.out = args[++i];
                break;
            case "--quiet":
            case "-q":
                opts.quiet = true;
                break;
            case "--help":
            case "-h":
                opts.help = true;
                break;
            default:
                process.stderr.write(`Unknown argument: ${arg}\n`);
                opts.help = true;
                break;
        }
    }
    return opts;
}

function printHelp(): void {
    process.stderr.write(
        [
            "Usage: analyze-grammar-collisions [options]",
            "",
            "Options:",
            "  -d, --dir <path>   Recurse this directory for *.ag.json (default: cwd)",
            "  -o, --out <path>   Write JSON report to this file (default: stdout)",
            "  -q, --quiet        Suppress progress messages on stderr",
            "  -h, --help         Show this help",
            "",
        ].join("\n"),
    );
}

/**
 * Walk `dir` recursively, returning every `*.ag.json` file path.  Uses
 * sync I/O — the file count is small (tens of grammars) and synchronous
 * reads keep the CLI startup simple and the output deterministic.
 */
function findAgJsonFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            // Skip common heavy directories to avoid wasted IO.  Matches the
            // typical TypeAgent monorepo layout; users can point `--dir` at
            // a more specific path when they want to bypass this filter.
            if (
                e.name === "node_modules" ||
                e.name === ".git" ||
                e.name === ".turbo"
            ) {
                continue;
            }
            out.push(...findAgJsonFiles(full));
        } else if (e.isFile() && e.name.endsWith(".ag.json")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Derive a human-friendly schema name from the file path: basename minus
 * the `.ag.json` extension and any trailing `Schema` suffix that the
 * grammar generator conventionally appends.  Mirrors what the dispatcher
 * uses for `schemaName`, so collisions found here line up with what the
 * in-shell command would report.
 */
function schemaNameFor(file: string): string {
    const base = path.basename(file).replace(/\.ag\.json$/, "");
    return base.endsWith("Schema") ? base.slice(0, -"Schema".length) : base;
}

type PreloadSkip = SchemaSkip | {
    schemaName: string;
    reason: "no-grammar" | "wrong-format" | "parse-error";
    error?: string;
};

export async function runAnalyzeCollisions(args: string[]): Promise<number> {
    const opts = parseArgs(args);
    if (opts.help) {
        printHelp();
        return 0;
    }
    registerBuiltInEntities();

    const log = opts.quiet
        ? () => {}
        : (msg: string) => process.stderr.write(`${msg}\n`);

    const files = findAgJsonFiles(opts.dir);
    log(`Found ${files.length} compiled grammar file(s) under ${opts.dir}`);

    // Phase 0: read + parse files.  Track parse failures so they appear
    // in the JSON's `skipped` list — same contract the in-shell command
    // exposes, so downstream tooling can rely on a single set of reasons.
    const inputs: SchemaInput[] = [];
    const preloadSkips: PreloadSkip[] = [];
    const fileBySchema = new Map<string, string>();

    // Dedupe by schema name — multiple agent build outputs (e.g.
    // electron + extension webagent copies) commonly emit the same
    // grammar to several paths.  Keep the first one we see; warn so the
    // user can point `--dir` at a more specific tree if a different copy
    // is wanted.
    const seenByName = new Map<string, string>();
    const dedupedFiles: string[] = [];
    for (const f of files) {
        const schemaName = schemaNameFor(f);
        const prev = seenByName.get(schemaName);
        if (prev !== undefined) {
            log(
                `[warn] duplicate schemaName "${schemaName}" — using ${prev}, ignoring ${f}`,
            );
            continue;
        }
        seenByName.set(schemaName, f);
        dedupedFiles.push(f);
    }

    for (const f of dedupedFiles) {
        const schemaName = schemaNameFor(f);
        fileBySchema.set(schemaName, f);
        try {
            const grammar = grammarFromJson(
                JSON.parse(fs.readFileSync(f, "utf8")),
            );
            inputs.push({ schemaName, grammar });
        } catch (err) {
            preloadSkips.push({
                schemaName,
                reason: "parse-error",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Phase 1+2: shared scanner does compile (with tail-call-strip
    // fallback) and pairwise NFA intersection.  Progress lines go to
    // stderr so `--out` users can pipe stdout cleanly when they choose.
    const t0 = Date.now();
    const result = scanGrammarCollisions(inputs, {
        onProgress: (phase, index, total, label) => {
            log(
                `[${phase}] [${index}/${total}] ${label}`,
            );
        },
    });
    const elapsedMs = Date.now() - t0;

    // Merge preload skips into the structured result so the JSON has a
    // single, complete list.
    const merged = {
        ...result,
        skipped: [...preloadSkips, ...result.skipped],
    };

    const collisionCount = Object.keys(merged.collisions).length;
    const placeholderCount = Object.values(merged.collisions).filter(
        (c) => c.hasPlaceholders,
    ).length;
    const strippedCount = Object.values(merged.schemas).filter(
        (s) => s.compiledWithStripping,
    ).length;

    log(
        `Done in ${elapsedMs} ms — ${collisionCount} pair(s) overlap` +
            (placeholderCount > 0
                ? `, ${placeholderCount} flagged for manual review`
                : "") +
            (strippedCount > 0
                ? ` (${strippedCount} compiled with tailCall markers stripped)`
                : "") +
            (merged.skipped.length > 0
                ? `, ${merged.skipped.length} schema(s) skipped`
                : ""),
    );

    const json = JSON.stringify(merged, null, 2);
    if (opts.out) {
        const absPath = path.resolve(opts.out);
        fs.writeFileSync(absPath, json);
        log(`Wrote ${absPath}`);
    } else {
        process.stdout.write(json + "\n");
    }
    return 0;
}

// Invoked from the unified `grammar-tools collisions ...` CLI entry. See
// `cli.ts`. Kept as a separate file so the collision-scanner workflow has
// its own self-contained module that's easy to reuse from other hosts.
