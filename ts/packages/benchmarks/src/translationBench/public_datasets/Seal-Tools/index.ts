// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entry point: download the Seal-Tools validation split and emit the parsed
// TypeAgent dataset `seal-tools-validation.jsonl`.
//
// Run (from ts/packages/benchmarks):
//   pnpm run build
//   node dist/translationBench/public_datasets/Seal-Tools/index.js

import { writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { downloadSealToolsValidation } from "./get-dataset.js";
import {
    buildSealToolsValidationRows,
    DATASET_NAME,
} from "./toTypeAgentSchema.js";

// Default output dir: the committed dataset folder (this source directory). The
// processed `.jsonl` is LFS-tracked there; the raw `.hf.jsonl` cache is
// gitignored. Override with argv[2].
const DEFAULT_OUTPUT_DIR = join(
    process.cwd(),
    "src/translationBench/public_datasets/Seal-Tools",
);

export async function generateSealToolsValidation(
    outputDir: string,
): Promise<{ outputPath: string; rowCount: number }> {
    const { rows: hfRows } = await downloadSealToolsValidation(outputDir);
    const { rows, skipped } = buildSealToolsValidationRows(hfRows);
    const outputPath = join(outputDir, `${DATASET_NAME}.jsonl`);
    await writeFile(
        outputPath,
        rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    process.stderr.write(
        `built ${rows.length} eval rows (${skipped} skipped)\n`,
    );
    return { outputPath, rowCount: rows.length };
}

async function main(): Promise<void> {
    const outputDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;
    const { outputPath, rowCount } =
        await generateSealToolsValidation(outputDir);
    console.log(`\nwrote ${DATASET_NAME}: ${rowCount} eval rows`);
    console.log(outputPath);
}

// realpath both sides so /tmp vs /private/tmp symlinks don't defeat the guard.
if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
