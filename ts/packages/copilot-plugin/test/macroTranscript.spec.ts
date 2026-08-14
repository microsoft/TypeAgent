import {
    normalizeRecordedInteraction,
    redactTraceValue,
} from "../src/hooks/macro-transcript.js";
import { createHash } from "node:crypto";

function transcript(events: unknown[]): string {
    return events.map((event) => JSON.stringify(event)).join("\n");
}

describe("macro transcript normalization", () => {
    it("pairs tool calls and redacts arguments and results", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "Fetch data with token=prompt-secret" },
                },
                {
                    type: "tool.execution_start",
                    timestamp: "2026-08-14T10:00:01.000Z",
                    data: {
                        toolCallId: "call-1",
                        toolName: "fetch_data",
                        mcpServerName: "sample",
                        arguments: {
                            apiKey: "argument-secret",
                            query: "public",
                        },
                    },
                },
                {
                    type: "tool.execution_complete",
                    timestamp: "2026-08-14T10:00:02.000Z",
                    data: {
                        toolCallId: "call-1",
                        success: true,
                        result: { authorization: "result-secret", ok: true },
                    },
                },
                {
                    type: "assistant.message",
                    timestamp: "2026-08-14T10:00:03.000Z",
                    data: { content: "Done" },
                },
            ]),
            "session-1",
            "C:\\repo",
            createHash("sha256")
                .update("Fetch data with token=prompt-secret")
                .digest("hex"),
        );

        expect(trace).toEqual({
            schemaVersion: 1,
            sessionId: "session-1",
            cwd: "C:\\repo",
            prompt: "Fetch data with [REDACTED]",
            response: "Done",
            startedAt: "2026-08-14T10:00:00.000Z",
            completedAt: "2026-08-14T10:00:03.000Z",
            toolCalls: [
                {
                    toolCallId: "call-1",
                    name: "fetch_data",
                    mcpServerName: "sample",
                    arguments: { apiKey: "[REDACTED]", query: "public" },
                    result: { authorization: "[REDACTED]", ok: true },
                    status: "completed",
                },
            ],
        });
    });

    it("rejects a turn with an incomplete tool call", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "Fetch data" },
                },
                {
                    type: "tool.execution_start",
                    timestamp: "2026-08-14T10:00:01.000Z",
                    data: {
                        toolCallId: "call-1",
                        toolName: "fetch_data",
                    },
                },
            ]),
            "session-1",
            ".",
        );

        expect(trace).toBeUndefined();
    });

    it("rejects an aborted turn with no assistant event", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "Start work" },
                },
            ]),
            "session-1",
            ".",
        );

        expect(trace).toBeUndefined();
    });

    it("selects only the turn matching the claimed prompt", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "record this" },
                },
                {
                    type: "assistant.message",
                    timestamp: "2026-08-14T10:00:01.000Z",
                    data: { content: "recorded" },
                },
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:01:00.000Z",
                    data: { content: "unrelated later turn" },
                },
                {
                    type: "assistant.message",
                    timestamp: "2026-08-14T10:01:01.000Z",
                    data: { content: "unrelated" },
                },
            ]),
            "session-1",
            ".",
            createHash("sha256").update("record this").digest("hex"),
        );

        expect(trace?.prompt).toBe("record this");
        expect(trace?.response).toBe("recorded");
    });

    it("redacts nested secret keys without changing public values", () => {
        expect(
            redactTraceValue({ nested: [{ password: "secret", value: 3 }] }),
        ).toEqual({ nested: [{ password: "[REDACTED]", value: 3 }] });
    });

    it("preserves parallel call order and failed outcomes", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "Run both" },
                },
                {
                    type: "tool.execution_start",
                    timestamp: "2026-08-14T10:00:01.000Z",
                    data: { toolCallId: "first", toolName: "first_tool" },
                },
                {
                    type: "tool.execution_start",
                    timestamp: "2026-08-14T10:00:01.100Z",
                    data: { toolCallId: "second", toolName: "second_tool" },
                },
                {
                    type: "tool.execution_complete",
                    timestamp: "2026-08-14T10:00:02.000Z",
                    data: {
                        toolCallId: "second",
                        success: true,
                        result: "ok",
                    },
                },
                {
                    type: "tool.execution_complete",
                    timestamp: "2026-08-14T10:00:03.000Z",
                    data: {
                        toolCallId: "first",
                        success: false,
                        error: { message: "failed" },
                    },
                },
            ]),
            "session-1",
            ".",
        );

        expect(
            trace?.toolCalls.map(({ toolCallId, status }) => ({
                toolCallId,
                status,
            })),
        ).toEqual([
            { toolCallId: "first", status: "failed" },
            { toolCallId: "second", status: "completed" },
        ]);
    });

    it("records permission denial as a complete outcome", () => {
        const trace = normalizeRecordedInteraction(
            transcript([
                {
                    type: "user.message",
                    timestamp: "2026-08-14T10:00:00.000Z",
                    data: { content: "Delete it" },
                },
                {
                    type: "tool.execution_start",
                    timestamp: "2026-08-14T10:00:01.000Z",
                    data: { toolCallId: "call-1", toolName: "delete_file" },
                },
                {
                    type: "permission.completed",
                    timestamp: "2026-08-14T10:00:02.000Z",
                    data: {
                        toolCallId: "call-1",
                        result: "denied-interactively-by-user",
                    },
                },
            ]),
            "session-1",
            ".",
        );

        expect(trace?.toolCalls[0]).toMatchObject({
            status: "denied",
            result: "denied-interactively-by-user",
        });
    });

    it("redacts standalone GitHub tokens", () => {
        expect(redactTraceValue("credential ghp_1234567890abcdef")).toBe(
            "credential [REDACTED]",
        );
    });
});
