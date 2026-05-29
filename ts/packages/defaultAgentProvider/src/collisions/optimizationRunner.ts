// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Out-of-process entry point for `@collision optimize` runs. Spins up the
// dispatcher with the default agent providers and invokes the 5-step
// optimize pipeline (neighborhoods → explore → validate → patterns →
// distill).
//
// Translator and cache are intentionally NOT disabled — explore needs to
// invoke the translator against the sandbox provider, and cache state is
// flipped by the pipeline's withReadOnlySession wrapper for the duration
// of the run.
//
// Usage (from ts/, after building):
//
//   node packages/defaultAgentProvider/dist/collisions/optimizationRunner.js \
//       --workdir D:\collisions \
//       [--from neighborhoods|explore|validate|patterns|distill] \
//       [--top 5] [--depth 0] \
//       [--lever jsdoc,manifest] [--severity blocker,leaky] \
//       [--dry-run] [--skip-distill] [--distill-min-attempts 10]
//
// Scheduled runs (cron / Windows Task Scheduler) accumulate
// `optimization-run-<ts>/` directories under `--workdir`, and
// `patterns.jsonl` grows across runs.

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { createDispatcher } from "agent-dispatcher";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "../index.js";
import { silentClientIO } from "./silentClientIO.js";

interface Args {
    workdir: string;
    from?: string;
    top?: number;
    depth?: number;
    lever?: string;
    severity?: string;
    dryRun: boolean;
    skipDistill: boolean;
    distillMinAttempts?: number;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const has = (name: string): boolean => argv.includes(`--${name}`);
    const workdir = get("workdir");
    if (!workdir) {
        throw new Error(
            "Required: --workdir <path>. Optional: --from, --top, --depth, --lever, --severity, --dry-run, --skip-distill, --distill-min-attempts.",
        );
    }
    const topRaw = get("top");
    const depthRaw = get("depth");
    const dmaRaw = get("distill-min-attempts");
    return {
        workdir,
        ...(get("from") && { from: get("from")! }),
        ...(topRaw && { top: Number(topRaw) }),
        ...(depthRaw && { depth: Number(depthRaw) }),
        ...(get("lever") && { lever: get("lever")! }),
        ...(get("severity") && { severity: get("severity")! }),
        dryRun: has("dry-run"),
        skipDistill: has("skip-distill"),
        ...(dmaRaw && { distillMinAttempts: Number(dmaRaw) }),
    };
}

function buildCommand(args: Args): string {
    const parts = ["@collision optimize run"];
    parts.push(`--workdir "${args.workdir}"`);
    if (args.from) parts.push(`--from ${args.from}`);
    if (args.top !== undefined) parts.push(`--top ${args.top}`);
    if (args.depth !== undefined) parts.push(`--depth ${args.depth}`);
    if (args.lever) parts.push(`--lever ${args.lever}`);
    if (args.severity) parts.push(`--severity ${args.severity}`);
    if (args.dryRun) parts.push("--dry-run");
    if (args.skipDistill) parts.push("--skip-distill");
    if (args.distillMinAttempts !== undefined) {
        parts.push(`--distill-min-attempts ${args.distillMinAttempts}`);
    }
    return parts.join(" ");
}

async function main(): Promise<void> {
    const args = parseArgs();
    const command = buildCommand(args);

    process.stderr.write(
        `optimizationRunner: ${command}\nSpinning up dispatcher…\n`,
    );

    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry =
        await getIndexingServiceRegistry(instanceDir);

    // We forward all dispatcher output to stderr so the runner's stdout
    // stays clean for piping the eventual summary line. The pipeline's
    // displayStatus calls funnel through silentClientIO's appendDisplay
    // which we route below.
    const clientIO = silentClientIO({
        setDisplay(msg) {
            const text = extractText(msg.message);
            if (text) process.stderr.write(text + "\n");
        },
        appendDisplay(msg) {
            const text = extractText(msg.message);
            if (text) process.stderr.write(text + "\n");
        },
    });

    const dispatcher = await createDispatcher("optimization-runner", {
        appAgentProviders: defaultAppAgentProviders,
        // Allow translator (explore needs it). Actions still disabled —
        // we never execute agent handlers in a probe run.
        agents: { actions: false, commands: ["dispatcher"] },
        explainer: { enabled: false },
        // Cache state is flipped on per-step by withReadOnlySession inside
        // the pipeline. Leave dispatcher-level cache enabled here so the
        // wrapper is reversible.
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO,
    });
    process.stderr.write("Dispatcher ready. Running pipeline…\n\n");

    try {
        await dispatcher.processCommand(command);
        process.stderr.write("\noptimizationRunner: done.\n");
    } catch (err) {
        process.stderr.write(
            `\noptimizationRunner: pipeline failed: ${
                err instanceof Error ? err.stack : String(err)
            }\n`,
        );
        process.exitCode = 1;
    } finally {
        await dispatcher.close();
    }
}

function extractText(msg: unknown): string {
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.join("\n");
    if (!msg || typeof msg !== "object") return "";
    const m = msg as {
        type?: string;
        content?: unknown;
        alternates?: { type: string; content: unknown }[];
    };
    if (m.type === "text") {
        return Array.isArray(m.content)
            ? m.content.join("\n")
            : String(m.content ?? "");
    }
    if (m.alternates) {
        for (const alt of m.alternates) {
            if (alt.type === "text") {
                return Array.isArray(alt.content)
                    ? alt.content.join("\n")
                    : String(alt.content ?? "");
            }
        }
    }
    return typeof m.content === "string" ? m.content : "";
}

main().catch((err) => {
    process.stderr.write(
        `optimizationRunner: ${
            err instanceof Error ? err.stack : String(err)
        }\n`,
    );
    process.exit(1);
});
