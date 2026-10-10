// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureSourceCitation } from "./types.js";
import type { AgentEdition } from "./agentEdition.js";

export type ViewKind = "troubleshootingGuide";
export type ViewState = "draft" | "stale" | "archived";
export interface ViewCitation extends ProcedureSourceCitation {
    locator: string;
    excerpt: string;
}
export interface ViewSourceSelector {
    kind: "sources";
    sources: Array<{ sourceId: string; revisionId: string }>;
}
export interface ViewSection {
    id: string;
    role:
        | "description"
        | "prerequisites"
        | "diagnostic"
        | "guard"
        | "verification"
        | "recovery"
        | "context";
    heading: string;
    body: string;
}
export type ViewEndpoint =
    | { kind: "section"; viewId: string; sectionId: string }
    | { kind: "source"; sourceId: string; revisionId: string };
export interface ViewRelationshipInput {
    id: string;
    predicate: "supportedBy" | "dependsOn";
    from: Extract<ViewEndpoint, { kind: "section" }>;
    to: Extract<ViewEndpoint, { kind: "source" }>;
    citations: ViewCitation[];
}
export type ViewRelationship =
    | (ViewRelationshipInput & {
          schemaVersion: 1;
          family: "evidence" | "dependency";
          origin: "human" | "generator";
          reviewState: "unreviewed";
      })
    | {
          id: string;
          schemaVersion: 1;
          family: "lineage" | "dependency";
          origin: "system";
          predicate: "generatedFrom" | "dependsOn";
          from: { kind: "view"; viewId: string; revisionId: string };
          to:
              | { kind: "definition"; viewId: string; revisionId: string }
              | { kind: "source"; sourceId: string; revisionId: string };
      };
interface GuideFields {
    title: string;
    summary?: string;
    sections: ViewSection[];
    agentEdition?: AgentEdition;
    compatibilityFields?: Record<string, unknown>;
}
export interface TroubleshootingGuideContent extends GuideFields {
    kind: "troubleshootingGuide";
    citations: ViewCitation[];
}
export interface ProcedureViewContent extends GuideFields {
    kind: "procedure";
    citations: ProcedureSourceCitation[];
}
export interface ViewDefinitionInput {
    viewId: string;
    kind: ViewKind;
    selector: ViewSourceSelector;
}
export interface ViewDefinition {
    viewId: string;
    revisionId: string;
    kind: ViewKind | "procedure";
    selector: ViewSourceSelector;
}
export interface ViewVersion {
    corpusId: string;
    viewId: string;
    revisionId: string;
    version: number;
    state: ViewState;
    createdAt: string;
    actor: string;
    baseRevisionId?: string;
    generation?: {
        candidateId: string;
        content: TroubleshootingGuideContent | ProcedureViewContent;
        fingerprint: string;
        relationships?: ViewRelationshipInput[];
        input?: ViewBuildSnapshot;
        outcome?: ViewSynthesisOutput["outcome"];
        missingEvidence?: string[];
        inventory?: ViewFactInventory;
        inventoryAudit?: ViewInventoryAudit;
        coverage?: ViewInventoryCoverage;
    };
    edits?: ViewEditOperation[];
    definition: ViewDefinition;
    content: TroubleshootingGuideContent | ProcedureViewContent;
    relationships: ViewRelationship[];
    provenance: "human" | "procedure" | "generated" | "merged";
    validation?: ViewPublicationProof;
    compatibility?: {
        state: "saved" | "stale" | "archived";
        basedOnCandidateId?: string;
        previousVersion?: number;
    };
}
export interface ViewSnapshot {
    head: string | null;
    views: ViewVersion[];
}
export interface ViewSaveRequest {
    corpusId: string;
    viewId: string;
    expectedVersion: number;
    expectedHead: string | null;
    definition: ViewDefinitionInput;
    content: TroubleshootingGuideContent;
    relationships: ViewRelationshipInput[];
}
export interface ViewArchiveRequest {
    corpusId: string;
    viewId: string;
    expectedVersion: number;
    expectedHead: string;
}
export interface ViewReadRequest {
    corpusId: string;
    viewId: string;
    revisionId?: string;
}
export interface ViewHistoryEntry {
    commitId: string;
    version: ViewVersion;
}
export interface MemoryViewService {
    listViews(corpusId: string): Promise<ViewSnapshot>;
    getView(request: ViewReadRequest): Promise<ViewVersion | undefined>;
    saveViewDraft(request: ViewSaveRequest): Promise<ViewHistoryEntry>;
    archiveView(request: ViewArchiveRequest): Promise<ViewHistoryEntry>;
    getViewHistory(request: ViewReadRequest): Promise<ViewHistoryEntry[]>;
    getViewPublicationPolicy(corpusId: string): Promise<ViewPublicationPolicy>;
    updateViewPublicationPolicy(
        request: ViewPublicationPolicyUpdate,
    ): Promise<ViewPublicationPolicy>;
    getViewPublication(
        request: ViewReadRequest,
    ): Promise<ViewPublicationStatus>;
    publishView(request: ViewPublishRequest): Promise<ViewPublicationStatus>;
    retryViewIndex(request: ViewPublishRequest): Promise<ViewPublicationStatus>;
    searchViews(request: ViewSearchRequest): Promise<ViewSearchMatch[]>;
    buildViews(request: ViewBuildRequest): Promise<ViewBuildJob>;
    getViewBuild(
        request: ViewBuildJobRequest,
    ): Promise<ViewBuildJob | undefined>;
    listViewBuilds(corpusId: string): Promise<ViewBuildJob[]>;
    cancelViewBuild(request: ViewBuildJobRequest): Promise<ViewBuildJob>;
    retryViewBuild(request: ViewBuildJobRequest): Promise<ViewBuildJob>;
    getViewConflict(
        request: ViewConflictReadRequest,
    ): Promise<ViewMergeConflict | undefined>;
    resolveViewConflict(
        request: ViewConflictResolution,
    ): Promise<ViewHistoryEntry>;
}

export interface ViewBuildTarget {
    definition: ViewDefinitionInput;
    expectedVersion: number;
}
export interface ViewBuildBounds {
    learnedBefore?: string;
    occurredFrom?: string;
    occurredTo?: string;
}
export interface ViewBuildRequest {
    corpusId: string;
    expectedHead: string | null;
    targets: ViewBuildTarget[];
    bounds?: ViewBuildBounds;
    publication?: boolean;
}
export interface ViewRetainedInput {
    sourceId: string;
    revisionId: string;
    title: string;
    content: string;
    contentHash: string;
    learnedAt?: string;
    occurredAt?: string;
}
export interface ViewBuildSnapshot {
    corpusId: string;
    actor: string;
    definition: ViewDefinitionInput;
    definitionRevisionId?: string;
    targetRevisionId?: string;
    expectedVersion: number;
    bounds: ViewBuildBounds;
    inputs: ViewRetainedInput[];
    pipeline: "troubleshooting-v1";
    model: string;
    fingerprint: string;
    publicationPolicy?: ViewEffectivePublicationPolicy;
}
export interface ViewSynthesisOutput {
    content: TroubleshootingGuideContent;
    relationships: ViewRelationshipInput[];
    outcome: "diagnosticOnly" | "verifiedRecovery";
    missingEvidence: string[];
    inventory?: ViewFactInventory;
    inventoryAudit?: ViewInventoryAudit;
    coverage?: ViewInventoryCoverage;
}
export type ViewFactKind =
    | "goal"
    | "measurement"
    | "approach"
    | "prerequisite"
    | "authority"
    | "recovery"
    | "outcome"
    | "unresolved"
    | "reuseWarning"
    | "timing"
    | "background";
export type ViewFactStatus =
    | "observed"
    | "proposed"
    | "attempted"
    | "rejected"
    | "deferred"
    | "confirmed"
    | "unknown"
    | "blocked"
    | "notApplicable";
export interface ViewInventoryItem {
    id: string;
    key: string;
    kind: ViewFactKind;
    status: ViewFactStatus;
    statement: string;
    measurements: Array<{ quantity: string; unit: string; context: string }>;
    occurredAt: string;
    learnedAt: string;
    citations: ViewCitation[];
}
export interface ViewSourceDecision {
    id: string;
    sourceId: string;
    passageIds: string[];
    disposition: "represented" | "metadata" | "duplicate" | "outsideScope";
    itemIds: string[];
    reason: string;
}
export interface ViewFactInventory {
    schemaVersion: 1;
    sourceFingerprint: string;
    fingerprint: string;
    items: ViewInventoryItem[];
    sourceDecisions: ViewSourceDecision[];
}
export interface ViewInventoryAudit {
    supported: boolean;
    items: Array<{ itemId: string; supported: boolean; reason: string }>;
    decisions: Array<{
        decisionId: string;
        supported: boolean;
        reason: string;
    }>;
    missingFacts: Array<{
        sourceId: string;
        passageIds: string[];
        description: string;
    }>;
    reasons: string[];
}
export interface ViewInventoryCoverage {
    inventoryFingerprint: string;
    items: Array<{
        itemId: string;
        state: "covered" | "excluded";
        sectionId?: string;
        locator?: string;
        excerpt?: string;
        justification?: string;
        exclusion?: "duplicate" | "outsideScope";
        duplicateOf?: string;
    }>;
    reuseEligibility: "diagnosticOnly" | "requiresFreshEvidence";
}
export interface ViewSupportReport {
    supported: boolean;
    sections: Array<{ sectionId: string; supported: boolean; reason: string }>;
    relationships: Array<{
        edgeId: string;
        supported: boolean;
        reason: string;
    }>;
    missingContext: string[];
    reasons: string[];
    exclusions?: Array<{ itemId: string; supported: boolean; reason: string }>;
}
export interface ViewSynthesisAdapter {
    identity: string;
    inventory?(
        input: ViewBuildSnapshot,
        signal: AbortSignal,
    ): Promise<ViewFactInventory>;
    checkInventory?(
        input: ViewBuildSnapshot,
        inventory: ViewFactInventory,
        signal: AbortSignal,
    ): Promise<ViewInventoryAudit>;
    generate(
        input: ViewBuildSnapshot,
        signal: AbortSignal,
        inventory?: ViewFactInventory,
    ): Promise<ViewSynthesisOutput>;
    validate(
        input: ViewBuildSnapshot,
        output: ViewSynthesisOutput,
        signal: AbortSignal,
    ): Promise<ViewSupportReport>;
}
export type ViewBuildResultState =
    | "pending"
    | "inventorying"
    | "checkingInventory"
    | "generating"
    | "validating"
    | "draft"
    | "merged"
    | "published"
    | "searchable"
    | "conflicted"
    | "blocked"
    | "stale"
    | "skipped"
    | "failed"
    | "cancelled"
    | "interrupted";
export interface ViewBuildTargetResult {
    viewId: string;
    snapshot: ViewBuildSnapshot;
    state: ViewBuildResultState;
    reason: string;
    revisionId?: string;
    conflictId?: string;
    missingEvidence?: string[];
    inventory?: ViewFactInventory;
    inventoryAudit?: ViewInventoryAudit;
    coverage?: ViewInventoryCoverage;
    publication?: ViewPublicationStatus;
}
export interface ViewBuildJob {
    jobId: string;
    corpusId: string;
    fingerprint: string;
    request: ViewBuildRequest;
    actor: string;
    createdAt: string;
    updatedAt: string;
    state:
        | "running"
        | "complete"
        | "partial"
        | "failed"
        | "cancelled"
        | "interrupted";
    results: ViewBuildTargetResult[];
    publication: boolean;
}

export interface ViewPublicationPolicy {
    revision: number;
    autoPublish: boolean;
    views: Record<string, { revision: number; autoPublish: boolean | null }>;
}
export interface ViewPublicationPolicyUpdate {
    corpusId: string;
    expectedHead: string | null;
    expectedRevision: number;
    autoPublish: boolean | null;
    viewId?: string;
}
export interface ViewEffectivePublicationPolicy {
    autoPublish: boolean;
    origin: "build" | "view" | "corpus";
    corpusRevision: number;
    viewRevision: number;
    buildOverride?: boolean;
}
export interface ViewPublicationProof {
    artifactFingerprint: string;
    inputFingerprint: string;
    support: ViewSupportReport;
}
export interface ViewPublicationStatus {
    viewId: string;
    latestBuiltRevisionId?: string;
    publishedRevisionId?: string;
    indexedRevisionId?: string;
    intent?: { revisionId: string; actor: string; createdAt: string };
    indexState: "absent" | "pending" | "failed" | "ready";
    reason: string;
    blockedReason?: string;
}
export interface ViewPublishRequest {
    corpusId: string;
    viewId: string;
    revisionId: string;
    expectedVersion: number;
    expectedHead: string;
}
export interface ViewSearchRequest {
    corpusId: string;
    query: string;
    limit?: number;
    freshness: "current";
}
export interface ViewSearchMatch {
    view: ViewVersion;
    score: number;
    snippet: string;
    review: "unreviewed";
    freshness: "current";
    evidence: ViewCitation[];
    corroboration: "derived";
}
export interface ViewBuildJobRequest {
    corpusId: string;
    jobId: string;
}
export interface ViewEditOperation {
    id: string;
    target: string;
    actor: string;
    createdAt: string;
    generatedBaseId?: string;
    baseFingerprint?: string;
    oldHash: string;
    oldValue?: unknown;
    newValue?: unknown;
    operation: "set" | "delete";
    status: "active" | "merged" | "conflicted" | "cleared";
}
export interface ViewConflictReadRequest {
    corpusId: string;
    conflictId: string;
}
export interface ViewMergeConflict {
    event: {
        kind: "viewMergeConflict";
        editIds: string[];
        evidence: Array<{ sourceId: string; revisionId: string }>;
    };
    conflictId: string;
    identity: string;
    corpusId: string;
    viewId: string;
    jobId: string;
    createdAt: string;
    actor: string;
    state: "pending" | "resolved";
    expectedRevisionId: string;
    input: ViewBuildSnapshot;
    base?: ViewVersion["generation"];
    human: ViewVersion;
    candidate: ViewSynthesisOutput;
    targets: string[];
    reason: string;
    resolutionRevisionId?: string;
}
export interface ViewConflictResolution {
    corpusId: string;
    conflictId: string;
    expectedHead: string;
    expectedVersion: number;
    expectedRevisionId: string;
    inputFingerprint: string;
    choice: "human" | "generated" | "combined";
    combined?: ViewSynthesisOutput;
}
