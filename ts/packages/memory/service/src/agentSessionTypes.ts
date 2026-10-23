// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AgentSessionImportType =
    | "agent-session-jsonl"
    | "copilot-session-jsonl";

export interface AgentSessionScope {
    repository?: string;
    commit?: string;
    environment?: string;
}

export interface AgentSessionImportRequest extends AgentSessionScope {
    corpusId: string;
    sessionId: string;
    importType: AgentSessionImportType;
    idempotencyKey: string;
    expectedCursor: number;
    jsonl: string;
    final?: boolean;
}

export interface AgentSessionReadRequest {
    corpusId: string;
    sessionId: string;
}

export type AgentSessionEventKind =
    | "objective"
    | "message"
    | "reasoning-summary"
    | "delegation"
    | "tool-call"
    | "tool-result"
    | "decision"
    | "verification"
    | "outcome"
    | "compaction"
    | "lifecycle";

export interface AgentSessionEvent {
    schemaVersion: 1;
    id: string;
    sessionId: string;
    kind: AgentSessionEventKind;
    text: string;
    role?: "user" | "assistant" | "tool" | "system" | "agent";
    agentId?: string;
    parentAgentId?: string;
    taskId?: string;
    parentTaskId?: string;
    turnId?: string;
    callId?: string;
    timestamp?: string;
    outcome?: "success" | "failure" | "unknown";
}

export interface AgentSessionLoss {
    line: number;
    reason: string;
}

export interface AgentSessionParseResult {
    events: AgentSessionEvent[];
    records: number;
    duplicates: number;
    losses: AgentSessionLoss[];
}

export interface AgentSessionEpisode {
    episodeId: string;
    events: AgentSessionEvent[];
    text: string;
    spans: Array<{ eventId: string; start: number; end: number }>;
}

export interface AgentMemoryEvidence {
    eventId: string;
    sourceId: string;
    revisionId: string;
    locator: string;
    excerpt: string;
}

export interface AgentMemoryArtifact {
    memoryId: string;
    kind: "semantic" | "procedure";
    title: string;
    body: string;
    state: "diagnostic-only" | "observed";
    scope: AgentSessionScope;
    evidence: AgentMemoryEvidence[];
    influenceSourceIds: string[];
    supersedes: string[];
    conflicted: boolean;
}

export interface AgentSessionEvidenceInput extends AgentSessionScope {
    sourceId: string;
    revisionId: string;
    episode: AgentSessionEpisode;
}

export interface AgentSessionDistillationModel {
    identity: string;
    fits(prompt: string): boolean;
    complete(prompt: string, signal: AbortSignal): Promise<string>;
}

export interface AgentSessionImportReceipt extends AgentSessionReadRequest {
    schemaVersion: 1;
    importType: AgentSessionImportType;
    state: "running" | "complete" | "partial" | "failed" | "cancelled";
    cursor: number;
    final: boolean;
    sourceCount: number;
    memoryCount: number;
    duplicates: number;
    losses: AgentSessionLoss[];
    updatedAt: string;
    error?: string;
}

export interface AgentMemorySearchRequest extends AgentSessionScope {
    corpusId: string;
    query: string;
    limit?: number;
}

export interface AgentMemorySearchResult {
    memories: AgentMemoryArtifact[];
    warnings: string[];
}
