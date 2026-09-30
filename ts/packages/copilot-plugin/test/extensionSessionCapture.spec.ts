// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
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
});
