// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProcedureCandidate,
    ProcedureSaveRequest,
    ProcedureSourceCitation,
    ProcedureVersion,
} from "@typeagent/memory-service";
import type { MemoryCenterPage } from "./serviceTypes.js";

export type RunbookSkillIdentity = {
    scope: "builtin" | "user" | "project" | "package";
    origin: string;
    name: string;
};
export type RunbookSkillState =
    | "draft"
    | "validated"
    | "approved"
    | "active"
    | "disabled"
    | "archived";
export type RunbookSkillAction =
    | "validate"
    | "approve"
    | "activate"
    | "disable"
    | "archive"
    | "rollback"
    | "draft";
export type RunbookSkill = {
    identity: RunbookSkillIdentity;
    revisionId: string;
    state: RunbookSkillState;
    displayName: string;
    description: string;
    active: boolean;
    createdAt: string;
    files: Array<{ path: string; size: number; hash: string }>;
    lineage?: {
        corpusId: string;
        procedureId: string;
        version: number;
        jsonHash: string;
        markdownHash: string;
    };
    allowedActions: RunbookSkillAction[];
    findings: string[];
};
export type RunbookReadiness =
    | "detected"
    | "howto"
    | "runbook"
    | "toolsBound"
    | "skill"
    | "active";
export type RunbookSummary = {
    id: string;
    kind: "candidate" | "procedure";
    corpusId: string;
    corpusName: string;
    objectId: string;
    title: string;
    state: "detected" | "draft" | "saved" | "stale" | "archived";
    readiness: RunbookReadiness;
    latestVersion?: number;
    updatedAt: string;
    editionState?: "draft" | "reviewed";
    boundSteps: number;
    totalSteps: number;
    skills: RunbookSkill[];
    drift: Array<{ stepId: string; reason: string }>;
};
export type RunbookError = {
    corpusId: string;
    operation: string;
    message: string;
};
export type RunbookListRequest = {
    corpusId?: string;
    query?: string;
    readiness?: RunbookReadiness[];
    states?: RunbookSummary["state"][];
    needsReview?: boolean;
    pageSize?: number;
    continuationToken?: string;
};
export type RunbookLocator = {
    kind: "characters";
    start: number;
    end: number;
};
export type RunbookAsset = {
    sourceId: string;
    revisionId: string;
    assetId: string;
    name: string;
    mimeType: string;
    size: number;
    hash: string;
    description?: string;
    instructionBearing?: boolean;
    previewUrl?: string;
    originalUrl?: string;
    warnings: string[];
};
export type RunbookOriginal = {
    citation: ProcedureSourceCitation;
    title: string;
    available: boolean;
    content: string;
    offset: number;
    totalChars: number;
    nextOffset?: number;
    location?: RunbookLocator;
    assets: RunbookAsset[];
    error?: string;
    warnings?: string[];
};
export type RunbookDetailRequest = {
    corpusId: string;
    kind: "candidate" | "procedure";
    objectId: string;
    version?: number;
    skillRevisionId?: string;
};
export type RunbookDetail = {
    corpusId: string;
    corpusName: string;
    candidate?: ProcedureCandidate;
    procedure?: ProcedureVersion;
    originals: RunbookOriginal[];
    history: Array<
        Pick<
            ProcedureVersion,
            "version" | "state" | "createdAt" | "jsonHash" | "markdownHash"
        >
    >;
    skills: RunbookSkill[];
    drift: Array<{ stepId: string; reason: string }>;
    warnings: string[];
};
export type RunbookBindingSuggestion = {
    targetId: string;
    kind: "mcp" | "macro" | "flow";
    name: string;
    description: string;
    version: string;
    fingerprint: string;
    inputSchema: Record<string, unknown>;
    safety: "readOnly" | "changesData" | "unknown";
    score: number;
    reasons: string[];
};
export type RunbookSkillPreview = {
    files: Array<{ path: string; content: string }>;
    findings: string[];
    valid: boolean;
    identity: RunbookSkillIdentity;
    lineage: NonNullable<RunbookSkill["lineage"]>;
};
export type RunbookStaleComparison = {
    previous: RunbookOriginal[];
    updated: RunbookOriginal[];
    current: ProcedureVersion;
    affectedSteps: Array<{ stepId: string; reasons: string[] }>;
    warnings: string[];
};
export type RunbookHistoryEntry = Pick<
    ProcedureVersion,
    "version" | "state" | "createdAt" | "jsonHash" | "markdownHash"
>;
export type RunbookUsage = {
    procedure: Pick<
        ProcedureVersion,
        | "corpusId"
        | "procedureId"
        | "version"
        | "state"
        | "jsonHash"
        | "markdownHash"
    > & { document: { title: string } };
    skills: RunbookSkill[];
};
export type DerivedViewUsage = {
    corpusId: string;
    viewId: string;
    kind: "troubleshootingGuide" | "projectBrief" | "timeline" | "wiki";
    title: string;
    revisionId?: string;
    version?: number;
    jobId?: string;
    conflictId?: string;
    state: "current" | "historical" | "build" | "conflict";
    sectionIds: string[];
    reason: string;
};
export type MemoryHubRunbookFunctions = {
    memoryHubRunbooks(params: RunbookListRequest): Promise<
        MemoryCenterPage<RunbookSummary> & {
            errors: RunbookError[];
            warnings: string[];
        }
    >;
    memoryHubRunbook(params: RunbookDetailRequest): Promise<RunbookDetail>;
    memoryHubSaveRunbook(
        params: ProcedureSaveRequest,
    ): Promise<ProcedureVersion>;
    memoryHubRunbookHistory(params: {
        corpusId: string;
        procedureId: string;
        beforeVersion?: number;
        pageSize?: number;
    }): Promise<MemoryCenterPage<RunbookHistoryEntry>>;
    memoryHubRunbookOriginal(params: {
        corpusId: string;
        sourceId: string;
        revisionId: string;
        locator?: string;
        offset?: number;
    }): Promise<RunbookOriginal>;
    memoryHubRunbookUsedBy(params: {
        corpusId: string;
        sourceId: string;
        pageSize?: number;
        continuationToken?: string;
        viewContinuationToken?: string;
    }): Promise<
        MemoryCenterPage<RunbookUsage> & {
            warnings: string[];
            views?: MemoryCenterPage<DerivedViewUsage>;
        }
    >;
    memoryHubSuggestBindings(params: {
        corpusId: string;
        procedureId: string;
        version: number;
        stepId: string;
    }): Promise<{
        suggestions: RunbookBindingSuggestion[];
        warnings: string[];
    }>;
    memoryHubAcceptBinding(params: {
        corpusId: string;
        procedureId: string;
        expectedVersion: number;
        stepId: string;
        targetId?: string;
        fingerprint?: string;
        targetVersion?: string;
        arguments?: Record<string, unknown>;
        command?: string;
        manualReason?: string;
        safety: "readOnly" | "changesData" | "unknown";
        safetyConfirmed: boolean;
    }): Promise<ProcedureVersion>;
    memoryHubPreviewSkill(params: {
        corpusId: string;
        procedureId: string;
        version: number;
        identity: RunbookSkillIdentity;
        description?: string;
    }): Promise<RunbookSkillPreview>;
    memoryHubPublishSkill(params: {
        corpusId: string;
        procedureId: string;
        version: number;
        identity: RunbookSkillIdentity;
        description?: string;
    }): Promise<RunbookSkill>;
    memoryHubSkillAction(params: {
        identity: RunbookSkillIdentity;
        revisionId: string;
        expectedState: RunbookSkillState;
        expectedActive: boolean;
        action: RunbookSkillAction;
    }): Promise<RunbookSkill>;
    memoryHubSkillFile(params: {
        identity: RunbookSkillIdentity;
        revisionId: string;
        path: string;
    }): Promise<{ path: string; content: string }>;
    memoryHubCompareRunbook(params: {
        corpusId: string;
        procedureId: string;
        version: number;
    }): Promise<RunbookStaleComparison>;
    memoryHubSynthesizeRunbook(params: {
        corpusId: string;
        procedureId: string;
        version: number;
        sourceId: string;
        revisionId: string;
    }): Promise<import("@typeagent/memory-service").RunbookJobResult>;
    memoryHubReadRunbookAsset(params: {
        corpusId: string;
        sourceId: string;
        revisionId: string;
        assetId: string;
        hash: string;
        variant: "original" | "preview";
        acknowledgeUnreviewed?: boolean;
    }): Promise<{ asset: RunbookAsset; data: string }>;
};
