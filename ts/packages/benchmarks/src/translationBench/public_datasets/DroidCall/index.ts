// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { downloadDroidCall } from "../huggingFaceRows.js";
import { analyzeDroidCall } from "./analyze.js";

const DEFAULT_OUTPUT_DIR = join(
    process.cwd(),
    "src/translationBench/public_datasets/DroidCall",
);

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2));
    const outputArg = process.argv
        .slice(2)
        .find((arg) => !arg.startsWith("--"));
    const outputDir = outputArg ?? DEFAULT_OUTPUT_DIR;
    if (args.has("--download")) await downloadDroidCall(outputDir);
    const report = await analyzeDroidCall(outputDir);
    console.log(JSON.stringify(report.splits, null, 2));
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
