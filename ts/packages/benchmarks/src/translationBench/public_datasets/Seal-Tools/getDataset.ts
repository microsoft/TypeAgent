// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
    downloadHuggingFaceRows,
    type HuggingFaceRowsSource,
} from "../huggingFaceRows.js";

export const sealToolsSource: HuggingFaceRowsSource = {
    dataset: "casey-martin/Seal-Tools",
    revision: "d0fe2245740d01a22b8fdd22ec1f49e48fcb1fbf",
    config: "default",
    split: "validation",
};

const sealToolsRowSchema = z.object({
    id: z.string(),
    conversations: z.array(
        z.object({
            from: z.string(),
            value: z.string(),
        }),
    ),
    domain: z.string(),
});

export async function downloadSealTools(outputPath: string): Promise<number> {
    return downloadHuggingFaceRows({
        source: sealToolsSource,
        outputPath,
        parseRow: (value) => sealToolsRowSchema.parse(value),
        onProgress: (downloaded, total) => {
            process.stderr.write(`Downloaded ${downloaded}/${total}\r`);
        },
    });
}

async function main(): Promise<void> {
    const outputPath = process.argv[2];
    if (!outputPath || process.argv.length !== 3) {
        throw new Error("Usage: getDataset <output.jsonl>");
    }
    const rows = await downloadSealTools(outputPath);
    process.stderr.write(`Downloaded ${rows} rows to ${outputPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
