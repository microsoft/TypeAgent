// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeDroidCall } from "./analyze.js";
import { downloadDroidCall, readDroidCallJsonl } from "./get-dataset.js";
import {
    buildDroidCallMultiActionRows,
    DATASET_NAME,
    type DroidCallSourceRow,
} from "./toTypeAgentSchema.js";

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
    const [trainRows, testRows] = await Promise.all([
        readDroidCallJsonl<DroidCallSourceRow>(
            join(outputDir, "raw", "DroidCall_train.jsonl"),
        ),
        readDroidCallJsonl<DroidCallSourceRow>(
            join(outputDir, "raw", "DroidCall_test.jsonl"),
        ),
    ]);
    const rows = buildDroidCallMultiActionRows(trainRows, testRows);
    const datasetPath = join(outputDir, `${DATASET_NAME}.jsonl`);
    await writeFile(
        datasetPath,
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    process.stderr.write(`built ${rows.length} multi-action eval rows\n`);
    console.log(JSON.stringify(report.splits, null, 2));
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
