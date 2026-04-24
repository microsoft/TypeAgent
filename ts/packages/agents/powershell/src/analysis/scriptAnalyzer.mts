// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptRecipe } from "../types/scriptRecipe.js";
import { basename } from "path";
import registerDebug from "debug";

const debug = registerDebug("typeagent:powershell:analyzer");

const ANALYSIS_MODEL = "claude-sonnet-4-5-20250929";
const MAX_SCRIPT_SIZE = 100 * 1024; // 100KB

export class ScriptAnalyzer {
    async analyze(
        scriptContent: string,
        filePath: string,
        overrideActionName?: string,
    ): Promise<ScriptRecipe> {
        if (scriptContent.length > MAX_SCRIPT_SIZE) {
            throw new Error(
                `Script too large for analysis (${(scriptContent.length / 1024).toFixed(0)}KB, max 100KB)`,
            );
        }

        const fileName = basename(filePath);
        const prompt = this.buildPrompt(
            scriptContent,
            fileName,
            overrideActionName,
        );

        let result = "";
        const queryInstance = query({
            prompt,
            options: {
                model: ANALYSIS_MODEL,
                maxTurns: 1,
            },
        });

        for await (const message of queryInstance) {
            if (message.type === "result" && message.subtype === "success") {
                result = message.result;
            }
        }

        if (!result) {
            throw new Error("LLM returned no result during script analysis");
        }

        const jsonMatch =
            result.match(/```json\s*([\s\S]*?)\s*```/) ||
            result.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
            debug("Could not extract JSON from LLM response");
            throw new Error("Failed to parse analysis result as JSON");
        }

        const recipe = JSON.parse(jsonMatch[1]) as ScriptRecipe;
        if (!recipe.actionName || !recipe.script?.body) {
            throw new Error(
                "Analysis produced invalid recipe: missing actionName or script.body",
            );
        }

        recipe.version = 1;
        recipe.source = {
            type: "manual",
            timestamp: new Date().toISOString(),
            originalRequest: `Imported from ${filePath}`,
        };

        return recipe;
    }

    private buildPrompt(
        scriptContent: string,
        fileName: string,
        overrideActionName?: string,
    ): string {
        const nameInstruction = overrideActionName
            ? `Use "${overrideActionName}" as the actionName.`
            : "Derive a camelCase actionName from the script's purpose.";

        return `You are analyzing an existing PowerShell script to create a reusable script flow recipe.

Script file: "${fileName}"

Script contents:
\`\`\`powershell
${scriptContent}
\`\`\`

Analyze this script and generate a recipe JSON object:

1. **actionName**: ${nameInstruction}
2. **description**: Concise description of what the script does.
3. **displayName**: Human-readable name.
4. **parameters**: Extract from the param() block if present. Map PowerShell types:
   [string] -> "string", [int] -> "number", [bool]/[switch] -> "boolean", paths -> "path".
   Include defaults from the param() block. If no param() block exists, infer likely
   parameters from hardcoded values in the script.
5. **script.body**: Use the EXACT script content provided. Do NOT modify it.
6. **script.expectedOutputFormat**: "text", "json", "objects", or "table" based on output cmdlets used.
7. **grammarPatterns**: 2-4 patterns with objects containing:
   - pattern: AGR grammar pattern using $(paramName:wildcard) for strings/paths or $(paramName:number) for numbers
   - isAlias: true for terse shell-like forms, false for natural language
   - examples: 2-3 example invocations
   Include at least one natural language pattern and one terse alias if applicable.
8. **sandbox**: Only cmdlets actually used in the script plus standard pipeline utilities
   (Select-Object, Where-Object, ForEach-Object, Format-Table, Out-String, Sort-Object).
   Set networkAccess: true only if the script uses network cmdlets (Invoke-WebRequest, etc.).

Return ONLY a JSON object matching this schema (no markdown fences, no explanation):
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this script does",
  "displayName": "Human Readable Name",
  "parameters": [
    { "name": "paramName", "type": "string|number|boolean|path", "required": true, "description": "...", "default": "optional default" }
  ],
  "script": {
    "language": "powershell",
    "body": "<exact script content>",
    "expectedOutputFormat": "text|json|objects|table"
  },
  "grammarPatterns": [
    { "pattern": "natural language $(param:wildcard)", "isAlias": false, "examples": ["example"] },
    { "pattern": "short $(param:wildcard)", "isAlias": true, "examples": ["example"] }
  ],
  "sandbox": {
    "allowedCmdlets": ["Get-ChildItem", "Select-Object"],
    "allowedPaths": ["$env:USERPROFILE", "$PWD", "$env:TEMP"],
    "allowedModules": ["Microsoft.PowerShell.Management"],
    "maxExecutionTime": 30,
    "networkAccess": false
  }
}`;
    }
}
