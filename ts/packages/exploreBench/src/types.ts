// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BenchmarkVariant = "baseline" | "typeagent" | "typeagent-lsp";

export function normalizeBenchmarkVariant(value: unknown): BenchmarkVariant {
    if (value === "typeagent-mcp") {
        return "typeagent";
    }
    if (
        value === "baseline" ||
        value === "typeagent" ||
        value === "typeagent-lsp"
    ) {
        return value;
    }
    throw new Error(
        `Unsupported benchmark variant ${JSON.stringify(value)}; expected baseline, typeagent, or typeagent-lsp`,
    );
}

export function isTypeAgentVariant(
    variant: BenchmarkVariant,
): variant is "typeagent" | "typeagent-lsp" {
    return variant === "typeagent" || variant === "typeagent-lsp";
}

export const BENCHMARK_TOOL_CALL_LIMIT = 8;

export type RepositoryLanguage = "python" | "typescript";

export interface MatrixEntry {
    name?: string;
    model: string;
}

export interface MatrixFile {
    runs: MatrixEntry[];
}

export interface SwebenchRow {
    instance_id: string;
    repo?: string;
    base_commit?: string;
    problem_statement: string;
    patch: string;
}

export interface SwebenchMeta {
    dataset: string;
    split: "test";
    rowIndex: number;
    instanceId: string;
    repo?: string;
    baseCommit?: string;
    patch: string;
    dockerImage: string;
}

export interface BenchTask {
    id: string;
    repoPath: string;
    query: string;
    swebench: SwebenchMeta;
}

export interface McpServerConfig {
    command: string;
    args: string[];
    cwd?: string;
    envVars: string[];
}

export interface BenchmarkAgentConfig {
    name: string;
    description: string;
    tools: string[];
    prompt: string;
    file: string;
    sha256: string;
}

export interface TokenUsage {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}

export interface CopilotUsage extends TokenUsage {
    requestCount: number;
    usageComplete?: boolean;
    source: "assistant.usage" | "rpc";
    models: string[];
}

export interface TypeAgentUsage extends TokenUsage {
    requestCount: number;
    usageComplete?: boolean;
}

export interface TypeAgentDispatchAction {
    schemaName: string;
    actionName: string;
    parameters?: Record<string, unknown>;
}

export interface TypeAgentDispatchEvidence {
    ingress: "natural-language";
    submittedRequest: string;
    translationInvoked: boolean;
    translationRequestCount: number;
    activeAgentNames: string[];
    activeSchemaNames: string[];
    translatedActions: TypeAgentDispatchAction[];
    executionCount: number;
    outputMatchedExecution: boolean;
    executionRequestMatchedIngress: boolean;
    usedCopilot: boolean;
    usedMcp: boolean;
}

export interface TypeAgentToolCallTrace {
    tool: string;
    startedAt?: string;
    durationMs: number;
    input: unknown;
    execution?: {
        engine: string;
        executable: string;
    };
    resultCount: number;
    outputBytes: number;
    truncated: boolean;
    error?: string;
}

export interface TypeAgentToolTrace {
    calls: TypeAgentToolCallTrace[];
    totalCalls: number;
    totalOutputBytes: number;
}

export interface ExploreInvocationTelemetry {
    index: number;
    status: "completed" | "failed";
    usage: TypeAgentUsage;
    translationUsage?: TypeAgentUsage;
    codeModeUsage?: TypeAgentUsage;
    actionTranslationAndCodeGenerationUsage?: TypeAgentUsage;
    toolTrace: TypeAgentToolTrace;
    reasoningTrace?: Array<{
        index: number;
        tool: string;
        actionName?: string;
        status: "completed" | "failed";
        error?: string;
    }>;
    actionAttempts?: Array<{
        index: number;
        actionName: string;
        status: "completed" | "failed";
        error?: string;
    }>;
    submissionAction?: "refineRepository" | "submitExploration";
    result?: {
        citationCount: number;
        truncated: boolean;
    };
    error?: string;
}

/** Parsed telemetry normalized to aggregate usage while preserving v2 calls. */
export interface ExploreTelemetry {
    schemaVersion: 1 | 2 | 3 | 4;
    model: string;
    status: "completed" | "failed";
    usage: TypeAgentUsage;
    toolTrace: TypeAgentToolTrace;
    invocations?: ExploreInvocationTelemetry[];
    result?: {
        citationCount: number;
        truncated: boolean;
    };
    error?: string;
}

export type CopilotTraceItem = Record<string, unknown>;

export interface CopilotToolCallTrace {
    tool: string;
    args: unknown;
    ok: boolean;
    durationMs: number;
    output: string;
}

export interface McpToolCallTrace {
    toolCallId: string;
    server?: string;
    tool?: string;
    arguments?: unknown;
    completed: boolean;
    success?: boolean;
    result?: unknown;
    error?: string;
}

export interface ExplorerSubagentTrace {
    toolCallId: string;
    agentId?: string;
    agentName: string;
    arguments?: unknown;
    started: boolean;
    completed: boolean;
    success?: boolean;
    model?: string;
    durationMs?: number;
    totalTokens?: number;
    totalToolCalls?: number;
    error?: string;
}

export interface SwebenchCitation {
    path: string;
    lineRange: string;
    startLine: number;
    endLine: number;
    explanation: string;
}

export interface SwebenchMetricScore {
    score: number;
    precision: number;
    recall: number;
    f1: number;
    nCitation: number;
    nPatch: number;
}

export interface SwebenchScore {
    kind: "swebench";
    validFinalAnswer: boolean;
    citations: SwebenchCitation[];
    patchFiles: Array<{ path: string; startLine: number; endLine: number }>;
    file: SwebenchMetricScore;
    line: SwebenchMetricScore;
    nBrokenLines: number;
    nOverlapLineCitation: number;
}

export interface SafeProviderMetadata {
    type: "openai-compatible";
    baseUrl: string;
    apiKeyEnv: string;
    hasApiKey: boolean;
    wireApi: "responses";
}

export interface RunResult {
    runId: string;
    taskId: string;
    rowIndex: number;
    matrixName: string;
    model: string;
    variant: BenchmarkVariant;
    provider: SafeProviderMetadata;
    repoPath: string;
    query: string;
    swebench: SwebenchMeta;
    ok: boolean;
    durationMs: number;
    attempt: number;
    maxAttempts: number;
    usedRepair?: boolean;
    finalAnswer: string;
    score: SwebenchScore;
    /** Outer GitHub Copilot CLI usage from SDK assistant.usage events. */
    usage?: CopilotUsage;
    /** Inner Explorer Code Mode model usage from TypeAgent telemetry. */
    typeAgentUsage?: TypeAgentUsage;
    /** TypeAgent dispatcher natural-language-to-action translation usage. */
    dispatcherUsage?: TypeAgentUsage;
    /** Dispatcher translation plus inner Explorer reasoning usage. */
    combinedUsage?: TokenUsage;
    /** Combined usage from the final attempt only, populated while reporting. */
    finalAttemptUsage?: TokenUsage;
    typeAgentToolTrace?: TypeAgentToolTrace;
    exploreTelemetry?: ExploreTelemetry;
    telemetryFile?: string;
    attemptedExploreCalls?: number;
    completedExploreCalls?: number;
    successfulExploreCalls?: number;
    outsideExploreInspection?: boolean;
    mcpServerReady?: boolean;
    mcpAdvertisedTools?: string[];
    telemetryError?: string;
    mcpAdopted: boolean;
    lspAdopted?: boolean;
    lspCallCount?: number;
    lspResultCount?: number;
    subagentAdopted: boolean;
    defaultMainAgent: boolean;
    attemptedExplorerDelegations?: number;
    completedExplorerDelegations?: number;
    successfulExplorerDelegations?: number;
    failedExplorerDelegations?: number;
    explorerRepositoryCalls?: number;
    firstAssistantActionExclusiveExplorer?: boolean;
    explorerCompletedBeforeLaterAssistantAction?: boolean;
    mainAgentRepositoryInspection?: boolean;
    explorerSubagentTrace: ExplorerSubagentTrace[];
    mcpToolTrace: McpToolCallTrace[];
    toolTrace: CopilotToolCallTrace[];
    events: CopilotTraceItem[];
    selectedAgentName?: string;
    typeAgentDispatch?: TypeAgentDispatchEvidence;
    reusedFrom?: ResultReuseProvenance;
    error?: string;
}

export interface ResultReuseProvenance {
    originalRunId: string;
    sourceRunId: string;
    resultsPath: string;
    manifestPath?: string;
    runtimeEvidence?: string;
    importedAt: string;
}

export interface RunManifest {
    schemaVersion: 1;
    /** Bump when prompts, tools, scoring, or integrity semantics change. */
    cacheCompatibilityRevision?: number;
    runId: string;
    createdAt: string;
    dataset: string;
    split: "test";
    taskOffset?: number;
    taskSeed?: string;
    taskIdsFile?: string;
    sourceTaskCount?: number;
    languageFilter?: RepositoryLanguage[];
    taskIds: string[];
    matrix: MatrixEntry[];
    variants: BenchmarkVariant[];
    output: string;
    copilotPath: string;
    runtimeEvidence: string;
    provider: Omit<SafeProviderMetadata, "hasApiKey">;
    mcp: McpServerConfig;
    agent: BenchmarkAgentConfig;
    maxConcurrency: number;
    maxAttempts: number;
    timeoutMs: number;
    dockerPlatform: string;
}
