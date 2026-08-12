// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { Dispatcher } from "@typeagent/agent-server-client";
import type {
    CommandResult,
    ProcessCommandOptions,
} from "@typeagent/dispatcher-types";
import {
    getDevActionCommandOptions,
    handleDevActions,
    type DevActionDependencies,
} from "../src/hooks/hook-dev-actions.js";
import { createClientIO } from "../src/shared/typeagent-client.js";

const input = {
    sessionId: "test-session",
    timestamp: 1,
    cwd: ".",
    prompt: "show running processes",
};

function createDependencies(
    result: CommandResult | Promise<CommandResult | undefined> | undefined,
): {
    dependencies: DevActionDependencies;
    submitCommand: jest.Mock;
    cancelCommand: jest.Mock;
    cancelCommandByClientId: jest.Mock;
    close: jest.Mock;
} {
    const completion =
        result instanceof Promise ? result : Promise.resolve(result);
    const submitCommand = jest.fn(async () => ({
        ok: true,
        entry: { requestId: "request-1", completion },
    }));
    const cancelCommand = jest.fn(async () => ({
        kind: "running",
        requestId: "request-1",
    }));
    const cancelCommandByClientId = jest.fn();
    const close = jest.fn(async () => {});
    const dispatcher = {
        submitCommand,
        cancelCommand,
        cancelCommandByClientId,
        close,
    } as unknown as Dispatcher;
    return {
        dependencies: {
            connectToTypeAgent: jest.fn(async () => dispatcher),
            emitProgress: jest.fn(),
            platform: "win32",
        },
        submitCommand,
        cancelCommand,
        cancelCommandByClientId,
        close,
    };
}

describe("Copilot dev actions hook", () => {
    it("uses the PowerShell schema family for ordinary prompts", () => {
        expect(getDevActionCommandOptions("show running processes")).toEqual({
            activeSchemaFamilies: ["powershell"],
            noReasoning: false,
            reasoningProfile: "powershellCapabilityFallback",
        });
    });

    it("uses the recording profile for recording directives", () => {
        expect(
            getDevActionCommandOptions("learn: show running processes"),
        ).toEqual({
            activeSchemaFamilies: ["powershell"],
            noReasoning: false,
            reasoningProfile: "powershellFlowRecording",
        });
    });

    it("falls through when the dispatcher returns notHandled", async () => {
        const { dependencies, submitCommand, close } = createDependencies({
            disposition: { status: "notHandled", reason: "unknown" },
        });

        await expect(handleDevActions(input, dependencies)).resolves.toEqual(
            {},
        );
        const options = submitCommand.mock.calls[0][2] as ProcessCommandOptions;
        expect(options).toEqual({
            activeSchemaFamilies: ["powershell"],
            noReasoning: false,
            reasoningProfile: "powershellCapabilityFallback",
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns handled output for a PowerShell action", async () => {
        const { dependencies } = createDependencies({
            disposition: {
                status: "handled",
                path: "action",
                schemas: ["powershell.powershell-processes"],
            },
        });

        await expect(handleDevActions(input, dependencies)).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent completed the request.",
            handledBy: "typeagent",
        });
    });

    it("falls through when connection fails before submission", async () => {
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const dependencies: DevActionDependencies = {
            connectToTypeAgent: jest.fn(async () => {
                throw new Error("server unavailable");
            }),
            emitProgress: jest.fn(),
            platform: "win32",
        };

        await expect(handleDevActions(input, dependencies)).resolves.toEqual(
            {},
        );
        consoleError.mockRestore();
    });

    it("returns a handled error when completion fails after submission", async () => {
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const { dependencies } = createDependencies(
            Promise.reject(new Error("connection lost")),
        );

        await expect(handleDevActions(input, dependencies)).resolves.toEqual({
            handled: true,
            responseContent:
                "TypeAgent could not finish the submitted development action: connection lost",
            handledBy: "typeagent",
        });
        consoleError.mockRestore();
    });

    it("falls through for ordinary prompts on non-Windows platforms", async () => {
        const { dependencies } = createDependencies({
            disposition: {
                status: "handled",
                path: "action",
                schemas: ["powershell"],
            },
        });
        dependencies.platform = "linux";

        await expect(handleDevActions(input, dependencies)).resolves.toEqual(
            {},
        );
        expect(dependencies.connectToTypeAgent).not.toHaveBeenCalled();
    });

    it("reports unsupported explicit recording on non-Windows platforms", async () => {
        const { dependencies } = createDependencies(undefined);
        dependencies.platform = "darwin";

        await expect(
            handleDevActions(
                { ...input, prompt: "learn: show running processes" },
                dependencies,
            ),
        ).resolves.toEqual({
            handled: true,
            responseContent:
                "TypeAgent PowerShell recording is supported only on Windows. Run the request on a Windows host with the PowerShell agent enabled.",
            handledBy: "typeagent",
        });
    });

    it("reports unavailable PowerShell for explicit recording", async () => {
        const { dependencies } = createDependencies({
            disposition: {
                status: "notHandled",
                reason: "noActiveSchema",
            },
        });

        await expect(
            handleDevActions(
                { ...input, prompt: "record: show running processes" },
                dependencies,
            ),
        ).resolves.toEqual({
            handled: true,
            responseContent:
                "TypeAgent could not record this PowerShell flow because the PowerShell schema is unavailable. Enable the PowerShell agent and retry.",
            handledBy: "typeagent",
        });
    });

    it("cancels an accepted request when the hook is aborted", async () => {
        let resolveCompletion:
            | ((result: CommandResult | undefined) => void)
            | undefined;
        const completion = new Promise<CommandResult | undefined>((resolve) => {
            resolveCompletion = resolve;
        });
        const { dependencies, cancelCommand } = createDependencies(completion);
        cancelCommand.mockImplementation(async () => {
            resolveCompletion?.({ cancelled: true });
            return { kind: "running", requestId: "request-1" };
        });
        const controller = new AbortController();

        const handled = handleDevActions(
            input,
            dependencies,
            controller.signal,
        );
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();

        await expect(handled).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent request was cancelled.",
            handledBy: "typeagent",
        });
        expect(cancelCommand).toHaveBeenCalledWith("request-1");
    });

    it("keeps abort cancellation best-effort when client-id cancellation throws", async () => {
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        let resolveCompletion:
            | ((result: CommandResult | undefined) => void)
            | undefined;
        let resolveSubmit:
            | ((result: {
                  ok: true;
                  entry: {
                      requestId: string;
                      completion: Promise<CommandResult | undefined>;
                  };
              }) => void)
            | undefined;
        const completion = new Promise<CommandResult | undefined>((resolve) => {
            resolveCompletion = resolve;
        });
        const submitCommand = jest.fn(
            () =>
                new Promise<{
                    ok: true;
                    entry: {
                        requestId: string;
                        completion: Promise<CommandResult | undefined>;
                    };
                }>((resolve) => {
                    resolveSubmit = resolve;
                }),
        );
        const cancelCommand = jest.fn(async () => {
            resolveCompletion?.({ cancelled: true });
            return { kind: "running", requestId: "request-1" };
        });
        const cancelCommandByClientId = jest.fn(() => {
            throw new Error("disconnected");
        });
        const dispatcher = {
            submitCommand,
            cancelCommand,
            cancelCommandByClientId,
            close: jest.fn(async () => {}),
        } as unknown as Dispatcher;
        const dependencies: DevActionDependencies = {
            connectToTypeAgent: jest.fn(async () => dispatcher),
            emitProgress: jest.fn(),
            platform: "win32",
        };
        const controller = new AbortController();

        const handled = handleDevActions(
            input,
            dependencies,
            controller.signal,
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(submitCommand).toHaveBeenCalled();
        expect(() => controller.abort()).not.toThrow();
        resolveSubmit?.({
            ok: true,
            entry: { requestId: "request-1", completion },
        });

        await expect(handled).resolves.toEqual({
            handled: true,
            responseContent: "TypeAgent request was cancelled.",
            handledBy: "typeagent",
        });
        expect(cancelCommandByClientId).toHaveBeenCalled();
        expect(cancelCommand).toHaveBeenCalledWith("request-1");
        consoleError.mockRestore();
    });

    it("defaults unattended interactions to denial", async () => {
        const clientIO = createClientIO({});

        await expect(
            clientIO.question(
                undefined,
                "Allow action?",
                ["Run", "Cancel"],
                undefined,
                "powershell",
            ),
        ).resolves.toBe(1);
        await expect(
            clientIO.question(
                undefined,
                "Allow action?",
                ["Run", "Cancel"],
                1,
                "powershell",
            ),
        ).resolves.toBe(1);
    });
});
