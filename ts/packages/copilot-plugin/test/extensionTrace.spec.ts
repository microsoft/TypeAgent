// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { induceMacroFromTrace } from "@typeagent/copilot-macros";
import { ExtensionTraceAssembler } from "../src/extension/trace-assembler.js";

function event(
    type: string,
    timestamp: string,
    data: Record<string, unknown>,
    agentId?: string,
) {
    return { type, timestamp, data, ...(agentId ? { agentId } : {}) };
}

describe("extension trace assembler", () => {
    it.each([
        [
            '{"answer":{"value":"public","apiKey":"secret"}}',
            {
                answer: { value: "public", apiKey: "[REDACTED]" },
            },
        ],
        ["null", null],
        ["false", false],
        ["0", 0],
        ['""', ""],
        ["", ""],
        ["plain text", "plain text"],
        ['{"truncated":', '{"truncated":'],
    ])(
        "captures model-facing content %s without UI-only fields",
        (content, expected) => {
            const assembler = new ExtensionTraceAssembler("session-1", ".");
            assembler.record(
                event("user.message", "2026-09-29T08:00:00.000Z", {
                    content: "Read the result",
                }),
            );
            assembler.record(
                event("tool.execution_start", "2026-09-29T08:00:01.000Z", {
                    toolCallId: "call-1",
                    toolName: "web_search",
                    mcpServerName: "github-mcp-server",
                }),
            );
            assembler.record(
                event("tool.execution_complete", "2026-09-29T08:00:02.000Z", {
                    toolCallId: "call-1",
                    success: true,
                    result: {
                        content,
                        detailedContent: "UI detail",
                        contents: [],
                    },
                }),
            );
            const call = assembler.finish()?.toolCalls[0];
            expect(call?.modelResult).toEqual(expected);
            expect(call?.result).toMatchObject({
                detailedContent: "UI detail",
                contents: [],
            });
        },
    );

    it("does not manufacture model-facing evidence when content is absent", () => {
        const assembler = new ExtensionTraceAssembler("session-1", ".");
        assembler.record(
            event("user.message", "2026-09-29T08:00:00.000Z", {
                content: "Read",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-29T08:00:01.000Z", {
                toolCallId: "call-1",
                toolName: "read",
            }),
        );
        assembler.record(
            event("tool.execution_complete", "2026-09-29T08:00:02.000Z", {
                toolCallId: "call-1",
                success: true,
                result: { detailedContent: '{"notVisible":true}' },
            }),
        );
        expect(assembler.finish()?.toolCalls[0]).not.toHaveProperty(
            "modelResult",
        );
    });

    it.each([
        ["web_search", "github-mcp-server", "web_search"],
        ["sample-fetch_data", "sample", "fetch_data"],
    ])(
        "preserves callable %s separately from MCP provenance through induction",
        async (toolName, mcpServerName, mcpToolName) => {
            const assembler = new ExtensionTraceAssembler("session-1", ".");
            assembler.record(
                event("user.message", "2026-09-29T08:00:00.000Z", {
                    content: "Run the benign fixture",
                }),
            );
            assembler.record(
                event("tool.execution_start", "2026-09-29T08:00:01.000Z", {
                    toolCallId: "call-1",
                    toolName,
                    mcpServerName,
                    mcpToolName,
                    arguments: { query: "IANA example domains" },
                }),
            );
            assembler.record(
                event("tool.execution_complete", "2026-09-29T08:00:02.000Z", {
                    toolCallId: "call-1",
                    success: true,
                    result: { content: "Reserved for documentation" },
                }),
            );
            const trace = assembler.finish();
            expect(trace?.toolCalls[0]).toMatchObject({
                name: toolName,
                mcpServerName,
            });
            if (!trace) throw new Error("Expected completed capture");
            const macro = await induceMacroFromTrace(
                "trace-1",
                trace,
                "macro-1",
                "Callable identity fixture",
                "",
                "2026-09-29T08:00:03.000Z",
            );
            expect(macro.steps[0]).toMatchObject({
                toolName,
                mcpServerName,
                executionClass: "agentRequired",
                arguments: {
                    kind: "literal",
                    value: { query: "IANA example domains" },
                },
            });
        },
    );

    it("builds a redacted trace from live session events", () => {
        const assembler = new ExtensionTraceAssembler("session-1", "C:\\repo");
        assembler.record(
            event("user.message", "2026-09-18T10:00:00.000Z", {
                content: "Fetch data with token=prompt-secret",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-18T10:00:01.000Z", {
                toolCallId: "call-1",
                toolName: "fetch_data",
                mcpServerName: "sample",
                arguments: { apiKey: "argument-secret", query: "public" },
            }),
        );
        assembler.record(
            event("tool.execution_complete", "2026-09-18T10:00:02.000Z", {
                toolCallId: "call-1",
                success: true,
                result: { authorization: "result-secret", ok: true },
            }),
        );
        assembler.record(
            event("assistant.message", "2026-09-18T10:00:03.000Z", {
                content: "Done",
            }),
        );

        expect(
            assembler.finish(
                createHash("sha256")
                    .update("Fetch data with [REDACTED]")
                    .digest("hex"),
            ),
        ).toEqual({
            schemaVersion: 1,
            sessionId: "session-1",
            cwd: "C:\\repo",
            prompt: "Fetch data with [REDACTED]",
            response: "Done",
            startedAt: "2026-09-18T10:00:00.000Z",
            completedAt: "2026-09-18T10:00:03.000Z",
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

    it("preserves parallel call order and terminal failure outcomes", () => {
        const assembler = new ExtensionTraceAssembler("session-1", ".");
        assembler.record(
            event("user.message", "2026-09-18T10:00:00.000Z", {
                content: "Run both",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-18T10:00:01.000Z", {
                toolCallId: "first",
                toolName: "first_tool",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-18T10:00:01.100Z", {
                toolCallId: "second",
                toolName: "second_tool",
            }),
        );
        assembler.record(
            event("tool.execution_complete", "2026-09-18T10:00:02.000Z", {
                toolCallId: "second",
                success: true,
                result: "ok",
            }),
        );
        assembler.record(
            event("tool.execution_complete", "2026-09-18T10:00:03.000Z", {
                toolCallId: "first",
                success: false,
                error: { message: "failed" },
            }),
        );

        expect(
            assembler.finish()?.toolCalls.map(({ toolCallId, status }) => ({
                toolCallId,
                status,
            })),
        ).toEqual([
            { toolCallId: "first", status: "failed" },
            { toolCallId: "second", status: "completed" },
        ]);
    });

    it("records a typed permission denial as a terminal outcome", () => {
        const assembler = new ExtensionTraceAssembler("session-1", ".");
        assembler.record(
            event("user.message", "2026-09-18T10:00:00.000Z", {
                content: "Delete it",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-18T10:00:01.000Z", {
                toolCallId: "call-1",
                toolName: "delete_file",
            }),
        );
        assembler.record(
            event("permission.completed", "2026-09-18T10:00:02.000Z", {
                toolCallId: "call-1",
                result: {
                    kind: "denied-interactively-by-user",
                    message: "Not now",
                },
            }),
        );

        expect(assembler.finish()?.toolCalls[0]).toMatchObject({
            status: "denied",
            result: {
                kind: "denied-interactively-by-user",
                message: "Not now",
            },
        });
    });

    it("does not finish an aborted or incomplete turn", () => {
        const assembler = new ExtensionTraceAssembler("session-1", ".");
        assembler.record(
            event("user.message", "2026-09-18T10:00:00.000Z", {
                content: "Start work",
            }),
        );
        assembler.record(
            event("tool.execution_start", "2026-09-18T10:00:01.000Z", {
                toolCallId: "call-1",
                toolName: "unfinished_tool",
            }),
        );

        expect(assembler.finish()).toBeUndefined();
        expect(assembler.finish(undefined, true)).toBeUndefined();
    });

    it("ignores subagent messages while retaining subagent tool calls", () => {
        const assembler = new ExtensionTraceAssembler("session-1", ".");
        assembler.record(
            event("user.message", "2026-09-18T10:00:00.000Z", {
                content: "Delegate this",
            }),
        );
        assembler.record(
            event(
                "tool.execution_start",
                "2026-09-18T10:00:01.000Z",
                { toolCallId: "child-call", toolName: "read_file" },
                "agent-1",
            ),
        );
        assembler.record(
            event(
                "tool.execution_complete",
                "2026-09-18T10:00:02.000Z",
                {
                    toolCallId: "child-call",
                    success: true,
                    result: "child result",
                },
                "agent-1",
            ),
        );
        assembler.record(
            event(
                "assistant.message",
                "2026-09-18T10:00:03.000Z",
                { content: "child response" },
                "agent-1",
            ),
        );
        assembler.record(
            event("assistant.message", "2026-09-18T10:00:04.000Z", {
                content: "root response",
            }),
        );

        const trace = assembler.finish();
        expect(trace?.response).toBe("root response");
        expect(trace?.toolCalls).toHaveLength(1);
    });
});
