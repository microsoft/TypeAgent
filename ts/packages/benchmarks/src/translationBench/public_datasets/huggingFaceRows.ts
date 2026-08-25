// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface HuggingFaceRowsSource {
    dataset: string;
    revision: string;
    config: string;
    split: string;
}

export interface DownloadRowsOptions<Row> {
    source: HuggingFaceRowsSource;
    outputPath: string;
    parseRow: (value: unknown) => Row;
    fetch?: typeof fetch;
    onProgress?: (downloaded: number, total: number) => void;
    rowsApi?: string;
    pageSize?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
    requestTimeoutMs?: number;
    signal?: AbortSignal;
}

type DatasetInfo = { sha?: unknown };
interface RowsPage {
    rows?: { row?: unknown }[];
    num_rows_total?: number;
}
const defaultHubApi = "https://huggingface.co/api/datasets";
const defaultRowsApi = "https://datasets-server.huggingface.co/rows";
const transientStatuses = new Set([408, 425, 429]);

function isTransientStatus(status: number): boolean {
    return transientStatuses.has(status) || status >= 500;
}

async function fetchJson(
    fetchImpl: typeof fetch,
    url: URL,
    api: "Hub API" | "rows API",
    attempts: number,
    retryDelayMs: number,
    requestTimeoutMs: number,
    signal?: AbortSignal,
    revision?: string,
): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        let response: Response;
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        const requestSignal = signal
            ? AbortSignal.any([signal, timeout])
            : timeout;
        try {
            response = await fetchImpl(url, { signal: requestSignal });
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            lastError = error;
            if (attempt + 1 === attempts) break;
            await delay(retryDelayMs * 2 ** attempt, undefined, { signal });
            continue;
        }
        if (!response.ok && !isTransientStatus(response.status)) {
            throw new Error(
                `Hugging Face ${api} returned ${response.status} ${response.statusText}`,
            );
        }
        if (response.ok) {
            if (
                revision !== undefined &&
                response.headers.get("x-revision") !== revision
            ) {
                throw new Error(
                    `Hugging Face rows API did not serve revision ${revision}`,
                );
            }
            return response.json();
        }
        lastError = new Error(
            `Hugging Face ${api} returned ${response.status}`,
        );
        if (attempt + 1 < attempts) {
            await delay(retryDelayMs * 2 ** attempt, undefined, { signal });
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function resolveRevision(
    fetchImpl: typeof fetch,
    source: HuggingFaceRowsSource,
    attempts: number,
    retryDelayMs: number,
    requestTimeoutMs: number,
    signal?: AbortSignal,
): Promise<string> {
    const url = new URL(
        `${defaultHubApi}/${source.dataset}/revision/${encodeURIComponent(source.revision)}`,
    );
    const value = (await fetchJson(
        fetchImpl,
        url,
        "Hub API",
        attempts,
        retryDelayMs,
        requestTimeoutMs,
        signal,
    )) as DatasetInfo;
    if (
        typeof value !== "object" ||
        value === null ||
        typeof value.sha !== "string" ||
        !/^[0-9a-f]{40}$/.test(value.sha)
    ) {
        throw new Error("Hugging Face Hub API returned an invalid revision");
    }
    return value.sha;
}

function parsePage<Row>(
    value: unknown,
    offset: number,
    parseRow: (value: unknown) => Row,
): { rows: Row[]; total: number } {
    const page = value as RowsPage;
    if (
        typeof page !== "object" ||
        page === null ||
        !Array.isArray(page.rows) ||
        !Number.isSafeInteger(page.num_rows_total) ||
        page.num_rows_total! < 0
    ) {
        throw new Error(`Invalid Hugging Face rows page at offset ${offset}`);
    }
    return {
        rows: page.rows.map((entry, index) => {
            if (
                typeof entry !== "object" ||
                entry === null ||
                !("row" in entry)
            ) {
                throw new Error(
                    `Invalid Hugging Face row at offset ${offset + index}`,
                );
            }
            return parseRow(entry.row);
        }),
        total: page.num_rows_total!,
    };
}

export async function downloadHuggingFaceRows<Row>(
    options: DownloadRowsOptions<Row>,
): Promise<number> {
    const fetchImpl = options.fetch ?? fetch;
    const pageSize = options.pageSize ?? 100;
    const retryAttempts = options.retryAttempts ?? 4;
    const retryDelayMs = options.retryDelayMs ?? 500;
    const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
        throw new Error("pageSize must be a positive integer");
    }
    if (!Number.isSafeInteger(retryAttempts) || retryAttempts <= 0) {
        throw new Error("retryAttempts must be a positive integer");
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
        throw new Error("requestTimeoutMs must be a positive integer");
    }
    options.signal?.throwIfAborted();
    const revision = await resolveRevision(
        fetchImpl,
        options.source,
        retryAttempts,
        retryDelayMs,
        requestTimeoutMs,
        options.signal,
    );

    await mkdir(dirname(options.outputPath), { recursive: true });
    const tempPath = `${options.outputPath}.${process.pid}.${Date.now()}.tmp`;
    const output = await open(tempPath, "wx");
    let offset = 0;
    let expectedTotal: number | undefined;
    try {
        while (expectedTotal === undefined || offset < expectedTotal) {
            const url = new URL(options.rowsApi ?? defaultRowsApi);
            url.searchParams.set("dataset", options.source.dataset);
            url.searchParams.set("config", options.source.config);
            url.searchParams.set("split", options.source.split);
            url.searchParams.set("offset", String(offset));
            url.searchParams.set("length", String(pageSize));
            const page = parsePage<Row>(
                await fetchJson(
                    fetchImpl,
                    url,
                    "rows API",
                    retryAttempts,
                    retryDelayMs,
                    requestTimeoutMs,
                    options.signal,
                    revision,
                ),
                offset,
                options.parseRow,
            );
            if (expectedTotal !== undefined && page.total !== expectedTotal) {
                throw new Error(
                    `Hugging Face row count changed from ${expectedTotal} to ${page.total}`,
                );
            }
            expectedTotal = page.total;
            if (page.rows.length > Math.min(pageSize, expectedTotal - offset)) {
                throw new Error(`Invalid page length at offset ${offset}`);
            }
            if (page.rows.length === 0 && offset < expectedTotal) {
                throw new Error(
                    `Download stalled at ${offset}/${expectedTotal}`,
                );
            }
            await output.writeFile(
                page.rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
            );
            offset += page.rows.length;
            options.onProgress?.(offset, expectedTotal);
        }
        if (offset !== expectedTotal) {
            throw new Error(
                `Downloaded ${offset} rows, expected ${expectedTotal}`,
            );
        }
        await output.sync();
        await output.close();
        await rename(tempPath, options.outputPath);
        return offset;
    } catch (error) {
        await output.close().catch(() => undefined);
        await rm(tempPath, { force: true });
        throw error;
    }
}

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
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await pipeline(
            Readable.fromWeb(response.body as never),
            createWriteStream(temporaryPath, { flags: "wx" }),
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
    const rows: T[] = [];
    for (const [index, line] of text.split("\n").entries()) {
        if (line.trim().length === 0) continue;
        try {
            rows.push(JSON.parse(line) as T);
        } catch (error) {
            throw new Error(`${basename(path)}:${index + 1}: ${String(error)}`);
        }
    }
    return rows;
}
