// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ReasoningTrace } from "./tracing/types.js";
import registerDebug from "debug";

const debug = registerDebug(
    "typeagent:dispatcher:reasoning:scriptRecipeGenerator",
);

const RECIPE_MODEL = "claude-sonnet-4-5-20250929";

export interface ScriptCapture {
    stepNumber: number;
    rawCommand: string;
    scriptBody: string;
    output: string;
    exitCode: number;
    originalRequest: string;
}

export interface ScriptRecipe {
    version: 1;
    actionName: string;
    description: string;
    displayName: string;
    parameters: ScriptParameter[];
    script: {
        language: "powershell";
        body: string;
        expectedOutputFormat: "text" | "json" | "objects" | "table";
    };
    grammarPatterns: GrammarPattern[];
    sandbox: SandboxPolicy;
    source?: {
        type: "reasoning" | "manual";
        requestId?: string;
        timestamp: string;
        originalRequest?: string;
    };
}

export interface ScriptParameter {
    name: string;
    type: "string" | "number" | "boolean" | "path";
    required: boolean;
    description: string;
    default?: unknown;
}

export interface GrammarPattern {
    pattern: string;
    isAlias: boolean;
    examples: string[];
}

export interface SandboxPolicy {
    allowedCmdlets: string[];
    allowedPaths: string[];
    allowedModules: string[];
    maxExecutionTime: number;
    networkAccess: boolean;
}

const PS_DETECTION_PATTERN =
    /powershell|pwsh|Get-|Set-|New-|Remove-|Select-|Where-|ForEach-|Test-Path|Measure-Object/i;

export function isPowerShellExecution(bashCommand: string): boolean {
    return PS_DETECTION_PATTERN.test(bashCommand);
}

export function extractPowerShellScript(bashCommand: string): string | null {
    // powershell -NoProfile -Command "& { <script> }"
    let match = bashCommand.match(
        /powershell[^"]*-Command\s+"&\s*\{\s*([\s\S]*?)\s*\}"/i,
    );
    if (match) return match[1].trim();

    // powershell -NoProfile -Command "<pipeline>"
    match = bashCommand.match(/powershell[^"]*-Command\s+"([\s\S]+?)"/i);
    if (match) return match[1].trim();

    // powershell -Command '<pipeline>' (single quotes)
    match = bashCommand.match(/powershell[^']*-Command\s+'([\s\S]+?)'/i);
    if (match) return match[1].trim();

    // pwsh variants
    match = bashCommand.match(
        /pwsh[^"]*-Command\s+"&?\s*\{?\s*([\s\S]*?)\s*\}?"/i,
    );
    if (match) return match[1].trim();

    // Inline cmdlets without explicit powershell prefix (when the command IS a cmdlet)
    if (
        /^(Get-|Set-|New-|Remove-|Select-|Where-|ForEach-|Test-|Measure-|Copy-|Move-|Add-)/i.test(
            bashCommand.trim(),
        )
    ) {
        return bashCommand.trim();
    }

    return null;
}

export function extractScriptsFromTrace(
    trace: ReasoningTrace,
): ScriptCapture[] {
    const captures: ScriptCapture[] = [];

    for (const step of trace.steps) {
        if (!step.action || !step.result) continue;

        // Look for Bash tool calls that contain PowerShell
        const toolName = step.action.tool;
        if (
            !toolName.includes("Bash") &&
            toolName !== "Bash" &&
            !toolName.includes("bash")
        ) {
            continue;
        }

        const command = step.action.parameters?.command ?? "";
        if (!isPowerShellExecution(command)) continue;

        const scriptBody = extractPowerShellScript(command);
        if (!scriptBody) continue;

        // Only capture successful executions
        if (!step.result.success) continue;

        captures.push({
            stepNumber: step.stepNumber,
            rawCommand: command,
            scriptBody,
            output:
                typeof step.result.data === "string"
                    ? step.result.data
                    : JSON.stringify(step.result.data ?? ""),
            exitCode: 0,
            originalRequest: trace.session.originalRequest,
        });
    }

    return captures;
}

/**
 * Generates PowerShell recipes from PowerShell scripts found in reasoning traces.
 */
export class ScriptRecipeGenerator {
    async generate(trace: ReasoningTrace): Promise<ScriptRecipe[]> {
        if (!trace.result.success) {
            debug(
                "Trace was not successful, skipping script recipe generation",
            );
            return [];
        }

        const captures = extractScriptsFromTrace(trace);
        if (captures.length === 0) {
            debug("No PowerShell scripts found in trace");
            return [];
        }

        const recipes: ScriptRecipe[] = [];

        for (const capture of captures) {
            try {
                const recipe = await this.generalizeScript(capture);
                if (recipe) {
                    recipe.source = {
                        type: "reasoning",
                        requestId: trace.session.requestId,
                        timestamp: new Date().toISOString(),
                        originalRequest: trace.session.originalRequest,
                    };
                    recipes.push(recipe);
                }
            } catch (error) {
                debug("Failed to generalize script:", error);
            }
        }

        return recipes;
    }

    private async generalizeScript(
        capture: ScriptCapture,
    ): Promise<ScriptRecipe | null> {
        const prompt = this.buildPrompt(capture);

        let result = "";
        const queryInstance = query({
            prompt,
            options: {
                model: RECIPE_MODEL,
                maxTurns: 1,
            },
        });

        for await (const message of queryInstance) {
            if (message.type === "result" && message.subtype === "success") {
                result = message.result;
            }
        }

        if (!result) return null;

        const jsonMatch =
            result.match(/```json\s*([\s\S]*?)\s*```/) ||
            result.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
            debug("Could not extract JSON from LLM response");
            return null;
        }

        try {
            const recipe = JSON.parse(jsonMatch[1]) as ScriptRecipe;
            if (!recipe.actionName || !recipe.script?.body) {
                debug(
                    "Invalid script recipe: missing actionName or script.body",
                );
                return null;
            }
            recipe.version = 1;
            return recipe;
        } catch (error) {
            debug("Failed to parse script recipe JSON:", error);
            return null;
        }
    }

    private buildPrompt(capture: ScriptCapture): string {
        return `You are generating a reusable PowerShell script recipe from a successful reasoning trace.

Original user request: "${capture.originalRequest}"

PowerShell script executed:
\`\`\`powershell
${capture.scriptBody}
\`\`\`

Script output (truncated): ${capture.output.substring(0, 500)}

Generate a script recipe JSON object that:
1. Has a camelCase actionName derived from what the script does
2. Has a human-readable displayName
3. Generalizes hardcoded values (paths, search patterns, filenames, counts) into parameters with sensible defaults
4. Parameters use types: "string", "number", "boolean", or "path" (for filesystem paths)
5. The script body uses PowerShell param() block with the generalized parameters
6. Includes grammarPatterns array with objects containing:
   - pattern: AGR grammar pattern using $(paramName:wildcard) for strings/paths or $(paramName:number) for numbers
   - isAlias: true for terse shell-like forms (e.g. "ls"), false for natural language
   - examples: 2-3 example invocations
   Include at least one natural language pattern and one terse alias if applicable
7. Includes a sandbox policy with:
   - allowedCmdlets: only the cmdlets this script actually needs plus pipeline utilities (Select-Object, Where-Object, ForEach-Object, Format-Table, Out-String, Sort-Object)
   - allowedPaths: ["$env:USERPROFILE", "$PWD", "$env:TEMP"] unless broader access needed
   - allowedModules: PowerShell modules needed
   - maxExecutionTime: reasonable timeout in seconds (15-60)
   - networkAccess: false unless the script uses network cmdlets
8. expectedOutputFormat: "text", "json", "objects", or "table"

Return ONLY a JSON object matching this schema (no markdown fences, no explanation):
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this script does",
  "displayName": "Human Readable Name",
  "parameters": [
    { "name": "paramName", "type": "string|number|boolean|path", "required": true|false, "description": "...", "default": "optional default" }
  ],
  "script": {
    "language": "powershell",
    "body": "param([string]$Param = 'default')\\nGet-ChildItem -Path $Param",
    "expectedOutputFormat": "text|json|objects|table"
  },
  "grammarPatterns": [
    { "pattern": "list files in $(path:wildcard)", "isAlias": false, "examples": ["list files in downloads"] },
    { "pattern": "ls $(path:wildcard)", "isAlias": true, "examples": ["ls downloads"] }
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
