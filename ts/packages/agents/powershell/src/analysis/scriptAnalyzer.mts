// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import {
    getRequiredModules,
    type ScriptRecipe,
} from "../types/scriptRecipe.js";
import { validatePowerShellIdentifier } from "@typeagent/agent-flows/powershell/integrity";
import { basename } from "path";
import registerDebug from "debug";

const debug = registerDebug("typeagent:powershell:analyzer");

const ANALYSIS_MODEL = "copilot:gpt-5.6-sol";
const MAX_SCRIPT_SIZE = 100 * 1024; // 100KB

export class ScriptAnalyzer {
    async analyze(
        scriptContent: string,
        filePath: string,
        overrideActionName?: string,
    ): Promise<ScriptRecipe> {
        if (overrideActionName !== undefined)
            validatePowerShellIdentifier(overrideActionName);
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

        const completion = await openai
            .createChatModel(ANALYSIS_MODEL)
            .complete(prompt);
        if (!completion.success) {
            throw new Error(`Script analysis failed: ${completion.message}`);
        }
        const result = completion.data;
        if (!result.trim()) {
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
        validatePowerShellIdentifier(recipe.actionName);
        if (!recipe.actionName || !recipe.script?.body) {
            throw new Error(
                "Analysis produced invalid recipe: missing actionName or script.body",
            );
        }
        if (recipe.script.body !== scriptContent) {
            throw new Error(
                "Analysis changed the imported PowerShell script content.",
            );
        }

        recipe.version = 1;
        recipe.requiredModules = getRequiredModules(recipe);
        recipe.sandbox = {
            maxExecutionTime: Math.min(
                Math.max(recipe.sandbox?.maxExecutionTime ?? 30, 1),
                120,
            ),
        };
        recipe.source = {
            type: "imported",
            timestamp: new Date().toISOString(),
            originalRequest: "Imported PowerShell script",
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
   [string] -> "string", [int] -> "number", [bool]/[switch] -> "boolean",
   filesystem paths -> "path", and values passed to executable command parameters
   such as Start-Process -FilePath -> "executable".
   Include defaults from the param() block. If no param() block exists, infer likely
   parameters from hardcoded values in the script.
5. **script.body**: Use the EXACT script content provided. Do NOT modify it.
6. **script.expectedOutputFormat**: "text", "json", "objects", or "table" based on output cmdlets used.
7. **grammarPatterns**: 2-4 patterns with objects containing:
   - pattern: AGR grammar pattern using $(paramName:wildcard) for strings/paths or $(paramName:number) for numbers
   - isAlias: true for terse shell-like forms, false for natural language
   - examples: 2-3 example invocations
   Include at least one natural language pattern and one terse alias if applicable.
8. **requiredModules**: Installed module names needed by this script, or [].
   Dependencies are loaded only after user authorization. There is no cmdlet catalogue.
9. **sandbox.maxExecutionTime**: Operational timeout, between 1 and 120 seconds.
   After authorization, the script runs with the current user's permissions.
   It is not sandboxed. Importing or analyzing it does not authorize execution.

Return ONLY a JSON object matching this schema (no markdown fences, no explanation):
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this script does",
  "displayName": "Human Readable Name",
  "parameters": [
    { "name": "paramName", "type": "string|number|boolean|path|executable", "required": true, "description": "...", "default": "optional default" }
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
  "requiredModules": [],
  "sandbox": { "maxExecutionTime": 30 }
}`;
    }
}
