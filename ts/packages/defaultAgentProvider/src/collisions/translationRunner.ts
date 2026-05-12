// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Standalone runner for `@collision corpus translate`. Spins up a dispatcher
// with translation enabled (but actions, cache, fuzzy, etc. all disabled),
// copies a corpus.json into the workdir if needed, and invokes the command.
//
// SAFETY:
//   - `agents.actions: false`        no agent's `executeAction` runs
//   - `cache.enabled: false`          no cache reads/writes
//   - `explainer.enabled: false`      no explanation runs
//   - `translation.enabled: true`     YES — this is the whole point of this
//     runner; the LLM translator IS invoked. The handler bypasses cache /
//     grammar / fuzzy / action exec but does call the translator. Single
//     chat-completion per phrase.
// Read-only against TypeAgent state; nothing here will click anywhere.
//
// Usage (from ts/, after building):
//   node packages/defaultAgentProvider/dist/collisions/translationRunner.js \
//     [--corpus <path>] [--workdir <dir>] [--max-phrases N] [--concurrency N] \
//     [--user-context-mode none|expected-schema|fixed] \
//     [--user-context-json '{"activeApp":"spotify"}'] \
//     [--output-suffix <suffix>]
// All flags optional; defaults to a small slice of the existing
// f:/tmp/corpus-full.json so a first run is cheap. Pair runs with
// different --output-suffix values to drive translationCompareRunner.

import { config as loadDotenv } from "dotenv";
loadDotenv();

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createDispatcher } from "agent-dispatcher";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "../index.js";
import {
    getInstanceConfigProvider,
    type InstanceConfig,
    type InstanceConfigProvider,
} from "../utils/config.js";
import { silentClientIO } from "./silentClientIO.js";

interface Args {
    corpusPath: string;
    workdir: string;
    maxPhrases: number;
    concurrency: number;
    userContextMode: "none" | "expected-schema" | "fixed";
    userContextJson: string | undefined;
    outputSuffix: string | undefined;
}

// The dispatcher's display callbacks receive either a bare string or a
// `{ type, content, kind? }` envelope. Extract the visible text from
// either shape so warnings/errors reach stderr.
function extractDisplayText(msg: unknown): string {
    if (typeof msg === "string") return msg;
    if (!msg || typeof msg !== "object") return "";
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => (typeof c === "string" ? c : ""))
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const mode = (get("user-context-mode") ?? "none") as Args["userContextMode"];
    if (
        mode !== "none" &&
        mode !== "expected-schema" &&
        mode !== "fixed"
    ) {
        throw new Error(
            `Invalid --user-context-mode '${mode}'. Expected: none | expected-schema | fixed.`,
        );
    }
    return {
        corpusPath: get("corpus") ?? "f:/tmp/corpus-full.json",
        workdir:
            get("workdir") ??
            path.join(
                process.env.TEMP || "f:/tmp",
                "collision-translation-run",
            ),
        maxPhrases: parseInt(get("max-phrases") ?? "20", 10),
        concurrency: parseInt(get("concurrency") ?? "2", 10),
        userContextMode: mode,
        userContextJson: get("user-context-json"),
        outputSuffix: get("output-suffix"),
    };
}

/**
 * Build an instance-config provider that wraps the on-disk config for
 * `instanceDir` and fills in default `serverScriptArgs` for MCP agents
 * that need them (so their schema gets populated even when the user
 * hasn't run `@<agent> server <args>` to configure them).
 *
 * `setInstanceConfig` is intentionally a no-op — we don't want a probe
 * run to mutate the user's persistent instance config on disk.
 */
function buildProbeInstanceConfig(
    instanceDir: string | undefined,
    workdir: string,
): InstanceConfigProvider {
    const base = getInstanceConfigProvider(instanceDir);
    const baseConfig = base.getInstanceConfig();

    // Default allowed directories for `mcpfilesystem`. Pointing at the
    // workdir (which exists) plus the OS temp dir gives the server two
    // safe roots so it can start. Actions are disabled in the probe
    // dispatcher, so nothing inside these paths is read or written.
    const fsDefaults = [workdir, os.tmpdir()].filter(
        (p): p is string => typeof p === "string" && p.length > 0,
    );

    const mergedConfig: InstanceConfig = {
        ...baseConfig,
        mcpServers: {
            mcpfilesystem: { serverScriptArgs: fsDefaults },
            // User overrides win — if they've configured mcpfilesystem
            // (or any other MCP server) in their on-disk config, those
            // values overwrite the defaults above.
            ...(baseConfig.mcpServers ?? {}),
        },
    };

    return {
        getInstanceDir: () => instanceDir,
        getInstanceConfig: () => mergedConfig,
        setInstanceConfig: () => {
            // Probe runs must not persist anything to the user's
            // instance config.
        },
    };
}

async function main() {
    const args = parseArgs();
    fs.mkdirSync(args.workdir, { recursive: true });

    if (!fs.existsSync(args.corpusPath)) {
        throw new Error(
            `Corpus file not found: ${args.corpusPath}. Pass --corpus <path> or generate one with \`@collision corpus generate\`.`,
        );
    }
    const targetCorpusPath = path.join(args.workdir, "corpus.json");
    if (path.resolve(args.corpusPath) !== path.resolve(targetCorpusPath)) {
        process.stderr.write(
            `Copying ${args.corpusPath} -> ${targetCorpusPath}\n`,
        );
        fs.copyFileSync(args.corpusPath, targetCorpusPath);
    }

    const instanceDir = getInstanceDir();

    // MCP agents that take `serverScriptArgs` need actual values to start
    // their server process; without them, `createMcpAppAgentTransport`
    // throws "Missing required server script args in instance config",
    // the schema content stays empty, and any phrase the translator
    // routes to that agent fails with `loadParsedActionSchema ... No
    // data`. For the probe context (read-only, actions disabled), we
    // synthesize a minimal default so the server can start and report
    // its tools — the schema is read but never invoked.
    //
    // `mcpfilesystem` needs at least one allowed directory. We point it
    // at the workdir, which already exists and contains only experiment
    // artifacts. Honors any user-set instance config for mcpfilesystem
    // (returned by the base provider) so this only fills in missing
    // values.
    const probeConfigProvider = buildProbeInstanceConfig(
        instanceDir,
        args.workdir,
    );
    const defaultAppAgentProviders = getDefaultAppAgentProviders(
        probeConfigProvider,
    );
    const defaultConstructionProvider = getDefaultConstructionProvider();
    // Pass the SAME injected config to the indexing-service builder. Otherwise
    // it spins up its own provider chain via `instanceDir`, with no MCP args,
    // and triggers a duplicate boot-time `connectTransport` that fails with
    // "Missing required server script args" — leaving the manifest in error
    // state for the rest of the run.
    const indexingServiceRegistry = await getIndexingServiceRegistry(
        probeConfigProvider,
    );

    process.stderr.write(
        "Spinning up dispatcher (translation enabled, actions/cache/explainer off)…\n",
    );
    const dispatcher = await createDispatcher("translation-runner", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: true },
        explainer: { enabled: false },
        cache: { enabled: false },
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO: silentClientIO({
            // Stream status / warning / result messages to stderr so the
            // user sees both the progress ticker and any handler errors
            // (the previous version only read `.message`, which is never
            // populated — so displayWarn was silently swallowed).
            setDisplay(msg) {
                const text = extractDisplayText(msg);
                if (text) process.stderr.write(text + "\n");
            },
            appendDisplay(msg) {
                const text = extractDisplayText(msg);
                if (text) process.stderr.write(text + "\n");
            },
        }),
    });
    process.stderr.write("Dispatcher ready.\n\n");

    try {
        const parts = [
            `@collision corpus translate`,
            `--workdir "${args.workdir}"`,
            `--max-phrases ${args.maxPhrases}`,
            `--concurrency ${args.concurrency}`,
            `--user-context-mode ${args.userContextMode}`,
        ];
        if (args.userContextMode === "fixed") {
            if (!args.userContextJson) {
                throw new Error(
                    `--user-context-mode=fixed requires --user-context-json '{"activeApp":"...","activeAppDescription":"..."}'.`,
                );
            }
            // Wrap in single quotes so the inner double-quotes of the JSON
            // pass through the dispatcher's tokenizer intact. The tokenizer
            // preserves escape sequences as literal text, so `\"` would
            // survive into JSON.parse and break it — single quotes avoid
            // the escape entirely.
            if (args.userContextJson.includes("'")) {
                throw new Error(
                    `--user-context-json must not contain a single quote (the runner wraps the value in '…' when forwarding to the dispatcher).`,
                );
            }
            parts.push(`--user-context-json '${args.userContextJson}'`);
        }
        if (args.outputSuffix) {
            parts.push(`--output-suffix ${args.outputSuffix}`);
        }
        const cmd = parts.join(" ");
        process.stderr.write(`Running: ${cmd}\n\n`);
        const t0 = Date.now();
        await dispatcher.processCommand(cmd);
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`\nDone in ${elapsedSec}s.\n`);

        const outName = args.outputSuffix
            ? `translation-results-${args.outputSuffix}.json`
            : "translation-results.json";
        const out = path.join(args.workdir, outName);
        if (fs.existsSync(out)) {
            const data = JSON.parse(fs.readFileSync(out, "utf8"));
            const c = data.summary?.counts ?? {};
            process.stderr.write(
                `Output: ${out}\n` +
                    `  CLEAN    ${c.CLEAN ?? 0}\n` +
                    `  MISROUTE ${c.MISROUTE ?? 0}\n` +
                    `  CLARIFY  ${c.CLARIFY ?? 0}\n` +
                    `  INVALID  ${c.INVALID ?? 0}\n` +
                    `  ERROR    ${c.ERROR ?? 0}\n`,
            );
        }
    } finally {
        await dispatcher.close();
    }
}

main().catch((err) => {
    process.stderr.write(
        `translation-runner failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
});
