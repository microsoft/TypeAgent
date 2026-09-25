// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { ScriptAnalyzer } from "../src/analysis/scriptAnalyzer.mjs";
import type { ScriptRecipe } from "../src/types/scriptRecipe.js";

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

describe("ScriptAnalyzer", () => {
    it("preserves imported bytes and marks the recipe as imported", async () => {
        const script = "Write-Output 'original'\r\n";
        const analyzer = new ScriptAnalyzer(async () =>
            JSON.stringify(createAnalysisResult(script)),
        );

        await expect(
            analyzer.analyze(script, "imported.ps1"),
        ).resolves.toMatchObject({
            script: { body: script },
            source: {
                type: "imported",
                originalRequest: "Imported PowerShell script",
            },
        });
    });

    it("rejects an analysis result that changes imported bytes", async () => {
        const analyzer = new ScriptAnalyzer(async () =>
            JSON.stringify(
                createAnalysisResult("Write-Output 'model rewrite'"),
            ),
        );

        await expect(
            analyzer.analyze("Write-Output 'original'", "imported.ps1"),
        ).rejects.toThrow(
            "Analysis changed the imported PowerShell script content.",
        );
    });
});
