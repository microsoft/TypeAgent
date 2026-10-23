// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExtensionTraceAssembler,
    type ExtensionSessionEvent,
} from "../src/extension/trace-assembler.js";

describe("selected task success boundary for Copilot authoring", () => {
    const now = new Date().toISOString();
    function collect(extra: Partial<ExtensionSessionEvent>[] = []) {
        const assembler = new ExtensionTraceAssembler(
            "session",
            "D:\\workspace",
        );
        assembler.record({
            id: "user",
            type: "user.message",
            timestamp: now,
            data: { content: "read file alpha for me" },
        });
        assembler.record({
            id: "start",
            type: "tool.execution_start",
            timestamp: now,
            data: {
                toolCallId: "read",
                toolName: "read",
                arguments: { path: "alpha" },
            },
        });
        assembler.record({
            id: "complete",
            type: "tool.execution_complete",
            timestamp: now,
            data: {
                toolCallId: "read",
                success: true,
                result: { content: "fresh" },
            },
        });
        for (const event of extra)
            assembler.record({
                id: "extra",
                type: "session.idle",
                timestamp: now,
                data: {},
                ...event,
            });
        return assembler;
    }
    function receipt(
        assembler: ExtensionTraceAssembler,
        agentId?: string,
        promptHash = assembler.getPromptHash(),
    ) {
        const scope = agentId ? { agentId } : {};
        assembler.record({
            ...scope,
            id: "receipt-start",
            type: "tool.execution_start",
            timestamp: now,
            data: {
                toolCallId: "receipt",
                toolName: "typeagent_recorded_task_succeeded",
                arguments: { summary: "read succeeded" },
            },
        });
        assembler.record({
            ...scope,
            id: "receipt",
            type: "tool.execution_complete",
            timestamp: now,
            data: {
                toolCallId: "receipt",
                success: true,
                result: {
                    content: JSON.stringify({
                        status: "succeeded",
                        recordingTokenId: "token",
                        promptHash,
                    }),
                },
            },
        });
    }
    it("requires a root final answer and completed root turn, not idle or a successful tool alone", () => {
        const assembler = collect([{ type: "session.idle" }]);
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
        assembler.record({
            id: "final",
            type: "assistant.message",
            timestamp: now,
            data: { content: "fresh contents" },
        });
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
        assembler.record({
            id: "end",
            type: "assistant.turn_end",
            timestamp: now,
            data: {},
        });
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
        receipt(assembler);
        assembler.record({
            id: "final",
            type: "assistant.message",
            timestamp: now,
            data: { content: "fresh contents" },
        });
        assembler.record({
            id: "end",
            type: "assistant.turn_end",
            timestamp: now,
            data: {},
        });
        expect(assembler.getChildAuthoringCapture()).toEqual({
            taskId: "session:user",
            firstEventId: "user",
            successEventId: "receipt",
            outputEventId: "final",
            recordingTokenId: "token",
        });
    });
    it.each(["child", "stale"])("rejects %s success receipts", (kind) => {
        const assembler = collect();
        receipt(
            assembler,
            kind === "child" ? "author" : undefined,
            kind === "stale" ? "another-task" : assembler.getPromptHash(),
        );
        assembler.record({
            id: "final",
            type: "assistant.message",
            timestamp: now,
            data: { content: "fresh" },
        });
        assembler.record({
            id: "end",
            type: "assistant.turn_end",
            timestamp: now,
            data: {},
        });
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
    });
    it.each(["abort", "session.error"])(
        "rejects an original task with %s evidence",
        (type) => {
            const assembler = collect([
                {
                    id: "final",
                    type: "assistant.message",
                    data: { content: "partial" },
                },
                { type: "assistant.turn_end" },
                { type },
            ]);
            expect(assembler.getChildAuthoringCapture()).toBeUndefined();
            expect(assembler.finish()).toBeUndefined();
        },
    );
    it("cannot use a child's answer, completion or idle as original-task success", () => {
        const assembler = collect([
            {
                type: "assistant.message",
                agentId: "author",
                data: { content: "candidate" },
            },
            { type: "assistant.turn_end", agentId: "author" },
            { type: "session.idle", agentId: "author" },
        ]);
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
    });
    it("invalidates an intermediate answer when later tools start", () => {
        const assembler = collect([
            {
                id: "intermediate",
                type: "assistant.message",
                data: { content: "I will do more" },
            },
            { type: "assistant.turn_end" },
            {
                type: "tool.execution_start",
                data: { toolCallId: "second", toolName: "read", arguments: {} },
            },
            {
                type: "tool.execution_complete",
                data: { toolCallId: "second", success: true, result: {} },
            },
            { type: "session.idle" },
        ]);
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
    });
    it("rejects denied/incomplete business calls even if an answer appears", () => {
        const assembler = collect([
            {
                type: "tool.execution_start",
                data: { toolCallId: "denied", toolName: "read", arguments: {} },
            },
            {
                type: "tool.execution_complete",
                data: { toolCallId: "denied", success: false, result: {} },
            },
            {
                id: "final",
                type: "assistant.message",
                data: { content: "Could not finish" },
            },
            { type: "assistant.turn_end" },
        ]);
        expect(assembler.getChildAuthoringCapture()).toBeUndefined();
    });
});
