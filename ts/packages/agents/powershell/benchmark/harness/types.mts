// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface BenchmarkScenario {
    id: string;
    category:
        | "grammar-match"
        | "grammar-subschemas"
        | "grammar-competition"
        | "llm-translation"
        | "execution"
        | "fallback-chain"
        | "end-to-end";
    description: string;
    setup: {
        requiredFlows?: string[];
        requiredSchemas?: string[];
        allAgents?: boolean;
        environmentSetup?: string;
        configOverrides?: Record<string, unknown>;
    };
    utterances: TestUtterance[];
    teardown?: { cleanupScript?: string };
}

export interface TestUtterance {
    text: string;
    expected: {
        routedTo: "grammar" | "llm-translation" | "reasoning";
        matchedFlow?: string | null;
        matchedAgent?: string | null;
        extractedParams?: Record<string, unknown>;
        execution?: {
            shouldSucceed: boolean;
            outputContains?: string[];
            outputNotContains?: string[];
            outputPattern?: string;
        };
        fallback?: {
            shouldFallback: boolean;
            fallbackReason?: string;
            reasoningShouldFix?: boolean;
        };
        llmJudge?: { question: string; context?: string };
    };
}

export interface PipelineTrace {
    utterance: string;
    grammarMatchAttempted: boolean;
    grammarMatchResult: "match" | "no-match" | "rejected";
    matchedAgent?: string;
    matchedAction?: string;
    extractedParams?: Record<string, unknown>;
    llmTranslationAttempted: boolean;
    llmTranslationResult?: unknown;
    executionAttempted: boolean;
    executionResult?: {
        success: boolean;
        output: string;
        error?: string;
    };
    fallbackTriggered: boolean;
    fallbackReason?: string;
    reasoningInvoked: boolean;
    totalTimeMs: number;
}

export interface EvaluationResult {
    passed: boolean;
    component:
        | "grammar"
        | "parameters"
        | "execution"
        | "fallback"
        | "llm-judge";
    expected: unknown;
    actual: unknown;
    message?: string;
}

export interface ScenarioResult {
    scenarioId: string;
    category: string;
    description: string;
    utterance: string;
    passed: boolean;
    evaluations: EvaluationResult[];
    trace: PipelineTrace;
    durationMs: number;
}

export interface CategorySummary {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
}

export interface ComponentAccuracy {
    accuracy: number;
    total: number;
    correct: number;
}

export interface Scorecard {
    timestamp: string;
    durationSeconds: number;
    summary: CategorySummary;
    byCategory: Record<string, CategorySummary>;
    byComponent: Record<string, ComponentAccuracy>;
    regressions: string[];
    improvements: string[];
}
