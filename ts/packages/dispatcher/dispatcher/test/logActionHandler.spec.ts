// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";

const mockProcessCommandNoLock = jest.fn();
jest.unstable_mockModule("../src/command/command.js", () => ({
    processCommandNoLock: mockProcessCommandNoLock,
}));

const { executeLogAction } = await import(
    "../src/context/system/action/logActionHandler.js"
);

const agentContext = { id: "agent-context" } as any;

async function run(action: any) {
    mockProcessCommandNoLock.mockClear();
    await executeLogAction({ schemaName: "system.log", ...action }, {
        sessionContext: { agentContext },
    } as any);
}

describe("executeLogAction delegates to @log commands", () => {
    it.each([
        [{ actionName: "showLogStatus" }, "@log status"],
        [
            {
                actionName: "setLogProfile",
                parameters: { profile: "diagnostic" },
            },
            "@log profile diagnostic",
        ],
        [
            {
                actionName: "setLogDebugCopy",
                parameters: { enabled: true },
            },
            "@log debug-copy on",
        ],
        [
            {
                actionName: "setLogDebugCopy",
                parameters: { enabled: false },
            },
            "@log debug-copy off",
        ],
        [{ actionName: "clearLogSettings" }, "@log clear"],
    ])("maps %j to %s", async (action, command) => {
        await run(action);
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            command,
            agentContext,
        );
    });
});
