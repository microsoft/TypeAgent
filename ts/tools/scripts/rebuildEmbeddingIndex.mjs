// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseArgs } from "node:util";

const help = `Prepare one memory-service index with the configured embedding model.

Usage (from ts, after building):
  node tools\\scripts\\rebuildEmbeddingIndex.mjs --index-dir <old> --output-dir <new> [--apply]

Stop all memory-service processes before copying an index. The output parent
must already exist. Use an output outside the managed memory-service tree;
never use a live generation or an existing directory as the output.

Without --apply, only print the plan (no model calls or filesystem changes).
With --apply, rebuild vectors without knowledge extraction, save, and reopen
the new index. The original, manifests, sources, and View records are unchanged.
After preparing all required document, event, and View indexes, activate the
copies offline, keeping the originals outside the managed tree for rollback.
`;

try {
    const { values } = parseArgs({
        options: {
            "index-dir": { type: "string" },
            "output-dir": { type: "string" },
            apply: { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
    });
    if (values.help) {
        console.log(help);
    } else {
        if (!values["index-dir"] || !values["output-dir"])
            throw new Error("Both --index-dir and --output-dir are required");
        console.log(
            JSON.stringify({
                source: values["index-dir"],
                output: values["output-dir"],
                apply: values.apply,
            }),
        );
        if (!values.apply) {
            console.log("Plan only. Stop all writers before using --apply.");
        } else {
            const { loadConfigSync, getConfigProblems } = await import(
                "../../packages/config/dist/index.js"
            );
            const { initRuntimeConfigFromProcessEnv } = await import(
                "../../packages/aiclient/dist/index.js"
            );
            const { prepareEmbeddingIndexMigration } = await import(
                "../../packages/memory/service/dist/embeddingMigration.js"
            );
            loadConfigSync();
            if (getConfigProblems().length)
                throw new Error(
                    "Resolve configuration errors before migration",
                );
            initRuntimeConfigFromProcessEnv();
            console.log(
                JSON.stringify(
                    await prepareEmbeddingIndexMigration(
                        values["index-dir"],
                        values["output-dir"],
                    ),
                ),
            );
            console.log("Prepared and verified. The original is unchanged.");
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
