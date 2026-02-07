// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import {
    ReasoningTrace,
    ReasoningStep,
    TraceCollectorOptions,
} from "./types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:trace");

/**
 * Captures execution traces for reasoning actions
 * Only active when planReuse is enabled
 */
export class ReasoningTraceCollector {
    private trace: ReasoningTrace;
    private storage: Storage;
    private traceDir: string;
    private currentStepNumber: number = 0;
    private startTime: number;

    constructor(options: TraceCollectorOptions) {
        this.storage = options.storage;
        this.traceDir = `reasoning/traces/${options.requestId}`;
        this.startTime = Date.now();

        // Initialize trace structure
        this.trace = {
            session: {
                sessionId: options.sessionId,
                requestId: options.requestId,
                startTime: new Date().toISOString(),
                model: options.model,
                originalRequest: options.originalRequest,
                planReuseEnabled: options.planReuseEnabled,
            },
            steps: [],
            metrics: {
                totalSteps: 0,
                totalToolCalls: 0,
                duration: 0,
            },
            result: {
                success: false,
            },
        };

        debug(`Initialized trace collector: ${options.requestId}`);
    }

    /**
     * Record thinking from assistant message
     */
    recordThinking(message: any): void {
        this.currentStepNumber++;

        // Extract text content
        const textContent = this.extractTextContent(message);
        const summary = this.summarizeThinking(textContent);

        const step: ReasoningStep = {
            stepNumber: this.currentStepNumber,
            timestamp: new Date().toISOString(),
            thinking: {
                summary,
                fullThought: textContent,
            },
        };

        this.trace.steps.push(step);
        debug(`Recorded thinking step ${this.currentStepNumber}`);
    }

    /**
     * Record tool call (action)
     */
    recordToolCall(toolName: string, parameters: any): void {
        const currentStep = this.getCurrentStep();
        if (currentStep) {
            // Extract schema and action name from tool call
            const actionData: any = {
                tool: toolName,
                parameters,
            };

            if (toolName.includes("discover_actions")) {
                actionData.schemaName = parameters.schemaName;
            } else if (toolName.includes("execute_action")) {
                actionData.schemaName = parameters.schemaName;
                if (parameters.action?.actionName) {
                    actionData.actionName = parameters.action.actionName;
                }
            }

            currentStep.action = actionData;

            debug(`Recorded tool call: ${toolName}`);
        }
    }

    /**
     * Record tool result
     */
    recordToolResult(
        toolName: string,
        result: any,
        error?: string,
        duration?: number,
    ): void {
        const currentStep = this.getCurrentStep();
        if (currentStep) {
            const resultData: any = {
                success: !error,
                data: result,
            };

            if (error) {
                resultData.error = error;
            }
            if (duration !== undefined) {
                resultData.duration = duration;
            }

            currentStep.result = resultData;

            debug(`Recorded tool result for: ${toolName}`);
        }
    }

    /**
     * Mark trace as complete with success
     */
    markSuccess(finalOutput?: any): void {
        this.trace.result = {
            success: true,
            finalOutput,
        };
        this.calculateMetrics();
        debug("Trace marked as successful");
    }

    /**
     * Mark trace as failed
     */
    markFailed(error: Error | string): void {
        this.trace.result = {
            success: false,
            error: error instanceof Error ? error.message : error,
        };
        this.calculateMetrics();
        debug(`Trace marked as failed: ${error}`);
    }

    /**
     * Check if trace was successful
     */
    wasSuccessful(): boolean {
        return this.trace.result.success;
    }

    /**
     * Get trace duration in milliseconds
     */
    getDuration(): number {
        return this.trace.metrics.duration;
    }

    /**
     * Get the trace data
     */
    getTrace(): ReasoningTrace {
        return this.trace;
    }

    /**
     * Save trace to sessionStorage
     */
    async saveTrace(): Promise<void> {
        try {
            const tracePath = `${this.traceDir}/trace.json`;
            await this.storage.write(
                tracePath,
                JSON.stringify(this.trace, null, 2),
                "utf8",
            );
            debug(`Saved trace to sessionStorage: ${tracePath}`);
        } catch (error) {
            console.error(`Failed to save trace: ${error}`);
        }
    }

    /**
     * Check if trace exists in storage
     */
    static async exists(storage: Storage, requestId: string): Promise<boolean> {
        try {
            return await storage.exists(
                `reasoning/traces/${requestId}/trace.json`,
            );
        } catch (error) {
            return false;
        }
    }

    /**
     * Load trace from storage
     */
    static async load(
        storage: Storage,
        requestId: string,
    ): Promise<ReasoningTrace | null> {
        try {
            const tracePath = `reasoning/traces/${requestId}/trace.json`;
            const content = await storage.read(tracePath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            debug(`Failed to load trace ${requestId}: ${error}`);
            return null;
        }
    }

    /**
     * List all traces in storage
     */
    static async listTraces(storage: Storage): Promise<string[]> {
        try {
            const traces = await storage.list("reasoning/traces", {
                dirs: true,
            });
            return traces;
        } catch (error) {
            debug(`Failed to list traces: ${error}`);
            return [];
        }
    }

    // Private helper methods

    private getCurrentStep(): ReasoningStep | undefined {
        return this.trace.steps[this.trace.steps.length - 1];
    }

    private extractTextContent(message: any): string {
        if (!message.content) return "";

        const textBlocks: string[] = [];
        for (const block of message.content) {
            if (block.type === "text") {
                textBlocks.push(block.text);
            }
        }

        return textBlocks.join("\n\n");
    }

    private summarizeThinking(thought: string): string {
        if (!thought) return "";

        // First sentence
        const firstSentence = thought.split(/[.!?]/)[0];
        if (firstSentence && firstSentence.length <= 100) {
            return firstSentence.trim();
        }

        // First 100 chars
        return thought.substring(0, 100).trim() + "...";
    }

    private calculateMetrics(): void {
        this.trace.metrics = {
            totalSteps: this.trace.steps.length,
            totalToolCalls: this.trace.steps.filter((s) => s.action).length,
            duration: Date.now() - this.startTime,
        };
    }
}
