// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Structured Plan Format Types
 *
 * Enables:
 * - Explicit planning before execution
 * - State tracking (predicted vs actual)
 * - Plan learning and revision
 * - LLM-friendly plan generation
 */

import { TaskCategory, TaskDifficulty } from "../types.js";

// ============================================================================
// Core Plan Structure
// ============================================================================

export interface ExecutionPlan {
    // Plan metadata
    planId: string;
    taskId: string;
    createdAt: string;
    version: number;

    // Task context
    task: {
        description: string;
        startingUrl: string;
        category: TaskCategory;
        difficulty: TaskDifficulty;
    };

    // Goal state prediction
    goalState: PredictedPageState;

    // Execution steps
    steps: PlanStep[];

    // Variables/state
    variables: VariableDefinition[];

    // Execution metadata (populated during execution)
    execution?: ExecutionMetadata;
}

// ============================================================================
// Plan Steps
// ============================================================================

export interface PlanStep {
    // Step identification
    stepId: string;
    stepNumber: number;

    // Step details
    objective: string;
    description: string;

    // Prerequisites
    preconditions: Precondition[];

    // Actions to perform
    actions: PlannedAction[];

    // State predictions
    predictedState: PredictedPageState;

    // Variables
    inputVariables: string[];
    outputVariables: VariableAssignment[];

    // Control flow
    controlFlow?: ControlFlowNode;

    // Execution tracking (populated during execution)
    execution?: StepExecution;
}

export interface PlannedAction {
    actionId: string;
    tool: string;
    parameters: Record<string, any>;
    parameterBindings?: ParameterBinding[];
    rationale?: string;

    // Execution tracking
    execution?: ActionExecution;
}

export interface ParameterBinding {
    parameterName: string;
    variableName: string;
}

// ============================================================================
// Control Flow
// ============================================================================

export type ControlFlowNode =
    | SequentialFlow
    | ConditionalFlow
    | LoopFlow
    | RetryFlow;

export interface SequentialFlow {
    type: "sequential";
}

export interface ConditionalFlow {
    type: "conditional";
    condition: Condition;
    thenSteps: PlanStep[];
    elseSteps?: PlanStep[];
}

export interface LoopFlow {
    type: "loop";
    condition: Condition;
    loopSteps: PlanStep[];
    maxIterations: number;
}

export interface RetryFlow {
    type: "retry";
    maxRetries: number;
    retrySteps: PlanStep[];
    backoffStrategy?: "linear" | "exponential";
}

export interface Condition {
    type: "pageState" | "variable" | "elementExists" | "custom";
    expression: string;
    variables?: string[];
}

// ============================================================================
// State Predictions
// ============================================================================

export interface PredictedPageState {
    // Page identification
    expectedUrl?: string;
    expectedUrlPattern?: string;
    expectedPageType?: string;

    // Page elements
    expectedElements?: ElementPrediction[];

    // Page content
    expectedContent?: ContentPrediction[];

    // State variables
    stateVariables?: Record<string, any>;

    // Confidence
    confidence?: number;
}

export interface ElementPrediction {
    role: string;
    description: string;
    required: boolean;
    attributes?: Record<string, string>;
}

export interface ContentPrediction {
    location: string;
    expectedText?: string;
    expectedTextPattern?: string;
    containsKeywords?: string[];
}

// ============================================================================
// Variables and State
// ============================================================================

export interface VariableDefinition {
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description: string;
    scope: "plan" | "step";
    defaultValue?: any;
}

export interface VariableAssignment {
    variableName: string;
    source: "toolResult" | "pageState" | "computation";
    extractionPath?: string;
    computation?: string;
}

// ============================================================================
// Preconditions
// ============================================================================

export interface Precondition {
    type: "pageState" | "variable" | "stepCompleted" | "elementExists";
    description: string;
    condition: Condition;
    required: boolean;
}

// ============================================================================
// Execution Tracking
// ============================================================================

export interface ExecutionMetadata {
    startTime: string;
    endTime?: string;
    duration?: number;
    status: "running" | "success" | "partial" | "failure";
    corrections: Correction[];
    performanceMetrics: {
        totalSteps: number;
        successfulSteps: number;
        failedSteps: number;
        retriedSteps: number;
    };
}

export interface StepExecution {
    startTime: string;
    endTime?: string;
    duration?: number;
    status: "pending" | "running" | "success" | "failure" | "skipped";
    actualState?: PredictedPageState;
    stateDiff?: StateDifference;
    corrections?: Correction[];
    retryCount?: number;
}

export interface ActionExecution {
    startTime: string;
    endTime?: string;
    duration?: number;
    success: boolean;
    toolResult?: any;
    error?: string;
}

export interface StateDifference {
    predictedUrl?: string;
    actualUrl?: string;
    urlMatch: boolean;

    missingElements: ElementPrediction[];
    unexpectedElements: any[];

    contentMismatches: ContentMismatch[];

    variableDifferences: VariableDifference[];
}

export interface ContentMismatch {
    location: string;
    predicted?: string;
    actual?: string;
    mismatchType: "missing" | "different" | "extra";
}

export interface VariableDifference {
    variableName: string;
    predictedValue?: any;
    actualValue?: any;
    match: boolean;
}

export interface Correction {
    stepId: string;
    correctionType:
        | "action-modified"
        | "action-added"
        | "action-removed"
        | "step-skipped"
        | "step-added";
    originalAction?: PlannedAction;
    correctedAction?: PlannedAction;
    reason: string;
    timestamp: string;
}

// ============================================================================
// Plan Execution Results
// ============================================================================

export interface PlanExecutionResult {
    planId: string;
    success: boolean;
    error?: string;
    duration: number;
    executedSteps: number;
    totalSteps: number;
    corrections: Correction[];
    finalState?: PredictedPageState;
    data?: any;
}

// ============================================================================
// Plan Generation Options
// ============================================================================

export interface PlanGenerationOptions {
    includeControlFlow?: boolean;
    maxSteps?: number;
    detailLevel?: "minimal" | "standard" | "detailed";
    taskSpecificHints?: string[];
}

export interface PlanRevisionOptions {
    preserveStructure?: boolean;
    onlyCorrections?: boolean;
    includeReasons?: boolean;
}
