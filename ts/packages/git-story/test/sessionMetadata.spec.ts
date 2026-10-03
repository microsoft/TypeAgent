// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    SessionWatcher,
    type CapturedSessionUpdates,
    type SessionWatchRequest,
} from "../src/sessionWatcher.js";

let directory: string;
let request: SessionWatchRequest;
let stateDirectory: string;
const watcher = new SessionWatcher();
const startTime = "2026-10-02T08:00:00Z";

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-metadata-"));
    stateDirectory = path.join(directory, "capture");
    request = {
        projectPath: directory,
        sessionId: "synthetic-session",
        transcriptPath: path.join(directory, "events.jsonl"),
        metadata: { clientName: "registered client", models: ["seed-model"] },
    };
    await fs.writeFile(request.transcriptPath, "");
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function append(...events: unknown[]) {
    await fs.appendFile(
        request.transcriptPath,
        events.map((event) => JSON.stringify(event) + "\n").join(""),
    );
}

async function capture(maxRecords = 1000) {
    return watcher.captureUpdates(request, undefined, {
        stateDirectory,
        maxRecords,
    });
}

function collect(captured: CapturedSessionUpdates) {
    return watcher.collectMetadata(
        request,
        watcher.normalizeEvents(request, captured),
    );
}

function restore(captured: CapturedSessionUpdates, maxRecords = 1000) {
    return new SessionWatcher().restoreMetadata(
        request,
        captured.nextCheckpoint,
        captured.generation,
        { stateDirectory, maxRecords },
    );
}

test("registration seeds empty batches without mutating seed or prior state", async () => {
    request.metadata = {
        clientName: "registered client",
        models: ["seed-model", "seed-model"],
        parentSessionId: "seed-parent",
        startedAt: startTime,
        lastEventTimestamp: "2026-10-02T09:00:00Z",
    };
    const original = structuredClone(request);
    const first = collect(await capture());
    expect(first.metadata).toEqual({
        ...request.metadata,
        models: ["seed-model"],
    });
    const before = structuredClone(first);
    const next = watcher.collectMetadata(
        request,
        watcher.normalizeEvents(request, await capture()),
        first,
    );
    next.metadata.models.push("later");
    expect(first).toEqual(before);
    expect(request).toEqual(original);
});

test("accumulates explicit model/client/parent/start metadata across metadata-only batches", async () => {
    await append({
        type: "session.start",
        timestamp: "2026-10-02T09:00:00Z",
        data: {
            producer: "copilot-cli",
            selectedModel: "model-a",
            startTime,
            detachedFromSpawningParentSessionId: "parent-session",
        },
    });
    const firstCapture = await capture();
    const first = collect(firstCapture);
    expect(first.metadata).toEqual({
        clientName: "copilot-cli",
        models: ["seed-model", "model-a"],
        startedAt: startTime,
        parentSessionId: "parent-session",
        lastEventTimestamp: "2026-10-02T09:00:00Z",
    });
    await append(
        {
            type: "session.model_change",
            timestamp: "2026-10-02T11:00:00Z",
            data: { previousModel: "model-a", newModel: "model-b" },
        },
        {
            type: "assistant.usage",
            timestamp: "2026-10-02T10:00:00Z",
            data: { model: "model-c" },
        },
        {
            type: "session.resume",
            data: {
                selectedModel: "model-b",
                resumeTime: "2026-10-02T12:00:00Z",
            },
        },
    );
    const secondCapture = await capture();
    const second = watcher.collectMetadata(
        request,
        watcher.normalizeEvents(request, secondCapture),
        first,
    );
    expect(second.metadata.models).toEqual([
        "seed-model",
        "model-a",
        "model-b",
        "model-c",
    ]);
    expect(second.metadata.startedAt).toBe(startTime);
    expect(second.metadata.parentSessionId).toBe("parent-session");
    expect(second.metadata.lastEventTimestamp).toBe("2026-10-02T11:00:00Z");
    expect(second.metadata.clientName).toBe("copilot-cli");
    expect(
        watcher.collectMetadata(
            request,
            watcher.normalizeEvents(request, secondCapture),
            second,
        ),
    ).toEqual(second);
    expect(first.metadata.models).toEqual(["seed-model", "model-a"]);
});

test("uses source timestamp for start when startTime is absent, never resume time", async () => {
    await append(
        {
            type: "session.start",
            timestamp: startTime,
            data: {
                clientName: "explicit client",
                parentSessionId: "explicit-parent",
            },
        },
        {
            type: "session.resume",
            timestamp: "2026-10-02T12:00:00Z",
            data: { resumeTime: "2026-10-02T12:00:00Z" },
        },
    );
    expect(collect(await capture()).metadata).toMatchObject({
        clientName: "explicit client",
        parentSessionId: "explicit-parent",
        startedAt: startTime,
        lastEventTimestamp: "2026-10-02T12:00:00Z",
    });
});

test("observes models from messages and tools without inferring missing models", async () => {
    await append(
        {
            type: "assistant.message",
            data: { content: "synthetic response", model: "model-a" },
        },
        {
            type: "tool.execution_start",
            model: "model-b",
            data: { toolCallId: "call", toolName: "powershell" },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "call", success: true },
        },
        { type: "user.message", data: { content: "synthetic prompt" } },
    );
    const batch = watcher.normalizeEvents(request, await capture());
    const state = watcher.collectMetadata(request, batch);
    expect(state.metadata.models).toEqual(["seed-model", "model-a", "model-b"]);
    expect(batch.events[2]).not.toHaveProperty("model");
    expect(state.metadata).not.toHaveProperty("startedAt");
    expect(state.metadata).not.toHaveProperty("parentSessionId");
});

test("latest timestamp includes ignored and unsupported records with timezone ordering", async () => {
    await append(
        {
            type: "assistant.turn_end",
            timestamp: "2026-10-02T10:00:00-07:00",
            data: {},
        },
        { type: "future.event", timestamp: "2026-10-02T15:00:00Z", data: {} },
    );
    const captured = await capture();
    const batch = watcher.normalizeEvents(request, captured);
    expect(batch.events).toEqual([]);
    expect(
        watcher.collectMetadata(request, batch).metadata.lastEventTimestamp,
    ).toBe("2026-10-02T10:00:00-07:00");
    expect(batch.diagnostics[0]?.code).toBe("unsupported-event");
});

test("restores earlier metadata after capture advanced without downstream processing", async () => {
    await append(
        {
            type: "session.start",
            data: {
                producer: "copilot-cli",
                selectedModel: "model-a",
                startTime,
                parentSessionId: "parent",
            },
        },
        {
            type: "assistant.message",
            data: { content: "synthetic response", model: "model-b" },
        },
    );
    const first = await capture(1);
    // Simulate a crash after capture saved its cursor, before metadata was collected.
    const resumed = await new SessionWatcher().captureUpdates(
        request,
        undefined,
        { stateDirectory },
    );
    expect(resumed.records).toHaveLength(1);
    expect(collect(resumed).metadata.models).toEqual(["seed-model", "model-b"]);
    const restored = await restore(resumed, 1);
    expect(restored.state.metadata).toMatchObject({
        clientName: "copilot-cli",
        models: ["seed-model", "model-a", "model-b"],
        parentSessionId: "parent",
        startedAt: startTime,
    });
    expect(restored.nextCheckpoint).toEqual(resumed.nextCheckpoint);
    expect(restored.diagnostics).toEqual([]);
    const replay = await watcher.captureUpdates(
        request,
        { ...first.nextCheckpoint, sourceByteOffset: "0" },
        { stateDirectory, expectedGeneration: first.generation },
    );
    expect(replay.records.map((record) => record.id)).toEqual([
        first.records[0]!.id,
        resumed.records[0]!.id,
    ]);
    expect(collect(replay)).toEqual(restored.state);
    expect((await capture()).records).toEqual([]);
});

test("restoring an older boundary neither processes unread appends nor regresses the capture cursor", async () => {
    await append({
        type: "session.start",
        data: { selectedModel: "old-model" },
    });
    const old = await capture();
    await append({
        type: "assistant.message",
        data: { content: "", model: "new-model" },
    });
    const newer = await capture();
    await append({
        type: "assistant.message",
        data: { content: "", model: "unread-model" },
    });
    const restored = await restore(old);
    expect(restored.state.metadata.models).toEqual(["seed-model", "old-model"]);
    expect(restored.nextCheckpoint).toEqual(old.nextCheckpoint);
    const next = await capture();
    expect(next.records).toHaveLength(1);
    expect(next.records[0]!.source.sourceByteOffset).toBe(
        newer.nextCheckpoint.sourceByteOffset,
    );
    expect(collect(next).metadata.models).toEqual([
        "seed-model",
        "unread-model",
    ]);
});

async function beforeTranscriptOpen(
    number: number,
    operation: () => Promise<void>,
) {
    const open = fs.open.bind(fs);
    let opens = 0;
    jest.spyOn(fs, "open").mockImplementation(async (...args) => {
        if (args[0] === request.transcriptPath && ++opens === number) {
            await operation();
        }
        return open(...args);
    });
}

test("fixed replay boundary excludes appends made during replay", async () => {
    await append(
        { type: "session.start", data: { selectedModel: "model-a" } },
        { type: "session.model_change", data: { newModel: "model-b" } },
    );
    const captured = await capture();
    // First open counts the fixed prefix, second replays its first record.
    await beforeTranscriptOpen(3, () =>
        append({
            type: "assistant.message",
            data: { content: "new unread append", model: "model-c" },
        }),
    );
    const restored = await restore(captured, 1);
    expect(restored.state.metadata.models).toEqual([
        "seed-model",
        "model-a",
        "model-b",
    ]);
    expect(restored.nextCheckpoint).toEqual(captured.nextCheckpoint);
    jest.restoreAllMocks();
    const next = await capture();
    expect(next.records).toHaveLength(1);
    expect(next.records[0]!.source.sourceByteOffset).toBe(
        captured.nextCheckpoint.sourceByteOffset,
    );
});

test.each(["replacement", "truncation"] as const)(
    "rejects %s between counting and replay",
    async (change) => {
        await append({
            type: "session.start",
            data: { selectedModel: "old-model" },
        });
        const captured = await capture();
        await beforeTranscriptOpen(2, async () => {
            if (change === "replacement") {
                await fs.rename(
                    request.transcriptPath,
                    path.join(directory, "old.jsonl"),
                );
                await fs.writeFile(
                    request.transcriptPath,
                    JSON.stringify({
                        type: "session.start",
                        data: { selectedModel: "new-model" },
                    }) + "\n",
                );
            } else {
                await fs.truncate(request.transcriptPath, 0);
            }
        });
        await expect(restore(captured)).rejects.toThrow(
            "Capture transcript generation does not match",
        );
    },
);

test("generation reset discards old history while keeping the registration seed", async () => {
    await append({
        type: "session.start",
        timestamp: startTime,
        data: {
            producer: "old-client",
            selectedModel: "old-model",
            parentSessionId: "old-parent",
        },
    });
    const old = await capture();
    const oldState = collect(old);
    await fs.rename(request.transcriptPath, path.join(directory, "old.jsonl"));
    await fs.writeFile(
        request.transcriptPath,
        JSON.stringify({
            type: "user.message",
            data: { content: "new generation" },
        }) + "\n",
    );
    const fresh = await capture();
    expect(fresh.generation).not.toBe(old.generation);
    const state = watcher.collectMetadata(
        request,
        watcher.normalizeEvents(request, fresh),
        oldState,
    );
    expect(state.metadata).toEqual(request.metadata);
    expect(state.generation).toBe(fresh.generation);
    await expect(restore(old)).rejects.toThrow(
        "Metadata replay requires a captured generation and boundary",
    );
    expect((await restore(fresh)).state).toEqual(state);
});

test("restores empty and zero boundaries using seed only without consuming unread data", async () => {
    const empty = await capture();
    await append({ type: "session.start", data: { selectedModel: "unread" } });
    expect((await restore(empty)).state.metadata).toEqual(request.metadata);
    expect((await capture()).records).toHaveLength(1);
});

test.each(["-1", "01", "abc", "9007199254740992"])(
    "rejects invalid restore byte offset %s",
    async (offset) => {
        const captured = await capture();
        captured.nextCheckpoint.sourceByteOffset = offset;
        await expect(restore(captured)).rejects.toThrow(
            "Capture byte offset must be a safe decimal integer",
        );
    },
);

test("rejects non-boundary, uncaptured, unregistered and missing-state replay", async () => {
    await append({ type: "session.start", data: { selectedModel: "model-a" } });
    const captured = await capture();
    await expect(
        restore({
            ...captured,
            nextCheckpoint: {
                ...captured.nextCheckpoint,
                sourceByteOffset: "5",
            },
        }),
    ).rejects.toThrow("Capture checkpoint is not a complete record boundary");
    await expect(
        restore({
            ...captured,
            nextCheckpoint: {
                ...captured.nextCheckpoint,
                sourceByteOffset: String(
                    Number(captured.nextCheckpoint.sourceByteOffset) + 1,
                ),
            },
        }),
    ).rejects.toThrow(
        "Metadata replay requires a captured generation and boundary",
    );
    await expect(
        restore({
            ...captured,
            nextCheckpoint: {
                ...captured.nextCheckpoint,
                sessionId: "another",
            },
        }),
    ).rejects.toThrow("Session source does not match registration");
    await expect(
        watcher.restoreMetadata(
            request,
            captured.nextCheckpoint,
            captured.generation,
            { stateDirectory: path.join(directory, "missing") },
        ),
    ).rejects.toThrow(
        "Metadata replay requires a captured generation and boundary",
    );
});

test("metadata accumulation rejects state from another session or transcript", async () => {
    const batch = watcher.normalizeEvents(request, await capture());
    const state = watcher.collectMetadata(request, batch);
    expect(() =>
        watcher.collectMetadata(request, batch, {
            ...state,
            sessionId: "another",
        }),
    ).toThrow("Session source does not match registration");
    expect(() =>
        watcher.collectMetadata(request, batch, {
            ...state,
            transcriptPath: path.join(directory, "another.jsonl"),
        }),
    ).toThrow("Session source does not match registration");
});

test("restore surfaces capture, unsupported and malformed diagnostics without payload leakage", async () => {
    await fs.appendFile(request.transcriptPath, "SECRET-invalid-json\n");
    await append(
        { type: "unknown.SECRET", data: { text: "SECRET" } },
        { type: "tool.execution_complete", data: { success: "SECRET" } },
        { type: "session.start", data: { selectedModel: "model-a" } },
    );
    const captured = await capture();
    const restored = await restore(captured, 2);
    expect(restored.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "invalid-json",
        "unsupported-event",
        "malformed-event",
    ]);
    expect(JSON.stringify(restored.diagnostics)).not.toContain("SECRET");
    expect(restored.state.metadata.models).toEqual(["seed-model", "model-a"]);
});

test.each([0, -1, 0.5, NaN])(
    "rejects invalid restore batch size %s",
    async (maxRecords) => {
        await expect(restore(await capture(), maxRecords)).rejects.toThrow(
            "Metadata replay maxRecords must be a positive safe integer",
        );
    },
);
