// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfigSync } from "../../packages/config/dist/index.js";
import { initRuntimeConfigFromProcessEnv } from "../../packages/aiclient/dist/index.js";
import { createDurableMemoryIndexSettings } from "../../packages/agentServer/server/dist/durableMemoryService.js";
import {
    createKnowProCorpusIndex,
    toDocParts,
} from "../../packages/memory/service/dist/knowProCorpusIndex.js";
import { instrumentSettings } from "./longmemeval-indexing-storage.mjs";
import { sessionSource } from "./longmemeval-runner.mjs";
import { digest, encode } from "./longmemeval-indexing-contract.mjs";
import { atomicWriteJson, hashWorkingTreePatch } from "./replay-artifacts.mjs";
import { validateLiveAuthorization } from "./wiki-consolidation-qualification.mjs";
import { snapshotCompiledCheckpoint } from "./harness.mjs";

const { values } = parseArgs({
    options: {
        dataset: { type: "string" },
        authorization: { type: "string" },
        output: { type: "string" },
    },
});
assert.ok(values.dataset && values.authorization && values.output);
const authorization = JSON.parse(await readFile(values.authorization, "utf8"));
const remaining = validateLiveAuthorization(authorization) - 5 * 60_000;
assert.ok(
    remaining > 0,
    "Live authorization expired or cleanup reserve reached",
);
const datasetBytes = await readFile(values.dataset);
assert.equal(
    digest(datasetBytes),
    "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
);
const row = JSON.parse(datasetBytes).find(
    (entry) => entry.question_id === "4f54b7c9",
);
assert.ok(row);
const documents = row.haystack_sessions.map((turns, position) => {
    const prepared = sessionSource(row.question_id, {
        id: row.haystack_session_ids[position],
        date: row.haystack_dates[position],
        position,
        turns: turns.map(({ role, content }) => ({ role, content })),
    });
    const sourceId = `probe-source-${position}`;
    return {
        source: {
            sourceId,
            corpusId: "probe",
            sourceType: "markdown",
            title: prepared.source.title,
            canonicalUri: prepared.canonicalUri,
            activeRevisionId: prepared.sha256,
        },
        revision: {
            revisionId: prepared.sha256,
            sourceId,
            contentHash: prepared.sha256,
            mimeType: "text/markdown",
            temporalContext: prepared.source.temporalContext,
            pipelineVersion: "1",
            state: "ready",
        },
        content: prepared.source.text,
        pipeline: { mode: "content" },
    };
});
assert.equal(documents.length, 45);
assert.equal(documents.flatMap(toDocParts).length, 536);
await mkdir(values.output);
await writeFile(path.join(values.output, "documents.json"), encode(documents), {
    flag: "wx",
});
loadConfigSync();
initRuntimeConfigFromProcessEnv();
const patch = await hashWorkingTreePatch(process.cwd());
const compiled = await snapshotCompiledCheckpoint(process.cwd());
await writeFile(
    path.join(values.output, "checkpoint.json"),
    JSON.stringify({ patch, compiled }),
    { flag: "wx" },
);
const startedEpochMs = Date.now();
const signal = AbortSignal.timeout(Math.min(remaining, 90 * 60_000));
const entries = [],
    durations = [],
    occurrences = new Map();
let writing = Promise.resolve(),
    active = 0,
    peak = 0,
    completedGroups = 0;
const journal = (entry) => {
    const line = `${encode(entry)}\n`;
    writing = writing.then(() =>
        appendFile(path.join(values.output, "provider-journal.jsonl"), line),
    );
    return writing;
};
const factory = () => {
    const settings = createDurableMemoryIndexSettings(64, 64);
    instrumentSettings(
        settings.conversationSettings,
        {
            async invoke(method, identity, args, work) {
                signal.throwIfAborted();
                assert.ok(
                    entries.length + active < 10000,
                    "Native capture request limit reached",
                );
                const key = digest(encode({ method, identity, args }));
                const occurrence = (occurrences.get(key) ?? 0) + 1;
                occurrences.set(key, occurrence);
                const start = performance.now();
                await journal({
                    event: "started",
                    key,
                    occurrence,
                    method,
                    identity,
                    args,
                    epochMs: Date.now(),
                });
                active++;
                peak = Math.max(peak, active);
                try {
                    const value = await work();
                    const elapsedMs = performance.now() - start;
                    await journal({
                        event: "settled",
                        key,
                        occurrence,
                        method,
                        value,
                        elapsedMs,
                    });
                    entries.push({ key, occurrence, method, value });
                    durations.push([`${key}:${occurrence}`, elapsedMs]);
                    signal.throwIfAborted();
                    return value;
                } catch (error) {
                    await journal({
                        event: "failed",
                        key,
                        occurrence,
                        method,
                        error: { name: error.name, message: error.message },
                    });
                    throw error;
                } finally {
                    active--;
                }
            },
        },
        { commit: false },
    );
    return settings;
};
const indexDirectory = path.join(values.output, "index");
await mkdir(indexDirectory);
const index = createKnowProCorpusIndex("probe", indexDirectory, factory);
let outcome = "FAILED_CAPTURE";
try {
    for (let offset = 0; offset < documents.length; offset += 2) {
        signal.throwIfAborted();
        await index.append(
            documents.slice(offset, offset + 2),
            signal,
            async () => {},
        );
        completedGroups++;
        const progress = {
            completedGroups,
            totalGroups: Math.ceil(documents.length / 2),
            providerCalls: entries.length,
            active,
            peak,
            elapsedMs: Date.now() - startedEpochMs,
            memory: process.memoryUsage(),
        };
        await atomicWriteJson(
            path.join(values.output, "progress.json"),
            progress,
        );
        process.stdout.write(`${JSON.stringify(progress)}\n`);
    }
    assert.equal(
        await hashWorkingTreePatch(process.cwd()),
        patch,
        "Source changed during capture",
    );
    assert.deepEqual(
        await snapshotCompiledCheckpoint(process.cwd()),
        compiled,
        "Compiled product changed during capture",
    );
    outcome = "COMPLETE_CAPTURE";
} finally {
    await writing;
    await writeFile(
        path.join(values.output, "provider-replay-tape.json"),
        encode({ entries, durations }),
        { flag: "wx" },
    );
    await writeFile(
        path.join(values.output, "outcome.json"),
        JSON.stringify({
            outcome,
            completedGroups,
            parts: 536,
            sourceCount: documents.length,
            providerCalls: entries.length,
            active,
            peak,
            patch,
            startedEpochMs,
            finishedEpochMs: Date.now(),
            maxRssKb: process.resourceUsage().maxRSS,
            graphHash: completedGroups
                ? digest(encode(await index.getKnowledgeGraph()))
                : null,
        }),
        { flag: "wx" },
    );
}
