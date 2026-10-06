// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { jest } from "@jest/globals";
import {
    SessionWatcher,
    type CapturedSessionUpdates,
    type SessionWatchRequest,
    type NormalizedSessionUpdate,
} from "../src/sessionWatcher.js";

const watcher = new SessionWatcher();
const request: SessionWatchRequest = {
    projectPath: process.cwd(),
    sessionId: "synthetic-session",
    transcriptPath: path.resolve("synthetic-events.jsonl"),
    metadata: { clientName: "Copilot CLI", models: [] },
};
const diff =
    "diff --git a/example.ts b/example.ts\nindex 1111111..2222222 100644\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+new\n";

function captured(...payloads: unknown[]): CapturedSessionUpdates {
    return {
        records: payloads.map((payload, index) => {
            const id =
                typeof payload === "object" &&
                payload !== null &&
                "id" in payload &&
                typeof payload.id === "string"
                    ? payload.id
                    : undefined;
            return {
                id:
                    id ??
                    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                ...(id !== undefined ? { sourceEventId: id } : {}),
                source: {
                    sessionId: request.sessionId,
                    transcriptPath: request.transcriptPath,
                    generation: "generation-1",
                    sourceByteOffset: String(index * 100),
                },
                payload,
            };
        }),
        diagnostics: [],
        generation: "generation-1",
        nextCheckpoint: {
            sessionId: request.sessionId,
            transcriptPath: request.transcriptPath,
            sourceByteOffset: String(payloads.length * 100),
        },
    };
}

function normalize(...payloads: unknown[]) {
    return watcher.normalizeEvents(request, captured(...payloads));
}

test.each([{ status: "private detail" }, diff])(
    "captures complete evidence with detail %j through the real whole-update privacy boundary",
    async (detailedContent) => {
        const directory = await fs.mkdtemp(
            path.join(os.tmpdir(), "git-story-pipeline-"),
        );
        const source: SessionWatchRequest = {
            ...request,
            projectPath: directory,
            transcriptPath: path.join(directory, "events.jsonl"),
        };
        const result = {
            content: "private summary (truncated)",
            detailedContent,
            contents: [
                { type: "text", text: "private full evidence" },
                {
                    type: "future-block",
                    nested: { values: [true, null, "private block"] },
                },
            ],
            structuredContent: {
                rows: [
                    {
                        file: "private.ts",
                        line: 42,
                        message: "private exact evidence",
                    },
                ],
            },
            diff: "private source-reported patch",
        };
        const destination =
            jest.fn<(update: NormalizedSessionUpdate) => void>();
        const filter = jest.fn(
            (input: NormalizedSessionUpdate): NormalizedSessionUpdate => {
                expect(input.projectPath).toBe(directory);
                expect(input.sessionId).toBe(source.sessionId);
                expect(input.metadata.models).toEqual(["private model"]);
                expect(input.metadata.parentSessionId).toBe("private parent");
                expect(input.events[1]).toMatchObject({
                    type: "tool-complete",
                    output: result.content,
                    detailedContent: result.detailedContent,
                    contents: result.contents,
                    structuredContent: result.structuredContent,
                    diff: result.diff,
                    error: { message: "private error" },
                });
                // Synthetic allow-list policy, not a production privacy default.
                return {
                    projectPath: "approved project",
                    sessionId: "approved session",
                    metadata: { clientName: "approved client", models: [] },
                    events: [
                        {
                            id: input.events[1]!.id,
                            type: "message",
                            role: "system",
                            text: "approved evidence",
                        },
                    ],
                };
            },
        );
        const integrated = new SessionWatcher({
            privacyFilter: filter,
            approvedUpdateDestination: destination,
        });
        try {
            await fs.writeFile(
                source.transcriptPath,
                [
                    {
                        type: "session.start",
                        data: {
                            selectedModel: "private model",
                            parentSessionId: "private parent",
                        },
                    },
                    {
                        type: "tool.execution_complete",
                        data: {
                            toolCallId: "call",
                            success: false,
                            result,
                            error: { message: "private error" },
                        },
                    },
                ]
                    .map((event) => JSON.stringify(event) + "\n")
                    .join(""),
            );
            const options = { stateDirectory: path.join(directory, "capture") };
            const updates = await integrated.captureUpdates(
                source,
                undefined,
                options,
            );
            const batch = integrated.normalizeEvents(source, updates);
            expect(batch.diagnostics).toEqual([]);
            const state = integrated.collectMetadata(source, batch);
            expect(destination).not.toHaveBeenCalled();
            const update: NormalizedSessionUpdate = {
                projectPath: source.projectPath,
                sessionId: source.sessionId,
                events: batch.events,
                metadata: state.metadata,
            };
            const approved = await integrated.filterForPrivacy(update);
            expect(filter).toHaveBeenCalledTimes(1);
            expect(destination).not.toHaveBeenCalled();
            if (!approved) throw new Error("Expected approval");
            expect(JSON.stringify(approved)).toBe("{}");
            update.metadata.models.push("private post-approval mutation");
            await integrated.publishUpdate(approved);
            expect(destination).toHaveBeenCalledTimes(1);
            expect(destination.mock.calls[0]![0]).toEqual({
                projectPath: "approved project",
                sessionId: "approved session",
                metadata: { clientName: "approved client", models: [] },
                events: [
                    {
                        id: updates.records[1]!.id,
                        type: "message",
                        role: "system",
                        text: "approved evidence",
                    },
                ],
            });
            expect(JSON.stringify(destination.mock.calls)).not.toContain(
                "private",
            );
            const restored = await integrated.restoreMetadata(
                source,
                updates.nextCheckpoint,
                updates.generation,
                { ...options, maxRecords: 1 },
            );
            expect(restored.state.metadata.models).toEqual(["private model"]);
            expect(destination).toHaveBeenCalledTimes(1);
            const excluded = new SessionWatcher({
                privacyFilter: () => null,
                approvedUpdateDestination: destination,
            });
            expect(await excluded.filterForPrivacy(update)).toBeNull();
            expect(destination).toHaveBeenCalledTimes(1);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    },
);

test("clones opaque evidence independently of the source and other evidence fields", () => {
    const shared = { rows: [{ message: "exact evidence" }] };
    const result = {
        contents: shared,
        structuredContent: shared,
        detailedContent: shared,
    };
    const event = normalize({
        type: "tool.execution_complete",
        data: { toolCallId: "call", success: true, result },
    }).events[0];
    if (event?.type !== "tool-complete") throw new Error("Expected completion");
    expect(event.contents).toEqual(shared);
    expect(event.structuredContent).toEqual(shared);
    expect(event.contents).not.toBe(shared);
    expect(event.structuredContent).not.toBe(event.contents);
    shared.rows[0]!.message = "source mutation";
    expect(JSON.stringify(event)).not.toContain("source mutation");
    const structured = event.structuredContent;
    if (
        typeof structured !== "object" ||
        structured === null ||
        !("rows" in structured) ||
        !Array.isArray(structured.rows)
    )
        throw new Error("Expected rows");
    const row: unknown = structured.rows[0];
    if (typeof row !== "object" || row === null || !("message" in row))
        throw new Error("Expected row");
    row.message = "normalized mutation";
    expect(JSON.stringify(result)).not.toContain("normalized mutation");
    expect(JSON.stringify(event.contents)).not.toContain("normalized mutation");
    expect(JSON.stringify(event.detailedContent)).not.toContain(
        "normalized mutation",
    );
});

test.each([null, false, 0, "", [], { future: { exact: [1, null] } }])(
    "keeps forward-compatible opaque JSON evidence %j",
    (value) => {
        const batch = normalize({
            type: "tool.execution_complete",
            data: {
                toolCallId: "call",
                success: true,
                result: { contents: value, structuredContent: value },
            },
        });
        expect(batch.diagnostics).toEqual([]);
        expect(batch.events[0]).toMatchObject({
            contents: value,
            structuredContent: value,
        });
    },
);

test("does not add absent result evidence fields", () => {
    const batch = normalize({
        type: "tool.execution_complete",
        data: {
            toolCallId: "call",
            success: true,
            result: { content: "summary only" },
        },
    });
    for (const field of ["contents", "structuredContent", "detailedContent"]) {
        expect(batch.events[0]).not.toHaveProperty(field);
    }
});

test.each([
    ["user.message", "user"],
    ["assistant.message", "agent"],
    ["system.message", "system"],
])("normalizes %s text and preserves source headers", (type, role) => {
    const batch = normalize({
        id: "native:not-a-guid",
        type,
        timestamp: "2026-10-02T10:00:00Z",
        agentId: "worker-1",
        data: { content: "synthetic text", model: "model-a" },
    });
    expect(batch.events).toEqual([
        {
            type: "message",
            role,
            text: "synthetic text",
            id: "native:not-a-guid",
            sourceEventId: "native:not-a-guid",
            timestamp: "2026-10-02T10:00:00Z",
            model: "model-a",
            agentId: "worker-1",
        },
    ]);
    expect(batch.events[0]).not.toHaveProperty("sessionId");
    expect(batch.diagnostics).toEqual([]);
});

test.each(["", "native-id"])("preserves native string ID %j verbatim", (id) => {
    expect(
        normalize({ id, type: "user.message", data: { content: "" } }).events,
    ).toEqual([
        { id, sourceEventId: id, type: "message", role: "user", text: "" },
    ]);
});

test.each([undefined, 5, null])(
    "uses only the capture-assigned ID for source ID %j",
    (id) => {
        const updates = captured(
            { id, type: "assistant.message", data: { content: "same" } },
            { id, type: "assistant.message", data: { content: "same" } },
        );
        const first = watcher.normalizeEvents(request, updates);
        const replay = watcher.normalizeEvents(
            request,
            structuredClone(updates),
        );
        expect(replay).toEqual(first);
        expect(first.events.map((event) => event.id)).toEqual(
            updates.records.map((record) => record.id),
        );
        expect(first.events[0]!.id).not.toBe(first.events[1]!.id);
        for (const event of first.events)
            expect(event).not.toHaveProperty("sourceEventId");
    },
);

test("keeps starts and completions associated without same-batch state", () => {
    const start = normalize({
        id: "start",
        type: "tool.execution_start",
        model: "model-a",
        data: {
            toolCallId: "call-exact",
            toolName: "apply_patch",
            arguments: { patch: "synthetic patch" },
        },
    }).events[0];
    const complete = normalize({
        id: "complete",
        type: "tool.execution_complete",
        data: {
            toolCallId: "call-exact",
            success: true,
            result: { content: "Patched example.ts", detailedContent: diff },
        },
    }).events[0];
    expect(start).toMatchObject({
        type: "tool-start",
        toolCallId: "call-exact",
        toolName: "apply_patch",
        model: "model-a",
        arguments: { patch: "synthetic patch" },
    });
    expect(complete).toMatchObject({
        type: "tool-complete",
        toolCallId: "call-exact",
        success: true,
        output: "Patched example.ts",
        detailedContent: diff,
    });
    expect(complete).not.toHaveProperty("diff");
    const sameBatch = normalize(
        {
            type: "tool.execution_start",
            data: { toolCallId: "call-exact", toolName: "apply_patch" },
        },
        {
            type: "tool.execution_complete",
            data: {
                toolCallId: "call-exact",
                success: false,
                result: { detailedContent: diff },
            },
        },
    ).events;
    expect(sameBatch[1]).toMatchObject({
        toolCallId: "call-exact",
        success: false,
        detailedContent: diff,
    });
    expect(sameBatch[1]).not.toHaveProperty("diff");
});

test.each([
    { content: "ran command" },
    { content: "", detailedContent: "Script succeeded; no diff supplied." },
    { detailedContent: { log: "ran tests", files: ["example.ts"] } },
    {
        detailedContent: {
            diff: { original: "old", modified: "new" },
            log: "structured result",
        },
    },
    { detailedContent: ["part one", "part two"] },
    { detailedContent: "Example patch:\n" + diff },
    { detailedContent: "--- not a patch\n+++ merely labels\n" },
    { detailedContent: diff },
    { detailedContent: diff.replace(/\n/g, "\r\n") },
    { detailedContent: diff.slice(diff.indexOf("--- ")) },
])(
    "preserves script output/detail without manufacturing diffs: %j",
    (result) => {
        const event = normalize({
            type: "tool.execution_complete",
            data: { toolCallId: "script", success: true, result },
        }).events[0];
        expect(event).not.toHaveProperty("diff");
        if ("content" in result)
            expect(event).toHaveProperty("output", result.content);
        if ("detailedContent" in result)
            expect(event).toHaveProperty(
                "detailedContent",
                result.detailedContent,
            );
    },
);

test.each([
    { diff, detailedContent: "Additional UI detail" },
    { detailedContent: { diff, warnings: ["synthetic warning"] } },
])("preserves explicit diff evidence: %j", (result) => {
    const event = normalize({
        type: "tool.execution_complete",
        data: { toolCallId: "patch", success: true, result },
    }).events[0];
    expect(event).toHaveProperty("diff", diff);
    expect(event).toHaveProperty("detailedContent", result.detailedContent);
});

test("missing optional fields remain absent and failed tools retain error details", () => {
    const batch = normalize(
        { type: "user.message", data: { content: "" } },
        {
            type: "tool.execution_start",
            data: { toolCallId: "", toolName: "powershell" },
        },
        {
            type: "tool.execution_complete",
            data: {
                toolCallId: "",
                success: false,
                error: { message: "synthetic failure", code: "FAILED" },
            },
        },
    );
    expect(batch.diagnostics).toEqual([]);
    expect(batch.events[0]).not.toHaveProperty("timestamp");
    expect(batch.events[0]).not.toHaveProperty("model");
    expect(batch.events[2]).toMatchObject({
        success: false,
        error: { message: "synthetic failure", code: "FAILED" },
    });
    expect(batch.events[2]).not.toHaveProperty("output");
    expect(batch.events[2]).not.toHaveProperty("diff");
});

test.each([
    "session.start",
    "session.resume",
    "session.info",
    "session.warning",
    "session.error",
    "session.idle",
    "session.shutdown",
    "session.context_changed",
    "session.title_changed",
    "session.task_complete",
    "session.handoff",
    "session.truncation",
    "session.compaction_complete",
    "assistant.usage",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
])("retains %s session details without semantic extraction", (type) => {
    expect(
        normalize({
            type,
            data: { model: "model-b", context: { cwd: "synthetic" } },
        }).events[0],
    ).toMatchObject({
        type: "session",
        eventType: type,
        model: "model-b",
        details: { model: "model-b" },
    });
});

test.each([
    "assistant.message_delta",
    "assistant.message_start",
    "assistant.reasoning_delta",
    "assistant.streaming_delta",
    "assistant.tool_call_delta",
    "assistant.turn_start",
    "assistant.turn_end",
    "assistant.idle",
    "tool.execution_partial_result",
    "tool.execution_progress",
])("explicitly ignores %s, but observes its timestamp", (type) => {
    const batch = normalize({
        type,
        timestamp: "2026-10-02T12:00:00Z",
        data: {},
    });
    expect(batch.events).toEqual([]);
    expect(batch.diagnostics).toEqual([]);
    expect(batch.lastEventTimestamp).toBe("2026-10-02T12:00:00Z");
});

test("unknown future records report disposition without blocking useful messages", () => {
    const batch = normalize(
        { type: "future.SECRET", data: { secret: "DO NOT LEAK" } },
        { type: "user.message", data: { content: "keep this" } },
    );
    expect(batch.events).toHaveLength(1);
    expect(batch.diagnostics).toEqual([
        { code: "unsupported-event", source: captured({}).records[0]!.source },
    ]);
    expect(JSON.stringify(batch.diagnostics)).not.toMatch(/SECRET|DO NOT LEAK/);
});

test.each([
    null,
    [],
    3,
    {},
    { type: "user.message", data: null },
    { type: "assistant.message", data: { content: 7 } },
    { type: "system.message", data: {} },
    { type: "user.message", timestamp: "SECRET", data: { content: "hidden" } },
    { type: "user.message", timestamp: 123, data: { content: "hidden" } },
    { type: "user.message", data: { content: "hidden", model: [] } },
    { type: "tool.execution_start", data: { toolName: "tool" } },
    { type: "tool.execution_start", data: { toolCallId: "call", toolName: 1 } },
    {
        type: "tool.execution_complete",
        data: { toolCallId: "call", success: "yes" },
    },
    { type: "tool.execution_complete", data: { toolCallId: 1, success: true } },
    {
        type: "tool.execution_complete",
        data: { toolCallId: "call", success: true, result: "hidden" },
    },
    {
        type: "tool.execution_complete",
        data: { toolCallId: "call", success: true, result: { content: 9 } },
    },
    { type: "session.start", data: { startTime: "SECRET" } },
    { type: "session.resume", data: { selectedModel: [] } },
    { type: "session.model_change", data: {} },
])("malformed known record reports source-only diagnostic: %j", (payload) => {
    const batch = normalize(payload);
    expect(batch.events).toEqual([]);
    expect(batch.diagnostics).toEqual([
        { code: "malformed-event", source: captured({}).records[0]!.source },
    ]);
    expect(JSON.stringify(batch.diagnostics)).not.toMatch(/SECRET|hidden/);
});

test("capture diagnostics propagate and normalization does not mutate envelopes", () => {
    const updates = captured({
        type: "tool.execution_complete",
        data: {
            toolCallId: "call",
            success: true,
            result: { detailedContent: { log: "original" } },
        },
    });
    updates.diagnostics.push({
        code: "invalid-json",
        source: updates.records[0]!.source,
    });
    const before = structuredClone(updates);
    const batch = watcher.normalizeEvents(request, updates);
    expect(batch.diagnostics).toEqual(updates.diagnostics);
    const event = batch.events[0];
    if (event?.type !== "tool-complete")
        throw new Error("Expected tool completion");
    event.detailedContent = "changed";
    expect(updates).toEqual(before);
});

test.each(["session", "path", "generation", "id"] as const)(
    "rejects mixed capture envelope %s",
    (field) => {
        const updates = captured({
            id: "native",
            type: "user.message",
            data: { content: "" },
        });
        const record = updates.records[0]!;
        if (field === "session") record.source.sessionId = "another-session";
        if (field === "path")
            record.source.transcriptPath = path.resolve("another.jsonl");
        if (field === "generation")
            record.source.generation = "another-generation";
        if (field === "id") record.id = "another-id";
        expect(() => watcher.normalizeEvents(request, updates)).toThrow(
            field === "id"
                ? "Captured event ID does not match native ID"
                : field === "generation"
                  ? "Session batch contains mixed generations"
                  : "Session source does not match registration",
        );
    },
);
