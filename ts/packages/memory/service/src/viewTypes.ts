// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentEdition } from "./agentEdition.js";
import type { MemoryAcquisitionService } from "./acquisitionTypes.js";
import type {
    MemoryKnowledgeService,
    CorpusQuestionInput,
    CorpusQuestionProposal,
} from "./knowledgeTypes.js";
export type * from "./knowledgeTypes.js";
export type * from "./acquisitionTypes.js";
import type {
    MemorySchemaViewService,
    QuestionDetails,
    SchemaViewContent,
    SchemaViewDefinition,
} from "./schemaViewTypes.js";
export type * from "./schemaViewTypes.js";
import type { MemoryTopicService } from "./topicTypes.js";
import type { ProcedureSourceCitation } from "./types.js";
import type {
    ViewRedirect,
    WikiConsolidationReceipt,
} from "./wikiConsolidation.js";
import type {
    ViewMaintenanceDefinition,
    ViewMaintenanceManifest,
    ViewMaintenancePlan,
    ViewMaintenancePlanRequest,
    ViewMaintenanceRead,
    ViewMaintenanceRequest,
    ViewMaintenanceResult,
    ViewMaintenanceSnapshot,
    ViewMaintenanceUpdate,
} from "./viewMaintenanceTypes.js";
export type * from "./viewMaintenanceTypes.js";
export type * from "./topicTypes.js";

export type ViewKind =
    | "troubleshootingGuide"
    | "projectBrief"
    | "timeline"
    | "wiki"
    | "schemaView";
export type ViewState = "draft" | "stale" | "archived";
export interface ViewCitation extends ProcedureSourceCitation {
    locator: string;
    excerpt: string;
    evidence?: { kind: "event"; eventId: string };
}
export interface ViewDocumentSelector {
    kind: "sources";
    sources: Array<{ sourceId: string; revisionId: string }>;
    events?: never;
}
export interface TimelineEvidenceSelector {
    kind: "timelineEvidence";
    sources: Array<{ sourceId: string; revisionId: string }>;
    events: Array<{ eventId: string }>;
}
export type ViewSourceSelector =
    | ViewDocumentSelector
    | TimelineEvidenceSelector;
export interface ViewSection {
    id: string;
    role:
        | "description"
        | "prerequisites"
        | "diagnostic"
        | "guard"
        | "verification"
        | "recovery"
        | "context"
        | "goalsScope"
        | "owners"
        | "status"
        | "milestones"
        | "decisions"
        | "risks"
        | "event"
        | "page"
        | "question";
    heading: string;
    body: string;
    details?:
        | ProjectBriefDetails
        | TimelineRecordDetails
        | WikiPageDetails
        | QuestionDetails;
}
export interface InformationalWikiPageDetails {
    kind: "page";
    construction: "informational-wiki-v1";
    taxonomy: "concept" | "system" | "project";
    note: string;
    mergedPageIds: string[];
}
export type WikiPageDetails = InformationalWikiPageDetails;
export type WikiPage = Omit<ViewSection, "role" | "details"> & {
    role: "page";
    details: WikiPageDetails;
};
export interface WikiIndexEntry {
    pageId: string;
    title: string;
    taxonomy: WikiPageDetails["taxonomy"];
}
export interface WikiContent {
    kind: "wiki";
    construction: "informational-wiki-v1";
    title: string;
    summary?: string;
    index: WikiIndexEntry[];
    sections: WikiPage[];
    citations: ViewCitation[];
    agentEdition?: never;
}
export interface TimelineRecordDetails {
    kind: "event";
    identity:
        | { kind: "canonicalEvent"; eventId: string }
        | { kind: "documentRecord"; sourceId: string; sourceRecordId: string };
    eventType: string;
    state: ViewFactStatus;
    outcome: string | null;
    occurredAt: string | null;
    learnedAt: string | null;
    capturedAt: string | null;
    inventoryIds: string[];
}
export type TimelineRecord = Omit<ViewSection, "role" | "details"> & {
    role: "event";
    details: TimelineRecordDetails;
};
export interface TimelineContent {
    kind: "timeline";
    title: string;
    summary?: string;
    generatedAt: string;
    sections: TimelineRecord[];
    citations: ViewCitation[];
    agentEdition?: never;
}
export interface TimelineEvidenceRecord {
    id: string;
    details: Omit<TimelineRecordDetails, "inventoryIds">;
    citation: ViewCitation;
}
export type ProjectBriefDetails =
    | { kind: "goalsScope" }
    | {
          kind: "owners";
          assignments: Array<{
              id: string;
              responsibility: string;
              state: "known" | "unknown" | "unassigned";
              owner: string | null;
          }>;
      }
    | {
          kind: "status";
          project: "unknown" | "active" | "blocked" | "complete";
          incident: "unknown" | "open" | "closed" | "notApplicable";
          capacity:
              | "unknown"
              | "pendingOwnerReview"
              | "validated"
              | "notApplicable";
      }
    | {
          kind: "milestones";
          items: Array<{
              id: string;
              status:
                  | "proposed"
                  | "confirmed"
                  | "blocked"
                  | "deferred"
                  | "unknown";
              date: string | null;
          }>;
      }
    | {
          kind: "decisions";
          items: Array<{
              id: string;
              status: ViewFactStatus;
          }>;
      }
    | {
          kind: "risks";
          items: Array<{
              id: string;
              status: "open" | "blocked" | "resolved" | "unknown";
          }>;
      }
    | {
          kind: "context";
          asOf: string | null;
          basis: "recordEvidence" | "unknown";
      };
export type ProjectBriefSection = Omit<ViewSection, "role" | "details"> & {
    role: ProjectBriefDetails["kind"];
    details: ProjectBriefDetails;
};
export interface ProjectBriefContent {
    kind: "projectBrief";
    construction: "informational-project-summary-v1";
    title: string;
    summary?: string;
    sections: ProjectBriefSection[];
    citations: ViewCitation[];
    agentEdition?: never;
}
export type DerivedViewContent =
    | TroubleshootingGuideContent
    | ProjectBriefContent
    | TimelineContent
    | WikiContent
    | SchemaViewContent;
export type ViewEndpoint =
    | { kind: "section"; viewId: string; sectionId: string }
    | {
          kind: "source";
          sourceId: string;
          revisionId: string;
          evidence?: { kind: "event"; eventId: string };
      };
export interface ViewEvidenceRelationshipInput {
    id: string;
    predicate: "supportedBy" | "dependsOn";
    from: Extract<ViewEndpoint, { kind: "section" }>;
    to: Extract<ViewEndpoint, { kind: "source" }>;
    citations: ViewCitation[];
}
export interface TimelineCorrectionRelationshipInput {
    id: string;
    predicate: "corrects" | "supersedes";
    from: Extract<ViewEndpoint, { kind: "section" }>;
    to: Extract<ViewEndpoint, { kind: "section" }>;
    citations: ViewCitation[];
}
export type ViewRelationshipInput =
    | ViewEvidenceRelationshipInput
    | TimelineCorrectionRelationshipInput;
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
              | Extract<ViewEndpoint, { kind: "source" }>;
      };
interface GuideFields {
    title: string;
    summary?: string;
    sections: ViewSection[];
    agentEdition?: AgentEdition;
}
export interface TroubleshootingGuideContent extends GuideFields {
    kind: "troubleshootingGuide";
    citations: ViewCitation[];
}
export interface ViewDefinitionInput {
    viewId: string;
    kind: ViewKind;
    selector: ViewSourceSelector;
    maintenance?: ViewMaintenanceDefinition;
    schemaView?: SchemaViewDefinition;
    wiki?: {
        construction: "informational-wiki-v1";
        query: string;
        aliases: string[];
        excludedSourceIds: string[];
    };
    projectSummary?: {
        construction: "informational-project-summary-v1";
        query: string;
        aliases: string[];
        excludedSourceIds: string[];
    };
}
export interface ViewDefinition {
    viewId: string;
    revisionId: string;
    kind: ViewKind;
    selector: ViewSourceSelector;
    maintenance?: ViewMaintenanceDefinition;
    schemaView?: SchemaViewDefinition;
    wiki?: NonNullable<ViewDefinitionInput["wiki"]>;
    projectSummary?: NonNullable<ViewDefinitionInput["projectSummary"]>;
}
export interface ViewVersion {
    redirect?: ViewRedirect;
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
        content: DerivedViewContent;
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
    content: DerivedViewContent;
    relationships: ViewRelationship[];
    provenance: "human" | "generated" | "merged";
    validation?: ViewPublicationProof;
    maintenance?: ViewMaintenanceManifest;
    relatedArticles?: import("./viewEditorial.js").RelatedArticle[];
    protectedTargets?: string[];
}
export interface ViewSnapshot {
    head: string | null;
    views: ViewVersion[];
    wikiFamily?: {
        enabled: boolean;
        pending: boolean;
        error?: string;
    };
    projectFamily?: {
        enabled: boolean;
        pending: boolean;
        error?: string;
    };
}
export interface ViewSourceUsageRequest {
    corpusId: string;
    sourceId: string;
    pageSize?: number;
    continuationToken?: string;
}
export interface ViewSourceUsage {
    viewId: string;
    revisionId: string;
    version: number;
    kind: ViewKind;
    title: string;
    state: ViewState;
    provenance: ViewVersion["provenance"];
}
export interface ViewSourceUsagePage {
    items: ViewSourceUsage[];
    total: number;
    nextContinuationToken?: string;
}
export interface ViewSaveRequest {
    corpusId: string;
    viewId: string;
    expectedVersion: number;
    expectedHead: string | null;
    definition: ViewDefinitionInput;
    content: DerivedViewContent;
    relationships: ViewRelationshipInput[];
    unlockProtection?: string[];
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
export interface MemoryViewService
    extends Partial<MemoryTopicService>,
        Partial<MemorySchemaViewService>,
        Partial<MemoryKnowledgeService>,
        Partial<MemoryAcquisitionService> {
    updateViewMaintenance(
        request: ViewMaintenanceUpdate,
    ): Promise<ViewHistoryEntry>;
    getViewMaintenance(
        request: ViewMaintenanceRead,
    ): Promise<ViewMaintenanceResult | undefined>;
    planViewMaintenance(
        request: ViewMaintenancePlanRequest,
    ): Promise<ViewMaintenancePlan>;
    maintainViews(
        request: ViewMaintenanceRequest,
    ): Promise<ViewMaintenanceResult>;
    listViews(corpusId: string): Promise<ViewSnapshot>;
    getSourceViewUsage(
        request: ViewSourceUsageRequest,
    ): Promise<ViewSourceUsagePage>;
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
    evidence?: { kind: "event"; eventId: string };
    passages?: ViewCitation[];
    records?: TimelineEvidenceRecord[];
    assertionLineage?: {
        owner?: string;
        independenceKey?: string;
        derivedFrom: string[];
    };
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
    influenceSources?: Array<{ sourceId: string; revisionId: string }>;
    selectionFingerprint?: string;
    informationalRetrieval?: {
        readonly indexGeneration: string;
        readonly sources: ReadonlyArray<
            Readonly<{ sourceId: string; revisionId: string }>
        >;
        readonly followSources: ReadonlyArray<
            Readonly<{ sourceId: string; revisionId: string }>
        >;
    };
    topicInput?: import("./topicTypes.js").TopicBuildInput;
    pipeline:
        | "troubleshooting-v1"
        | "timeline-v1"
        | "informational-wiki-v1"
        | "informational-project-summary-v1"
        | "topics-v1"
        | "schema-defined-v1";
    model: string;
    fingerprint: string;
    publicationPolicy?: ViewEffectivePublicationPolicy;
    maintenance?: ViewMaintenanceSnapshot;
    editorial?: import("./viewEditorial.js").ViewEditorialContext;
    wikiContribution?: {
        candidateViewId: string;
        query: string;
        purpose: string;
        essentialDistinctions: WikiSubjectAssessment["essentialDistinctions"];
    };
}
export interface ViewSynthesisOutput {
    content: DerivedViewContent;
    relationships: ViewRelationshipInput[];
    outcome:
        | "diagnosticOnly"
        | "verifiedRecovery"
        | "projectSummary"
        | "chronology"
        | "knowledgePages"
        | "schemaAnswers";
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
    | "projectStatus"
    | "projectAsOf"
    | "incidentStatus"
    | "capacity"
    | "owner"
    | "milestone"
    | "decision"
    | "risk"
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
    discoverCorpusQuestions?(
        input: CorpusQuestionInput,
        signal: AbortSignal,
    ): Promise<CorpusQuestionProposal[]>;
    proposeSchema?(
        specification: string,
        signal: AbortSignal,
    ): Promise<SchemaViewDefinition>;
    discoverSchemaQuestions?(
        input: ViewBuildSnapshot,
        signal: AbortSignal,
    ): Promise<import("./schemaViewTypes.js").QuestionSlot[]>;
    assessWikiConsolidation?(
        input: ViewBuildSnapshot,
        survivor: ViewVersion,
        retiring: ViewVersion,
        signal: AbortSignal,
    ): Promise<import("./wikiConsolidation.js").WikiConsolidationScope>;
    checkWikiConsolidation?(
        input: ViewBuildSnapshot,
        output: ViewSynthesisOutput,
        assessment: import("./wikiConsolidation.js").WikiConsolidationScope,
        signal: AbortSignal,
    ): Promise<import("./viewEditorial.js").ViewEditorialAssessment>;
    checkEditorial?(
        input: ViewBuildSnapshot,
        output: ViewSynthesisOutput,
        signal: AbortSignal,
    ): Promise<import("./viewEditorial.js").ViewEditorialAssessment>;
    generateTopics?(
        input: ViewBuildSnapshot,
        signal: AbortSignal,
    ): Promise<import("./topicTypes.js").TopicSnapshot>;
    assessWikiSubject?(
        input: ViewBuildSnapshot,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<WikiSubjectAssessment>;
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
export interface WikiPagePurposeContext {
    viewId: string;
    revisionId: string;
    query: string;
    aliases: string[];
    identity?: import("./types.js").IndexedSubjectIdentity;
    candidateIdentity?: import("./types.js").IndexedSubjectIdentity;
    title: string;
    prose: string;
    proseTruncated: boolean;
    sharedFragmentIds: string[];
    candidateFragmentIds: string[];
    contributingSources: Array<{ sourceId: string; revisionId: string }>;
    sourceOverlap: { shared: number; union: number; subset: boolean };
}
export interface WikiSubjectAssessment {
    disposition: "distinct" | "covered" | "contribute" | "ambiguous";
    purpose: string;
    reason: string;
    /** Empty for distinct/ambiguous; covered/contribute name a supplied current page. */
    canonicalViewId: string;
    sharedFragmentIds: string[];
    ambiguousViewIds: string[];
    essentialDistinctions: Array<{
        fragmentId: string;
        statement: string;
        canonicalExcerpt: string;
    }>;
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
    wikiConsolidation?: WikiConsolidationReceipt;
    viewId: string;
    snapshot: ViewBuildSnapshot;
    state: ViewBuildResultState;
    reason: string;
    revisionId?: string;
    topicGeneration?: string;
    conflictId?: string;
    missingEvidence?: string[];
    inventory?: ViewFactInventory;
    inventoryAudit?: ViewInventoryAudit;
    coverage?: ViewInventoryCoverage;
    publication?: ViewPublicationStatus;
    wikiAssessment?: WikiSubjectAssessment & { canonicalRevisionId?: string };
    wikiContribution?: {
        input: ViewBuildSnapshot;
        revisionId: string;
        state: "committed" | "bound";
        verification: WikiSubjectAssessment;
    };
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
    maintenancePlan?: ViewMaintenancePlan;
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
    kinds?: ViewKind[];
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
    protection?: string[];
    unlockedTargets?: string[];
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
