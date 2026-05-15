#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseArgs } from "node:util";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import { Git } from "./git.js";
import { findMonorepoRoot } from "./paths.js";
import { resolveSinceRef } from "./sinceResolver.js";
import {
    buildGraph,
    loadWorkspaceFromDisk,
    type WorkspacePackage,
    type WorkspaceGraph,
} from "./workspaceGraph.js";
import { detectChangedPackages } from "./changeDetection.js";
import { gatherPackageInputs } from "./packageInputs.js";
import { assembleAutogenBlock } from "./assembleAutogen.js";
import { renderReferenceSection } from "./renderReference.js";
import { decideCompact } from "./compactMode.js";
import { generateOverview } from "./generateOverview.js";
import { extractMarkdownLinks, type ExtractedLink } from "./linkExtraction.js";
import { validateLinks } from "./linkValidation.js";
import {
    END_MARKER,
    START_MARKER,
    writeAutogenRegion,
} from "./autogenRegion.js";
import { compareReadmes } from "./diffGuard.js";
import {
    loadCanonicalTrademarks,
    validateTrademarks,
} from "./trademarksGuard.js";
import { promises as fsPromises } from "node:fs";

interface CliOptions {
    since: string | undefined;
    all: boolean;
    packages: string[];
    dryRun: boolean;
    json: boolean;
    render: boolean;
    write: boolean;
    verifyLinks: boolean;
    llm: boolean;
    maxPackages: number;
    help: boolean;
}

const DEFAULT_MAX_PACKAGES = 25;

const HELP = `docs-autogen — regenerate package READMEs in the TypeAgent monorepo.

Usage:
  docs-autogen [options]

Modes:
  (none)              Plan: print which packages would be regenerated.
  --render            Render the AUTOGEN block(s) to stdout.
  --render --write    Render the block(s) and write them back into each
                      package's README.md (with diff guard + Trademarks check).
  --verify-links      Spot-check the existing README links for each selected
                      package. Exits non-zero on any broken link.

Selection:
  --since <ref>       Diff against this ref instead of the smart default.
  --all               Select every workspace package (cost guard still applies).
  --package <name>    Limit to the named package(s). Repeatable.
  --max-packages <n>  Cap selection at <n> packages (default ${DEFAULT_MAX_PACKAGES}). Anything past
                      the cap is dropped with a warning so a single run cannot
                      blow up the LLM bill.

Generation:
  --llm               When rendering, call Azure OpenAI (via aiclient) to fill in
                      the Overview section. Requires ts/.env. Without --llm the
                      Overview is a deterministic placeholder.
  --dry-run           Plan only; never write to disk. Implies --render in
                      render mode.
  --json              Emit machine-readable JSON output.
  --help              Show this message.

Smart default for --since (when none of --since/--all/--package are given):
  1. If on a non-default branch, the merge-base with origin/main.
  2. Otherwise the docs-bot/last-run watermark tag.
  3. Otherwise: no-op (warns and exits 0).
`;

function parseCli(argv: readonly string[]): CliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            since: { type: "string" },
            all: { type: "boolean", default: false },
            package: { type: "string", multiple: true },
            render: { type: "boolean", default: false },
            write: { type: "boolean", default: false },
            "verify-links": { type: "boolean", default: false },
            llm: { type: "boolean", default: false },
            "max-packages": { type: "string" },
            "dry-run": { type: "boolean", default: false },
            json: { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
    });
    const maxRaw = values["max-packages"];
    const maxParsed =
        typeof maxRaw === "string" ? Number.parseInt(maxRaw, 10) : NaN;
    return {
        since: values.since,
        all: values.all === true,
        packages: (values.package as string[] | undefined) ?? [],
        render: values.render === true,
        write: values.write === true,
        verifyLinks: values["verify-links"] === true,
        llm: values.llm === true,
        maxPackages:
            Number.isFinite(maxParsed) && maxParsed > 0
                ? maxParsed
                : DEFAULT_MAX_PACKAGES,
        dryRun: values["dry-run"] === true,
        json: values.json === true,
        help: values.help === true,
    };
}

async function main(): Promise<number> {
    let opts: CliOptions;
    try {
        opts = parseCli(process.argv.slice(2));
    } catch (e) {
        process.stderr.write(`${(e as Error).message}\n${HELP}\n`);
        return 2;
    }
    if (opts.help) {
        process.stdout.write(HELP);
        return 0;
    }

    const monorepoRoot = findMonorepoRoot(process.cwd());
    const git = new Git(monorepoRoot);

    const allPackages = await loadWorkspaceFromDisk(monorepoRoot);
    const eligible = filterEligible(allPackages);
    const graph = buildGraph(allPackages);

    const explicitFilter =
        opts.packages.length > 0
            ? new Set<string>(opts.packages.map(stripScope))
            : null;

    let selected: WorkspacePackage[];
    let sinceLabel: string;
    let sinceSha: string | null = null;

    if (opts.all) {
        selected = explicitFilter
            ? eligible.filter((p) => explicitFilter.has(stripScope(p.name)))
            : eligible;
        sinceLabel = "--all";
    } else if (explicitFilter) {
        selected = eligible.filter((p) =>
            explicitFilter.has(stripScope(p.name)),
        );
        sinceLabel = "--package";
    } else {
        const since = await resolveSinceRef(git, { explicit: opts.since });
        if (since.source === "none") {
            emitNoop(opts, since.reason);
            return 0;
        }
        sinceLabel = `${since.source} (${since.sinceRef})`;
        sinceSha = since.sinceSha;
        const headSha = await git.headSha();
        const changedFiles =
            since.sinceSha === headSha
                ? []
                : await git.diffNameOnly(since.sinceSha, headSha);
        const detection = detectChangedPackages(eligible, changedFiles);
        selected = detection.packages;
    }

    const headSha = await git.headSha();

    // Cost guard: cap the number of packages a single run can touch
    // so an accidental --all + --llm doesn't run up an unbounded LLM
    // bill. Anything past the cap is dropped with a warning; the next
    // run will pick them up via the watermark.
    let truncatedCount = 0;
    if (selected.length > opts.maxPackages) {
        truncatedCount = selected.length - opts.maxPackages;
        selected = selected.slice(0, opts.maxPackages);
        if (!opts.json) {
            process.stderr.write(
                `${chalk.yellow(`docs-autogen: capped at ${opts.maxPackages} packages — ${truncatedCount} more deferred to the next run (raise with --max-packages).`)}\n`,
            );
        }
    }

    if (opts.verifyLinks) {
        if (selected.length === 0) {
            emitNoop(opts, "no packages selected to verify");
            return 0;
        }
        return verifyLinksMode(selected, opts);
    }

    if (opts.render) {
        if (selected.length === 0) {
            emitNoop(opts, "no packages selected to render");
            return 0;
        }
        await renderSelected(selected, graph, monorepoRoot, headSha, opts);
        return 0;
    }

    const report = {
        headSha,
        sinceLabel,
        sinceSha,
        totalWorkspacePackages: allPackages.length,
        eligiblePackages: eligible.length,
        selectedPackages: selected.map((p) => ({
            name: p.name,
            relDir: p.relDir,
            reverseDeps: [...(graph.reverseDeps.get(p.name) ?? [])].sort(),
        })),
        dryRun: opts.dryRun,
    };

    if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        printHumanReport(report);
    }
    return 0;
}

/**
 * Drop packages that should never be regenerated by docs-autogen:
 * anything outside `packages/**`, plus the docs-autogen package itself.
 */
function filterEligible(
    packages: readonly WorkspacePackage[],
): WorkspacePackage[] {
    const out: WorkspacePackage[] = [];
    for (const pkg of packages) {
        if (!pkg.relDir.startsWith("packages/")) continue;
        if (pkg.name === "@typeagent/docs-autogen") continue;
        out.push(pkg);
    }
    return out;
}

function stripScope(name: string): string {
    const slash = name.indexOf("/");
    return slash >= 0 ? name.slice(slash + 1) : name;
}

function emitNoop(opts: CliOptions, reason: string): void {
    if (opts.json) {
        process.stdout.write(
            `${JSON.stringify({ noop: true, reason }, null, 2)}\n`,
        );
    } else {
        process.stderr.write(
            `${chalk.yellow("docs-autogen: nothing to do")} — ${reason}\n`,
        );
    }
}

function printHumanReport(report: {
    headSha: string;
    sinceLabel: string;
    sinceSha: string | null;
    totalWorkspacePackages: number;
    eligiblePackages: number;
    selectedPackages: Array<{
        name: string;
        relDir: string;
        reverseDeps: string[];
    }>;
    dryRun: boolean;
}): void {
    const out = process.stdout;
    out.write(`${chalk.bold("docs-autogen")} (foundation build, no LLM yet)\n`);
    out.write(`  HEAD:                ${report.headSha}\n`);
    out.write(`  Since:               ${report.sinceLabel}`);
    if (report.sinceSha !== null) {
        out.write(` @ ${report.sinceSha}`);
    }
    out.write("\n");
    out.write(
        `  Workspace packages:  ${report.totalWorkspacePackages} (${report.eligiblePackages} eligible)\n`,
    );
    out.write(
        `  Selected:            ${report.selectedPackages.length} package(s)\n`,
    );
    if (report.selectedPackages.length === 0) {
        out.write(`    ${chalk.dim("(none)")}\n`);
        return;
    }
    for (const sel of report.selectedPackages) {
        out.write(`    - ${chalk.cyan(sel.name)}  ${chalk.dim(sel.relDir)}\n`);
        if (sel.reverseDeps.length > 0) {
            out.write(
                `        used by: ${sel.reverseDeps.slice(0, 5).join(", ")}${
                    sel.reverseDeps.length > 5
                        ? ` …and ${sel.reverseDeps.length - 5} more`
                        : ""
                }\n`,
            );
        }
    }
    if (report.dryRun) {
        out.write(`  ${chalk.dim("(--dry-run: no files would be written)")}\n`);
    }
}

/**
 * Render the AUTOGEN block(s) for the selected packages and print
 * them. When --json is on, emits a structured array; otherwise emits
 * each block to stdout with a delimiter, plus link-validation
 * diagnostics to stderr.
 */
async function renderSelected(
    selected: readonly WorkspacePackage[],
    graph: WorkspaceGraph,
    monorepoRoot: string,
    headSha: string,
    opts: CliOptions,
): Promise<void> {
    const isoDate = new Date().toISOString();
    const overviewModel = opts.llm
        ? await loadOverviewModel(monorepoRoot)
        : null;

    const records: Array<{
        package: string;
        relDir: string;
        compact: boolean;
        hash: string;
        body: string;
        overview: {
            mode: "skeleton" | "llm";
            status: string;
            attempts: number;
            isPlaceholder: boolean;
            wordCount: number | null;
            diagnostics: string[];
        };
        links: { total: number; broken: ExtractedLink[] };
        write:
            | {
                  attempted: boolean;
                  verdict:
                      | "wrote"
                      | "unchanged"
                      | "footer-only"
                      | "trademarks-broken"
                      | "broken-links";
                  note: string | undefined;
              }
            | undefined;
    }> = [];

    // Load the canonical Trademarks block once when --write is on so
    // we can guard every README before persisting.
    const canonicalTrademarks = opts.write
        ? await loadCanonicalTrademarks(monorepoRoot)
        : null;

    for (const pkg of selected) {
        const inputs = await gatherPackageInputs(pkg, graph, monorepoRoot);

        let llmOverviewBody: string | undefined;
        let overviewMeta: (typeof records)[number]["overview"] = {
            mode: "skeleton",
            status: "skipped",
            attempts: 0,
            isPlaceholder: true,
            wordCount: null,
            diagnostics: [],
        };

        if (overviewModel) {
            const referencePreview = renderReferenceSection(
                inputs,
                decideCompact(inputs),
            );
            const result = await generateOverview(
                inputs,
                referencePreview,
                overviewModel,
            );
            overviewMeta = {
                mode: "llm",
                status: result.status,
                attempts: result.attempts,
                isPlaceholder: result.isPlaceholder,
                wordCount: result.validation?.wordCount ?? null,
                diagnostics: result.diagnostics,
            };
            if (!result.isPlaceholder) {
                llmOverviewBody = result.body;
            }
        }

        const block = assembleAutogenBlock(inputs, {
            headSha,
            isoDate,
            ...(llmOverviewBody !== undefined ? { llmOverviewBody } : {}),
        });
        const links = extractMarkdownLinks(block.body);
        const readmePath = path.join(pkg.dir, "README.md");
        const validation = await validateLinks(links, readmePath);

        let writeMeta: (typeof records)[number]["write"];
        if (opts.write && !opts.dryRun) {
            writeMeta = await writeOnePackage(
                pkg,
                readmePath,
                block.body,
                validation.broken.length,
                canonicalTrademarks!,
            );
        } else if (opts.write) {
            writeMeta = {
                attempted: false,
                verdict: "unchanged",
                note: "--dry-run: not written",
            };
        }

        records.push({
            package: pkg.name,
            relDir: pkg.relDir,
            compact: block.compact,
            hash: block.hash,
            body: block.body,
            overview: overviewMeta,
            links: {
                total: links.length,
                broken: validation.broken.map((b) => b.link),
            },
            write: writeMeta,
        });
    }

    if (opts.json) {
        process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
        return;
    }

    for (const r of records) {
        process.stdout.write(
            `\n${chalk.bold("─── ")}${chalk.cyan(r.package)} ${chalk.dim(`(${r.relDir})`)}${chalk.bold(" ───")}\n`,
        );
        const overviewLabel =
            r.overview.mode === "llm"
                ? `overview=llm/${r.overview.status} attempts=${r.overview.attempts}${
                      r.overview.wordCount !== null
                          ? ` words=${r.overview.wordCount}`
                          : ""
                  }`
                : `overview=skeleton`;
        const writeLabel = r.write
            ? `  write=${r.write.verdict}${r.write.note ? ` (${r.write.note})` : ""}`
            : "";
        process.stdout.write(
            `${chalk.dim(`compact=${r.compact}  hash=${r.hash.slice(0, 12)}…  links=${r.links.total} broken=${r.links.broken.length}  ${overviewLabel}${writeLabel}`)}\n\n`,
        );
        if (!opts.write) {
            process.stdout.write(`${START_MARKER}\n`);
            process.stdout.write(`${r.body}\n`);
            process.stdout.write(`${END_MARKER}\n`);
        }
        if (r.overview.diagnostics.length > 0) {
            process.stderr.write(
                `\n${chalk.yellow(`${r.package}: overview diagnostics`)}\n`,
            );
            for (const d of r.overview.diagnostics) {
                process.stderr.write(`  ${d}\n`);
            }
        }
        if (r.links.broken.length > 0) {
            process.stderr.write(
                `\n${chalk.red(`${r.package}: ${r.links.broken.length} broken link(s)`)}\n`,
            );
            for (const b of r.links.broken) {
                process.stderr.write(
                    `  L${b.line}: [${b.text}](${b.target})\n`,
                );
            }
        }
    }
}

/**
 * Persist the assembled block to a package's README.md, but only when
 * it's safe to do so: the new content must differ in a meaningful way
 * (not just the staleness footer/hash), the Trademarks block must
 * survive intact, and there must be no broken links.
 */
async function writeOnePackage(
    pkg: WorkspacePackage,
    readmePath: string,
    body: string,
    brokenLinkCount: number,
    canonicalTrademarks: string,
): Promise<{
    attempted: boolean;
    verdict:
        | "wrote"
        | "unchanged"
        | "footer-only"
        | "trademarks-broken"
        | "broken-links";
    note: string | undefined;
}> {
    void pkg;
    if (brokenLinkCount > 0) {
        return {
            attempted: false,
            verdict: "broken-links",
            note: `${brokenLinkCount} broken link(s) — refusing to write`,
        };
    }

    let oldText: string;
    try {
        oldText = await fsPromises.readFile(readmePath, "utf8");
    } catch {
        oldText = "";
    }

    const newText = writeAutogenRegion(oldText, body);

    const trademarksCheck = validateTrademarks(newText, canonicalTrademarks);
    if (!trademarksCheck.ok) {
        return {
            attempted: false,
            verdict: "trademarks-broken",
            note:
                trademarksCheck.reason ??
                "Trademarks block missing after regeneration — refusing to write.",
        };
    }

    const diff = compareReadmes(oldText, newText);
    if (diff.verdict === "unchanged") {
        return { attempted: true, verdict: "unchanged", note: undefined };
    }
    if (diff.verdict === "footer-only") {
        return { attempted: true, verdict: "footer-only", note: undefined };
    }

    await fsPromises.writeFile(readmePath, newText, "utf8");
    return { attempted: true, verdict: "wrote", note: undefined };
}

/**
 * Spot-check the existing README links for each selected package.
 * No regeneration, no LLM — just `extractMarkdownLinks` +
 * `validateLinks`. Exits non-zero when any package has broken links
 * so this can be wired up as a pre-merge or pnpm-script gate.
 */
async function verifyLinksMode(
    selected: readonly WorkspacePackage[],
    opts: CliOptions,
): Promise<number> {
    const records: Array<{
        package: string;
        relDir: string;
        readme: string | null;
        total: number;
        broken: ExtractedLink[];
    }> = [];

    for (const pkg of selected) {
        const readmePath = path.join(pkg.dir, "README.md");
        let content: string;
        try {
            content = await fsPromises.readFile(readmePath, "utf8");
        } catch {
            records.push({
                package: pkg.name,
                relDir: pkg.relDir,
                readme: null,
                total: 0,
                broken: [],
            });
            continue;
        }
        const links = extractMarkdownLinks(content);
        const result = await validateLinks(links, readmePath);
        records.push({
            package: pkg.name,
            relDir: pkg.relDir,
            readme: readmePath,
            total: links.length,
            broken: result.broken.map((b) => b.link),
        });
    }

    if (opts.json) {
        process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    } else {
        for (const r of records) {
            const summary = r.readme
                ? `${chalk.cyan(r.package)} ${chalk.dim(`(${r.relDir})`)} — ${r.total} link(s), ${r.broken.length} broken`
                : `${chalk.cyan(r.package)} ${chalk.dim(`(${r.relDir})`)} — ${chalk.dim("no README")}`;
            process.stdout.write(`${summary}\n`);
            for (const b of r.broken) {
                process.stdout.write(
                    `  ${chalk.red("✗")} L${b.line}: [${b.text}](${b.target})\n`,
                );
            }
        }
    }
    const totalBroken = records.reduce((acc, r) => acc + r.broken.length, 0);
    return totalBroken === 0 ? 0 : 1;
}

/**
 * Lazily load the Azure OpenAI chat model. Imported dynamically so
 * the deterministic skeleton path does not require aiclient or
 * AZURE_OPENAI_* env vars to be present.
 */
async function loadOverviewModel(
    monorepoRoot: string,
): Promise<import("./generateOverview.js").OverviewChatModel> {
    // Load ts/.env into process.env if not already loaded. Uses the
    // Node 22 built-in (no dotenv dependency). Silently no-op if the
    // file is missing — aiclient will then surface the underlying
    // missing-env error which we catch below.
    const envPath = path.join(monorepoRoot, ".env");
    try {
        (process as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
            envPath,
        );
    } catch {
        // missing .env is fine; aiclient will report the env it needs
    }
    try {
        const mod = await import("./llm.js");
        return mod.getOverviewModel();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
            `--llm requires aiclient and Azure OpenAI env vars (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_CHAT_MODEL_DEPLOYMENT_NAME) — typically loaded from ts/.env. Loader error: ${message}`,
        );
    }
}

// Top-level entry; resolve unhandled rejections to a non-zero exit.
const entry = path.resolve(process.argv[1] ?? "");
const here = new URL(import.meta.url).pathname;
const isMain =
    process.argv[1] !== undefined &&
    (entry === here ||
        entry === here.replace(/^\/+/u, "") ||
        path.basename(entry) === "cli.js");

if (isMain) {
    main()
        .then((code) => process.exit(code))
        .catch((err) => {
            process.stderr.write(
                `${chalk.red("docs-autogen failed")}: ${(err as Error).stack ?? err}\n`,
            );
            process.exit(1);
        });
}
