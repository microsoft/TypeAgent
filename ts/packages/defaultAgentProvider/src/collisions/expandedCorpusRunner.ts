// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// End-to-end runner for an expanded-styles corpus run. Spins up a
// dispatcher with translation enabled and walks the pipeline:
//   1. corpus generate --styles imperative,conversational,casual,polite,curt,slang,typos
//   2. corpus probe (embedding ranker)
//   3. corpus reanalyze (prefix-aware reclassification)
//   4. corpus translate (LLM translator)
//
// Outputs land in a SIBLING workdir (default
// %TEMP%\collision-corpus-expanded\) so the existing 3-style corpus and
// its derived artifacts in %TEMP%\collision-corpus-smoke\ stay intact for
// A/B comparison.
//
// SAFETY: same bypass scope as translationRunner.ts —
//   - actions disabled at the agent layer
//   - cache disabled
//   - explainer disabled
//   - translation IS enabled (otherwise the translate step would no-op)
// Single chat-completion per phrase for both generate and translate.

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
    workdir: string;
    styles: string;
    concurrency: number;
    translateConcurrency: number;
    maxPhrases: number;
    skipGenerate: boolean;
    skipProbe: boolean;
    skipTranslate: boolean;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const flag = (name: string): boolean => argv.includes(`--${name}`);
    return {
        workdir:
            get("workdir") ??
            path.join(
                process.env.TEMP || "f:/tmp",
                "collision-corpus-expanded",
            ),
        styles:
            get("styles") ??
            "imperative,conversational,casual,polite,curt,slang,typos",
        concurrency: parseInt(get("concurrency") ?? "8", 10),
        translateConcurrency: parseInt(get("translate-concurrency") ?? "6", 10),
        maxPhrases: parseInt(get("max-phrases") ?? "99999", 10),
        skipGenerate: flag("skip-generate"),
        skipProbe: flag("skip-probe"),
        skipTranslate: flag("skip-translate"),
    };
}

async function main() {
    const args = parseArgs();
    fs.mkdirSync(args.workdir, { recursive: true });

    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry = await getIndexingServiceRegistry(instanceDir);

    process.stderr.write(
        `Spinning up dispatcher (translation enabled, actions/cache/explainer off)…\n` +
            `Workdir: ${args.workdir}\n` +
            `Styles:  ${args.styles}\n`,
    );

    const dispatcher = await createDispatcher("expanded-corpus-runner", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: true },
        explainer: { enabled: false },
        cache: { enabled: false },
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO: silentClientIO({
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
        // 1. Generate
        if (!args.skipGenerate) {
            const cmd =
                `@collision corpus generate ` +
                `--styles ${args.styles} ` +
                `--concurrency ${args.concurrency} ` +
                `--workdir "${args.workdir}"`;
            process.stderr.write(`[1/4] ${cmd}\n\n`);
            const t0 = Date.now();
            await dispatcher.processCommand(cmd);
            process.stderr.write(
                `[1/4] generate complete in ${((Date.now() - t0) / 1000).toFixed(0)}s\n\n`,
            );
        } else {
            process.stderr.write("[1/4] generate SKIPPED\n\n");
        }

        // 2. Probe
        if (!args.skipProbe) {
            const cmd = `@collision corpus probe --concurrency ${args.concurrency} --workdir "${args.workdir}"`;
            process.stderr.write(`[2/4] ${cmd}\n\n`);
            const t0 = Date.now();
            await dispatcher.processCommand(cmd);
            process.stderr.write(
                `[2/4] probe complete in ${((Date.now() - t0) / 1000).toFixed(0)}s\n\n`,
            );

            // 3. Reanalyze (cheap; bundled with probe block)
            const cmd2 = `@collision corpus reanalyze --workdir "${args.workdir}"`;
            process.stderr.write(`[3/4] ${cmd2}\n\n`);
            const t1 = Date.now();
            await dispatcher.processCommand(cmd2);
            process.stderr.write(
                `[3/4] reanalyze complete in ${((Date.now() - t1) / 1000).toFixed(0)}s\n\n`,
            );
        } else {
            process.stderr.write("[2/4] probe SKIPPED\n");
            process.stderr.write("[3/4] reanalyze SKIPPED\n\n");
        }

        // 4. Translate
        if (!args.skipTranslate) {
            const cmd =
                `@collision corpus translate ` +
                `--max-phrases ${args.maxPhrases} ` +
                `--concurrency ${args.translateConcurrency} ` +
                `--workdir "${args.workdir}"`;
            process.stderr.write(`[4/4] ${cmd}\n\n`);
            const t0 = Date.now();
            await dispatcher.processCommand(cmd);
            process.stderr.write(
                `[4/4] translate complete in ${((Date.now() - t0) / 1000).toFixed(0)}s\n\n`,
            );
        } else {
            process.stderr.write("[4/4] translate SKIPPED\n\n");
        }

        // Inventory
        process.stderr.write("Inventory:\n");
        for (const f of [
            "corpus.json",
            "probe-results.json",
            "probe-results-reclassified.json",
            "translation-results.json",
        ]) {
            const p = path.join(args.workdir, f);
            if (fs.existsSync(p)) {
                const kb = (fs.statSync(p).size / 1024).toFixed(0);
                process.stderr.write(`  ${f}: ${kb} KB\n`);
            } else {
                process.stderr.write(`  ${f}: (missing)\n`);
            }
        }
    } finally {
        await dispatcher.close();
    }
}

main().catch((err) => {
    process.stderr.write(
        `expanded-corpus-runner failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
});
