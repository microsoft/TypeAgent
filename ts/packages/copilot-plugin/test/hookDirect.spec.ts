// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    ClientIO,
    Dispatcher,
    IAgentMessage,
} from "@typeagent/agent-server-client";
import type { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";
import type { CommandResult } from "@typeagent/dispatcher-types";
import {
    handleDirect,
    type DirectDependencies,
} from "../src/hooks/hook-direct.js";

const input = {
    sessionId: "test-session",
    timestamp: 1,
    cwd: ".",
    prompt: "@package group list",
};

function makeMessage(message: DisplayContent): IAgentMessage {
    return {
        message,
        requestId: { requestId: "request-1", connectionId: "connection-1" },
        source: "test-agent",
    };
}

type EmitDisplay = (clientIO: ClientIO) => void;

function createDependencies(
    result: CommandResult | Promise<CommandResult | undefined> | undefined,
    emitDisplay?: EmitDisplay,
): {
    dependencies: DirectDependencies;
    close: jest.Mock;
    emitProgress: jest.Mock;
} {
    const completion =
        result instanceof Promise ? result : Promise.resolve(result);
    const close = jest.fn(async () => {});
    const submitCommand = jest.fn(async () => {
        emitDisplay?.(clientIO);
        return {
            ok: true,
            entry: { requestId: "request-1", completion },
        };
    });
    const dispatcher = {
        submitCommand,
        close,
    } as unknown as Dispatcher;
    let clientIO!: ClientIO;
    const emitProgress = jest.fn();
    const dependencies: DirectDependencies = {
        connectToTypeAgent: jest.fn(async (connectedClientIO: ClientIO) => {
            clientIO = connectedClientIO;
            return dispatcher;
        }),
        emitProgress,
        runAgentHandoff: jest.fn(async () => "Host macro answer"),
    };
    return { dependencies, close, emitProgress };
}

function appendDisplay(
    content: DisplayContent,
    mode: DisplayAppendMode = "block",
): EmitDisplay {
    return (clientIO) => clientIO.appendDisplay(makeMessage(content), mode);
}

function setDisplay(content: DisplayContent): EmitDisplay {
    return (clientIO) => clientIO.setDisplay(makeMessage(content));
}

const forced = { forceHandled: true };

describe("direct TypeAgent hook", () => {
    it("returns the native host answer without a root-model handoff turn", async () => {
        const handoff = {
            agentName: "typeagent-macro-runner",
            payload: { macro: "approved" },
        };
        const { dependencies, close } = createDependencies({
            agentHandoff: handoff,
        });
        const runAgentHandoff = jest.fn(
            async () => "Vega checklist\n1. Ready\n2. Verified",
        );
        const result = await handleDirect(
            input,
            {},
            { ...dependencies, runAgentHandoff },
        );
        expect(result).toEqual({
            handled: true,
            handledBy: "typeagent",
            responseContent: "Vega checklist\n1. Ready\n2. Verified",
        });
        expect(runAgentHandoff).toHaveBeenCalledWith(
            input.sessionId,
            handoff,
            input.timestamp,
        );
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("makes host execution failures terminal instead of delegating or rerouting", async () => {
        const { dependencies } = createDependencies({
            agentHandoff: { agentName: "typeagent-macro-runner", payload: {} },
        });
        const runAgentHandoff = jest.fn(async () => {
            throw new Error("Macro cancelled");
        });
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const result = await handleDirect(
                input,
                {},
                { ...dependencies, runAgentHandoff },
            );
            expect(result.handled).toBe(true);
            expect(result.responseContent).toContain("Macro cancelled");
            expect(result.additionalContext).toBeUndefined();
            expect(runAgentHandoff).toHaveBeenCalledTimes(1);
        } finally {
            error.mockRestore();
        }
    });

    it("always uses the native host for macro handoffs without caller context", async () => {
        const launch = {
            agent: "typeagent-macro-runner",
            macro: { macroId: "approved", version: 2 },
            inputs: { topic: "different topic" },
        };
        const { dependencies } = createDependencies({
            actions: [{ schemaName: "macros", actionName: "run_approved_v2" }],
            agentHandoff: {
                agentName: "typeagent-macro-runner",
                payload: launch,
            },
        });
        const result = await handleDirect(input, {}, dependencies);
        expect(result).toEqual({
            handled: true,
            handledBy: "typeagent",
            responseContent: "Host macro answer",
        });
        expect(result.modifiedPrompt).toBeUndefined();
        expect(result.additionalContext).toBeUndefined();
        expect(dependencies.runAgentHandoff).toHaveBeenCalledWith(
            input.sessionId,
            expect.objectContaining({ payload: launch }),
            input.timestamp,
        );
    });

    it.each([
        { lastError: "Replay failed after step one." },
        { cancelled: true },
    ])("keeps accepted macro failures handled: %j", async (outcome) => {
        const { dependencies } = createDependencies({
            actions: [{ schemaName: "macros", actionName: "run_approved_v2" }],
            ...outcome,
        });
        const result = await handleDirect(input, {}, dependencies);
        expect(result.handled).toBe(true);
        expect(result.additionalContext).toBeUndefined();
    });

    it("passes the hook session ID rather than relying on inherited environment", async () => {
        const { dependencies } = createDependencies({});
        await handleDirect(input, forced, dependencies);
        expect(dependencies.connectToTypeAgent).toHaveBeenCalledWith(
            expect.anything(),
            input.sessionId,
        );
    });

    it.each([false, true])(
        "preserves pending user input instead of claiming completion (forced: %s)",
        async (forceHandled) => {
            const { dependencies, close } = createDependencies({}, (io) => {
                io.requestChoice(
                    {
                        requestId: "request-1",
                        connectionId: "connection-1",
                    },
                    "choice-1",
                    "yesNo",
                    "Apply the change?",
                    ["Yes", "No"],
                    "test-agent",
                );
            });
            const result = await handleDirect(
                input,
                { forceHandled },
                dependencies,
            );
            expect(result.handled).toBe(true);
            expect(result.responseContent).toContain(
                "USER interaction required",
            );
            expect(result.responseContent).toContain("Apply the change?");
            expect(result.responseContent).toContain("choice-1");
            expect(result.responseContent).not.toContain(
                "TypeAgent completed the command",
            );
            expect(close).toHaveBeenCalledTimes(1);
        },
    );

    it("returns a warning without duplicating it as persistent progress", async () => {
        const { dependencies, close, emitProgress } = createDependencies(
            {},
            appendDisplay({
                type: "text",
                content: "No change",
                kind: "warning",
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "No change",
            handledBy: "typeagent",
        });
        expect(emitProgress).not.toHaveBeenCalledWith("No change");
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns an error without duplicating it as persistent progress", async () => {
        const { dependencies, emitProgress } = createDependencies(
            {},
            appendDisplay({
                type: "text",
                content: "Command error",
                kind: "error",
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "Command error",
            handledBy: "typeagent",
        });
        expect(emitProgress).not.toHaveBeenCalledWith("Command error");
    });

    it("preserves line and table structure for forced execution", async () => {
        const { dependencies, close } = createDependencies(
            {},
            setDisplay({
                type: "text",
                content: [
                    ["Group", "Members"],
                    ["developer", "coding-agent, code-review"],
                ],
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent:
                "Group | Members  \ndeveloper | coding-agent, code-review",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("preserves multiline display content", async () => {
        const { dependencies } = createDependencies(
            {},
            setDisplay({
                type: "text",
                content: ["first line", "second line"],
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toMatchObject({
            responseContent: "first line  \nsecond line",
        });
    });

    it("returns a completion message when forced execution has no output", async () => {
        const { dependencies, close } = createDependencies({});

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent completed the command.",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            {
                disposition: {
                    status: "notHandled",
                    reason: "unknown",
                },
            } as CommandResult,
            "TypeAgent did not handle the command.",
        ],
        [
            {
                disposition: {
                    status: "failed",
                    path: "command",
                    mayHaveSideEffects: false,
                },
            } as CommandResult,
            "TypeAgent could not complete the command.",
        ],
    ])("reports a %s disposition", async (result, responseContent) => {
        const { dependencies } = createDependencies(result);

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent,
            handledBy: "typeagent",
        });
    });

    it("reports an undefined completion result", async () => {
        const { dependencies, close } = createDependencies(undefined);

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent:
                "TypeAgent accepted the command but did not return a completion result. Check agent-server before retrying.",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("prioritizes cancellation over collected output", async () => {
        const { dependencies, close } = createDependencies(
            { cancelled: true },
            setDisplay("partial output"),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent request was cancelled.",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("prioritizes the last error over collected warnings", async () => {
        const { dependencies, close } = createDependencies(
            { lastError: "Command failed" },
            appendDisplay({
                type: "text",
                content: "Earlier warning",
                kind: "warning",
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "Command failed",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("prioritizes the last error over collected table output", async () => {
        const { dependencies } = createDependencies(
            { lastError: "Command failed" },
            setDisplay({
                type: "text",
                content: [
                    ["Group", "Members"],
                    ["developer", "coding-agent"],
                ],
            }),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "Command failed",
            handledBy: "typeagent",
        });
    });

    it("returns a handled error and closes the dispatcher on failure", async () => {
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const { dependencies, close } = createDependencies(
            Promise.reject(new Error("connection lost")),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent:
                "TypeAgent could not execute the command: connection lost",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("preserves ordinary fallthrough without a recognized action", async () => {
        const { dependencies, close } = createDependencies(
            {},
            setDisplay("unused output"),
        );

        await expect(handleDirect(input, {}, dependencies)).resolves.toEqual(
            {},
        );
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("preserves ordinary fallthrough without collected output", async () => {
        const result = {
            actions: [{ actionName: "testAction" }],
        } as CommandResult;
        const { dependencies, close } = createDependencies(result);

        await expect(handleDirect(input, {}, dependencies)).resolves.toEqual(
            {},
        );
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("preserves ordinary successful direct output", async () => {
        const result = {
            actions: [{ actionName: "testAction" }],
        } as CommandResult;
        const { dependencies, close } = createDependencies(
            result,
            setDisplay("TypeAgent answer"),
        );

        await expect(handleDirect(input, {}, dependencies)).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent answer",
            handledBy: "typeagent",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("uses the completion fallback for whitespace-only output", async () => {
        const { dependencies } = createDependencies({}, setDisplay(" \n "));

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent completed the command.",
            handledBy: "typeagent",
        });
    });

    it("preserves meaningful leading and trailing whitespace", async () => {
        const { dependencies } = createDependencies(
            {},
            setDisplay("    indented\nnext  "),
        );

        await expect(
            handleDirect(input, forced, dependencies),
        ).resolves.toMatchObject({
            responseContent: "    indented  \nnext  ",
        });
    });
});
