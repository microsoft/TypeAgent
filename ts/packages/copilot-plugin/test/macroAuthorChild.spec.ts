// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { SessionEvent } from "@github/copilot-sdk";
import { readFile } from "node:fs/promises";
import {
    launchMacroAuthorChild,
    macroAuthorChildAgent,
    createMacroAuthorChildLauncher,
    type MacroAuthorChildSession,
} from "../src/extension/macro-author-child.js";

function nativeEvent(
    type: string,
    data: Record<string, unknown>,
    agentId?: string,
): SessionEvent {
    return {
        type,
        data,
        agentId,
        id: `${type}-event`,
        parentId: null,
        timestamp: new Date().toISOString(),
    } as unknown as SessionEvent;
}

function fixture() {
    let handler: (event: SessionEvent) => void = () => {};
    let callId = "";
    const off = jest.fn();
    const child = {
        type: "agent",
        id: "child-1",
        toolCallId: "",
        agentType: "typeagent-macro-author",
        executionMode: "sync",
        prompt: "supplied bounded context",
        status: "idle",
        latestResponse: "candidate",
    };
    const emit = (
        type: string,
        data: Record<string, unknown>,
        agentId = "child-1",
    ) => handler(nativeEvent(type, data, agentId));
    const started = () => {
        emit("subagent.started", {
            toolCallId: callId,
            agentName: "typeagent-macro-author",
            executionMode: "sync",
        });
        emit("subagent.selected", { tools: [] });
    };
    const completed = () =>
        emit("subagent.completed", {
            toolCallId: callId,
            totalToolCalls: 0,
        });
    const profile = {
        name: "typeagent-macro-author",
        id: "typeagent-macro-author",
        tools: [] as string[],
    };
    const profiles = jest.fn(async () => ({ agents: [profile] }));
    const list = jest.fn(async () => ({ tasks: [child] }));
    const cancel = jest.fn(async (_input: { id: string }) => ({
        cancelled: true,
    }));
    let invoke = async () => {
        started();
        completed();
        return { resultType: "success", textResultForLlm: "candidate" };
    };
    const execute = jest.fn(
        async (input: {
            name: string;
            toolCallId: string;
            arguments: Record<string, unknown>;
        }) => {
            callId = input.toolCallId;
            child.toolCallId = callId;
            return invoke();
        },
    );
    const session = {
        sessionId: "root",
        on: (callback: (event: SessionEvent) => void) => {
            handler = callback;
            return off;
        },
        rpc: {
            agent: { list: profiles },
            tools: { execute },
            tasks: { list, cancel },
        },
    } as unknown as MacroAuthorChildSession;
    return {
        session,
        execute,
        list,
        cancel,
        profiles,
        profile,
        child,
        started,
        completed,
        emit,
        off,
        invoke: (action: typeof invoke) => {
            invoke = action;
        },
    };
}

describe("bounded native author child", () => {
    it("keeps the explicit SDK profile equivalent to the native CLI profile", async () => {
        const source = await readFile(
            new URL(
                "../../agents/typeagent-macro-author.agent.md",
                import.meta.url,
            ),
            "utf8",
        );
        expect(source).toContain("tools: []");
        expect(source.split("---").slice(2).join("---").trim()).toBe(
            macroAuthorChildAgent.prompt,
        );
        expect(macroAuthorChildAgent.tools).toEqual([]);
        expect(macroAuthorChildAgent.infer).toBe(false);
        expect(macroAuthorChildAgent.model).toBeUndefined();
    });

    it("exposes the parent's prompt/signal launcher contract", async () => {
        const f = fixture();
        await expect(
            createMacroAuthorChildLauncher(f.session)(f.child.prompt),
        ).resolves.toMatchObject({ text: "candidate", childId: "child-1" });
    });

    it("filters exact author task and child events even before the internal start listener runs", async () => {
        const f = fixture();
        const launch = createMacroAuthorChildLauncher(f.session);
        f.invoke(async () => {
            const toolCallId = f.child.toolCallId;
            expect(
                launch.isAuthoringEvent(
                    nativeEvent("tool.execution_start", {
                        toolCallId,
                        toolName: "task",
                    }),
                ),
            ).toBe(true);
            expect(
                launch.isAuthoringEvent(
                    nativeEvent("subagent.started", { toolCallId }, "child-1"),
                ),
            ).toBe(true);
            expect(
                launch.isAuthoringEvent(
                    nativeEvent(
                        "assistant.message",
                        { content: "candidate" },
                        "child-1",
                    ),
                ),
            ).toBe(true);
            expect(
                launch.isAuthoringEvent(
                    nativeEvent(
                        "session.task_complete",
                        { success: true },
                        "child-1",
                    ),
                ),
            ).toBe(true);
            f.started();
            f.completed();
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await launch(f.child.prompt);
        expect(
            launch.isAuthoringEvent(
                nativeEvent("tool.execution_complete", {
                    toolCallId: f.child.toolCallId,
                }),
            ),
        ).toBe(true);
        expect(
            launch.isAuthoringEvent(
                nativeEvent(
                    "subagent.completed",
                    { cancelled: true },
                    "child-1",
                ),
            ),
        ).toBe(true);
    });

    it("never hides unrelated new root work while an author child is cancelling", async () => {
        const f = fixture();
        const launch = createMacroAuthorChildLauncher(f.session);
        const controller = new AbortController();
        f.invoke(async () => {
            f.started();
            controller.abort();
            for (const event of [
                nativeEvent("user.message", { content: "New user task" }),
                nativeEvent("assistant.message", { content: "New answer" }),
                nativeEvent("session.task_complete", { success: true }),
                nativeEvent("session.idle", {}),
                nativeEvent("abort", {}),
                nativeEvent("tool.execution_start", {
                    toolCallId: "other-task",
                    toolName: "task",
                }),
                nativeEvent("tool.execution_complete", {
                    toolCallId: "new-receipt",
                    toolName: "typeagent_recorded_task_succeeded",
                }),
                nativeEvent(
                    "subagent.started",
                    {
                        toolCallId: "unrelated",
                        agentName: "typeagent-macro-author",
                    },
                    "other-child",
                ),
                nativeEvent(
                    "assistant.message",
                    { content: "other" },
                    "other-child",
                ),
            ]) {
                expect(launch.isAuthoringEvent(event)).toBe(false);
            }
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await expect(
            launch(f.child.prompt, controller.signal),
        ).rejects.toMatchObject({
            code: "cancelled",
        });
        expect(
            launch.isAuthoringEvent(
                nativeEvent(
                    "subagent.completed",
                    { cancelled: true },
                    "child-1",
                ),
            ),
        ).toBe(true);
        expect(
            launch.isAuthoringEvent(
                nativeEvent("user.message", { content: "Another new task" }),
            ),
        ).toBe(false);
    });

    it("retains exact identities for a child which starts after caller cancellation", async () => {
        const f = fixture();
        const launch = createMacroAuthorChildLauncher(f.session);
        const controller = new AbortController();
        let finish: () => void = () => {};
        f.invoke(
            () =>
                new Promise((resolve) => {
                    finish = () => {
                        f.started();
                        resolve({
                            resultType: "success",
                            textResultForLlm: "candidate",
                        });
                    };
                    controller.abort();
                }),
        );
        await expect(
            launch(f.child.prompt, controller.signal),
        ).rejects.toMatchObject({
            code: "cancelled",
        });
        finish();
        await Promise.resolve();
        expect(
            launch.isAuthoringEvent(
                nativeEvent(
                    "session.task_complete",
                    { success: true },
                    "child-1",
                ),
            ),
        ).toBe(true);
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
    });

    it("returns only the exact sync child's native result and retires its context", async () => {
        const f = fixture();
        const result = await launchMacroAuthorChild(f.session, f.child.prompt);
        expect(result).toEqual({
            text: "candidate",
            childId: "child-1",
            toolCallId: f.child.toolCallId,
            parentSessionId: "root",
            startedEventId: "subagent.started-event",
            completedEventId: "subagent.completed-event",
        });
        expect(f.execute).toHaveBeenCalledWith({
            name: "task",
            toolCallId: result.toolCallId,
            arguments: {
                agent_type: "typeagent-macro-author",
                name: "typeagent-macro-author",
                description: "Bounded TypeAgent candidate author",
                prompt: f.child.prompt,
                mode: "sync",
            },
        });
        expect(f.cancel).toHaveBeenCalledTimes(1);
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
        expect(f.off).toHaveBeenCalledTimes(1);
    });

    it.each(["", " ", "x".repeat(65_537)])(
        "rejects empty or oversized context",
        async (context) => {
            const f = fixture();
            await expect(
                launchMacroAuthorChild(f.session, context),
            ).rejects.toMatchObject({ code: "invalid-context" });
            expect(f.execute).not.toHaveBeenCalled();
        },
    );

    it("rejects inherited/all tools rather than falling back to a parent launch", async () => {
        const f = fixture();
        f.profile.tools.push("task");
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({ code: "unsupported-host" });
        expect(f.execute).not.toHaveBeenCalled();
    });

    it.each([
        { tools: undefined },
        { model: "pinned-model" },
        { models: ["pinned-model"] },
        { skills: ["ambient"] },
        { mcpServers: { business: {} } },
    ])(
        "rejects ambient privileges or model overrides: %j",
        async (override) => {
            const f = fixture();
            Object.assign(f.profile, override);
            await expect(
                launchMacroAuthorChild(f.session, f.child.prompt),
            ).rejects.toMatchObject({ code: "unsupported-host" });
            expect(f.execute).not.toHaveBeenCalled();
        },
    );

    it("never treats the parent session identifier as a cancellable child", async () => {
        const f = fixture();
        f.invoke(async () => {
            f.started();
            f.emit(
                "subagent.started",
                {
                    toolCallId: f.child.toolCallId,
                    agentName: "typeagent-macro-author",
                    executionMode: "sync",
                },
                "root",
            );
            f.completed();
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({ code: "uncorrelated-result" });
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
        expect(f.cancel).not.toHaveBeenCalledWith({ id: "root" });
    });

    it("rejects unsupported lifecycle explicitly", async () => {
        await expect(
            launchMacroAuthorChild(
                { sessionId: "root" } as MacroAuthorChildSession,
                "context",
            ),
        ).rejects.toMatchObject({ code: "unsupported-host" });
    });

    it.each([
        "wrong-prompt",
        "wrong-text",
        "wrong-child",
        "tools-enabled",
        "nested-tool",
    ])("rejects uncorrelated or unrestricted evidence: %s", async (kind) => {
        const f = fixture();
        f.invoke(async () => {
            f.started();
            f.completed();
            if (kind === "wrong-prompt") f.child.prompt = "other context";
            if (kind === "wrong-text") f.child.latestResponse = "parent text";
            if (kind === "wrong-child") f.child.id = "other-child";
            if (kind === "tools-enabled") {
                f.emit("subagent.selected", { tools: ["task"] });
            }
            if (kind === "nested-tool") {
                f.emit("tool.execution_start", { toolName: "task" });
            }
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({ code: "uncorrelated-result" });
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
    });

    it.each(["missing", "other-child"])(
        "waits only for exact completion until the original deadline: %s",
        async (kind) => {
            jest.useFakeTimers();
            try {
                const f = fixture();
                f.invoke(async () => {
                    f.started();
                    if (kind === "other-child")
                        f.emit(
                            "subagent.completed",
                            { totalToolCalls: 0 },
                            "other-child",
                        );
                    return {
                        resultType: "success",
                        textResultForLlm: "candidate",
                    };
                });
                const pending = expect(
                    launchMacroAuthorChild(f.session, f.child.prompt),
                ).rejects.toMatchObject({ code: "timeout" });
                await jest.advanceTimersByTimeAsync(90_000);
                await pending;
                expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
                expect(f.off).toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        },
    );

    it("accepts an exact completion notification arriving after the RPC response", async () => {
        const f = fixture();
        f.invoke(async () => {
            f.started();
            setImmediate(f.completed);
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).resolves.toMatchObject({
            text: "candidate",
            completedEventId: "subagent.completed-event",
        });
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
    });

    it("does not launch for an already aborted request", async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(
            launchMacroAuthorChild(
                f.session,
                f.child.prompt,
                controller.signal,
            ),
        ).rejects.toMatchObject({ code: "cancelled" });
        expect(f.execute).not.toHaveBeenCalled();
    });

    it("cancels only the exact child, including a late start", async () => {
        const f = fixture();
        const controller = new AbortController();
        let finish: () => void = () => {};
        f.invoke(
            () =>
                new Promise((resolve) => {
                    finish = () => {
                        f.started();
                        resolve({
                            resultType: "success",
                            textResultForLlm: "candidate",
                        });
                    };
                    controller.abort();
                }),
        );
        await expect(
            launchMacroAuthorChild(
                f.session,
                f.child.prompt,
                controller.signal,
            ),
        ).rejects.toMatchObject({ code: "cancelled" });
        expect(f.cancel).not.toHaveBeenCalled();
        finish();
        await Promise.resolve();
        expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
    });

    it("requires host acknowledgement of exact child retirement", async () => {
        const f = fixture();
        f.cancel.mockResolvedValue({ cancelled: false });
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({ code: "unsupported-host" });
    });

    it("reports native lifecycle rejection explicitly without a fallback", async () => {
        const f = fixture();
        f.execute.mockRejectedValue(new Error("Method not found"));
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({
            code: "unsupported-host",
            message: "Native author child lifecycle failed: Method not found",
        });
        expect(f.execute).toHaveBeenCalledTimes(1);
    });

    it("does not accept a cancelled completion as a successful child result", async () => {
        const f = fixture();
        f.invoke(async () => {
            f.started();
            f.emit("subagent.completed", {
                toolCallId: f.child.toolCallId,
                totalToolCalls: 0,
                cancelled: true,
            });
            return { resultType: "success", textResultForLlm: "candidate" };
        });
        await expect(
            launchMacroAuthorChild(f.session, f.child.prompt),
        ).rejects.toMatchObject({ code: "uncorrelated-result" });
    });

    it.each(["", "x".repeat(131_073)])(
        "rejects empty or oversized native output",
        async (text) => {
            const f = fixture();
            f.invoke(async () => {
                f.started();
                f.completed();
                return { resultType: "success", textResultForLlm: text };
            });
            await expect(
                launchMacroAuthorChild(f.session, f.child.prompt),
            ).rejects.toMatchObject({ code: "child-failed" });
        },
    );

    it("has a hard deadline and cleans up only its own child", async () => {
        jest.useFakeTimers();
        try {
            const f = fixture();
            f.invoke(async () => {
                f.started();
                return new Promise(() => {});
            });
            const result = launchMacroAuthorChild(f.session, f.child.prompt);
            const rejected = expect(result).rejects.toMatchObject({
                code: "timeout",
            });
            await jest.advanceTimersByTimeAsync(90_000);
            await rejected;
            expect(f.cancel).toHaveBeenCalledWith({ id: "child-1" });
        } finally {
            jest.useRealTimers();
        }
    });
});
