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
