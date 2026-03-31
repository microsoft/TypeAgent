// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ReasoningTrace } from "./tracing/types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:reasoning:recipeGenerator");

const RECIPE_MODEL = "claude-sonnet-4-5-20250929";

export interface ScriptRecipe {
    name: string;
    description: string;
    parameters: RecipeParameter[];
    script: string;
    grammarPatterns: string[];
    source?: {
        type: "reasoning" | "manual" | "seed";
        sourceId?: string;
        timestamp: string;
    };
}

export interface RecipeParameter {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
}

const TASKFLOW_API_SCHEMA = `interface TaskFlowScriptAPI {
    /** Call any TypeAgent action by schema + action name */
    callAction(schemaName: string, actionName: string, params: Record<string, unknown>):
        Promise<{ text: string; data: unknown; error?: string }>;
    /** Convenience: callAction("utility", "llmTransform", ...) */
    queryLLM(prompt: string, options?: { input?: string; parseJson?: boolean; model?: string }):
        Promise<{ text: string; data: unknown; error?: string }>;
    /** Convenience: callAction("utility", "webSearch", ...) */
    webSearch(query: string): Promise<{ text: string; data: unknown; error?: string }>;
    /** Convenience: callAction("utility", "webFetch", ...) */
    webFetch(url: string): Promise<{ text: string; data: unknown; error?: string }>;
}`;

const BLOCKED_IDENTIFIERS = [
    "eval",
    "Function",
    "require",
    "import",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "window",
    "document",
    "globalThis",
    "setTimeout",
    "setInterval",
    "process",
    "Buffer",
].join(", ");

/**
 * Generates a TaskFlow script recipe from a successful ReasoningTrace.
 *
 * Filters trace steps to only `execute_action` tool calls, extracts
 * schemaName/actionName/parameters, and uses an LLM to produce a
 * reusable async function execute(api, params) script.
 */
export class ReasoningRecipeGenerator {
    async generate(trace: ReasoningTrace): Promise<ScriptRecipe | null> {
        if (!trace.result.success) {
            debug("Trace was not successful, skipping recipe generation");
            return null;
        }

        const executeSteps = trace.steps.filter(
            (s) => s.action?.tool === "execute_action" && s.result?.success,
        );

        if (executeSteps.length === 0) {
            debug("No execute_action steps found in trace");
            return null;
        }

        const stepsData = executeSteps.map((step) => ({
            schemaName: step.action!.schemaName,
            actionName: step.action!.actionName,
            parameters: step.action!.parameters,
            result: step.result?.data,
        }));

        const prompt = this.buildPrompt(
            trace.session.originalRequest,
            stepsData,
        );

        try {
            const recipe = await this.generateWithLLM(prompt);
            if (!recipe) return null;

            // Validate the generated script
            const validationErrors = this.validateScript(recipe.script);
            if (validationErrors.length > 0) {
                debug(
                    "Generated script failed validation, retrying:",
                    validationErrors,
                );
                const retryPrompt = this.buildRetryPrompt(
                    prompt,
                    recipe.script,
                    validationErrors,
                );
                const retryRecipe = await this.generateWithLLM(retryPrompt);
                if (retryRecipe) {
                    const retryErrors = this.validateScript(retryRecipe.script);
                    if (retryErrors.length === 0) {
                        retryRecipe.source = {
                            type: "reasoning",
                            sourceId: trace.session.requestId,
                            timestamp: new Date().toISOString(),
                        };
                        return retryRecipe;
                    }
                }
                debug("Retry also failed validation");
                return null;
            }

            recipe.source = {
                type: "reasoning",
                sourceId: trace.session.requestId,
                timestamp: new Date().toISOString(),
            };
            return recipe;
        } catch (error) {
            debug("Failed to generate recipe:", error);
            return null;
        }
    }

    private buildPrompt(
        originalRequest: string,
        steps: Array<{
            schemaName: string | undefined;
            actionName: string | undefined;
            parameters: any;
            result: any;
        }>,
    ): string {
        const stepsJson = JSON.stringify(steps, null, 2);

        return `You are generating a reusable TaskFlow script from a successful reasoning trace.

Original user request: "${originalRequest}"

Steps executed (only execute_action calls):
${stepsJson}

The script's \`api\` parameter implements the following TypeScript interface.
Use ONLY these methods in the generated script:

\`\`\`typescript
${TASKFLOW_API_SCHEMA}
\`\`\`

SCRIPT GENERATION RULES:
1. The script must define: async function execute(api, params) { ... }
2. Call agent actions via api.callAction(schemaName, actionName, params)
3. Use api.queryLLM() for LLM transform steps, api.webSearch() for web search, api.webFetch() for URL fetch
4. Use api.callAction() for all other agent actions (email, calendar, player, list, etc.)
5. Add error checking: if a step returns an error, return { success: false, error: ... }
6. Return { success: true, message: "..." } on success
7. Parameterize values that change between invocations via params.paramName
8. Use template literals for string interpolation: \`Top \${params.quantity} songs\`
9. Default LLM model: "claude-haiku-4-5-20251001" for extraction/formatting
10. BLOCKED identifiers — do NOT use: ${BLOCKED_IDENTIFIERS}

GRAMMAR PATTERN RULES:
- Lead with 2-3 distinctive fixed tokens before any wildcard
- Include a flow-specific anchor keyword that no other agent uses (e.g., "playlist", "digest", "agenda")
- Make distinguishing tokens mandatory, not optional
- Avoid starting with verbs owned by other agents: "search", "play", "email", "find", "send", "show"
- Only two capture types: $(name:wildcard) for strings, $(name:number) for numbers
- NEVER use $(name:string) or $(name:integer) — those are invalid
- Provide 3-5 pattern variants with different leading phrases

Generate a JSON object:
{
  "name": "camelCaseActionName",
  "description": "what this flow does",
  "parameters": [
    { "name": "param", "type": "string", "required": true, "description": "..." },
    { "name": "optionalParam", "type": "number", "required": false, "default": 10, "description": "..." }
  ],
  "script": "async function execute(api, params) { ... }",
  "grammarPatterns": [
    "natural language pattern with $(paramName:wildcard) or $(paramName:number) captures"
  ]
}

Return ONLY the JSON object, no markdown or explanation.`;
    }

    private buildRetryPrompt(
        originalPrompt: string,
        failedScript: string,
        errors: string[],
    ): string {
        return `${originalPrompt}

PREVIOUS ATTEMPT FAILED SCRIPT VALIDATION. Fix these errors in the script field:
${errors.map((e) => `- ${e}`).join("\n")}

Failed script:
${failedScript}

Generate a corrected version. Return ONLY the JSON object, no markdown or explanation.`;
    }

    private validateScript(source: string): string[] {
        const errors: string[] = [];

        if (
            !/async\s+function\s+execute\s*\(\s*api\s*,\s*params\s*\)/.test(
                source,
            )
        ) {
            errors.push(
                'Script must define "async function execute(api, params)"',
            );
        }

        const blocked = [
            "eval",
            "Function",
            "require",
            "import",
            "fetch",
            "XMLHttpRequest",
            "WebSocket",
            "window",
            "document",
            "globalThis",
            "setTimeout",
            "setInterval",
            "process",
            "Buffer",
        ];

        const lines = source.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

            for (const id of blocked) {
                const pattern = new RegExp(`\\b${id}\\b`);
                if (pattern.test(line)) {
                    const withoutStrings = line
                        .replace(/"[^"]*"/g, '""')
                        .replace(/'[^']*'/g, "''")
                        .replace(/`[^`]*`/g, "``");
                    if (pattern.test(withoutStrings)) {
                        errors.push(`Disallowed identifier: '${id}'`);
                    }
                }
            }
        }

        return errors;
    }

    private async generateWithLLM(
        prompt: string,
    ): Promise<ScriptRecipe | null> {
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
            if (!recipe.name || !recipe.script) {
                debug("Invalid recipe: missing name or script");
                return null;
            }
            return recipe;
        } catch (error) {
            debug("Failed to parse recipe JSON:", error);
            return null;
        }
    }
}
