// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import {
    SessionWatcher,
    type CapturedSessionUpdates,
    type SessionWatchRequest,
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
        diff,
        detailedContent: diff,
    });
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
        diff,
    });
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
    { detailedContent: diff.replace(/\n/g, "\r\n") },
    { detailedContent: diff.slice(diff.indexOf("--- ")) },
])("preserves explicit and supported unified diff evidence: %j", (result) => {
    const event = normalize({
        type: "tool.execution_complete",
        data: { toolCallId: "patch", success: true, result },
    }).events[0];
    expect(event).toHaveProperty("diff");
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
        details: { model: "model-b", context: { cwd: "synthetic" } },
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
