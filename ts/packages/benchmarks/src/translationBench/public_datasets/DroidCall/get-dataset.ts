// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

export const DROIDCALL_HF = {
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

async function downloadFile(
    relativePath: string,
    outputPath: string,
): Promise<void> {
    const url = `${DROIDCALL_HF.baseUrl}/${DROIDCALL_HF.revision}/${relativePath}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || response.body === null) {
        throw new Error(
            `HuggingFace download failed: ${response.status} ${url}`,
        );
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await finished(
        Readable.fromWeb(response.body as never).pipe(
            createWriteStream(outputPath),
        ),
    );
}

export async function downloadDroidCall(outputDir: string): Promise<string[]> {
    const rawDir = join(outputDir, "raw");
    await mkdir(rawDir, { recursive: true });
    for (const relativePath of DROIDCALL_HF.files) {
        const outputPath = join(rawDir, relativePath);
        process.stderr.write(`downloading ${relativePath}\n`);
        await downloadFile(relativePath, outputPath);
    }
    return DROIDCALL_HF.files.map((file) => join(rawDir, file));
}

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
