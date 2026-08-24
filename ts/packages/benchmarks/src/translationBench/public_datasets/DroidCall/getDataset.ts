// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const DOWNLOAD_TIMEOUT_MS = 30_000;

export const DROIDCALL_SOURCE = {
    dataset: "mllmTeam/DroidCall",
    revision: "42563ae614280d2891d57f1e7057c4bc50dd27bd",
    baseUrl: "https://huggingface.co/datasets/mllmTeam/DroidCall/resolve",
    files: [
        "DroidCall_code_short.jsonl",
        "DroidCall_train.jsonl",
        "DroidCall_test.jsonl",
        "annotated_api.jsonl",
        "README.md",
        ".gitattributes",
        "figures/data_generation.png",
        "figures/intent.png",
    ],
} as const;

// Stream one pinned source file to a temporary path so failed downloads never
// replace a complete local copy.
async function downloadFile(
    relativePath: string,
    outputPath: string,
): Promise<void> {
    const url = `${DROIDCALL_SOURCE.baseUrl}/${DROIDCALL_SOURCE.revision}/${relativePath}`;
    const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || response.body === null) {
        throw new Error(`DroidCall download failed: ${response.status} ${url}`);
    }

    // Keep partial bytes outside the destination until the stream completes.
    await mkdir(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    try {
        await finished(
            Readable.fromWeb(response.body as never).pipe(
                createWriteStream(temporaryPath, { flags: "wx" }),
            ),
        );
        await rename(temporaryPath, outputPath);
    } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
    }
}

// Download the exact upstream revision used by the benchmark analysis.
export async function downloadDroidCall(outputDir: string): Promise<string[]> {
    const rawDir = join(outputDir, "raw");
    for (const relativePath of DROIDCALL_SOURCE.files) {
        const outputPath = join(rawDir, relativePath);
        await downloadFile(relativePath, outputPath);
    }
    return DROIDCALL_SOURCE.files.map((file) => join(rawDir, file));
}

// Parse JSONL with source coordinates so corrupt upstream rows are actionable.
export async function readDroidCallJsonl<T>(path: string): Promise<T[]> {
    const text = await readFile(path, "utf8");
    return text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
            try {
                return JSON.parse(line) as T;
            } catch (error) {
                throw new Error(
                    `${basename(path)}:${index + 1}: ${String(error)}`,
                );
            }
        });
}
