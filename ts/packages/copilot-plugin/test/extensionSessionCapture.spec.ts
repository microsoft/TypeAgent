// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
    MacroManager,
    type FinalizeRecordingRequest,
    type TraceSummary,
} from "@typeagent/copilot-macros";
import {
    SessionCapture,
    type SessionCaptureDependencies,
} from "../src/extension/session-capture.js";
import type { ExtensionSessionEvent } from "../src/extension/trace-assembler.js";
import { normalizeNativeRecipeResult } from "../src/extension/recipe-native-host.js";

const sessionId = "session-selected";
const prompt = "Read the selected generated document";

function event(
    type: string,
    data: Record<string, unknown> = {},
    id?: string,
    agentId?: string,
): ExtensionSessionEvent {
    return {
        type,
        timestamp: "2026-09-18T10:00:00.000Z",
        data,
        ...(id ? { id } : {}),
        ...(agentId ? { agentId } : {}),
    };
}

describe("extension session capture", () => {
    let directory: string;
    let manager: MacroManager;
    let previousDemoPath: string | undefined;

    beforeEach(async () => {
        directory = await mkdtemp(join(process.cwd(), ".capture-test-"));
        previousDemoPath = process.env.TYPEAGENT_DEMO_STATE_PATH;
        process.env.TYPEAGENT_DEMO_STATE_PATH = join(directory, "demo.json");
        manager = new MacroManager(directory);
        await manager.setMacroLearningPreference({
            cwd: directory,
            mode: "all",
        });
    });

    afterEach(async () => {
        if (previousDemoPath === undefined)
            delete process.env.TYPEAGENT_DEMO_STATE_PATH;
        else process.env.TYPEAGENT_DEMO_STATE_PATH = previousDemoPath;
        await manager.close();
        await rm(directory, { recursive: true, force: true });
    });

    function selected(
        learning = true,
        overrides: Partial<SessionCaptureDependencies> = {},
    ) {
        manager.armRecording({ sessionId, cwd: directory, learning });
        const token = manager.claimRecording({
            sessionId,
            cwd: directory,
            promptHash: createHash("sha256").update(prompt).digest("hex"),
        })!;
        expect(token).toBeTruthy();
        const finalize = jest.fn(async (request: FinalizeRecordingRequest) =>
            manager.finalizeRecording(request),
        );
        const fail = jest.fn(
            async (id: string, tokenId: string, error: string) => {
                manager.failRecording(id, tokenId, error);
            },
        );
        const close = jest.fn(async () => {});
        const connectOwner = jest.fn(async () => ({
            getMacroRecordingState: async () =>
                manager.getRecordingState(sessionId),
            finalizeMacroRecording: finalize,
            failMacroRecording: fail,
            close,
        }));
        const dependencies: SessionCaptureDependencies = {
            connectOwner,
            ...overrides,
        };
        const errors = jest.fn<(message: string) => void>();
        const notify = jest.fn(async (_message: string) => {});
        const finalized = jest.fn(async (_summary: TraceSummary) => {});
        const capture = new SessionCapture(
            sessionId,
            directory,
            errors,
            dependencies,
            notify,
            finalized,
        );
        return {
            manager,
            token,
            finalize,
            fail,
            close,
            connectOwner,
            dependencies,
            errors,
            notify,
            finalized,
            capture,
        };
    }

    function businessCalls(capture: SessionCapture, success = true) {
        capture.enqueue(
            event("user.message", { content: prompt }, "user-root"),
        );
        capture.enqueue(
            event("tool.execution_start", {
                toolCallId: "read-call",
                toolName: "workiq-fetch",
                mcpServerName: "workiq",
                arguments: {},
            }),
        );
        const completion = event("tool.execution_complete", {
            toolCallId: "read-call",
            success,
            result: { content: "{}" },
        });
        capture.enqueue(completion);
        capture.enqueue(completion);
    }

    function receipt(
        fixture: ReturnType<typeof selected>,
        tokenId = fixture.token.id,
        promptHash = fixture.token.promptHash,
        agentId?: string,
    ) {
        fixture.capture.enqueue(
            event(
                "tool.execution_start",
                {
                    toolCallId: "receipt-call",
                    toolName: "typeagent_recorded_task_succeeded",
                    arguments: { summary: "Read completed" },
                },
                "receipt-start",
                agentId,
            ),
        );
        fixture.capture.enqueue(
            event(
                "tool.execution_complete",
                {
                    toolCallId: "receipt-call",
                    success: true,
                    result: {
                        content: JSON.stringify({
                            status: "succeeded",
                            recordingTokenId: tokenId,
                            promptHash,
                        }),
                    },
                },
                "receipt-root",
                agentId,
            ),
        );
    }

    function finalAnswer(capture: SessionCapture, agentId?: string) {
        capture.enqueue(
            event(
                "assistant.message",
                { content: "Completed generated read" },
                "answer-root",
                agentId,
            ),
        );
        capture.enqueue(event("assistant.turn_end", {}, "end-root", agentId));
    }

    it("stores the normalized selected trace and awaits its exact summary before notifying learning", async () => {
        const fixture = selected(true, {
            normalizeToolResult: normalizeNativeRecipeResult,
        });
        const { capture, dependencies, finalize, finalized, notify } = fixture;
        dependencies.resolveToolIdentity = async (toolName, mcpServerName) => ({
            toolName: toolName === "workiq-fetch" ? "fetch" : toolName,
            ...(mcpServerName ? { mcpServerName } : {}),
        });
        dependencies.prepareTrace = (trace) => ({
            ...trace,
            response: "Prepared final answer",
        });
        let release: () => void = () => {};
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const callbackStarted = new Promise<void>((resolve) => {
            finalized.mockImplementation(async () => {
                resolve();
                await blocked;
            });
        });
        businessCalls(capture);
        receipt(fixture);
        finalAnswer(capture);
        capture.enqueue(event("session.idle"));
        try {
            await Promise.race([
                callbackStarted,
                capture.flush().then(() => {
                    throw new Error(
                        "Finalized summary callback was not reached",
                    );
                }),
            ]);
            expect(notify).not.toHaveBeenCalled();
        } finally {
            release();
        }
        await capture.flush();
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(finalize.mock.calls[0][0].childAuthoring).toEqual({
            taskId: `${sessionId}:user-root`,
            firstEventId: "user-root",
            successEventId: "receipt-root",
            outputEventId: "answer-root",
            recordingTokenId: fixture.token.id,
        });
        const summary = (await fixture.manager.getRecordingState(sessionId))
            .trace!;
        expect(finalized).toHaveBeenCalledWith(summary);
        expect(notify).toHaveBeenCalledWith(
            expect.stringContaining(summary.learningJobId!),
        );
        const stored = JSON.parse(
            await readFile(
                join(
                    directory,
                    "copilot-macros",
                    "traces",
                    `${summary.traceId}.json`,
                ),
                "utf8",
            ),
        );
        expect(stored.response).toBe("Prepared final answer");
        expect(stored.toolCalls).toHaveLength(1);
        expect(stored.toolCalls[0]).toMatchObject({
            name: "fetch",
            mcpServerName: "workiq",
            result: {},
        });
        expect(fixture.close).toHaveBeenCalledTimes(1);
        expect(fixture.errors).not.toHaveBeenCalled();
    });

    it("preserves explicitly nonlearning durable capture without a success receipt", async () => {
        const fixture = selected(false);
        businessCalls(fixture.capture);
        finalAnswer(fixture.capture);
        fixture.capture.enqueue(event("session.idle"));
        await fixture.capture.flush();
        expect(fixture.finalize).toHaveBeenCalledTimes(1);
        expect(fixture.finalize.mock.calls[0][0]).not.toHaveProperty(
            "childAuthoring",
        );
        const summary = (await fixture.manager.getRecordingState(sessionId))
            .trace!;
        expect(summary.toolCallCount).toBe(1);
        expect(summary.learningJobId).toBeUndefined();
        expect(fixture.finalized).toHaveBeenCalledWith(summary);
        expect(fixture.notify).not.toHaveBeenCalled();
        await expect(
            readFile(
                join(
                    directory,
                    "copilot-macros",
                    "traces",
                    `${summary.traceId}.json`,
                ),
                "utf8",
            ),
        ).resolves.toContain(prompt);
    });

    it.each([
        "missing receipt",
        "wrong token",
        "stale prompt",
        "child receipt",
        "child answer",
        "missing final answer",
        "missing turn end",
        "failed tool",
        "denied tool",
        "abort",
        "session.error",
        "aborted idle",
    ])("does not learn from %s", async (kind) => {
        const fixture = selected();
        businessCalls(fixture.capture, kind !== "failed tool");
        if (kind === "denied tool")
            fixture.capture.enqueue(
                event("permission.completed", {
                    toolCallId: "read-call",
                    result: { kind: "denied-interactively-by-user" },
                }),
            );
        if (kind !== "missing receipt")
            receipt(
                fixture,
                kind === "wrong token" ? "another-token" : fixture.token.id,
                kind === "stale prompt"
                    ? "another-prompt"
                    : fixture.token.promptHash,
                kind === "child receipt" ? "child" : undefined,
            );
        if (kind === "missing turn end")
            fixture.capture.enqueue(
                event("assistant.message", { content: "Done" }, "answer-root"),
            );
        else if (kind !== "missing final answer")
            finalAnswer(
                fixture.capture,
                kind === "child answer" ? "child" : undefined,
            );
        if (kind === "abort" || kind === "session.error")
            fixture.capture.enqueue(event(kind));
        fixture.capture.enqueue(
            event("session.idle", { aborted: kind === "aborted idle" }),
        );
        await fixture.capture.flush();
        expect(fixture.finalize).not.toHaveBeenCalled();
        expect(fixture.fail).toHaveBeenCalledWith(
            sessionId,
            fixture.token.id,
            expect.stringContaining("no explicit root success receipt"),
        );
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.finalized).not.toHaveBeenCalled();
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });

    it("leaves a newly claimed recording untouched while finishing an earlier turn", async () => {
        const fixture = selected();
        fixture.capture.enqueue(
            event("user.message", { content: "Earlier task" }),
        );
        finalAnswer(fixture.capture);
        fixture.capture.enqueue(event("session.idle"));
        await fixture.capture.flush();
        expect(fixture.fail).not.toHaveBeenCalled();
        expect(fixture.finalize).not.toHaveBeenCalled();
    });

    it("does not finalize at child idle or perform tool-history side effects", async () => {
        const fixture = selected();
        businessCalls(fixture.capture);
        receipt(fixture);
        finalAnswer(fixture.capture);
        fixture.capture.enqueue(event("session.idle", {}, undefined, "child"));
        await fixture.capture.flush();
        expect(fixture.connectOwner).not.toHaveBeenCalled();
        fixture.capture.enqueue(event("session.idle"));
        await fixture.capture.flush();
        expect(fixture.connectOwner).toHaveBeenCalledTimes(1);
        expect(fixture.finalize).toHaveBeenCalledTimes(1);
    });

    it("does not persist or learn an unselected turn through a history side channel", async () => {
        const finalize = jest.fn(async () => {
            throw new Error("Unselected trace finalized");
        });
        const fail = jest.fn(async () => {});
        const close = jest.fn(async () => {});
        const history = jest.fn(async () => {
            throw new Error("Capture must not insert history");
        });
        const errors = jest.fn<(message: string) => void>();
        const dependencies = {
            connectOwner: async () => ({
                getMacroRecordingState: async () => ({
                    status: "idle" as const,
                }),
                finalizeMacroRecording: finalize,
                failMacroRecording: fail,
                close,
            }),
            insertToolHistory: history,
            insertTurnHistory: history,
        };
        const capture = new SessionCapture(
            sessionId,
            directory,
            errors,
            dependencies,
        );
        businessCalls(capture);
        finalAnswer(capture);
        capture.enqueue(event("session.idle"));
        await capture.flush();
        expect(finalize).not.toHaveBeenCalled();
        expect(fail).not.toHaveBeenCalled();
        expect(history).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
        await expect(
            readFile(join(directory, "copilot-macros", "traces"), "utf8"),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it.each(["session.idle", "session.shutdown"])(
        "discards the active turn when %s cannot connect",
        async (lifecycleEvent) => {
            const fixture = selected();
            fixture.connectOwner.mockRejectedValueOnce(
                new Error("connection refused"),
            );
            businessCalls(fixture.capture);
            receipt(fixture);
            finalAnswer(fixture.capture);
            fixture.capture.enqueue(event(lifecycleEvent));
            fixture.capture.enqueue(
                event("tool.execution_complete", {
                    toolCallId: "read-call",
                    success: true,
                    result: "late",
                }),
            );
            finalAnswer(fixture.capture);
            fixture.capture.enqueue(event("session.idle"));
            await fixture.capture.flush();
            expect(fixture.errors).toHaveBeenCalledWith(
                "[typeagent-extension] connection refused",
            );
            expect(fixture.finalize).not.toHaveBeenCalled();
            expect(fixture.fail).not.toHaveBeenCalled();
        },
    );

    it.each(["shutdown", "reload"])(
        "fails an interrupted claimed recording on %s",
        async (kind) => {
            const fixture = selected();
            if (kind === "reload")
                await fixture.capture.failInterruptedRecording();
            else {
                businessCalls(fixture.capture);
                fixture.capture.enqueue(event("session.shutdown"));
                await fixture.capture.flush();
            }
            expect(fixture.fail).toHaveBeenCalledWith(
                sessionId,
                fixture.token.id,
                expect.stringContaining(
                    kind === "reload" ? "reloaded" : "session ended",
                ),
            );
            expect(fixture.close).toHaveBeenCalledTimes(1);
            expect(fixture.finalize).not.toHaveBeenCalled();
        },
    );

    it("does not fail extension startup when the owner is unavailable", async () => {
        const fixture = selected();
        fixture.connectOwner.mockRejectedValueOnce(
            new Error("connection refused"),
        );
        await expect(
            fixture.capture.failInterruptedRecording(),
        ).resolves.toBeUndefined();
        expect(fixture.errors).toHaveBeenCalledWith(
            "[typeagent-extension] connection refused",
        );
    });

    it("fails the selected recording when trace preparation throws", async () => {
        const fixture = selected();
        fixture.dependencies.prepareTrace = () => {
            throw new Error("normalization failed");
        };
        businessCalls(fixture.capture);
        receipt(fixture);
        finalAnswer(fixture.capture);
        fixture.capture.enqueue(event("session.idle"));
        await fixture.capture.flush();
        expect(fixture.fail).toHaveBeenCalledWith(
            sessionId,
            fixture.token.id,
            "normalization failed",
        );
        expect(fixture.finalize).not.toHaveBeenCalled();
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.errors).toHaveBeenCalledWith(
            "[typeagent-extension] normalization failed",
        );
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });

    it("does not announce learning when durable finalization fails", async () => {
        const fixture = selected();
        fixture.finalize.mockRejectedValueOnce(new Error("storage failed"));
        businessCalls(fixture.capture);
        receipt(fixture);
        finalAnswer(fixture.capture);
        fixture.capture.enqueue(event("session.idle"));
        await fixture.capture.flush();
        expect(fixture.finalized).not.toHaveBeenCalled();
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.errors).toHaveBeenCalledWith(
            "[typeagent-extension] storage failed",
        );
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });

    it("does not learn after tool-result normalization fails", async () => {
        const fixture = selected(true, {
            normalizeToolResult: () => {
                throw new Error("invalid tool result");
            },
        });
        const { capture } = fixture;
        businessCalls(capture);
        receipt(fixture);
        finalAnswer(capture);
        capture.enqueue(event("session.idle"));
        await capture.flush();
        expect(fixture.errors).toHaveBeenCalledWith(
            "[typeagent-extension] invalid tool result",
        );
        expect(fixture.fail).toHaveBeenCalledTimes(1);
        expect(fixture.finalize).not.toHaveBeenCalled();
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });
});
