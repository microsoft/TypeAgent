// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RepositoryToolTrace } from "./script/repositoryApi.js";
import type { LanguageServerOptions } from "./script/languageServer.js";
import type {
    ReasoningLoopConfig,
    ReasoningSDKAdapter,
    ReasoningSession,
} from "agent-dispatcher/reasoning";

export interface ExploreRequest {
    query: string;
    maxResults?: number | undefined;
}

export interface ExploreUsage {
    requestCount: number;
    usageComplete?: boolean;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}

export interface RepositoryExplorer {
    explore(request: ExploreRequest): Promise<string>;
    exploreDetailed?(request: ExploreRequest): Promise<RepositoryExploreResult>;
    close?(): Promise<void>;
}

export interface RepositoryExploreResult {
    text: string;
    usage: ExploreUsage;
    toolTrace: RepositoryToolTrace;
    result: {
        citationCount: number;
        truncated: boolean;
    };
}

export interface ExplorerActionAttempt {
    index: number;
    actionName: string;
    status: "completed" | "failed";
    error?: string;
}

export interface ExplorerReasoningAttempt {
    index: number;
    tool: string;
    actionName?: string;
    status: "completed" | "failed";
    error?: string;
}

export interface ExplorerSessionSnapshot {
    submitted: boolean;
    submissionAction?: "refineRepository" | "submitExploration";
    programAttempts: number;
    observationCount: number;
    actionAttempts: ExplorerActionAttempt[];
    toolTrace: RepositoryToolTrace;
    text?: string;
    result?: {
        citationCount: number;
        truncated: boolean;
    };
}

export interface ExploreInvocationTelemetry {
    index: number;
    status: "completed" | "failed";
    usage: ExploreUsage;
    /**
     * The inner model calls both select typed actions and generate Code Mode
     * programs in the same completion, so their tokens cannot be split without
     * double-counting.
     */
    actionTranslationAndCodeGenerationUsage: ExploreUsage;
    toolTrace: RepositoryToolTrace;
    reasoningTrace: ExplorerReasoningAttempt[];
    actionAttempts: ExplorerActionAttempt[];
    submissionAction?: "refineRepository" | "submitExploration";
    result?: {
        citationCount: number;
        truncated: boolean;
    };
    error?: string;
}

export interface ExploreTelemetry {
    schemaVersion: 4;
    model: string;
    invocations: ExploreInvocationTelemetry[];
}

export interface UsageAwareReasoningSession extends ReasoningSession {
    getUsage(): ExploreUsage;
}

export interface ExplorerReasoningSDKAdapter extends ReasoningSDKAdapter {
    createSession(
        config: ReasoningLoopConfig,
    ): Promise<UsageAwareReasoningSession>;
    close?(): Promise<void>;
}

export interface CodeModeExplorerOptions {
    repoRoot: string;
    ripgrepPath?: string;
    reasoningAdapter: ExplorerReasoningSDKAdapter;
    modelName: string;
    telemetryFile?: string;
    executionTimeoutMs?: number;
    maxToolCalls?: number;
    maxOutputChars?: number;
    lsp?: LanguageServerOptions;
}
