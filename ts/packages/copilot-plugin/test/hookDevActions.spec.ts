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
    close: jest.Mock;
} {
    const completion =
        result instanceof Promise ? result : Promise.resolve(result);
    const submitCommand = jest.fn(async () => ({
        ok: true,
        entry: { completion },
    }));
    const close = jest.fn(async () => {});
    const dispatcher = {
        submitCommand,
        close,
    } as unknown as Dispatcher;
    return {
        dependencies: {
            connectToTypeAgent: jest.fn(async () => dispatcher),
            emitProgress: jest.fn(),
        },
        submitCommand,
        close,
    };
}

describe("Copilot dev actions hook", () => {
    it("uses the PowerShell schema family for ordinary prompts", () => {
        expect(getDevActionCommandOptions("show running processes")).toEqual({
            activeSchemaFamilies: ["powershell"],
            noReasoning: true,
        });
    });

    it("uses the recording profile for recording directives", () => {
        expect(
            getDevActionCommandOptions("learn: show running processes"),
        ).toEqual({
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
            noReasoning: true,
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
});
