// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacroManager } from "@typeagent/copilot-macros";
import {
    SessionCapture,
    type SessionCaptureDependencies,
} from "../src/extension/session-capture.js";
import type { ExtensionSessionEvent } from "../src/extension/trace-assembler.js";

function event(
    type: string,
    data: Record<string, unknown>,
    agentId?: string,
): ExtensionSessionEvent {
    return {
        type,
        timestamp: "2026-09-18T10:00:00.000Z",
        data,
        ...(agentId ? { agentId } : {}),
    };
}

function dependencies(
    connectAgentServer: SessionCaptureDependencies["connectAgentServer"],
) {
    return {
        connectAgentServer,
        insertToolHistory: jest.fn(async () => {}),
        insertTurnHistory: jest.fn(async () => {}),
    } satisfies SessionCaptureDependencies;
}

describe("extension session capture", () => {
    it("does not fail a newly claimed recording while finishing an earlier turn", async () => {
        const directory = await mkdtemp(join(tmpdir(), "capture-binding-"));
        try {
            const token = new MacroManager(directory).armRecording({
                sessionId: "session-1",
            });
            const fail = jest.fn(async () => {});
            const finalize = jest.fn(async () => {
                throw new Error("Wrong turn finalized.");
            });
            const mocks = dependencies(async () => ({
                getMacroRecordingState: async () => ({
                    status: "claimed",
                    token: {
                        ...token,
                        promptHash: createHash("sha256")
                            .update("Selected next task")
                            .digest("hex"),
                    },
                }),
                failMacroRecording: fail,
                finalizeMacroRecording: finalize,
                close: async () => {},
            }));
            const capture = new SessionCapture(
                "session-1",
                ".",
                () => {},
                mocks,
            );
            capture.enqueue(event("user.message", { content: "Earlier task" }));
            capture.enqueue(event("assistant.message", { content: "Done." }));
            capture.enqueue(event("session.idle", {}));
            await capture.flush();
            expect(fail).not.toHaveBeenCalled();
            expect(finalize).not.toHaveBeenCalled();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("does not fail extension startup when TypeAgent is unavailable", async () => {
        const errors: string[] = [];
        const capture = new SessionCapture(
            "session-1",
            ".",
            (message) => errors.push(message),
            dependencies(async () => {
                throw new Error("connection refused");
            }),
        );

        await expect(
            capture.failInterruptedRecording(),
        ).resolves.toBeUndefined();
        expect(errors).toEqual(["[typeagent-extension] connection refused"]);
    });

    it("correlates completion history with start metadata exactly once", async () => {
        const mocks = dependencies(async () => {
            throw new Error("unused");
        });
        const capture = new SessionCapture("session-1", ".", () => {}, mocks);
        capture.enqueue(
            event("tool.execution_start", {
                toolCallId: "call-1",
                toolName: "fetch_data",
                mcpServerName: "sample",
            }),
        );
        const completion = event("tool.execution_complete", {
            toolCallId: "call-1",
            success: true,
            result: "done",
        });

        capture.enqueue(completion);
        capture.enqueue(completion);
        await capture.flush();

        expect(mocks.insertToolHistory).toHaveBeenCalledTimes(1);
        expect(mocks.insertToolHistory).toHaveBeenCalledWith({
            ...completion,
            data: {
                ...completion.data,
                toolName: "fetch_data",
                mcpServerName: "sample",
            },
        });
    });

    it.each(["session.idle", "session.shutdown"])(
        "clears tool metadata when %s cleanup cannot connect",
        async (lifecycleEvent) => {
            const mocks = dependencies(async () => {
                throw new Error("connection refused");
            });
            const capture = new SessionCapture(
                "session-1",
                ".",
                () => {},
                mocks,
            );
            capture.enqueue(
                event("tool.execution_start", {
                    toolCallId: "call-1",
                    toolName: "fetch_data",
                }),
            );
            capture.enqueue(event(lifecycleEvent, {}));
            capture.enqueue(
                event("tool.execution_complete", {
                    toolCallId: "call-1",
                    success: true,
                    result: "done",
                }),
            );

            await capture.flush();

            expect(mocks.insertToolHistory).not.toHaveBeenCalled();
        },
    );

    it("continues event ingestion while optional history persistence is blocked", async () => {
        let release: () => void = () => {};
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const connect = jest.fn<
            SessionCaptureDependencies["connectAgentServer"]
        >(async () => {
            throw new Error("connection refused");
        });
        const mocks = dependencies(connect);
        mocks.insertToolHistory.mockImplementation(async () => blocked);
        const capture = new SessionCapture("session-1", ".", () => {}, mocks);
        capture.enqueue(
            event("tool.execution_start", {
                toolCallId: "call-1",
                toolName: "read",
            }),
        );
        capture.enqueue(
            event("tool.execution_complete", {
                toolCallId: "call-1",
                success: true,
            }),
        );
        capture.enqueue(event("session.idle", {}));
        try {
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(connect).toHaveBeenCalledTimes(1);
        } finally {
            release();
            await capture.flush();
        }
    });
});
