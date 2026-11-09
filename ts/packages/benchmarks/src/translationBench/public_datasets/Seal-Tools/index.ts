// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entry point: download the Seal-Tools validation split and emit the parsed
// TypeAgent dataset `seal-tools-validation.jsonl`.
//
// Run (from ts/packages/benchmarks):
//   pnpm run build
//   node dist/translationBench/public_datasets/Seal-Tools/index.js [outputDir]

import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonlLines } from "../../../core/fileJson.js";
import { downloadSealTools, type SealToolsSourceRow } from "./getDataset.js";
import {
    buildSealToolsValidationRows,
    DATASET_NAME,
} from "./toTypeAgentSchema.js";

// Default output dir: this source directory. The processed `.jsonl` and raw
// `.hf.jsonl` cache are gitignored. Override with argv[2].
const DEFAULT_OUTPUT_DIR = join(
    process.cwd(),
    "src/translationBench/public_datasets/Seal-Tools",
);

// Reuse the raw download when present; otherwise fetch the pinned split.
async function loadSourceRows(
    outputDir: string,
): Promise<SealToolsSourceRow[]> {
    const path = join(outputDir, `${DATASET_NAME}.hf.jsonl`);
    if (!existsSync(path)) {
        await downloadSealTools(path);
        process.stderr.write("\n");
    }
    return readJsonlLines<SealToolsSourceRow>(
        await readFile(path, "utf8"),
        path,
    );
}

export async function generateSealToolsValidation(
    outputDir: string,
): Promise<{ outputPath: string; rowCount: number }> {
    const { rows, skipped } = buildSealToolsValidationRows(
        await loadSourceRows(outputDir),
    );
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
    process.stderr.write(
        `wrote ${DATASET_NAME}: ${rowCount} eval rows\n${outputPath}\n`,
    );
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
