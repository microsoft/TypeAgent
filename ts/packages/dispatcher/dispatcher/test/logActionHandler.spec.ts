// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";

const mockShowLogStatus = jest.fn();
const mockSetLogProfile = jest.fn();
const mockClearLogSettings = jest.fn();
const mockOpenLogTrace = jest.fn(async () => undefined);
jest.unstable_mockModule(
    "../src/context/system/handlers/logCommandHandler.js",
    () => ({
        showLogStatus: mockShowLogStatus,
        setLogProfile: mockSetLogProfile,
        clearLogSettings: mockClearLogSettings,
        openLogTrace: mockOpenLogTrace,
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
        [{ actionName: "showLogStatus" }, () => mockShowLogStatus, [] as any[]],
        [
            {
                actionName: "setLogProfile",
                parameters: { profile: "diagnostic" },
            },
            () => mockSetLogProfile,
            ["diagnostic"],
        ],
        [{ actionName: "clearLogSettings" }, () => mockClearLogSettings, []],
        [
            {
                actionName: "openLogTrace",
                parameters: {
                    traceId: "0123456789abcdef0123456789abcdef",
                },
            },
            () => mockOpenLogTrace,
            ["0123456789abcdef0123456789abcdef"],
        ],
        [
            {
                actionName: "openLogTrace",
                parameters: { traceId: "last" },
            },
            () => mockOpenLogTrace,
            ["last"],
        ],
    ])("maps %j to the shared control", async (action, getHandler, args) => {
        await run(action);
        expect(getHandler()).toHaveBeenCalledWith(
            ...args,
            expect.objectContaining({
                sessionContext: { agentContext },
            }),
        );
    });
});
