// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
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

interface RowsPage {
    rows?: { row?: unknown }[];
    num_rows_total?: number;
}

const defaultRowsApi = "https://datasets-server.huggingface.co/rows";
const transientStatuses = new Set([408, 425, 429]);

function isTransientStatus(status: number): boolean {
    return transientStatuses.has(status) || status >= 500;
}

function combineSignals(
    signal: AbortSignal | undefined,
    timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (signal === undefined) return { signal: timeout, dispose: () => {} };
    const controller = new AbortController();
    const forwardAbort = (source: AbortSignal) =>
        controller.abort(source.reason);
    const onAbort = () => forwardAbort(signal);
    const onTimeout = () => forwardAbort(timeout);
    signal.addEventListener("abort", onAbort, { once: true });
    timeout.addEventListener("abort", onTimeout, { once: true });
    if (signal.aborted) forwardAbort(signal);
    return {
        signal: controller.signal,
        dispose: () => {
            signal.removeEventListener("abort", onAbort);
            timeout.removeEventListener("abort", onTimeout);
        },
    };
}

async function fetchPage(
    fetchImpl: typeof fetch,
    url: URL,
    attempts: number,
    retryDelayMs: number,
    requestTimeoutMs: number,
    signal?: AbortSignal,
): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        let response: Response;
        const requestSignal = combineSignals(signal, requestTimeoutMs);
        try {
            response = await fetchImpl(url, { signal: requestSignal.signal });
        } catch (error) {
            requestSignal.dispose();
            if (signal?.aborted) throw signal.reason;
            lastError = error;
            if (attempt + 1 === attempts) break;
            await delay(retryDelayMs * 2 ** attempt, undefined, { signal });
            continue;
        }
        if (!response.ok && !isTransientStatus(response.status)) {
            requestSignal.dispose();
            throw new Error(
                `Hugging Face rows API returned ${response.status} ${response.statusText}`,
            );
        }
        if (response.ok) {
            try {
                return await response.json();
            } finally {
                requestSignal.dispose();
            }
        }
        requestSignal.dispose();
        lastError = new Error(
            `Hugging Face rows API returned ${response.status}`,
        );
        if (attempt + 1 < attempts) {
            await delay(retryDelayMs * 2 ** attempt, undefined, { signal });
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

    await mkdir(dirname(options.outputPath), { recursive: true });
    const tempPath = `${options.outputPath}.${process.pid}.${Date.now()}.tmp`;
    const output = await open(tempPath, "wx");
    let offset = 0;
    let expectedTotal: number | undefined;
    try {
        while (expectedTotal === undefined || offset < expectedTotal) {
            const url = new URL(options.rowsApi ?? defaultRowsApi);
            url.searchParams.set("dataset", options.source.dataset);
            url.searchParams.set("revision", options.source.revision);
            url.searchParams.set("config", options.source.config);
            url.searchParams.set("split", options.source.split);
            url.searchParams.set("offset", String(offset));
            url.searchParams.set("length", String(pageSize));
            const page = parsePage<Row>(
                await fetchPage(
                    fetchImpl,
                    url,
                    retryAttempts,
                    retryDelayMs,
                    requestTimeoutMs,
                    options.signal,
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
