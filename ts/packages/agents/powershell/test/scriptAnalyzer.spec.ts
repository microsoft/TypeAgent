// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const complete = jest.fn();
const createChatModel = jest.fn(() => ({ complete }));

jest.unstable_mockModule("@typeagent/aiclient", () => ({
    openai: { createChatModel },
}));

const { ScriptAnalyzer } = await import("../src/analysis/scriptAnalyzer.mjs");

const recipe = {
    version: 1,
    actionName: "showLocation",
    description: "Shows the current location",
    displayName: "Show Location",
    parameters: [],
    script: {
        language: "powershell",
        body: "Get-Location",
        expectedOutputFormat: "text",
    },
    grammarPatterns: [],
    sandbox: {
        allowedCmdlets: ["Get-Location"],
        allowedPaths: [],
        allowedModules: [],
        maxExecutionTime: 30,
        networkAccess: false,
    },
};

describe("ScriptAnalyzer Copilot transport", () => {
    beforeEach(() => {
        complete.mockReset();
        createChatModel.mockClear();
    });

    test("uses the explicit Copilot default", async () => {
        complete.mockResolvedValue({
            success: true,
            data: JSON.stringify(recipe),
        } as never);

        const result = await new ScriptAnalyzer().analyze(
            "Get-Location",
            "location.ps1",
        );

        expect(createChatModel).toHaveBeenCalledWith("copilot:gpt-5.6-sol");
        expect(result.actionName).toBe("showLocation");
    });

    test("surfaces transport failures", async () => {
        complete.mockResolvedValue({
            success: false,
            message: "Copilot is unavailable",
        } as never);

        await expect(
            new ScriptAnalyzer().analyze("Get-Location", "location.ps1"),
        ).rejects.toThrow("Script analysis failed: Copilot is unavailable");
    });
});
