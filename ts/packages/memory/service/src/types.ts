// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentEdition } from "./agentEdition.js";
import type {
    RevisionAssetDescriptor,
    RevisionAssetInput,
    RevisionAssetReadRequest,
    RevisionAssetRequest,
} from "./revisionAssetStore.js";
import type {
    MemoryBatchImport,
    MemoryBatchImportLookup,
    MemoryBatchImportRequest,
} from "./batchImport.js";
import type {
    RunbookJobResult,
    RunbookSynthesisRequest,
} from "./runbookPipeline.js";

export const conversationCorpusName = "typeagent-profile-conversations";
export const conversationProducerId = "typeagent.dispatcher.conversation";

export type CorpusState = "ready" | "indexing" | "degraded" | "error";

export type SourceType = "web" | "markdown" | "text" | "html" | "vtt";

export type IngestionMode = "content";

export type UpdatePolicy =
    | "skipIfUnchanged"
    | "replaceActiveRevision"
    | "retainRevisionHistory"
    | "failIfExists";

export type JobState =
    | "accepted"
    | "validating"
    | "normalizing"
    | "chunking"
    | "extracting-knowledge"
    | "embedding"
    | "building-indexes"
    | "persisting"
    | "complete"
    | "partial"
    | "failed"
    | "cancelling"
    | "cancelled";

export interface MemoryCorpus {
    corpusId: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    status: CorpusState;
    documentCount: number;
}

export interface MemoryCorpusStatus extends MemoryCorpus {
    sourceCount: number;
    revisionCount: number;
    readyRevisionCount: number;
    failedRevisionCount: number;
    activeJobCount: number;
    indexVersion: string;
}

export interface SourceDocument {
    sourceId: string;
    corpusId: string;
    sourceType: SourceType;
    canonicalUri?: string;
    title: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    activeRevisionId: string;
}

export interface SourceRevision {
    revisionId: string;
    sourceId: string;
    contentHash: string;
    mimeType: string;
    capturedAt?: string;
    sourceModifiedAt?: string;
    indexedAt?: string;
    pipelineVersion: string;
    pipeline?: {
        mode: IngestionMode;
        maxCharsPerChunk?: number;
    };
    embeddingIdentity?: string;
    assets?: RevisionAssetDescriptor[];
    state: "accepted" | "processing" | "ready" | "failed" | "deleted";
}

export interface MemorySource extends SourceDocument {
    revisions: SourceRevision[];
}

export interface IngestionSource {
    sourceId?: string;
    sourceType: SourceType;
    title: string;
    canonicalUri?: string;
    markdown?: string;
    text?: string;
    html?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    capturedAt?: string;
    sourceModifiedAt?: string;
    contentHash?: string;
    assets?: RevisionAssetInput[];
}

export interface DocumentIngestRequest {
    corpusId: string;
    source: IngestionSource;
    pipeline?: {
        mode?: IngestionMode;
        maxCharsPerChunk?: number;
        updatePolicy?: UpdatePolicy;
        expectedActiveRevisionId?: string;
    };
}

export interface DocumentIngestResult {
    jobId: string;
    sourceId: string;
    revisionId: string;
    state: JobState;
    statusUri: string;
}

export interface JobProgress {
    completed: number;
    total?: number;
    message?: string;
    stage?: JobState;
    operation?: "rebuild" | "append";
    elapsedMs?: number;
    documentCount?: number;
    docPartCount?: number;
}

export interface IngestionTraceEvent extends JobProgress {
    state: JobState;
    timestamp: string;
}

export interface IngestionJobStatus {
    jobId: string;
    corpusId: string;
    sourceId: string;
    revisionId: string;
    state: JobState;
    progress: JobProgress;
    createdAt: string;
    updatedAt: string;
    error?: string;
    warnings: string[];
    trace?: IngestionTraceEvent[];
}

export interface MemoryPage<T> {
    items: T[];
    total: number;
    nextContinuationToken?: string;
}

export interface MemoryChangeReceipt {
    changeId: string;
    corpusId: string;
    operation: "replace" | "forget" | "suppress" | "restore";
    createdAt: string;
    outcome: "committed";
    sourceId?: string;
    previousRevisionId?: string;
    revisionId?: string;
    counts: {
        sources: number;
        revisions: number;
        knowledge: number;
    };
}

export interface MemoryChangeListRequest {
    corpusId: string;
    pageSize?: number;
    continuationToken?: string;
}

export interface SourceListRequest {
    corpusId: string;
    pageSize?: number;
    continuationToken?: string;
    query?: string;
    sourceTypes?: SourceType[];
}

export interface SourceContentRequest {
    corpusId: string;
    sourceId: string;
    revisionId?: string;
    offset?: number;
    maxChars?: number;
}

export interface SourceContent {
    corpusId: string;
    sourceId: string;
    revisionId: string;
    mimeType: string;
    offset: number;
    content: string;
    totalChars: number;
    truncated: boolean;
    nextOffset?: number;
}

export interface SourceReplaceRequest {
    corpusId: string;
    sourceId: string;
    expectedActiveRevisionId: string;
    source: Omit<IngestionSource, "sourceId">;
    retainRevisionHistory?: boolean;
}

export interface SourceForgetPreview {
    corpusId: string;
    sourceId: string;
    activeRevisionId: string;
    revisionCount: number;
    derivedEntityCount: number;
    derivedTopicCount: number;
    derivedRelationshipCount: number;
    confirmationToken: string;
    expiresAt: string;
}

export interface SourceForgetRequest {
    corpusId: string;
    sourceId: string;
    confirmationToken: string;
}

export interface SourceForgetResult {
    corpusId: string;
    sourceId: string;
    deletedRevisionCount: number;
    indexVersion: string;
}

export interface ReindexResult {
    corpusId: string;
    sourceId?: string;
    sourceCount: number;
    indexVersion: string;
}

export interface JobListRequest {
    corpusId?: string;
    sourceId?: string;
    states?: JobState[];
    pageSize?: number;
    continuationToken?: string;
}

export interface MemorySearchRequest {
    traceId?: string;
    corpusId: string;
    query: string;
    limit?: number;
    maxResponseChars?: number;
    sourceTypes?: SourceType[];
    tags?: string[];
    sourceIds?: string[];
    dateFrom?: string;
    dateTo?: string;
}

export interface MemoryEvidence {
    evidenceId: string;
    corpusId: string;
    sourceId: string;
    revisionId: string;
    title: string;
    canonicalUri?: string;
    locator?: string;
    snippet: string;
    score: number;
    sourceType: SourceType;
    capturedAt?: string;
    indexedAt: string;
}

export interface MemorySearchResult {
    query: string;
    matches: MemoryEvidence[];
    warnings: string[];
    capabilitiesUsed: string[];
    indexVersion: string;
}

export type AnswerMode = "synthesized" | "extractive";

export interface MemoryAnswerRequest {
    corpusId: string;
    question: string;
    limit?: number;
    maxResponseChars?: number;
    sourceIds?: string[];
    /**
     * `synthesized` generates the answer with KnowPro's answer generator over
     * the retrieved evidence. `extractive` returns the ranked evidence
     * snippets verbatim. When omitted, `synthesized` is used if the corpus
     * index supports it and `extractive` otherwise.
     */
    answerMode?: AnswerMode;
}

export interface MemoryAnswerResult {
    question: string;
    answer: string;
    mode: AnswerMode;
    citations: MemoryEvidence[];
    grounded: true;
    indexVersion: string;
    warnings: string[];
}

export type MemoryEventSourceKind =
    | "conversation"
    | "document"
    | "web-activity"
    | "procedure"
    | "system"
    | "other";

export type MemoryEventSender =
    | "user"
    | "assistant"
    | "system"
    | "tool"
    | "agent"
    | "other";

export type MemoryEventAuthority =
    | "user-assertion"
    | "evidence-only"
    | "verified-observation"
    | "explicit"
    | "producer-reported";

export interface MemoryEventProducer {
    producerId: string;
    producerType: string;
}

export interface MemoryEvent {
    eventId: string;
    corpusId: string;
    idempotencyKey: string;
    producer: MemoryEventProducer;
    eventType: string;
    sourceKind: MemoryEventSourceKind;
    observedAt: string;
    eventTime: string;
    createdAt: string;
    content?: string;
    conversationId?: string;
    runId?: string;
    turnId?: string;
    sender?: MemoryEventSender;
    actionName?: string;
    linkedSourceIds?: string[];
    metadata?: Record<string, unknown>;
}

export interface MemoryEventAppendRequest {
    corpusId: string;
    idempotencyKey: string;
    producer: MemoryEventProducer;
    eventType: string;
    sourceKind: MemoryEventSourceKind;
    observedAt?: string;
    eventTime?: string;
    content?: string;
    conversationId?: string;
    runId?: string;
    turnId?: string;
    sender?: MemoryEventSender;
    actionName?: string;
    linkedSourceIds?: string[];
    metadata?: Record<string, unknown>;
}

export interface MemoryEventAppendResult {
    event: MemoryEvent;
    replayed: boolean;
}

export interface MemoryEventFilter {
    sourceKinds?: MemoryEventSourceKind[];
    authorities?: MemoryEventAuthority[];
    producerIds?: string[];
    eventTypes?: string[];
    conversationIds?: string[];
    turnIds?: string[];
    runIds?: string[];
    linkedSourceIds?: string[];
    observedFrom?: string;
    observedTo?: string;
    eventFrom?: string;
    eventTo?: string;
}

export interface MemoryEventListRequest extends MemoryEventFilter {
    corpusId: string;
    pageSize?: number;
    continuationToken?: string;
}

export interface MemoryEventSearchRequest extends MemoryEventFilter {
    traceId?: string;
    corpusId: string;
    query: string;
    limit?: number;
}

export interface MemoryEventSearchMatch {
    event: MemoryEvent;
    snippet: string;
    score: number;
}

export interface MemoryEventSearchResult {
    query: string;
    matches: MemoryEventSearchMatch[];
}

export interface MemoryEventForgetRequest extends MemoryEventFilter {
    corpusId: string;
    eventIds?: string[];
    forgetLinkedSources?: boolean;
}

export interface MemoryEventForgetResult {
    corpusId: string;
    deletedEventCount: number;
    deletedSourceCount: number;
    retainedLinkedSourceIds: string[];
    indexVersion: string;
}

export interface MemoryGraphEntity {
    name: string;
    types: string[];
    mentionCount: number;
    sourceIds: string[];
}

export interface MemoryGraphTopic {
    name: string;
    mentionCount: number;
    sourceIds: string[];
}

export interface MemoryGraphRelationship {
    fromEntity: string;
    toEntity: string;
    relationshipType: string;
    count: number;
    sourceIds: string[];
}

export interface MemoryKnowledgeGraph {
    entities: MemoryGraphEntity[];
    topics: MemoryGraphTopic[];
    relationships: MemoryGraphRelationship[];
}

export type SourceKnowledgeKind = "entity" | "topic";

export interface SourceKnowledgeSuppression {
    sourceId: string;
    kind: SourceKnowledgeKind;
    name: string;
}

export interface SourceKnowledgeSuppressionRequest
    extends SourceKnowledgeSuppression {
    corpusId: string;
}

export interface MemoryServiceCapabilities {
    derivedViews?: {
        kinds: Array<"troubleshootingGuide" | "projectBrief">;
        drafts: true;
        history: true;
        publication: true;
        search: true;
        builds?: true;
        editMerging?: true;
    };
    chatProvider?: string;
    embeddingProvider?: string;
    features: {
        knowledgeExtraction: boolean;
        queryTranslation: boolean;
        vectorSimilarity: boolean;
        structuredSearch: boolean;
        exactSearch: boolean;
        management: boolean;
        groundedAnswer: boolean;
    };
    warnings: string[];
}

export interface PersonalHowToSettings {
    revision: number;
    updatedAt: string;
    enabled: boolean;
    detectCandidates: boolean;
    preferences?: Record<string, unknown>;
}

export interface PersonalHowToSettingsUpdate {
    expectedRevision: number;
    enabled?: boolean;
    detectCandidates?: boolean;
    preferences?: Record<string, unknown>;
}

export type ProcedureState =
    | "detected"
    | "draft"
    | "saved"
    | "stale"
    | "archived"
    | "rejected";

export interface ProcedureSourceCitation {
    sourceId: string;
    revisionId: string;
    locator?: string;
    excerpt?: string;
}

export interface ProcedureSection {
    heading: string;
    content: string;
}

export interface ProcedureDocument {
    title: string;
    summary?: string;
    steps: string[];
    citations: ProcedureSourceCitation[];
    additionalSections?: ProcedureSection[];
    agentEdition?: AgentEdition;
}

export interface ProcedureCandidate extends ProcedureDocument {
    candidateId: string;
    corpusId: string;
    state: "detected" | "draft" | "rejected" | "saved";
    createdAt: string;
    updatedAt: string;
}

export interface ProcedureCandidateCreateRequest extends ProcedureDocument {
    corpusId: string;
    candidateId?: string;
    state?: "detected" | "draft";
}

export interface ProcedureVersion {
    corpusId: string;
    procedureId: string;
    version: number;
    state: "saved" | "stale" | "archived";
    document: ProcedureDocument;
    canonicalJson: string;
    markdown: string;
    createdAt: string;
    jsonHash: string;
    markdownHash: string;
    basedOnCandidateId?: string;
    previousVersion?: number;
}

export interface ProcedureSummary {
    corpusId: string;
    procedureId: string;
    title: string;
    state: "saved" | "stale" | "archived";
    latestVersion: number;
    updatedAt: string;
}

export interface ProcedureSaveRequest {
    corpusId: string;
    procedureId?: string;
    candidateId?: string;
    expectedVersion?: number;
    document?: ProcedureDocument;
    markdown?: string;
    reviewAgentEdition?: boolean;
    safetyConfirmed?: boolean;
}

export interface ProcedureListRequest {
    corpusId: string;
    states?: Array<"saved" | "stale" | "archived">;
}

export interface ProcedureSearchRequest extends ProcedureListRequest {
    traceId?: string;
    query: string;
    limit?: number;
}

export interface ProcedureSearchMatch {
    procedure: ProcedureSummary;
    version: ProcedureVersion;
    score: number;
}

export interface MemoryService {
    initialize?(): Promise<void>;
    close?(): Promise<void>;
    createCorpus(name: string, description?: string): Promise<MemoryCorpus>;
    listCorpora(): Promise<MemoryCorpus[]>;
    getCorpus(corpusId: string): Promise<MemoryCorpusStatus | undefined>;
    clearCorpus(corpusId: string): Promise<number>;
    listChanges?(
        request: MemoryChangeListRequest,
    ): Promise<MemoryPage<MemoryChangeReceipt>>;
    getRevisionAssets?(
        request: RevisionAssetRequest,
    ): Promise<RevisionAssetDescriptor[]>;
    readRevisionAsset?(
        request: RevisionAssetReadRequest,
    ): Promise<{ descriptor: RevisionAssetDescriptor; bytes: Uint8Array }>;
    startBatchImport?(
        request: MemoryBatchImportRequest,
    ): Promise<MemoryBatchImport>;
    getBatchImport?(batchId: string): Promise<MemoryBatchImport>;
    findBatchImport?(
        request: MemoryBatchImportLookup,
    ): Promise<MemoryBatchImport | undefined>;
    listBatchImports?(corpusId: string): Promise<MemoryBatchImport[]>;
    retryBatchImport?(batchId: string): Promise<MemoryBatchImport>;
    cancelBatchImport?(batchId: string): Promise<MemoryBatchImport>;
    listRunbookJobs?(corpusId: string): Promise<RunbookJobResult[]>;
    getRunbookJob?(jobId: string): Promise<RunbookJobResult | undefined>;
    requestRunbookSynthesis?(
        request: RunbookSynthesisRequest,
    ): Promise<RunbookJobResult>;
    listSources(corpusId: string): Promise<MemorySource[]>;
    listSourcesPage(
        request: SourceListRequest,
    ): Promise<MemoryPage<MemorySource>>;
    getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined>;
    getSourceContent(request: SourceContentRequest): Promise<SourceContent>;
    getSourceKnowledge(
        corpusId: string,
        sourceId: string,
        traceId?: string,
    ): Promise<MemoryKnowledgeGraph>;
    listSourceKnowledgeSuppressions?(
        corpusId: string,
        sourceId: string,
    ): Promise<SourceKnowledgeSuppression[]>;
    suppressSourceKnowledge?(
        request: SourceKnowledgeSuppressionRequest,
    ): Promise<SourceKnowledgeSuppression[]>;
    restoreSourceKnowledge?(
        request: SourceKnowledgeSuppressionRequest,
    ): Promise<SourceKnowledgeSuppression[]>;
    ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    replaceSource(
        request: SourceReplaceRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    previewForgetSource(
        corpusId: string,
        sourceId: string,
    ): Promise<SourceForgetPreview>;
    forgetSource(request: SourceForgetRequest): Promise<SourceForgetResult>;
    reindexCorpus(
        corpusId: string,
        signal?: AbortSignal,
    ): Promise<ReindexResult>;
    reindexSource(
        corpusId: string,
        sourceId: string,
        signal?: AbortSignal,
    ): Promise<ReindexResult>;
    getJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    listJobs(request?: JobListRequest): Promise<MemoryPage<IngestionJobStatus>>;
    cancelJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    appendEvent(
        request: MemoryEventAppendRequest,
    ): Promise<MemoryEventAppendResult>;
    getEvent(
        corpusId: string,
        eventId: string,
    ): Promise<MemoryEvent | undefined>;
    listEvents(
        request: MemoryEventListRequest,
    ): Promise<MemoryPage<MemoryEvent>>;
    searchEvents(
        request: MemoryEventSearchRequest,
    ): Promise<MemoryEventSearchResult>;
    forgetEvents(
        request: MemoryEventForgetRequest,
    ): Promise<MemoryEventForgetResult>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    answer(request: MemoryAnswerRequest): Promise<MemoryAnswerResult>;
    getKnowledgeGraph(corpusId: string): Promise<MemoryKnowledgeGraph>;
    getCapabilities(): Promise<MemoryServiceCapabilities>;
}

export interface PersonalHowToService {
    getPersonalHowToSettings(corpusId: string): Promise<PersonalHowToSettings>;
    updatePersonalHowToSettings(
        corpusId: string,
        update: PersonalHowToSettingsUpdate,
    ): Promise<PersonalHowToSettings>;
    createProcedureCandidate(
        request: ProcedureCandidateCreateRequest,
    ): Promise<ProcedureCandidate>;
    getProcedureCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate | undefined>;
    listProcedureCandidates(
        corpusId: string,
        states?: ProcedureCandidate["state"][],
    ): Promise<ProcedureCandidate[]>;
    rejectProcedureCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate>;
    saveProcedure(request: ProcedureSaveRequest): Promise<ProcedureVersion>;
    listProcedures(request: ProcedureListRequest): Promise<ProcedureSummary[]>;
    getProcedure(
        corpusId: string,
        procedureId: string,
        version?: number,
    ): Promise<ProcedureVersion | undefined>;
    searchProcedures(
        request: ProcedureSearchRequest,
    ): Promise<ProcedureSearchMatch[]>;
    archiveProcedure(
        corpusId: string,
        procedureId: string,
        expectedVersion?: number,
    ): Promise<ProcedureVersion>;
}

export interface IndexedDocument {
    source: SourceDocument;
    revision: SourceRevision;
    content: string;
    indexTags?: string[];
    pipeline: {
        mode: IngestionMode;
        maxCharsPerChunk?: number;
    };
}

export interface CorpusIndexMatch {
    sourceId: string;
    revisionId: string;
    snippet: string;
    score: number;
    locator?: string;
}

export interface CorpusIndexAnswer {
    answer?: string | undefined;
    whyNoAnswer?: string | undefined;
    matches: CorpusIndexMatch[];
}

export interface CorpusIndex {
    initialize(): Promise<void>;
    rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void>;
    append?(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void>;
    search(
        query: string,
        limit: number,
        tags?: string[],
    ): Promise<CorpusIndexMatch[]>;
    answer?(
        query: string,
        limit: number,
        sourceIds?: ReadonlySet<string>,
    ): Promise<CorpusIndexAnswer>;
    getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph>;
}

export type CorpusIndexFactory = (
    corpusId: string,
    indexDirectory: string,
) => CorpusIndex;
