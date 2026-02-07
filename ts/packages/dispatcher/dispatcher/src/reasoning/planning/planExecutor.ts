// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowPlan, PlanStep, Precondition } from "./types.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../../context/commandHandlerContext.js";
import { executeAction } from "../../execute/actionHandlers.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:planning:executor");

const VARIABLE_EXTRACTION_MODEL = "claude-sonnet-4-5-20250929";

export interface PlanExecutionResult {
    success: boolean;
    planId: string;
    duration: number;
    stepResults: StepExecutionResult[];
    variables: Record<string, any>;
    finalOutput?: any;
    error?: string;
}

export interface StepExecutionResult {
    stepId: string;
    stepNumber: number;
    success: boolean;
    duration: number;
    output?: any;
    error?: string;
    skipped?: boolean;
    skipReason?: string;
}

/**
 * Executes workflow plans with variable substitution and control flow
 */
export class PlanExecutor {
    /**
     * Execute a workflow plan with the given user request
     */
    async executePlan(
        plan: WorkflowPlan,
        userRequest: string,
        context: ActionContext<CommandHandlerContext>,
    ): Promise<PlanExecutionResult> {
        const startTime = Date.now();
        const stepResults: StepExecutionResult[] = [];
        const variables: Record<string, any> = {};

        debug(`Executing plan ${plan.planId}: ${plan.description}`);

        try {
            // Step 1: Extract variables from user request
            displayStatus("Analyzing request parameters...", context);
            const extractedVars = await this.extractVariables(
                plan,
                userRequest,
            );

            if (!extractedVars) {
                return {
                    success: false,
                    planId: plan.planId,
                    duration: Date.now() - startTime,
                    stepResults,
                    variables,
                    error: "Failed to extract required variables from request",
                };
            }

            Object.assign(variables, extractedVars);
            debug("Extracted variables:", variables);

            // Step 2: Execute plan steps sequentially
            let finalOutput: any = undefined;

            for (const step of plan.steps) {
                const stepResult = await this.executeStep(
                    step,
                    variables,
                    context,
                );

                stepResults.push(stepResult);

                if (!stepResult.success) {
                    // Step failed - abort execution
                    return {
                        success: false,
                        planId: plan.planId,
                        duration: Date.now() - startTime,
                        stepResults,
                        variables,
                        error: `Step ${step.stepNumber} failed: ${stepResult.error}`,
                    };
                }

                if (stepResult.skipped) {
                    debug(
                        `Step ${step.stepNumber} skipped: ${stepResult.skipReason}`,
                    );
                    continue;
                }

                // Update variables with step outputs
                if (step.outputVariables && stepResult.output) {
                    for (const outputVar of step.outputVariables) {
                        variables[outputVar.name] = this.extractOutputVariable(
                            outputVar,
                            stepResult.output,
                        );
                    }
                }

                finalOutput = stepResult.output;
            }

            debug(
                `Plan ${plan.planId} completed successfully in ${Date.now() - startTime}ms`,
            );

            return {
                success: true,
                planId: plan.planId,
                duration: Date.now() - startTime,
                stepResults,
                variables,
                finalOutput,
            };
        } catch (error) {
            debug(`Plan execution failed:`, error);
            return {
                success: false,
                planId: plan.planId,
                duration: Date.now() - startTime,
                stepResults,
                variables,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Execute a single plan step
     */
    private async executeStep(
        step: PlanStep,
        variables: Record<string, any>,
        context: ActionContext<CommandHandlerContext>,
    ): Promise<StepExecutionResult> {
        const startTime = Date.now();

        debug(`Executing step ${step.stepNumber}: ${step.objective}`);

        try {
            // Check preconditions
            const preconditionResult = this.checkPreconditions(
                step.preconditions,
                variables,
            );

            if (!preconditionResult.satisfied) {
                if (preconditionResult.hasRequired) {
                    // Required precondition failed - abort
                    return {
                        stepId: step.stepId,
                        stepNumber: step.stepNumber,
                        success: false,
                        duration: Date.now() - startTime,
                        error: `Precondition failed: ${preconditionResult.failedCondition}`,
                    };
                } else {
                    // Optional precondition failed - skip step
                    return {
                        stepId: step.stepId,
                        stepNumber: step.stepNumber,
                        success: true,
                        duration: Date.now() - startTime,
                        skipped: true,
                        skipReason: `Optional precondition not met: ${preconditionResult.failedCondition}`,
                    };
                }
            }

            // Substitute variables in parameter template
            const parameters = this.substituteVariables(
                step.action.parameterTemplate,
                variables,
            );

            // Display status
            displayStatus(
                `Executing: ${step.action.schemaName}.${step.action.actionName}...`,
                context,
            );

            // Execute action
            const actionResult = await executeAction(
                {
                    action: {
                        schemaName: step.action.schemaName,
                        actionName: step.action.actionName,
                        parameters,
                    },
                },
                context,
                step.stepNumber,
            );

            return {
                stepId: step.stepId,
                stepNumber: step.stepNumber,
                success: true,
                duration: Date.now() - startTime,
                output: actionResult,
            };
        } catch (error) {
            debug(`Step ${step.stepNumber} failed:`, error);
            return {
                stepId: step.stepId,
                stepNumber: step.stepNumber,
                success: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Extract variables from user request using Claude
     */
    private async extractVariables(
        plan: WorkflowPlan,
        userRequest: string,
    ): Promise<Record<string, any> | null> {
        try {
            const prompt = this.buildVariableExtractionPrompt(
                plan,
                userRequest,
            );

            const queryInstance = query({
                prompt,
                options: {
                    model: VARIABLE_EXTRACTION_MODEL,
                    maxTurns: 1,
                    maxThinkingTokens: 2000,
                    allowedTools: [],
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
                    }
                }
            }

            if (!result) {
                return null;
            }

            // Extract JSON from markdown code blocks if present
            const jsonMatch = result.match(
                /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
            );
            const jsonText = jsonMatch ? jsonMatch[1] : result;

            return JSON.parse(jsonText);
        } catch (error) {
            debug("Failed to extract variables:", error);
            return null;
        }
    }

    /**
     * Build prompt for variable extraction
     */
    private buildVariableExtractionPrompt(
        plan: WorkflowPlan,
        userRequest: string,
    ): string {
        const variableDescriptions = plan.variables
            .map(
                (v) =>
                    `- ${v.name} (${v.type}): ${v.description}${v.defaultValue !== undefined ? ` [default: ${JSON.stringify(v.defaultValue)}]` : ""}`,
            )
            .join("\n");

        return `Extract variable values from the user request for the following workflow plan.

# Workflow Plan
${plan.description}

# Required Variables
${variableDescriptions}

# User Request
"${userRequest}"

# Task
Extract the values for each variable from the user request. If a variable cannot be determined from the request, use its default value if available, otherwise set it to null.

# Output Format
Return a JSON object with variable names as keys and extracted values:

{
  "variableName1": "extracted value",
  "variableName2": "extracted value"
}

Extract variables now:`;
    }

    /**
     * Check if preconditions are satisfied
     */
    private checkPreconditions(
        preconditions: Precondition[],
        variables: Record<string, any>,
    ): {
        satisfied: boolean;
        hasRequired: boolean;
        failedCondition?: string;
    } {
        for (const precondition of preconditions) {
            if (precondition.type === "variable_exists") {
                // Extract variable name from expression (e.g., "{{varName}}")
                const varMatch = precondition.expression.match(/\{\{(\w+)\}\}/);
                if (varMatch) {
                    const varName = varMatch[1];
                    const exists =
                        variables[varName] !== undefined &&
                        variables[varName] !== null;

                    if (!exists) {
                        return {
                            satisfied: false,
                            hasRequired: precondition.required,
                            failedCondition: precondition.description,
                        };
                    }
                }
            }
            // TODO: Support other precondition types (step_completed, custom)
        }

        return { satisfied: true, hasRequired: false };
    }

    /**
     * Substitute variables in parameter template
     */
    private substituteVariables(
        template: Record<string, any>,
        variables: Record<string, any>,
    ): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(template)) {
            if (typeof value === "string") {
                // Replace {{variable}} references
                result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
                    return variables[varName] !== undefined
                        ? String(variables[varName])
                        : `{{${varName}}}`;
                });
            } else if (typeof value === "object" && value !== null) {
                // Recursively substitute in nested objects
                result[key] = this.substituteVariables(value, variables);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Extract output variable from step result
     */
    private extractOutputVariable(
        outputVar: { name: string; source: string; extractionPath?: string },
        stepOutput: any,
    ): any {
        if (outputVar.source === "action_result") {
            if (outputVar.extractionPath) {
                // TODO: Implement JSONPath extraction
                // For now, return the full output
                return stepOutput;
            }
            return stepOutput;
        }

        return undefined;
    }
}
