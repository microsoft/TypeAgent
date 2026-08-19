// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";

const mockShowLogStatus = jest.fn();
const mockSetLogProfile = jest.fn();
const mockClearLogSettings = jest.fn();
jest.unstable_mockModule(
    "../src/context/system/handlers/logCommandHandler.js",
    () => ({
        showLogStatus: mockShowLogStatus,
        setLogProfile: mockSetLogProfile,
        clearLogSettings: mockClearLogSettings,
    }),
);

const { executeLogAction } = await import(
    "../src/context/system/action/logActionHandler.js"
);

const agentContext = { id: "agent-context" } as any;

async function run(action: any) {
    jest.clearAllMocks();
    await executeLogAction({ schemaName: "system.log", ...action }, {
        sessionContext: { agentContext },
    } as any);
}

describe("executeLogAction delegates to shared log controls", () => {
    it.each([
        [{ actionName: "showLogStatus" }, mockShowLogStatus, []],
        [
            {
                actionName: "setLogProfile",
                parameters: { profile: "diagnostic" },
            },
            mockSetLogProfile,
            ["diagnostic"],
        ],
        [{ actionName: "clearLogSettings" }, mockClearLogSettings, []],
    ])("maps %j to the shared control", async (action, handler, args) => {
        await run(action);
        expect(handler).toHaveBeenCalledWith(
            ...args,
            expect.objectContaining({
                sessionContext: { agentContext },
            }),
        );
    });
});
