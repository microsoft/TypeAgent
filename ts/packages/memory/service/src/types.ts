// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CorpusState = "ready" | "indexing" | "degraded" | "error";

export type SourceType = "web" | "markdown" | "text" | "html" | "vtt";

export type IngestionMode = "basic" | "summary" | "content" | "full";

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
    corpusId: string;
    query: string;
    limit?: number;
    maxResponseChars?: number;
    sourceTypes?: SourceType[];
    tags?: string[];
    sourceIds?: string[];
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

export interface MemoryAnswerRequest {
    corpusId: string;
    question: string;
    limit?: number;
    maxResponseChars?: number;
    sourceIds?: string[];
}

export interface MemoryAnswerResult {
    question: string;
    answer: string;
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
    producerIds?: string[];
    eventTypes?: string[];
    conversationIds?: string[];
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

export interface MemoryServiceCapabilities {
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

export interface MemoryService {
    initialize?(): Promise<void>;
    close?(): Promise<void>;
    createCorpus(name: string, description?: string): Promise<MemoryCorpus>;
    listCorpora(): Promise<MemoryCorpus[]>;
    getCorpus(corpusId: string): Promise<MemoryCorpusStatus | undefined>;
    clearCorpus(corpusId: string): Promise<number>;
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
    ): Promise<MemoryKnowledgeGraph>;
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

export interface IndexedDocument {
    source: SourceDocument;
    revision: SourceRevision;
    content: string;
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
    search(query: string, limit: number): Promise<CorpusIndexMatch[]>;
    getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph>;
}

export type CorpusIndexFactory = (
    corpusId: string,
    indexDirectory: string,
) => CorpusIndex;
