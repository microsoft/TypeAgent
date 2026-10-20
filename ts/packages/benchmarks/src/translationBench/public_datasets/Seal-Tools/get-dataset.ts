// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Downloads the Seal-Tools `validation` split from the HuggingFace
// datasets-server rows API (JSON, no parquet reader needed) and caches it as
// JSONL. Source: https://huggingface.co/datasets/casey-martin/Seal-Tools

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SEAL_TOOLS_HF = {
    dataset: "casey-martin/Seal-Tools",
    revision: "d0fe2245740d01a22b8fdd22ec1f49e48fcb1fbf",
    config: "default",
    split: "validation",
    rowsApi: "https://datasets-server.huggingface.co/rows",
} as const;

export interface SealToolsHfRow {
    id: string;
    conversations: { from: string; value: string }[];
    domain: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry transient failures (429 / 5xx / timeout) with exponential backoff; the
// HF datasets-server often returns 5xx "still processing" on cold splits.
async function fetchWithRetry(url: URL, attempts = 4): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(30_000),
            });
            if (res.status === 429 || res.status >= 500) {
                throw new Error(`HF rows API transient ${res.status}`);
            }
            if (!res.ok) {
                throw new Error(`HF rows API ${res.status} ${res.statusText}`);
            }
            return res;
        } catch (error) {
            lastError = error;
            if (attempt < attempts - 1) await sleep(500 * 2 ** attempt);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchRowsPage(
    offset: number,
    length: number,
): Promise<{ rows: SealToolsHfRow[]; total: number }> {
    const url = new URL(SEAL_TOOLS_HF.rowsApi);
    url.searchParams.set("dataset", SEAL_TOOLS_HF.dataset);
    url.searchParams.set("config", SEAL_TOOLS_HF.config);
    url.searchParams.set("split", SEAL_TOOLS_HF.split);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(length));
    const res = await fetchWithRetry(url);
    const body = (await res.json()) as {
        rows?: { row: SealToolsHfRow }[];
        num_rows_total?: number;
    };
    if (!Array.isArray(body.rows) || typeof body.num_rows_total !== "number") {
        throw new Error(
            `HF rows API returned an unexpected body @offset=${offset}`,
        );
    }
    return {
        rows: body.rows.map((entry) => entry.row),
        total: body.num_rows_total,
    };
}

export async function downloadSealToolsValidation(
    cacheDir: string,
): Promise<{ path: string; rows: SealToolsHfRow[] }> {
    await mkdir(cacheDir, { recursive: true });
    const path = join(cacheDir, "seal-tools-validation.hf.jsonl");
    if (existsSync(path)) {
        // Cache hit: re-parse the raw download instead of re-fetching.
        const cached = await readFile(path, "utf8");
        const rows = cached
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as SealToolsHfRow);
        if (rows.length > 0) return { path, rows };
    }
    const pageSize = 100; // rows API caps a page at 100
    const all: SealToolsHfRow[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
        const { rows, total: pageTotal } = await fetchRowsPage(
            offset,
            pageSize,
        );
        total = pageTotal;
        if (rows.length === 0) break;
        all.push(...rows);
        offset += rows.length;
        process.stderr.write(`  fetched ${all.length}/${total}\r`);
    }
    process.stderr.write("\n");
    await writeFile(path, all.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return { path, rows: all };
}
