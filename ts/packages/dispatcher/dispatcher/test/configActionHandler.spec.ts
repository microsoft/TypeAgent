// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { executeConfigAction } from "../src/context/system/action/configActionHandler.js";
import { configCommandHandlers } from "../src/context/system/handlers/configCommandHandlers.js";

const agentContext = { id: "agent-context" } as any;
const context = { sessionContext: { agentContext } } as any;

async function run(action: any) {
    const processCommand = jest.fn(async () => undefined);
    const executeCommand = jest.fn(async () => undefined);
    await executeConfigAction(
        { schemaName: "system.config", ...action },
        context,
        {
            processCommand,
            handlers: configCommandHandlers,
            executeCommand: executeCommand as any,
        },
    );
    return { executeCommand, processCommand };
}

describe("config actions", () => {
    it("serializes the finite config flags and ordered arguments", async () => {
        const { executeCommand } = await run({
            actionName: "runConfigCommand",
            parameters: {
                command: "agent",
                arguments: ["calendar", "agent with space"],
                flags: {
                    reset: true,
                    off: ["player*", "email"],
                    priority: ['code "editor"', "browser"],
                },
            },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["agent"],
            {
                args: { agentNames: ["calendar", "agent with space"] },
                flags: {
                    reset: true,
                    off: ["player*", "email"],
                    priority: ['code "editor"', "browser"],
                },
            },
            context,
        );
    });

    it("preserves arbitrary string arguments without command quoting", async () => {
        const { executeCommand } = await run({
            actionName: "runConfigCommand",
            parameters: {
                command: "collision telemetry experimentId",
                arguments: [`Sam's "quoted" \\ value`],
            },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["collision", "telemetry", "experimentId"],
            {
                args: { id: `Sam's "quoted" \\ value` },
                flags: undefined,
            },
            context,
        );
    });

    it("serializes the developer confirmation flag", async () => {
        const { executeCommand } = await run({
            actionName: "runConfigCommand",
            parameters: {
                command: "dev on",
                flags: { confirm: true },
            },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["dev", "on"],
            { args: undefined, flags: { confirm: true } },
            context,
        );
    });

    it("accepts empty parameter containers for parameterless commands", async () => {
        const { executeCommand } = await run({
            actionName: "runConfigCommand",
            parameters: {
                command: "translation off",
                arguments: [],
                flags: {},
            },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["translation", "off"],
            undefined,
            context,
        );
    });

    it("keeps the existing developer-mode action behavior", async () => {
        const { processCommand } = await run({
            actionName: "toggleDeveloperMode",
            parameters: { enable: false },
        });

        expect(processCommand).toHaveBeenCalledWith(
            "@config dev off",
            agentContext,
        );
    });
});
