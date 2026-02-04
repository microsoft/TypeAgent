// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Plan Executor - Executes structured plans step-by-step with state tracking
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk";
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
import type { WebTaskAgent } from "../webTaskAgent.js";

/**
 * Execution context - maintains state during plan execution
 */
interface ExecutionContext {
    variables: Map<string, any>;
    currentUrl?: string;
    currentPageState?: any;
    corrections: Correction[];
    options: Options;
    agent: WebTaskAgent;
    tracer?: TraceCollector | undefined;
}

export class PlanExecutor {
    /**
     * Execute a complete plan
     */
    async executePlan(
        plan: ExecutionPlan,
        options: Options,
        agent: WebTaskAgent,
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
            agent,
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
            // Execute step using WebTaskAgent
            const stepResult = await context.agent.executeStep(
                prompt,
                context.tracer,
            );

            // Check if agent reported failure in response
            const agentFailure = this.detectAgentFailure(stepResult.response);
            if (agentFailure) {
                console.error(
                    `[PlanExecutor] Agent reported step failure: ${agentFailure}`,
                );
                return {
                    success: false,
                    error: agentFailure,
                };
            }

            // Extract output variables from response
            const outputVariables = this.extractOutputVariables(
                step,
                stepResult.response,
                stepResult.toolCalls,
            );

            // Build actual state from captured data
            const actualState = {
                url: stepResult.capturedUrl,
                timestamp: new Date().toISOString(),
                captured: stepResult.capturedUrl !== undefined,
                toolCalls: stepResult.toolCalls.length,
            };

            // Update context URL
            if (stepResult.capturedUrl) {
                context.currentUrl = stepResult.capturedUrl;
            }

            // Compare predicted vs actual state
            const stateDiff = this.compareStates(
                step.predictedState,
                actualState,
            );

            // Check if correction was needed
            const correction = this.detectCorrection(
                step,
                stepResult.toolCalls,
                stateDiff,
                stepResult.response,
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
1. Get the current URL (use getCurrentUrl or similar tool to verify the page state)
2. Report what happened
3. Extract any requested output variables: ${step.outputVariables.map((v) => v.variableName).join(", ") || "None"}

# CRITICAL INSTRUCTIONS

**Data Extraction**:
- DO NOT use Python, bash scripts, or complex shell commands to parse HTML
- DO NOT create files and run scripts - they will be blocked by security
- INSTEAD: If you need to extract data from HTML, READ the HTML content and parse it YOURSELF using your reasoning
- Analyze the HTML structure, identify patterns, and extract the data directly in your response
- Provide the extracted data in structured JSON format in your response

**Failure Reporting**:
- If an action fails or doesn't work as intended, EXPLICITLY state "TASK FAILED" or "CANNOT PROCEED"
- DO NOT provide simulated, sample, or representative data
- DO NOT say "based on typical results" or similar - extract ACTUAL data or fail
- Report only what you actually observed and extracted

IMPORTANT: Always get the current URL after actions so we can verify the page state.

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
     * Note: URL matching is intentionally disabled to avoid brittleness
     */
    private compareStates(
        predicted: PredictedPageState,
        actual: any,
    ): StateDifference {
        const diff: StateDifference = {
            urlMatch: true, // Always true - we don't check URLs to avoid brittleness
            missingElements: [],
            unexpectedElements: [],
            contentMismatches: [],
            variableDifferences: [],
        };

        // Check expected elements (excluding images which are removed from HTML)
        if (predicted.expectedElements) {
            for (const expectedEl of predicted.expectedElements) {
                // Skip image elements - they're removed from HTML for token efficiency
                if (
                    expectedEl.role === "image" ||
                    expectedEl.role === "img" ||
                    expectedEl.description?.toLowerCase().includes("image")
                ) {
                    continue;
                }

                if (expectedEl.required) {
                    // For now, assume elements are present
                    // Real verification would require parsing actual HTML
                }
            }
        }

        return diff;
    }

    /**
     * Detect if agent reported failure in its response
     */
    private detectAgentFailure(response: string): string | null {
        const lowerResponse = response.toLowerCase();

        // Check for explicit failure declarations
        const failurePatterns = [
            /task cannot be completed/i,
            /cannot execute.*action/i,
            /cannot proceed/i,
            /task has failed/i,
            /fundamentally failed/i,
            /workflow.*failed/i,
            /search never succeeded/i,
            /navigation.*failed/i,
            /action.*did not work/i,
            /the.*failed/i,
        ];

        for (const pattern of failurePatterns) {
            if (pattern.test(response)) {
                // Extract failure reason from response
                const match = response.match(pattern);
                if (match) {
                    // Try to get more context around the match
                    const startIdx = Math.max(0, match.index! - 50);
                    const endIdx = Math.min(
                        response.length,
                        match.index! + match[0].length + 100,
                    );
                    return response.substring(startIdx, endIdx).trim();
                }
                return "Agent reported task failure";
            }
        }

        // Check for simulated/fake results (agent couldn't actually do the work)
        // These patterns must be specific to avoid false positives
        const simulationPatterns = [
            /\bsimulated extraction\b/i,
            /\brepresentative product/i,
            /\bsample product.*data\b/i,
            /\bbased on typical.*results?\b/i,
            /\bbased on.*experience.*results?\b/i,
            /\bproviding? sample data\b/i,
            /\bsimulated data\b/i,
            /\bmock data\b/i,
            /\bplaceholder (data|results)\b/i,
            /\bfor demonstration purposes\b/i,
            /\btypical.*(?:ace hardware|search results)\b/i,
        ];

        for (const pattern of simulationPatterns) {
            if (pattern.test(response)) {
                return "Agent provided simulated/fake results instead of actual data extraction";
            }
        }

        // Check for command execution blocks/errors
        if (
            lowerResponse.includes("requires approval") ||
            lowerResponse.includes("command blocked") ||
            (lowerResponse.includes("error") &&
                lowerResponse.includes("bash command"))
        ) {
            // Only fail if this prevented critical data extraction
            if (
                lowerResponse.includes("extract") ||
                lowerResponse.includes("parse") ||
                lowerResponse.includes("scrape")
            ) {
                return "Critical command execution blocked - cannot extract required data";
            }
        }

        // Check for error indicators in structured sections
        if (
            lowerResponse.includes("## issue detected") ||
            lowerResponse.includes("**problem**") ||
            lowerResponse.includes("**error**")
        ) {
            // If agent is reporting issues but continuing, don't fail yet
            // Only fail if it explicitly says cannot proceed
            if (
                lowerResponse.includes("cannot") &&
                (lowerResponse.includes("proceed") ||
                    lowerResponse.includes("execute") ||
                    lowerResponse.includes("complete"))
            ) {
                return "Agent detected critical issue preventing execution";
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
     * Note: URL checking is disabled to avoid false positives from URL variations
     */
    private detectCorrection(
        step: PlanStep,
        toolResults: any[],
        stateDiff: StateDifference,
        agentResponse?: string,
    ): Correction | undefined {
        // Check if agent reported issues with the planned actions
        if (agentResponse) {
            const lowerResponse = agentResponse.toLowerCase();

            // Check for action ineffectiveness
            if (
                lowerResponse.includes("did not") &&
                (lowerResponse.includes("work") ||
                    lowerResponse.includes("succeed") ||
                    lowerResponse.includes("execute"))
            ) {
                return {
                    stepId: step.stepId,
                    correctionType: "action-ineffective",
                    reason: "Planned action did not achieve intended result",
                    timestamp: new Date().toISOString(),
                };
            }

            // Check for issues detected
            if (
                lowerResponse.includes("issue detected") ||
                lowerResponse.includes("problem")
            ) {
                return {
                    stepId: step.stepId,
                    correctionType: "action-modified",
                    reason: "Agent detected issues with planned action execution",
                    timestamp: new Date().toISOString(),
                };
            }
        }

        // Check if more actions were taken than planned
        // This indicates the agent had to do additional work beyond the plan
        if (toolResults.length > step.actions.length) {
            return {
                stepId: step.stepId,
                correctionType: "action-added",
                reason: `${toolResults.length - step.actions.length} additional actions were needed beyond the plan`,
                timestamp: new Date().toISOString(),
            };
        }

        // No correction detected
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
