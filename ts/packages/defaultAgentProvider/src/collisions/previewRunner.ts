// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-shot runner for `@collision neighborhoods preview` against an
// arbitrary workdir. Useful when you've generated a sibling corpus
// (e.g. via expandedCorpusRunner) and want to regenerate its preview
// HTML without going through the interactive shell. Read-only against
// TypeAgent state — translation/cache/explainer all disabled, no
// actions ever dispatched.
//
// Usage (from ts/, after build):
//   node packages/defaultAgentProvider/dist/collisions/previewRunner.js \
//     [--workdir <path>] [--threshold 0.78]

import { config as loadDotenv } from "dotenv";
loadDotenv();

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
    threshold: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    return {
        workdir:
            get("workdir") ??
            path.join(process.env.TEMP || "f:/tmp", "collision-corpus-smoke"),
        threshold: get("threshold") ?? "0.78",
    };
}

async function main() {
    const args = parseArgs();
    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry =
        await getIndexingServiceRegistry(instanceDir);

    process.stderr.write(`Workdir:   ${args.workdir}\n`);
    process.stderr.write(`Threshold: ${args.threshold}\n\n`);
    process.stderr.write("Spinning up read-only dispatcher…\n");

    const dispatcher = await createDispatcher("preview-runner", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: false },
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

    try {
        const previewCmd =
            `@collision neighborhoods preview ` +
            `--workdir "${args.workdir}" --threshold ${args.threshold}`;
        process.stderr.write(`\nRunning: ${previewCmd}\n\n`);
        await dispatcher.processCommand(previewCmd);
        process.stderr.write("\nneighborhoods preview done.\n");

        // Also regenerate the collision-hotspots viz so both HTMLs in the
        // workdir get the same per-style chip wiring on one run.
        const vizCmd = `@collision corpus visualize --workdir "${args.workdir}"`;
        process.stderr.write(`\nRunning: ${vizCmd}\n\n`);
        await dispatcher.processCommand(vizCmd);
        process.stderr.write("\ncorpus visualize done.\n");

        // And the recovery viz (visualize-recovery).
        const recCmd = `@collision corpus visualize-recovery --workdir "${args.workdir}"`;
        process.stderr.write(`\nRunning: ${recCmd}\n\n`);
        await dispatcher.processCommand(recCmd);
        process.stderr.write("\ncorpus visualize-recovery done.\n");

        process.stderr.write("\nAll done.\n");
    } finally {
        await dispatcher.close();
    }
}

main().catch((err) => {
    process.stderr.write(
        `preview-runner failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
});
