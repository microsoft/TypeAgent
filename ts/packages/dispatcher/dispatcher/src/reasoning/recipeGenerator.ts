// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ReasoningTrace } from "./tracing/types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:reasoning:recipeGenerator");

const RECIPE_MODEL = "claude-sonnet-4-5-20250929";

export interface Recipe {
    version: 1;
    actionName: string;
    description: string;
    parameters: RecipeParameter[];
    steps: RecipeStep[];
    grammarPatterns: string[];
    source?: {
        type: "reasoning" | "browser" | "webtask" | "manual";
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
    testValue?: unknown;
}

export interface RecipeStep {
    id: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
    observedOutputFormat?: string;
}

/**
 * Generates a TaskFlow recipe from a successful ReasoningTrace.
 *
 * Filters trace steps to only `execute_action` tool calls, extracts
 * schemaName/actionName/parameters, and uses an LLM to determine which
 * parameter values should be generalized into recipe parameters.
 */
export class ReasoningRecipeGenerator {
    async generate(trace: ReasoningTrace): Promise<Recipe | null> {
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
            if (recipe) {
                recipe.source = {
                    type: "reasoning",
                    sourceId: trace.session.requestId,
                    timestamp: new Date().toISOString(),
                };
            }
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

        return `You are generating a reusable TaskFlow recipe from a successful reasoning trace.

Original user request: "${originalRequest}"

Steps executed (only execute_action calls):
${stepsJson}

Generate a recipe JSON object that:
1. Has a camelCase actionName derived from the task description
2. Identifies which parameter values should become recipe parameters (values that would change between invocations) vs hardcoded values
3. Uses \${paramName} for recipe parameters and \${stepId.text} or \${stepId.data} for step-to-step data flow
4. Includes 3-5 grammar patterns using $(paramName:wildcard) or $(paramName:number) captures

Return ONLY a JSON object matching this schema:
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this flow does",
  "parameters": [
    { "name": "paramName", "type": "string", "required": true, "description": "..." },
    { "name": "optionalParam", "type": "string", "required": false, "default": "default value", "description": "..." }
  ],
  "steps": [
    {
      "id": "stepId",
      "schemaName": "utility",
      "actionName": "webSearch",
      "parameters": { "query": "\${paramName}" },
      "observedOutputFormat": "description of output shape"
    }
  ],
  "grammarPatterns": [
    "natural language pattern with $(paramName:wildcard) captures"
  ]
}

Return ONLY the JSON object, no markdown or explanation.`;
    }

    private async generateWithLLM(prompt: string): Promise<Recipe | null> {
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

        // Extract JSON from response
        const jsonMatch =
            result.match(/```json\s*([\s\S]*?)\s*```/) ||
            result.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
            debug("Could not extract JSON from LLM response");
            return null;
        }

        try {
            const recipe = JSON.parse(jsonMatch[1]) as Recipe;
            if (
                !recipe.actionName ||
                !recipe.steps ||
                recipe.steps.length === 0
            ) {
                debug("Invalid recipe: missing actionName or steps");
                return null;
            }
            recipe.version = 1;
            return recipe;
        } catch (error) {
            debug("Failed to parse recipe JSON:", error);
            return null;
        }
    }
}
