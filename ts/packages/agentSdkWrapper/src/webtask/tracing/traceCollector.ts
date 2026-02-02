// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * TraceCollector - Captures execution traces for WebBench tasks
 *
 * Design: Transparent instrumentation at framework level
 * - Model executes normally, unaware it's being traced
 * - No prompt changes needed
 * - Observes message stream from Claude SDK
 * - Records thinking, actions, results
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
    TraceFile,
    TaskInfo,
    ExecutionMetadata,
    ExecutionStep,
    AgentThinking,
    AgentAction,
    ToolResult,
    TraceMetrics,
    TraceCollectorOptions,
} from "./types.js";
import {
    processHTMLToolResult,
    extractHTMLFilePath,
    type HTMLProcessingResult,
} from "./htmlProcessor.js";

export class TraceCollector {
    private trace: TraceFile;
    private traceDir: string;
    private currentStepNumber: number = 0;
    private startTime: number;
    private options: TraceCollectorOptions;

    // Track pending tool calls (tool_use_id -> tool info)
    private pendingToolCalls: Map<
        string,
        { stepNumber: number; toolName: string; parameters: any }
    > = new Map();

    // Plan tracking
    private planStepMap: Map<string, number> = new Map(); // planStepId -> traceStepNumber

    constructor(options: TraceCollectorOptions) {
        this.options = options;
        this.startTime = Date.now();

        // Initialize trace structure
        this.trace = this.initializeTrace(options);

        // Set trace directory
        const baseDir = options.traceDir || "./traces";
        this.traceDir = path.join(
            baseDir,
            options.runId,
            `task-${options.task.id}`,
        );
    }

    /**
     * Initialize empty trace structure
     */
    private initializeTrace(options: TraceCollectorOptions): TraceFile {
        const task: TaskInfo = {
            id: options.task.id,
            description: options.task.description,
            startingUrl: options.task.startingUrl,
            category: options.task.category,
            difficulty: options.task.difficulty,
        };

        const execution: ExecutionMetadata = {
            runId: options.runId,
            startTime: new Date().toISOString(),
            status: "running",
            model: options.model,
        };

        return {
            task,
            execution,
            steps: [],
            metrics: {
                totalSteps: 0,
                totalToolCalls: 0,
            },
        };
    }

    /**
     * Initialize trace directory structure
     */
    async initialize(): Promise<void> {
        await fs.mkdir(this.traceDir, { recursive: true });

        // Create subdirectories for Phase 2
        if (this.options.captureScreenshots) {
            await fs.mkdir(path.join(this.traceDir, "screenshots"), {
                recursive: true,
            });
        }

        if (this.options.captureHTML) {
            await fs.mkdir(path.join(this.traceDir, "html"), {
                recursive: true,
            });
        }
    }

    /**
     * Record agent thinking from assistant message
     */
    recordThinking(message: any): void {
        this.currentStepNumber++;

        // Extract text content from message
        const textContent = this.extractTextContent(message);

        const thinking: AgentThinking = {
            rawThought: textContent,
            summary: this.summarizeThinking(textContent),
            intent: this.extractIntent(textContent),
            reasoning: this.extractReasoning(textContent),
        };

        // Create or update step
        const step: ExecutionStep = {
            stepNumber: this.currentStepNumber,
            timestamp: new Date().toISOString(),
            thinking,
        };

        this.trace.steps.push(step);
    }

    /**
     * Record tool call (action)
     */
    recordToolCall(toolUseId: string, toolName: string, parameters: any): void {
        const stepNumber = this.currentStepNumber;

        // Track this tool call for when result arrives
        this.pendingToolCalls.set(toolUseId, {
            stepNumber,
            toolName,
            parameters,
        });

        // Update current step with action
        const currentStep = this.trace.steps[stepNumber - 1];
        if (currentStep) {
            const action: AgentAction = {
                tool: toolName,
                parameters,
            };
            currentStep.action = action;
        }
    }

    /**
     * Record tool result
     */
    async recordToolResult(
        toolUseId: string,
        content: string,
        isError: boolean = false,
        duration?: number | undefined,
    ): Promise<void> {
        const toolCall = this.pendingToolCalls.get(toolUseId);
        if (!toolCall) {
            console.warn(
                `[TraceCollector] No pending tool call found for ${toolUseId}`,
            );
            return;
        }

        const { stepNumber, toolName } = toolCall;
        const step = this.trace.steps[stepNumber - 1];

        if (step) {
            // Check if content contains file paths that need to be copied
            let processedContent = content;

            // Handle screenshots
            if (toolName.includes("captureScreenshot") && !isError) {
                processedContent = await this.processScreenshotResult(
                    stepNumber,
                    content,
                );
            }

            // Handle HTML extraction - process JSON and extract clean HTML
            if (
                (toolName.includes("getHTML") ||
                    toolName.includes("extractData")) &&
                this.options.captureHTML &&
                !isError
            ) {
                const htmlResult = await this.processHTMLResult(
                    stepNumber,
                    content,
                );
                if (htmlResult) {
                    // Update content to reference clean HTML file
                    processedContent = `HTML content retrieved successfully.\nClean HTML saved to: ${htmlResult.relativeCleanPath}\nUse Read tool to access the HTML content for analysis.`;

                    const reduction = (
                        ((htmlResult.originalSize - htmlResult.processedSize) /
                            htmlResult.originalSize) *
                        100
                    ).toFixed(1);
                    console.log(
                        `[TraceCollector] HTML processed: ${htmlResult.originalSize} → ${htmlResult.processedSize} bytes (${reduction}% reduction)`,
                    );
                }
            }

            const result: ToolResult = {
                success: !isError,
                data: processedContent,
                error: isError ? content : undefined,
                duration,
            };
            step.result = result;
        }

        this.pendingToolCalls.delete(toolUseId);
    }

    /**
     * Process screenshot result - copy to trace directory
     */
    private async processScreenshotResult(
        stepNumber: number,
        content: string,
    ): Promise<string> {
        // Look for file paths in the content (Windows or Unix style)
        // Updated patterns to exclude trailing punctuation
        const patterns = [
            /([A-Z]:\\[^"\s\n]+?)(?:[.,:;!?](?:\s|$)|$)/g, // Windows: C:\path\to\file (excludes trailing punctuation)
            /([A-Z]:\\\\[^"\s\n]+?)(?:[.,:;!?](?:\s|$)|$)/g, // Windows escaped: C:\\path\\to\\file
            /(\/[^"\s\n]+?\.txt)(?:[.,:;!?](?:\s|$)|$)/g, // Unix: /path/to/file.txt
        ];

        let foundPath: string | null = null;
        let updatedContent = content;

        for (const pattern of patterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                const filePath = match[1];
                // Check if it's a screenshot-related file
                if (
                    filePath.includes("screenshot") ||
                    filePath.includes("captureScreenshot")
                ) {
                    foundPath = filePath;
                    break;
                }
            }
            if (foundPath) break;
        }

        if (foundPath) {
            try {
                // Normalize path (handle escaped backslashes)
                let normalizedPath = foundPath.replace(/\\\\/g, "\\");
                // Remove any trailing punctuation that might have been captured
                normalizedPath = normalizedPath.replace(/[.,:;!?]+$/, "");

                // Check if file exists
                try {
                    await fs.access(normalizedPath);
                } catch {
                    console.warn(
                        `[TraceCollector] Screenshot file not found: ${normalizedPath}`,
                    );
                    return content;
                }

                // Determine file extension
                const ext = normalizedPath.endsWith(".txt") ? ".txt" : ".png";
                const filename = `step-${String(stepNumber).padStart(3, "0")}-screenshot${ext}`;
                const destPath = path.join(
                    this.traceDir,
                    "screenshots",
                    filename,
                );

                // Copy file
                await fs.copyFile(normalizedPath, destPath);

                // Update step with screenshot path
                const step = this.trace.steps[stepNumber - 1];
                if (step) {
                    if (!step.pageStateAfter) {
                        step.pageStateAfter = {
                            url: "unknown",
                            timestamp: new Date().toISOString(),
                        };
                    }
                    step.pageStateAfter.screenshotPath = `screenshots/${filename}`;
                }

                // Return updated content with relative path
                updatedContent = content.replace(
                    foundPath,
                    `[Copied to: screenshots/${filename}]`,
                );

                console.log(
                    `[TraceCollector] Copied screenshot to: screenshots/${filename}`,
                );
            } catch (error) {
                console.warn(
                    `[TraceCollector] Failed to copy screenshot: ${error}`,
                );
            }
        }

        return updatedContent;
    }

    /**
     * Mark execution as complete
     */
    markComplete(success: boolean, errorMessage?: string | undefined): void {
        this.trace.execution.endTime = new Date().toISOString();
        this.trace.execution.duration = Date.now() - this.startTime;
        this.trace.execution.status = success ? "success" : "failure";
        if (errorMessage) {
            this.trace.execution.errorMessage = errorMessage;
        }
    }

    /**
     * Save trace to disk
     */
    async saveTrace(): Promise<void> {
        // Calculate final metrics
        this.trace.metrics = this.calculateMetrics();

        // Save trace.json
        const tracePath = path.join(this.traceDir, "trace.json");
        await fs.writeFile(
            tracePath,
            JSON.stringify(this.trace, null, 2),
            "utf8",
        );

        console.log(`[TraceCollector] Trace saved to: ${tracePath}`);
    }

    /**
     * Process HTML tool result - deserialize JSON and extract clean HTML
     */
    private async processHTMLResult(
        stepNumber: number,
        content: string,
    ): Promise<HTMLProcessingResult | null> {
        // Check if content contains file path to HTML result
        const filePath = extractHTMLFilePath(content);
        if (!filePath) {
            // No file path found, content might be inline HTML
            // For now, skip - most large HTML is saved to file
            return null;
        }

        try {
            // Process the HTML file - deserialize JSON and extract clean HTML
            const htmlDir = path.join(this.traceDir, "html");
            const result = await processHTMLToolResult(
                filePath,
                htmlDir,
                stepNumber,
            );

            // Update step with HTML path
            const step = this.trace.steps[stepNumber - 1];
            if (step) {
                if (!step.pageStateAfter) {
                    step.pageStateAfter = {
                        url: "unknown",
                        timestamp: new Date().toISOString(),
                    };
                }
                step.pageStateAfter.htmlPath = result.relativeCleanPath;
                step.pageStateAfter.htmlSnippet =
                    result.processedHTML[0]?.html.substring(0, 1000) || "";
            }

            console.log(
                `[TraceCollector] Saved clean HTML to: ${result.relativeCleanPath}`,
            );

            return result;
        } catch (error) {
            console.warn(
                `[TraceCollector] Failed to process HTML result: ${error}`,
            );
            return null;
        }
    }

    /**
     * Calculate trace metrics
     */
    private calculateMetrics(): TraceMetrics {
        const totalSteps = this.trace.steps.length;
        const totalToolCalls = this.trace.steps.filter((s) => s.action).length;

        const totalExecutionTime = this.trace.steps.reduce((sum, step) => {
            return sum + (step.result?.duration || 0);
        }, 0);

        return {
            totalSteps,
            totalToolCalls,
            totalExecutionTime,
        };
    }

    /**
     * Extract text content from message
     */
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

    /**
     * Summarize thinking (first sentence or first 100 chars)
     */
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

    /**
     * Extract intent from thinking (heuristic)
     */
    private extractIntent(thought: string): string | undefined {
        // Look for patterns like "I need to...", "I'll...", "Let me..."
        const intentPatterns = [
            /(?:I need to|I'll|Let me|I will|I'm going to)\s+([^.!?]+)/i,
            /(?:First|Next|Now),?\s+(?:I'll|I need to|let me)\s+([^.!?]+)/i,
        ];

        for (const pattern of intentPatterns) {
            const match = thought.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return undefined;
    }

    /**
     * Extract reasoning from thinking (heuristic)
     */
    private extractReasoning(thought: string): string | undefined {
        // Look for patterns like "because...", "since...", "so that..."
        const reasoningPatterns = [
            /(?:because|since|so that|in order to)\s+([^.!?]+)/i,
        ];

        for (const pattern of reasoningPatterns) {
            const match = thought.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return undefined;
    }

    /**
     * Get trace directory path
     */
    getTraceDir(): string {
        return this.traceDir;
    }

    /**
     * Get current trace (for inspection)
     */
    getTrace(): TraceFile {
        return this.trace;
    }

    /**
     * Set the execution plan being traced
     */
    setPlan(plan: any): void {
        this.trace.plan = {
            planId: plan.planId,
            version: plan.version,
        };
        console.log(
            `[TraceCollector] Tracking execution of plan ${plan.planId} v${plan.version}`,
        );
    }

    /**
     * Record plan step execution with predicted vs actual state
     */
    recordStepExecution(
        planStepId: string,
        predictedState: any,
        actualState: any,
        stepExecution: any,
    ): void {
        // Find the corresponding trace step (current step number)
        const traceStepIndex = this.trace.steps.length - 1;
        if (traceStepIndex >= 0) {
            const traceStep = this.trace.steps[traceStepIndex];

            // Add plan tracking information
            traceStep.planStepId = planStepId;
            traceStep.predictedState = predictedState;
            traceStep.actualState = actualState;
            traceStep.stateDiff = stepExecution.stateDiff;

            // Add correction if present
            if (
                stepExecution.corrections &&
                stepExecution.corrections.length > 0
            ) {
                traceStep.correction = stepExecution.corrections[0];
            }

            // Map plan step ID to trace step number
            this.planStepMap.set(planStepId, this.currentStepNumber);

            console.log(
                `[TraceCollector] Recorded plan step ${planStepId} execution (trace step ${this.currentStepNumber})`,
            );
        }
    }

    /**
     * Set paths to plan files
     */
    setPlanPaths(originalPath?: string, revisedPath?: string): void {
        if (!this.trace.plan) {
            this.trace.plan = {
                planId: "unknown",
                version: 1,
            };
        }
        if (originalPath) {
            this.trace.plan.originalPlanPath = originalPath;
        }
        if (revisedPath) {
            this.trace.plan.revisedPlanPath = revisedPath;
        }
    }
}
