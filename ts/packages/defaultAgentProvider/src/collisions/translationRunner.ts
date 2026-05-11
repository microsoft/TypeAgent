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
//     [--corpus <path>] [--workdir <dir>] [--max-phrases N] [--concurrency N]
// All flags optional; defaults to a small slice of the existing
// f:/tmp/corpus-full.json so a first run is cheap.

import { config as loadDotenv } from "dotenv";
loadDotenv();

import * as fs from "node:fs";
import * as path from "node:path";

import { createDispatcher } from "agent-dispatcher";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "../index.js";
import { silentClientIO } from "./silentClientIO.js";

interface Args {
    corpusPath: string;
    workdir: string;
    maxPhrases: number;
    concurrency: number;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
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
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry = await getIndexingServiceRegistry(instanceDir);

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
            // Stream status messages straight to stderr so the user can
            // watch the [done/total] progress line tick over.
            setDisplay(msg) {
                const t = (msg as any)?.message;
                const text =
                    typeof t === "string"
                        ? t
                        : Array.isArray(t)
                          ? t.join("\n")
                          : "";
                if (text) process.stderr.write(text + "\n");
            },
            appendDisplay(msg) {
                const t = (msg as any)?.message;
                const text =
                    typeof t === "string"
                        ? t
                        : Array.isArray(t)
                          ? t.join("\n")
                          : "";
                if (text) process.stderr.write(text + "\n");
            },
        }),
    });
    process.stderr.write("Dispatcher ready.\n\n");

    try {
        const cmd = `@collision corpus translate --workdir "${args.workdir}" --max-phrases ${args.maxPhrases} --concurrency ${args.concurrency}`;
        process.stderr.write(`Running: ${cmd}\n\n`);
        const t0 = Date.now();
        await dispatcher.processCommand(cmd);
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`\nDone in ${elapsedSec}s.\n`);

        const out = path.join(args.workdir, "translation-results.json");
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
