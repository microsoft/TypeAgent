// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";
import { downloadHuggingFaceRows } from "../src/translationBench/public_datasets/huggingFaceRows.js";

const source = {
    dataset: "owner/name",
    revision: "abc123",
    config: "default",
    split: "train",
};
const directory = () => mkdtemp(join(tmpdir(), "hf-rows-"));

// prettier-ignore
test("handles retries, cancellation, and atomic output", async () => {
    const successDir = await directory(), outputPath = join(successDir, "rows.jsonl"), requests: URL[] = [], progress: number[] = [];
    await writeFile(outputPath, "old");
    const fetch = jest.fn<typeof globalThis.fetch>(async (input) => {
        const url = new URL(String(input)); requests.push(url);
        if (requests.length === 1) throw new TypeError("network failure");
        if (requests.length === 2) return new Response(null, { status: 503 });
        const offset = Number(url.searchParams.get("offset"));
        return Response.json(
            { rows: [{ row: { id: offset + 1 } }], num_rows_total: 2 },
            { headers: { "x-revision": "abc123" } },
        );
    });
    await expect(downloadHuggingFaceRows({ source, outputPath, parseRow: (row) => row, fetch, pageSize: 1, retryDelayMs: 0, onProgress: (count) => progress.push(count) })).resolves.toBe(2);
    expect(requests.every((url) => !url.searchParams.has("revision"))).toBe(true); expect(progress).toEqual([1, 2]);
    expect(await readFile(outputPath, "utf8")).toBe('{"id":1}\n{"id":2}\n');
    const wrongRevisionDir = await directory();
    const wrongRevision = jest.fn<typeof globalThis.fetch>(async () =>
        Response.json(
            { rows: [], num_rows_total: 0 },
            { headers: { "x-revision": "latest" } },
        ),
    );
    await expect(downloadHuggingFaceRows({ source, outputPath: join(wrongRevisionDir, "rows.jsonl"), parseRow: (row) => row, fetch: wrongRevision })).rejects.toThrow("did not serve revision abc123");
    expect(await readdir(wrongRevisionDir)).toEqual([]);
    const failureDir = await directory(), preservedPath = join(failureDir, "rows.jsonl");
    await writeFile(preservedPath, "old");
    const notFound = jest.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 404 }));
    await expect(downloadHuggingFaceRows({ source, outputPath: preservedPath, parseRow: (row) => row, fetch: notFound })).rejects.toThrow("404");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(await readdir(failureDir)).toEqual(["rows.jsonl"]);
    expect(await readFile(preservedPath, "utf8")).toBe("old");
    const controller = new AbortController(), abortDir = await directory();
    const transient = jest.fn<typeof globalThis.fetch>(async () => { queueMicrotask(() => controller.abort()); return new Response(null, { status: 503 }); });
    await expect(downloadHuggingFaceRows({ source, outputPath: join(abortDir, "rows.jsonl"), parseRow: (row) => row, fetch: transient, retryDelayMs: 10_000, signal: controller.signal })).rejects.toThrow();
    expect(transient).toHaveBeenCalledTimes(1);
    expect(await readdir(abortDir)).toEqual([]);

    const timeoutDir = await directory();
    const timeout = jest.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))));
    await expect(downloadHuggingFaceRows({ source, outputPath: join(timeoutDir, "rows.jsonl"), parseRow: (row) => row, fetch: timeout, retryAttempts: 2, retryDelayMs: 0, requestTimeoutMs: 1 })).rejects.toThrow();
    expect(timeout).toHaveBeenCalledTimes(2);
});
