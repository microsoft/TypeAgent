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
