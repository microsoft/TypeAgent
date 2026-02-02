// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Plan Executor - Executes structured plans step-by-step with state tracking
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { TraceCollector } from "../tracing/traceCollector.js";
import {
    ExecutionPlan,
    PlanStep,
    PlanExecutionResult,
    PredictedPageState,
    Correction,
    StepExecution,
    StateDifference,
} from "./types.js";

/**
 * Execution context - maintains state during plan execution
 */
interface ExecutionContext {
    variables: Map<string, any>;
    currentUrl?: string;
    currentPageState?: any;
    corrections: Correction[];
    options: Options;
    tracer?: TraceCollector | undefined;
}

export class PlanExecutor {
    /**
     * Execute a complete plan
     */
    async executePlan(
        plan: ExecutionPlan,
        options: Options,
        tracer?: TraceCollector,
    ): Promise<PlanExecutionResult> {
        console.log(
            `[PlanExecutor] Executing plan ${plan.planId} with ${plan.steps.length} steps`,
        );

        const startTime = Date.now();
        const context: ExecutionContext = {
            variables: new Map(),
            corrections: [],
            options,
            tracer: tracer || undefined,
        };

        // Initialize variables with defaults
        for (const varDef of plan.variables) {
            if (varDef.defaultValue !== undefined) {
                context.variables.set(varDef.name, varDef.defaultValue);
            }
        }

        // Set plan in tracer if available
        if (tracer) {
            tracer.setPlan(plan);
        }

        let executedSteps = 0;
        let success = true;
        let error: string | undefined;
        let finalData: any;

        try {
            // Execute each step in sequence
            for (const step of plan.steps) {
                console.log(
                    `[PlanExecutor] Executing step ${step.stepNumber}: ${step.objective}`,
                );

                // Check preconditions
                const preconditionsMet = await this.checkPreconditions(
                    step,
                    context,
                );
                if (!preconditionsMet) {
                    console.warn(
                        `[PlanExecutor] Preconditions not met for step ${step.stepId}, skipping`,
                    );
                    continue;
                }

                // Execute the step
                const stepResult = await this.executeStep(step, context);
                executedSteps++;

                if (!stepResult.success) {
                    success = false;
                    error = stepResult.error;
                    console.error(
                        `[PlanExecutor] Step ${step.stepId} failed: ${stepResult.error}`,
                    );
                    break;
                }

                // Store output variables
                if (stepResult.outputVariables) {
                    for (const [name, value] of Object.entries(
                        stepResult.outputVariables,
                    )) {
                        context.variables.set(name, value);
                    }
                }
            }

            // Extract final result from variables
            finalData = this.extractFinalResult(plan, context);
        } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
            console.error(`[PlanExecutor] Plan execution failed:`, err);
        }

        const duration = Date.now() - startTime;

        // Update plan execution metadata
        plan.execution = {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
            duration,
            status: success ? "success" : "failure",
            corrections: context.corrections,
            performanceMetrics: {
                totalSteps: plan.steps.length,
                successfulSteps: executedSteps,
                failedSteps: plan.steps.length - executedSteps,
                retriedSteps: context.corrections.filter(
                    (c) => c.correctionType === "action-modified",
                ).length,
            },
        };

        const result: PlanExecutionResult = {
            planId: plan.planId,
            success,
            duration,
            executedSteps,
            totalSteps: plan.steps.length,
            corrections: context.corrections,
            finalState: context.currentPageState,
            data: finalData,
        };

        if (error) {
            result.error = error;
        }

        console.log(
            `[PlanExecutor] Plan execution ${success ? "succeeded" : "failed"} (${executedSteps}/${plan.steps.length} steps)`,
        );

        return result;
    }

    /**
     * Execute a single step
     */
    private async executeStep(
        step: PlanStep,
        context: ExecutionContext,
    ): Promise<{
        success: boolean;
        error?: string;
        outputVariables?: Record<string, any>;
    }> {
        const stepStartTime = Date.now();

        // Build prompt for this step
        const prompt = this.buildStepPrompt(step, context);

        try {
            // Execute step using LLM
            const queryInstance = query({
                prompt,
                options: context.options,
            });

            let stepResponse = "";
            let toolResults: any[] = [];

            // Process messages
            for await (const message of queryInstance) {
                if (message.type === "result") {
                    if (message.subtype === "success") {
                        stepResponse = message.result || "";
                    }
                    break;
                } else if (message.type === "assistant") {
                    // Track assistant messages for thinking
                    const msg = message.message;
                    if (msg && msg.content) {
                        const thinking = this.extractThinking(msg.content);
                        if (thinking && context.tracer) {
                            // Tracer will capture this via message stream
                        }
                    }
                    // Check for tool use in content
                    if (msg && msg.content) {
                        toolResults.push(msg.content);
                    }
                }
            }

            // Extract output variables from response
            const outputVariables = this.extractOutputVariables(
                step,
                stepResponse,
                toolResults,
            );

            // Get current page state (if we have browser tools)
            const actualState = await this.captureCurrentState(context);

            // Compare predicted vs actual state
            const stateDiff = this.compareStates(
                step.predictedState,
                actualState,
            );

            // Check if correction was needed
            const correction = this.detectCorrection(
                step,
                toolResults,
                stateDiff,
            );
            if (correction) {
                context.corrections.push(correction);
                console.log(
                    `[PlanExecutor] Correction detected: ${correction.correctionType} - ${correction.reason}`,
                );
            }

            // Record step execution in tracer
            if (context.tracer) {
                const stepExecution: StepExecution = {
                    startTime: new Date(stepStartTime).toISOString(),
                    endTime: new Date().toISOString(),
                    duration: Date.now() - stepStartTime,
                    status: "success",
                    actualState,
                    stateDiff,
                };

                if (correction) {
                    stepExecution.corrections = [correction];
                }

                context.tracer.recordStepExecution(
                    step.stepId,
                    step.predictedState,
                    actualState,
                    stepExecution,
                );
            }

            // Update context
            context.currentPageState = actualState;

            return {
                success: true,
                outputVariables,
            };
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);

            // Record failed step in tracer
            if (context.tracer) {
                const stepExecution: StepExecution = {
                    startTime: new Date(stepStartTime).toISOString(),
                    endTime: new Date().toISOString(),
                    duration: Date.now() - stepStartTime,
                    status: "failure",
                };

                context.tracer.recordStepExecution(
                    step.stepId,
                    step.predictedState,
                    undefined,
                    stepExecution,
                );
            }

            return {
                success: false,
                error: errorMsg,
            };
        }
    }

    /**
     * Build prompt for executing a step
     */
    private buildStepPrompt(step: PlanStep, context: ExecutionContext): string {
        // Resolve variables in actions
        const resolvedActions = step.actions.map((action) => {
            const resolvedParams = { ...action.parameters };

            // Resolve parameter bindings
            if (action.parameterBindings) {
                for (const binding of action.parameterBindings) {
                    const value = context.variables.get(binding.variableName);
                    if (value !== undefined) {
                        resolvedParams[binding.parameterName] = value;
                    }
                }
            }

            return {
                tool: action.tool,
                parameters: resolvedParams,
                rationale: action.rationale,
            };
        });

        const variableContext = Array.from(context.variables.entries())
            .map(([name, value]) => `${name} = ${JSON.stringify(value)}`)
            .join("\n");

        return `You are executing a planned step in a browser automation task.

# Step Details

**Objective**: ${step.objective}
**Description**: ${step.description}

# Current Context

**Variables**:
${variableContext || "None"}

${context.currentUrl ? `**Current URL**: ${context.currentUrl}` : ""}

# Actions to Execute

${resolvedActions
    .map(
        (action, i) => `
${i + 1}. **${action.tool}**(${JSON.stringify(action.parameters, null, 2)})
   ${action.rationale ? `Rationale: ${action.rationale}` : ""}
`,
    )
    .join("\n")}

# Expected Outcome

After executing these actions, the page state should be:
${JSON.stringify(step.predictedState, null, 2)}

# Your Task

Execute the actions above using the available MCP tools. After execution:
1. Report what happened
2. Extract any requested output variables: ${step.outputVariables.map((v) => v.variableName).join(", ") || "None"}

Execute now:`;
    }

    /**
     * Check if step preconditions are met
     */
    private async checkPreconditions(
        step: PlanStep,
        context: ExecutionContext,
    ): Promise<boolean> {
        if (step.preconditions.length === 0) {
            return true;
        }

        for (const precondition of step.preconditions) {
            if (!precondition.required) {
                continue;
            }

            const met = await this.evaluateCondition(
                precondition.condition,
                context,
            );
            if (!met) {
                console.warn(
                    `[PlanExecutor] Precondition not met: ${precondition.description}`,
                );
                return false;
            }
        }

        return true;
    }

    /**
     * Evaluate a condition
     */
    private async evaluateCondition(
        condition: any,
        context: ExecutionContext,
    ): Promise<boolean> {
        // Simple implementation - can be enhanced
        switch (condition.type) {
            case "variable":
                // Check if variable exists and matches expression
                if (condition.variables) {
                    for (const varName of condition.variables) {
                        if (!context.variables.has(varName)) {
                            return false;
                        }
                    }
                }
                return true;

            case "elementExists":
                // Would need to query page - simplified for now
                return true;

            default:
                return true;
        }
    }

    /**
     * Compare predicted vs actual state
     */
    private compareStates(
        predicted: PredictedPageState,
        actual: any,
    ): StateDifference {
        const diff: StateDifference = {
            urlMatch: this.urlMatches(predicted, actual?.url),
            missingElements: [],
            unexpectedElements: [],
            contentMismatches: [],
            variableDifferences: [],
        };

        if (predicted.expectedUrl) {
            diff.predictedUrl = predicted.expectedUrl;
        }

        if (actual?.url) {
            diff.actualUrl = actual.url;
        }

        // Check expected elements
        if (predicted.expectedElements) {
            for (const expectedEl of predicted.expectedElements) {
                if (expectedEl.required) {
                    // Simplified - would need actual element checking
                    diff.missingElements.push(expectedEl);
                }
            }
        }

        return diff;
    }

    /**
     * Check if URL matches prediction
     */
    private urlMatches(
        predicted: PredictedPageState,
        actualUrl?: string,
    ): boolean {
        if (!actualUrl) {
            return false;
        }

        if (predicted.expectedUrl) {
            return actualUrl === predicted.expectedUrl;
        }

        if (predicted.expectedUrlPattern) {
            const regex = new RegExp(predicted.expectedUrlPattern);
            return regex.test(actualUrl);
        }

        return true; // No URL prediction made
    }

    /**
     * Capture current page state
     */
    private async captureCurrentState(context: ExecutionContext): Promise<any> {
        // Simplified implementation
        // In full implementation, would use MCP tools to get page state
        return {
            url: context.currentUrl,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Extract thinking from message content
     */
    private extractThinking(content: any): string | null {
        if (typeof content === "string") {
            return content;
        }
        if (Array.isArray(content)) {
            for (const item of content) {
                if (item.type === "text") {
                    return item.text;
                }
            }
        }
        return null;
    }

    /**
     * Extract output variables from step execution
     */
    private extractOutputVariables(
        step: PlanStep,
        response: string,
        toolResults: any[],
    ): Record<string, any> {
        const outputs: Record<string, any> = {};

        // Simple extraction - in full implementation would parse response
        // and extract variables based on step.outputVariables definitions

        for (const outputVar of step.outputVariables) {
            if (outputVar.source === "toolResult" && toolResults.length > 0) {
                // Extract from last tool result
                outputs[outputVar.variableName] =
                    toolResults[toolResults.length - 1];
            }
        }

        return outputs;
    }

    /**
     * Detect if a correction was made during execution
     */
    private detectCorrection(
        step: PlanStep,
        toolResults: any[],
        stateDiff: StateDifference,
    ): Correction | undefined {
        // Check if state differs significantly from prediction
        if (!stateDiff.urlMatch && step.predictedState.expectedUrl) {
            return {
                stepId: step.stepId,
                correctionType: "action-modified",
                reason: `URL mismatch: expected ${stateDiff.predictedUrl}, got ${stateDiff.actualUrl}`,
                timestamp: new Date().toISOString(),
            };
        }

        // Check if more actions were taken than planned
        if (toolResults.length > step.actions.length) {
            return {
                stepId: step.stepId,
                correctionType: "action-added",
                reason: `${toolResults.length - step.actions.length} additional actions were needed`,
                timestamp: new Date().toISOString(),
            };
        }

        return undefined;
    }

    /**
     * Extract final result from variables
     */
    private extractFinalResult(
        plan: ExecutionPlan,
        context: ExecutionContext,
    ): any {
        // Extract all plan-level variables as result
        const result: any = {};

        for (const varDef of plan.variables) {
            if (varDef.scope === "plan") {
                const value = context.variables.get(varDef.name);
                if (value !== undefined) {
                    result[varDef.name] = value;
                }
            }
        }

        return result;
    }
}
