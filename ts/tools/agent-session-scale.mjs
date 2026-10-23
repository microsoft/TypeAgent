// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const tsRoot = fileURLToPath(new URL("..", import.meta.url));
const parserPath = path.join(
    tsRoot,
    "packages",
    "memory",
    "service",
    "dist",
    "agentSessionParsing.js",
);

export function percentile(values, fraction) {
    assert.ok(values.length > 0);
    return [...values].sort((a, b) => a - b)[
        Math.ceil(values.length * fraction) - 1
    ];
}

export async function measureParser(parser, { events, targetBytes = 0 }) {
    assert.ok(Number.isSafeInteger(events) && events >= 1 && events <= 100_000);
    const started = performance.now();
    const sessionId = `scale-${events}-${targetBytes}`;
    let lines = [];
    let bytes = 0;
    let cursor = 0;
    let totalBytes = 0;
    let accepted = 0;
    let spans = 0;
    let peakRss = process.memoryUsage().rss;
    let maxChunkBytes = 0;
    let maxEpisodeChars = 0;
    const latencies = [];
    const flush = () => {
        if (!lines.length) return;
        const jsonl = lines.join("");
        maxChunkBytes = Math.max(maxChunkBytes, Buffer.byteLength(jsonl));
        const before = performance.now();
        const result = parser.parseAgentSessionChunk({
            corpusId: "scale-corpus",
            sessionId,
            importType: "agent-session-jsonl",
            expectedCursor: cursor,
            idempotencyKey: `chunk-${cursor}`,
            jsonl,
        });
        assert.equal(result.records, lines.length);
        assert.equal(result.losses.length, 0);
        assert.equal(result.duplicates, 0);
        assert.equal(result.events.length, lines.length);
        const episodes = parser.buildAgentSessionEpisodes(result.events);
        for (const episode of episodes) {
            maxEpisodeChars = Math.max(maxEpisodeChars, episode.text.length);
            const original = new Map(
                episode.events.map((event) => [event.id, event.text]),
            );
            for (const span of episode.spans) {
                assert.equal(
                    episode.text.slice(span.start, span.end),
                    original.get(span.eventId),
                );
                spans++;
            }
        }
        accepted += result.events.length;
        cursor += result.records;
        latencies.push(performance.now() - before);
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        lines = [];
        bytes = 0;
    };
    for (let ordinal = 0; ordinal < events; ordinal++) {
        const event = {
            schemaVersion: 1,
            id: `event-${ordinal}`,
            sessionId,
            kind: "tool-result",
            role: "tool",
            agentId: `agent-${ordinal % 4}`,
            taskId: `task-${Math.floor(ordinal / 20)}`,
            callId: `call-${ordinal}`,
            text: "",
            outcome: "unknown",
        };
        const overhead = Buffer.byteLength(JSON.stringify(event)) + 1;
        event.text =
            `Observation ${ordinal}: ` +
            "x".repeat(
                Math.max(32, Math.ceil(targetBytes / events) - overhead),
            );
        const line = JSON.stringify(event) + "\n";
        const length = Buffer.byteLength(line);
        assert.ok(length < 64 * 1024);
        if (lines.length === 100 || bytes + length > 256 * 1024) flush();
        lines.push(line);
        bytes += length;
        totalBytes += length;
    }
    flush();
    const elapsedMs = performance.now() - started;
    assert.equal(accepted, events);
    assert.equal(spans, events);
    assert.ok(totalBytes >= targetBytes);
    assert.ok(maxChunkBytes <= 256 * 1024);
    assert.ok(maxEpisodeChars <= 16_000);
    return {
        mode: "streamed-parser-and-episode-only",
        semanticExtraction: "not-run",
        corpusIndexing: "not-run",
        providerCalls: 0,
        events,
        accepted,
        exactSpanChecks: spans,
        inputBytes: totalBytes,
        targetBytes,
        chunks: latencies.length,
        maxChunkBytes,
        maxEpisodeChars,
        elapsedMs,
        mebibytesPerSecond: totalBytes / 1024 ** 2 / (elapsedMs / 1000),
        chunkLatencyMs: {
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
        },
        peakObservedRssBytes: peakRss,
    };
}

export async function runScale(output) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("Network prohibited in parser scale qualification");
    };
    try {
        const parser = await import(pathToFileURL(parserPath).href);
        const workloads = [];
        for (const spec of [
            { events: 1000 },
            { events: 10_000 },
            { events: 100_000 },
            { events: 10_000, targetBytes: 10 * 1024 ** 2 },
            { events: 100_000, targetBytes: 100 * 1024 ** 2 },
        ])
            workloads.push(await measureParser(parser, spec));
        const result = {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            parserSha256: createHash("sha256")
                .update(await readFile(parserPath))
                .digest("hex"),
            node: process.version,
            workloads,
            limitation:
                "No end-to-end index/model/retained-ledger scaling claim; RSS includes V8 high-water effects between workloads.",
        };
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
            flag: "wx",
        });
        return result;
    } finally {
        globalThis.fetch = originalFetch;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const { values } = parseArgs({ options: { output: { type: "string" } } });
    assert.ok(
        values.output,
        "--output is required and must name a new JSON receipt",
    );
    const result = await runScale(path.resolve(values.output));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
