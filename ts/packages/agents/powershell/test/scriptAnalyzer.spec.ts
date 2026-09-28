// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { ScriptRecipe } from "../src/types/scriptRecipe.js";

const complete = jest.fn();
const createChatModel = jest.fn(() => ({ complete }));

jest.unstable_mockModule("@typeagent/aiclient", () => ({
    openai: { createChatModel },
}));

const { ScriptAnalyzer } = await import("../src/analysis/scriptAnalyzer.mjs");

function createAnalysisResult(script: string): ScriptRecipe {
    return {
        version: 1,
        actionName: "importedScript",
        description: "Imported script",
        displayName: "Imported Script",
        parameters: [],
        script: {
            language: "powershell",
            body: script,
            expectedOutputFormat: "text",
        },
        grammarPatterns: [
            {
                pattern: "run imported script",
                isAlias: false,
                examples: [],
            },
        ],
        sandbox: {
            allowedCmdlets: ["Write-Output"],
            allowedPaths: [],
            allowedModules: [],
            maxExecutionTime: 30,
            networkAccess: false,
        },
    };
}

describe("ScriptAnalyzer Copilot transport", () => {
    beforeEach(() => {
        complete.mockReset();
        createChatModel.mockClear();
    });

    test("uses the explicit Copilot default", async () => {
        complete.mockResolvedValue({
            success: true,
            data: JSON.stringify(createAnalysisResult("Get-Location")),
        } as never);

        const result = await new ScriptAnalyzer().analyze(
            "Get-Location",
            "location.ps1",
        );

        expect(createChatModel).toHaveBeenCalledWith("copilot:gpt-5.6-sol");
        expect(result.actionName).toBe("importedScript");
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

    test("preserves imported bytes and marks the recipe as imported", async () => {
        const script = "Write-Output 'original'\r\n";
        complete.mockResolvedValue({
            success: true,
            data: JSON.stringify(createAnalysisResult(script)),
        } as never);

        await expect(
            new ScriptAnalyzer().analyze(script, "imported.ps1"),
        ).resolves.toMatchObject({
            script: { body: script },
            source: {
                type: "imported",
                originalRequest: "Imported PowerShell script",
            },
        });
    });

    test("rejects an analysis result that changes imported bytes", async () => {
        complete.mockResolvedValue({
            success: true,
            data: JSON.stringify(
                createAnalysisResult("Write-Output 'model rewrite'"),
            ),
        } as never);

        await expect(
            new ScriptAnalyzer().analyze(
                "Write-Output 'original'",
                "imported.ps1",
            ),
        ).rejects.toThrow(
            "Analysis changed the imported PowerShell script content.",
        );
    });
});
