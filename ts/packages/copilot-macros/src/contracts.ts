// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface RecordedToolCall {
    toolCallId: string;
    name: string;
    mcpServerName?: string;
    arguments?: unknown;
    result?: unknown;
    status: "completed" | "failed" | "denied";
    permission?: unknown;
}

export interface RecordedInteractionTrace {
    schemaVersion: 1;
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
}

export interface RecordingState {
    status: "idle" | "armed" | "claimed" | "completed" | "failed";
    token?: RecordingToken;
    trace?: TraceSummary;
    error?: string;
}

export interface FinalizeRecordingRequest {
    tokenId: string;
    trace: RecordedInteractionTrace;
}

export interface TraceSummary {
    traceId: string;
    sessionId: string;
    createdAt: string;
    toolCallCount: number;
}

export type MacroExecutionClass = "replayable" | "agentRequired";
export type MacroVersionState = "draft" | "approved" | "disabled";

export type ValueExpression =
    | { kind: "literal"; value: unknown }
    | { kind: "input"; name: string }
    | { kind: "stepResult"; stepId: string; path?: string[] };

export interface MacroInput {
    name: string;
    description: string;
    required: boolean;
    secret: boolean;
}

export interface MacroStep {
    id: string;
    toolName: string;
    mcpServerName?: string;
    arguments: ValueExpression;
    executionClass: MacroExecutionClass;
    sourceToolCallId: string;
    schemaFingerprint?: string;
}

export interface CopilotToolMacro {
    schemaVersion: 1;
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
    candidateProvenance?: MacroCandidateProvenance;
}

export interface MacroCandidateProvenance {
    sourceMacroId: string;
    sourceVersion: number;
    handoffRunId: string;
    reason: string;
    submittedAt: string;
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

export interface CreateMacroFromTraceRequest {
    traceId: string;
    name: string;
    description?: string;
}

export interface MacroVersionRef {
    macroId: string;
    version: number;
    state: MacroVersionState;
}

export interface InspectMacroRequest {
    macroId: string;
    version?: number;
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
    inputs: MacroInput[];
    tools: Array<{
        toolName: string;
        mcpServerName?: string;
        executionClass: MacroExecutionClass;
    }>;
}

export type MacroExecutionPreference = "replay" | "agent" | "auto";
export type MacroRunStatus =
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "agentRequired";

export interface RunMacroRequest extends InspectMacroRequest {
    runId: string;
    inputs?: Record<string, unknown>;
    preference?: MacroExecutionPreference;
    timeoutMs?: number;
    dryRun?: boolean;
}

export interface AgentRunnerLaunchPayload {
    agent: "typeagent-macro-runner";
    macro: CopilotToolMacro;
    inputs: Record<string, unknown>;
    reason: {
        code: "agentRequested" | "agentRequired";
        message: string;
        stepIds: string[];
    };
    budgets: {
        maxToolCalls: number;
        maxRetries: number;
        timeoutMs: number;
        maxTokens: number;
    };
    candidate: {
        sourceMacroId: string;
        sourceVersion: number;
        handoffRunId: string;
    };
}

export interface SubmitMacroCandidateRequest {
    sourceMacroId: string;
    sourceVersion: number;
    handoffRunId: string;
    reason: string;
    name?: string;
    description?: string;
    inputs: MacroInput[];
    steps: MacroStep[];
    executionEvidence: {
        outcome: "completed";
        toolCalls: number;
        retries: number;
        durationMs: number;
        tokensUsed: number;
        steps: Array<{
            stepId: string;
            status: "completed" | "failed" | "denied" | "cancelled";
        }>;
    };
}

export interface MacroRunStep {
    stepId: string;
    toolName: string;
    mcpServerName?: string;
    status: "completed" | "failed" | "cancelled";
    result?: unknown;
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
    error?: { code: string; message: string };
}

export type RunMacroResponse =
    | {
          status: "validated";
          runId: string;
          macroId: string;
          version: number;
      }
    | { status: "completed"; run: MacroRunRecord }
    | { status: "failed" | "cancelled"; run: MacroRunRecord }
    | {
          status: "agentRequired";
          runId: string;
          macroId: string;
          version: number;
          reason: string;
          launch: AgentRunnerLaunchPayload;
      };

export interface ReplayToolDescriptor {
    mcpServerName?: string;
    toolName: string;
    schemaFingerprint: string;
}

export interface ReplayToolContext {
    cwd?: string;
}

export interface ReplayToolHost {
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
