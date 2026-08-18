// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { executeConfigAction } from "../src/context/system/action/configActionHandler.js";
import { configCommandHandlers } from "../src/context/system/handlers/configCommandHandlers.js";

const agentContext = { id: "agent-context" } as any;
const context = { sessionContext: { agentContext } } as any;

async function run(action: any) {
    const executeCommand = jest.fn(async () => undefined);
    await executeConfigAction(
        { schemaName: "system.config", ...action },
        context,
        {
            handlers: configCommandHandlers,
            executeCommand: executeCommand as any,
        },
    );
    return { executeCommand };
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

    it("passes agent names as structured arguments, not command text", async () => {
        const { executeCommand } = await run({
            actionName: "toggleAgent",
            parameters: { enable: true, agentNames: ["calendar", "email"] },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["agent"],
            { args: { agentNames: ["calendar", "email"] }, flags: {} },
            context,
        );
    });

    it("disables every requested agent instead of enabling all but the first", async () => {
        const { executeCommand } = await run({
            actionName: "toggleAgent",
            parameters: { enable: false, agentNames: ["player", "email"] },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["agent"],
            { args: {}, flags: { off: ["player", "email"] } },
            context,
        );
    });

    it("does not let a flag-shaped agent name become a flag", async () => {
        const { executeCommand } = await run({
            actionName: "enterAgentPriorityMode",
            parameters: { agentName: "calendar --reset" },
        });

        // The name stays a single value. Interpolating it into a command
        // string would re-tokenize --reset into the real flag and clear the
        // user's whole agent configuration.
        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["agent"],
            { args: {}, flags: { priority: ["calendar --reset"] } },
            context,
        );
    });

    it("keeps the existing developer-mode action behavior", async () => {
        const { executeCommand } = await run({
            actionName: "toggleDeveloperMode",
            parameters: { enable: false },
        });

        expect(executeCommand).toHaveBeenCalledWith(
            configCommandHandlers,
            ["dev", "off"],
            undefined,
            context,
        );
    });
});
