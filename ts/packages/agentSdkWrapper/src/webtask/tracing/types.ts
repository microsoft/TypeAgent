// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Trace collection types for WebTask agent execution
 */

import { WebTask } from "../types.js";

/**
 * Complete trace file structure
 */
export interface TraceFile {
    // Task Information
    task: TaskInfo;

    // Execution Plan (if plan-based execution)
    plan?: {
        planId: string;
        version: number;
        originalPlanPath?: string | undefined;
        revisedPlanPath?: string | undefined;
    } | undefined;

    // Execution Metadata
    execution: ExecutionMetadata;

    // Step-by-Step Execution
    steps: ExecutionStep[];

    // Validation results (automatic, manual, or LLM-judge)
    validation?: ValidationResult | undefined;

    // Performance Metrics
    metrics: TraceMetrics;
}

/**
 * Task information
 */
export interface TaskInfo {
    id: string;
    description: string;
    startingUrl: string;
    category: "READ" | "CREATE" | "UPDATE" | "DELETE" | "FILE_MANIPULATION" | "NAVIGATE" | "SEARCH" | "FORM_FILL" | "CUSTOM";
    difficulty: "easy" | "medium" | "hard";
    expectedOutcome?: string | undefined;
}

/**
 * Execution metadata
 */
export interface ExecutionMetadata {
    runId: string;
    startTime: string; // ISO 8601
    endTime?: string | undefined; // ISO 8601
    duration?: number | undefined; // milliseconds
    status: "running" | "success" | "failure" | "timeout" | "error";
    errorMessage?: string | undefined;
    model: string;
    temperature?: number | undefined;
}

/**
 * Individual execution step
 */
export interface ExecutionStep {
    stepNumber: number;
    timestamp: string; // ISO 8601

    // Plan tracking (if execution is plan-based)
    planStepId?: string | undefined; // Reference to plan step
    predictedState?: any | undefined; // From plan: expected page state
    actualState?: any | undefined; // Actual page state after step
    stateDiff?: StateComparison | undefined; // Predicted vs actual comparison

    // Agent Thinking
    thinking?: AgentThinking | undefined;

    // Action Taken
    action?: AgentAction | undefined;

    // Capture page state before action
    pageStateBefore?: PageState | undefined;

    // Capture page state after action
    pageStateAfter?: PageState | undefined;

    // Tool Result
    result?: ToolResult | undefined;

    // Agent observation after action
    observation?: AgentObservation | undefined;

    // Corrections made during execution
    correction?: StepCorrection | undefined;
}

/**
 * Agent thinking/reasoning
 */
export interface AgentThinking {
    rawThought: string; // Full agent message text
    summary: string; // One-line summary
    intent?: string | undefined; // What it's trying to do
    reasoning?: string | undefined; // Why it chose this action
}

/**
 * Agent action (tool call)
 */
export interface AgentAction {
    tool: string; // Tool name
    parameters: Record<string, any>;
    expectedOutcome?: string | undefined; // What agent expects to happen
}

/**
 * Page state snapshot
 */
export interface PageState {
    url: string;
    title?: string | undefined;
    htmlPath?: string | undefined; // Relative path
    screenshotPath?: string | undefined; // Relative path
    htmlSnippet?: string | undefined; // First 1000 chars
    keyElements?: KeyElement[] | undefined; // TODO Phase 2: Extract key elements from HTML
    timestamp: string; // ISO 8601
}

/**
 * Key element identified on page
 */
export interface KeyElement {
    selector: string;
    description: string;
    visible: boolean;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: string | undefined; // Tool return value
    error?: string | undefined;
    duration?: number | undefined; // milliseconds
}

/**
 * Agent observation after action
 */
export interface AgentObservation {
    rawObservation: string; // What agent said it observed
    summary: string;
    changeDetected?: boolean | undefined; // Did page change as expected?
    anomalies?: string[] | undefined; // Unexpected observations
}

/**
 * Validation result (Phase 3)
 */
export interface ValidationResult {
    method: "automatic" | "manual" | "llm-judge" | "rule-based";
    criteria: string;
    result: "pass" | "fail" | "partial" | "unknown";
    reasoning: string;
    confidence: number; // 0-1
    extractedData?: any | undefined;
    expectedData?: any | undefined;
}

/**
 * Performance metrics
 */
export interface TraceMetrics {
    totalSteps: number;
    totalToolCalls: number;
    totalThinkingTime?: number | undefined; // Time in agent reasoning
    totalExecutionTime?: number | undefined; // Time in tool execution
    tokensUsed?: TokenUsage | undefined;
    cacheHits?: CacheHits | undefined;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
    input: number;
    output: number;
    cached?: number | undefined;
}

/**
 * Cache hit tracking
 */
export interface CacheHits {
    html?: number | undefined;
    selector?: number | undefined;
    knowledge?: number | undefined;
}

/**
 * State comparison (predicted vs actual)
 */
export interface StateComparison {
    urlMatch: boolean;
    predictedUrl?: string | undefined;
    actualUrl?: string | undefined;

    elementsMatch: boolean;
    missingElements?: string[] | undefined; // Elements predicted but not found
    unexpectedElements?: string[] | undefined; // Elements found but not predicted

    contentMatch: boolean;
    contentMismatches?: string[] | undefined;

    variablesMatch: boolean;
    variableDifferences?: Array<{
        name: string;
        predicted?: any;
        actual?: any;
    }> | undefined;

    overallMatchScore: number; // 0-1, how well predicted matched actual
}

/**
 * Step correction tracking
 */
export interface StepCorrection {
    correctionType: "action-modified" | "action-added" | "action-removed" | "step-skipped" | "retry-needed";
    reason: string;
    originalAction?: AgentAction | undefined;
    correctedAction?: AgentAction | undefined;
    timestamp: string;
}

/**
 * Trace collector options
 */
export interface TraceCollectorOptions {
    task: WebTask;
    runId: string;
    traceDir?: string | undefined;
    captureScreenshots?: boolean | undefined;
    captureHTML?: boolean | undefined;
    model: string;
}

/**
 * Run summary for multiple tasks
 */
export interface RunSummary {
    runId: string;
    startTime: string;
    endTime?: string | undefined;
    totalTasks: number;
    successCount: number;
    failureCount: number;
    tasks: {
        taskId: string;
        status: "success" | "failure" | "timeout" | "error";
        duration: number;
        tracePath: string;
    }[];
}
