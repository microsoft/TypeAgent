// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ReasoningTrace } from "../tracing/types.js";
import { WorkflowPlan } from "./types.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:planning");

const PLAN_GENERATION_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Generates structured workflow plans from successful reasoning traces
 */
export class PlanGenerator {
    /**
     * Generate a workflow plan from a successful trace
     */
    async generatePlan(trace: ReasoningTrace): Promise<WorkflowPlan | null> {
        if (!trace.result.success) {
            debug("Cannot generate plan from failed trace");
            return null;
        }

        try {
            // Build the plan generation prompt
            const prompt = this.buildPlanGenerationPrompt(trace);

            // Use Claude to analyze the trace and generate a structured plan
            const planJson = await this.generatePlanWithClaude(prompt);

            if (!planJson) {
                debug("Claude did not return a valid plan");
                return null;
            }

            // Build the complete WorkflowPlan
            const plan: WorkflowPlan = {
                planId: this.generatePlanId(),
                description: planJson.description,
                intent: planJson.intent,
                createdAt: new Date().toISOString(),
                version: 1,
                steps: planJson.steps,
                variables: planJson.variables,
                source: {
                    traceId: trace.session.requestId,
                    originalRequest: trace.session.originalRequest,
                    generatedFrom: "trace",
                },
                usage: {
                    successCount: 1,
                    failureCount: 0,
                    lastUsed: new Date().toISOString(),
                    avgDuration: trace.metrics.duration,
                },
            };

            debug(`Generated plan: ${plan.planId} (${plan.intent})`);
            return plan;
        } catch (error) {
            console.error("Failed to generate plan from trace:", error);
            return null;
        }
    }

    /**
     * Build the prompt for plan generation
     */
    private buildPlanGenerationPrompt(trace: ReasoningTrace): string {
        // Extract tool calls and results
        const toolCalls = trace.steps
            .filter((s) => s.action)
            .map((s, idx) => ({
                stepNumber: idx + 1,
                tool: s.action!.tool,
                schemaName: s.action!.schemaName,
                actionName: s.action!.actionName,
                parameters: s.action!.parameters,
                result: s.result,
            }));

        return `Analyze the following successful reasoning trace and generate a reusable workflow plan.

# Original Request
${trace.session.originalRequest}

# Execution Trace
${JSON.stringify(toolCalls, null, 2)}

# Task
Generate a structured workflow plan that can be reused for similar requests. The plan should:

1. **Extract the general pattern**: Identify what makes this workflow reusable
2. **Parameterize**: Replace specific values with variables (e.g., "LED light bulbs" → {{searchQuery}})
3. **Define steps**: Break down into clear, sequential steps with objectives
4. **Classify intent**: Categorize the plan type (e.g., "web_search", "data_extraction", "email_task")
5. **Define preconditions**: Specify what conditions must be met before each step

# Output Format
Return a JSON object with this structure:

{
  "description": "Brief description of what this workflow does",
  "intent": "Intent category (e.g., 'web_search', 'data_extraction', 'web_automation', 'email_task')",
  "steps": [
    {
      "stepId": "step-1",
      "stepNumber": 1,
      "objective": "What this step accomplishes",
      "description": "Detailed description",
      "action": {
        "schemaName": "browser",
        "actionName": "search",
        "parameterTemplate": {
          "query": "{{searchQuery}}",
          "site": "{{targetSite}}"
        }
      },
      "preconditions": [
        {
          "type": "variable_exists",
          "description": "Search query must be provided",
          "expression": "{{searchQuery}}",
          "required": true
        }
      ],
      "outputVariables": [
        {
          "name": "searchResults",
          "source": "action_result",
          "extractionPath": "$.results"
        }
      ]
    }
  ],
  "variables": [
    {
      "name": "searchQuery",
      "type": "string",
      "description": "The search term to use",
      "scope": "plan"
    },
    {
      "name": "targetSite",
      "type": "string",
      "description": "The website to search on",
      "scope": "plan"
    }
  ]
}

# Guidelines
- Use {{variableName}} syntax for parameters that should be filled in at execution time
- Keep step descriptions clear and action-oriented
- Include only essential variables that vary between executions
- Make the plan general enough to apply to similar requests
- Use descriptive variable names (e.g., {{productName}}, not {{param1}})

# IMPORTANT
Return ONLY the JSON object with no additional text, explanations, or markdown formatting. Start your response with { and end with }.

Generate the plan now:`;
    }

    /**
     * Use Claude to generate the plan structure
     */
    private async generatePlanWithClaude(prompt: string): Promise<any> {
        try {
            const queryInstance = query({
                prompt,
                options: {
                    model: PLAN_GENERATION_MODEL,
                    maxTurns: 1,
                    maxThinkingTokens: 5000,
                    allowedTools: [], // No tools needed for plan generation
                },
            });

            let result: string | undefined;

            for await (const message of queryInstance) {
                if (message.type === "assistant") {
                    for (const content of message.message.content) {
                        if (content.type === "text") {
                            result = content.text;
                        }
                    }
                } else if (message.type === "result") {
                    if (message.subtype === "success") {
                        result = message.result;
                    } else {
                        const errors =
                            "errors" in message
                                ? (message as any).errors
                                : undefined;
                        throw new Error(
                            `Plan generation failed: ${errors?.join(", ") || "Unknown error"}`,
                        );
                    }
                }
            }

            if (!result) {
                return null;
            }

            // Extract JSON from the response with multiple strategies
            let jsonText: string;

            // Strategy 1: Try to extract from markdown code blocks
            const codeBlockMatch = result.match(
                /```(?:json)?\s*([\s\S]*?)\s*```/,
            );
            if (codeBlockMatch) {
                jsonText = codeBlockMatch[1].trim();
            } else {
                // Strategy 2: Find JSON object in the text (look for { ... })
                const jsonObjectMatch = result.match(/\{[\s\S]*\}/);
                if (jsonObjectMatch) {
                    jsonText = jsonObjectMatch[0];
                } else {
                    // Strategy 3: Use the entire result
                    jsonText = result.trim();
                }
            }

            try {
                return JSON.parse(jsonText);
            } catch (error) {
                debug("Failed to parse plan JSON:", jsonText.substring(0, 200));
                throw new Error(
                    `Invalid JSON response from plan generation: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        } catch (error) {
            debug("Failed to generate plan with Claude:", error);
            throw error;
        }
    }

    /**
     * Generate a unique plan ID
     */
    private generatePlanId(): string {
        return `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Validate that a plan has required fields
     */
    validatePlan(plan: any): plan is WorkflowPlan {
        return (
            typeof plan.planId === "string" &&
            typeof plan.description === "string" &&
            typeof plan.intent === "string" &&
            Array.isArray(plan.steps) &&
            Array.isArray(plan.variables) &&
            plan.steps.length > 0
        );
    }
}
