// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonValue,
    RecipeArtifact,
    RecipeEffectCheckpoint,
    RecipeRunResult,
} from "./recipeContracts.js";

export interface RecordedToolCall {
    toolCallId: string;
    name: string;
    mcpServerName?: string;
    arguments?: unknown;
    result?: unknown;
    // Parsed model-facing tool text, distinct from the raw event/UI result.
    modelResult?: unknown;
    resultArtifact?: PrivateResultReference;
    modelResultArtifact?: PrivateResultReference;
    status: "completed" | "failed" | "denied";
    permission?: unknown;
}

export interface RecordedInteractionTrace {
    schemaVersion: 1 | 2;
    capabilities?: ["private-result-evidence-v1"];
    sessionId: string;
    cwd: string;
    prompt: string;
    response: string;
    startedAt: string;
    completedAt: string;
    toolCalls: RecordedToolCall[];
}

export interface ArmRecordingRequest {
    sessionId: string;
    ttlMs?: number;
    learning?: boolean;
    cwd?: string;
}

export interface ClaimRecordingRequest {
    sessionId: string;
    cwd: string;
    promptHash: string;
}

export interface RecordingToken {
    id: string;
    sessionId: string;
    status: "armed" | "claimed";
    expiresAt: string;
    cwd?: string;
    promptHash?: string;
    learning?: boolean;
}

export interface RecordingState {
    status: "idle" | "armed" | "claimed" | "completed" | "failed";
    token?: RecordingToken;
    trace?: TraceSummary;
    error?: string;
    learningJob?: MacroLearningJob;
}

export interface FinalizeRecordingRequest {
    tokenId: string;
    trace: RecordedInteractionTrace;
    childAuthoring?: MacroChildCapture;
}

export interface MacroChildCapture {
    taskId: string;
    firstEventId: string;
    successEventId: string;
    outputEventId: string;
    recordingTokenId: string;
}

export interface MacroAuthoringClaim {
    cwd: string;
    sessionId: string;
    workerId: string;
}

export interface MacroAuthoringRequest {
    requestId: string;
    jobId: string;
    captureId: string;
    contextDigest: string;
    promptDigest: string;
    prompt: string;
    leaseId: string;
    leaseExpiresAt: string;
    context: import("./recipeAuthoring.js").SealedRecipeAuthoringContext;
}

export interface MacroAuthoringSubmission extends MacroAuthoringClaim {
    requestId: string;
    leaseId: string;
    promptDigest: string;
    outcome:
        | { status: "completed"; text: string; childId: string }
        | { status: "failed"; error: string };
}

export interface TraceSummary {
    traceId: string;
    sessionId: string;
    createdAt: string;
    toolCallCount: number;
    learningJobId?: string;
}

export type MacroExecutionClass = "replayable" | "agentRequired";
export type MacroVersionState = "draft" | "approved" | "disabled";

export type ValueExpression =
    | { kind: "literal"; value: unknown }
    | { kind: "input"; name: string }
    | { kind: "stepResult"; stepId: string; path?: string[] }
    | { kind: "resultPath"; stepId: string; path: string[]; suffix: string }
    | {
          kind: "template";
          value: unknown;
          bindings: Array<{
              path: string[];
              expression: Exclude<ValueExpression, { kind: "template" }>;
          }>;
      };

export type MacroValueType =
    | "null"
    | "array"
    | "object"
    | "string"
    | "number"
    | "boolean";

export interface MacroInput {
    name: string;
    description: string;
    required: boolean;
    secret: boolean;
    valueType?: MacroValueType;
}

export type MacroPostcondition =
    | { kind: "resultType"; valueType: MacroValueType }
    | { kind: "resultPathExists"; path: string[] };

export interface MacroStep {
    id: string;
    toolName: string;
    mcpServerName?: string;
    arguments: ValueExpression;
    executionClass: MacroExecutionClass;
    sourceToolCallId: string;
    schemaFingerprint?: string;
    postconditions?: MacroPostcondition[];
}

export interface CopilotToolMacro {
    schemaVersion: 1 | 2;
    capabilities?: ["result-path-v1"];
    macroId: string;
    version: number;
    name: string;
    description: string;
    state: MacroVersionState;
    executionClass: MacroExecutionClass;
    inputs: MacroInput[];
    steps: MacroStep[];
    sourceTraceId: string;
    createdAt: string;
    warnings: string[];
    executionKind?: "program";
    program?: RecipeArtifact;
    learning?: {
        jobId: string;
        cwd: string;
        mode: MacroLearningMode;
        requiresLivePermissions: true;
        grammarRules: string[];
        exampleInputs: Record<string, unknown>;
        requests: string[];
        authoring?: MacroChildAuthoringIdentity;
    };
}

export type MacroLearningMode = "off" | "prepare" | "read-only" | "all";

export interface MacroLearningPreference {
    cwd: string;
    mode: MacroLearningMode;
    revision: number;
}

export interface MacroExecutionRecipe {
    schemaVersion: 1;
    traceId: string;
    request: string;
    toolCallIds: string[];
    description: string;
    uncertainties: string[];
    programRequirements?: string[];
}

export interface MacroLearningBuild {
    name: string;
    description: string;
    inputs: MacroInput[];
    steps: MacroStep[];
    exampleInputs: Record<string, unknown>;
    requests: string[];
    // The builder must explicitly report unsupported selection or full-output synthesis.
    unsupportedOutputs?: string[];
}

export interface MacroLearningJob {
    jobId: string;
    traceId: string;
    cwd: string;
    sessionId: string;
    mode: MacroLearningMode;
    status:
        | "queued"
        | "extracting"
        | "building"
        | "awaitingAuthor"
        | "needsReview"
        | "ready"
        | "failed"
        | "cancelled";
    macro?: MacroVersionRef;
    error?: string;
    createdAt: string;
    updatedAt: string;
    authoring?: MacroChildAuthoringIdentity;
}

export interface MacroChildAuthoringIdentity {
    captureId: string;
    taskId: string;
    tokenId: string;
    contextDigest: string;
}
export type MacroAuthoringQuery = (
    prompt: string,
    signal: AbortSignal,
) => Promise<string>;
export type MacroVerifierQueryCache = (
    prompt: string,
    execute: () => Promise<string>,
) => Promise<string>;

export interface MacroLearningRuntime {
    withAuthorQuery?(
        query: MacroAuthoringQuery,
        cacheVerifier?: MacroVerifierQueryCache,
    ): MacroLearningRuntime;
    buildProgram(
        macro: CopilotToolMacro,
        trace: RecordedInteractionTrace,
        signal: AbortSignal,
        query?: MacroAuthoringQuery,
        cacheVerifier?: MacroVerifierQueryCache,
    ): Promise<RecipeArtifact>;
    extract(
        trace: RecordedInteractionTrace,
        traceId: string,
        signal: AbortSignal,
    ): Promise<MacroExecutionRecipe>;
    build(
        recipe: MacroExecutionRecipe,
        trace: RecordedInteractionTrace,
        baseline: CopilotToolMacro,
        signal: AbortSignal,
    ): Promise<MacroLearningBuild>;
    generateGrammar(
        macro: CopilotToolMacro,
        exampleInputs: Record<string, unknown>,
        requests: string[],
        signal: AbortSignal,
    ): Promise<string[]>;
    // Validate staged rules against the current catalog without generating rules or executing tools.
    validateGrammar(
        macro: CopilotToolMacro,
        approved: CopilotToolMacro[],
    ): void;
}

export interface MacroSummary {
    macroId: string;
    version: number;
    name: string;
    description: string;
    state: MacroVersionState;
    executionClass: MacroExecutionClass;
    stepCount: number;
    updatedAt: string;
}

export interface MacroMatch {
    macro: MacroSummary;
    score: number;
}

export interface MacroVersionRef {
    macroId: string;
    version: number;
    state: MacroVersionState;
}

export interface InspectMacroRequest {
    macroId: string;
    version?: number;
    /** Also require the current approved, unsuppressed execution route. */
    requireRunnable?: boolean;
}

export interface ValidateMacroRequest extends InspectMacroRequest {}

export interface ApproveMacroRequest extends InspectMacroRequest {}

export interface DisableMacroRequest {
    macroId: string;
}

export interface DeleteMacroRequest {
    macroId: string;
}

export interface ListMacrosRequest {
    state?: MacroVersionState;
    limit?: number;
}

export interface SearchMacrosRequest {
    query: string;
    limit?: number;
}

export interface MacroValidationIssue {
    severity: "error" | "warning";
    code: string;
    message: string;
    stepId?: string;
}

export interface MacroValidationReport {
    macroId: string;
    version: number;
    valid: boolean;
    executionClass: MacroExecutionClass;
    issues: MacroValidationIssue[];
}

export interface MacroRequirements {
    macroId: string;
    version: number;
    executionClass: MacroExecutionClass;
    executionKind?: "program";
    inputs: MacroInput[];
    tools: Array<{
        toolName: string;
        mcpServerName?: string;
        executionClass: MacroExecutionClass;
    }>;
}
export type MacroRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RunMacroRequest extends InspectMacroRequest {
    runId: string;
    inputs?: Record<string, unknown>;
    timeoutMs?: number;
    dryRun?: boolean;
}

export interface MacroRunStep {
    stepId: string;
    toolName: string;
    mcpServerName?: string;
    status: "completed" | "failed" | "cancelled";
    result?: unknown;
    resultArtifact?: PrivateResultReference;
    error?: string;
    startedAt: string;
    completedAt: string;
}

export interface MacroRunRecord {
    runId: string;
    macroId: string;
    version: number;
    status: MacroRunStatus;
    executionClass: MacroExecutionClass;
    inputs: Record<string, unknown>;
    steps: MacroRunStep[];
    startedAt: string;
    completedAt?: string;
    result?: unknown;
    resultArtifact?: PrivateResultReference;
    error?: { code: string; message: string };
    program?: RecipeRunResult;
}

export interface MacroProgramRunContext {
    runId: string;
    cwd: string;
    signal: AbortSignal;
    timeoutMs: number;
    onCheckpoint(checkpoint: RecipeEffectCheckpoint): Promise<void>;
}

export interface MacroProgramRuntime {
    execute(
        artifact: RecipeArtifact,
        input: JsonValue,
        context: MacroProgramRunContext,
    ): Promise<RecipeRunResult>;
}

export interface PrivateResultReference {
    schemaVersion: 1;
    capability: "private-result-evidence-v1";
    owner: "trace" | "run";
    ownerId: string;
    toolCallId: string;
    source: "result" | "modelResult";
    id: string;
    encoding: "json-utf8";
    sha256: string;
    sizeBytes: number;
    sensitive: true;
    view: unknown;
    omittedPaths: string[][];
    blobs: Array<{
        path: string[];
        encoding: "base64";
        sha256: string;
        sizeBytes: number;
    }>;
}

export type RunMacroResponse =
    | { status: "completed"; run: MacroRunRecord }
    | { status: "failed" | "cancelled"; run: MacroRunRecord };

export interface ReplayToolDescriptor {
    mcpServerName?: string;
    toolName: string;
    schemaFingerprint: string;
    readOnly?: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
}

export interface ReplayToolContext {
    cwd?: string;
}

export interface ReplayToolHost {
    // Native inspection is opt-in; existing MCP-only hosts keep failing closed.
    readonly supportsNativeTools?: true;
    // Missing servers/tools return undefined; connection and inspection failures throw.
    inspectTool(
        mcpServerName: string | undefined,
        toolName: string,
        context?: ReplayToolContext,
    ): Promise<ReplayToolDescriptor | undefined>;
    callTool(
        mcpServerName: string | undefined,
        toolName: string,
        argumentsValue: unknown,
        signal: AbortSignal,
        context?: ReplayToolContext,
    ): Promise<unknown>;
}
