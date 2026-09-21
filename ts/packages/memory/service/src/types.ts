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
    };
    warnings: string[];
}

export interface MemoryService {
    initialize?(): Promise<void>;
    close?(): Promise<void>;
    createCorpus(name: string, description?: string): Promise<MemoryCorpus>;
    listCorpora(): Promise<MemoryCorpus[]>;
    clearCorpus(corpusId: string): Promise<number>;
    listSources(corpusId: string): Promise<MemorySource[]>;
    getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined>;
    ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    getJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    cancelJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    getKnowledgeGraph(corpusId: string): Promise<MemoryKnowledgeGraph>;
    getCapabilities(): Promise<MemoryServiceCapabilities>;
}

export interface IndexedDocument {
    source: SourceDocument;
    revision: SourceRevision;
    content: string;
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
    getKnowledgeGraph(): Promise<MemoryKnowledgeGraph>;
}

export type CorpusIndexFactory = (
    corpusId: string,
    indexDirectory: string,
) => CorpusIndex;
