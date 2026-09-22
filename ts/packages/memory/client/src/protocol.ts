// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

export const memoryToolNames = {
    corpusCreate: "memory_corpus_create",
    corpusList: "memory_corpus_list",
    corpusGet: "memory_corpus_get",
    corpusClear: "memory_corpus_clear",
    corpusReindex: "memory_corpus_reindex",
    sourceList: "memory_source_list",
    sourceListPage: "memory_source_list_page",
    sourceGet: "memory_source_get",
    sourceContentGet: "memory_source_content_get",
    sourceKnowledgeGet: "memory_source_knowledge_get",
    sourceReplace: "memory_source_replace",
    sourceForgetPreview: "memory_source_forget_preview",
    sourceForget: "memory_source_forget",
    sourceReindex: "memory_source_reindex",
    documentIngest: "memory_document_ingest",
    jobGet: "memory_job_get",
    jobList: "memory_job_list",
    jobWait: "memory_job_wait",
    jobCancel: "memory_job_cancel",
    search: "memory_search",
    answer: "memory_answer",
    knowledgeGraphGet: "memory_knowledge_graph_get",
    capabilities: "memory_capabilities",
} as const;

export const identifierSchema = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const sourceTypeSchema = z.enum([
    "web",
    "markdown",
    "text",
    "html",
    "vtt",
]);
export const jobStateSchema = z.enum([
    "accepted",
    "validating",
    "normalizing",
    "chunking",
    "extracting-knowledge",
    "embedding",
    "building-indexes",
    "persisting",
    "complete",
    "partial",
    "failed",
    "cancelling",
    "cancelled",
]);
export const terminalJobStates = new Set([
    "complete",
    "partial",
    "failed",
    "cancelled",
]);

export const corpusSchema = z.object({
    corpusId: identifierSchema,
    name: z.string(),
    description: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.enum(["ready", "indexing", "degraded", "error"]),
    documentCount: z.number().int().nonnegative(),
});

export const corpusStatusSchema = corpusSchema.extend({
    sourceCount: z.number().int().nonnegative(),
    revisionCount: z.number().int().nonnegative(),
    readyRevisionCount: z.number().int().nonnegative(),
    failedRevisionCount: z.number().int().nonnegative(),
    activeJobCount: z.number().int().nonnegative(),
    indexVersion: z.string(),
});

export const revisionSchema = z.object({
    revisionId: identifierSchema,
    sourceId: identifierSchema,
    contentHash: z.string(),
    mimeType: z.string(),
    capturedAt: z.string().optional(),
    sourceModifiedAt: z.string().optional(),
    indexedAt: z.string().optional(),
    pipelineVersion: z.string(),
    pipeline: z
        .object({
            mode: z.enum(["basic", "summary", "content", "full"]),
            maxCharsPerChunk: z.number().int().positive().optional(),
        })
        .optional(),
    embeddingIdentity: z.string().optional(),
    state: z.enum(["accepted", "processing", "ready", "failed", "deleted"]),
});

export const sourceSchema = z.object({
    sourceId: identifierSchema,
    corpusId: identifierSchema,
    sourceType: sourceTypeSchema,
    canonicalUri: z.string().optional(),
    title: z.string(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    activeRevisionId: identifierSchema,
    revisions: z.array(revisionSchema),
});

export const ingestRequestSchema = z.object({
    corpusId: identifierSchema,
    source: z.object({
        sourceId: identifierSchema.optional(),
        sourceType: sourceTypeSchema,
        title: z.string().min(1),
        canonicalUri: z.string().optional(),
        markdown: z.string().optional(),
        text: z.string().optional(),
        html: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        capturedAt: z.string().optional(),
        sourceModifiedAt: z.string().optional(),
        contentHash: z.string().optional(),
    }),
    pipeline: z
        .object({
            mode: z.enum(["basic", "summary", "content", "full"]).optional(),
            maxCharsPerChunk: z.number().int().positive().optional(),
            updatePolicy: z
                .enum([
                    "skipIfUnchanged",
                    "replaceActiveRevision",
                    "retainRevisionHistory",
                    "failIfExists",
                ])
                .optional(),
            expectedActiveRevisionId: identifierSchema.optional(),
        })
        .optional(),
});

export const ingestResultSchema = z.object({
    jobId: identifierSchema,
    sourceId: identifierSchema,
    revisionId: identifierSchema,
    state: jobStateSchema,
    statusUri: z.string(),
});

export const jobProgressSchema = z.object({
    completed: z.number().nonnegative(),
    total: z.number().nonnegative().optional(),
    message: z.string().optional(),
    stage: jobStateSchema.optional(),
    operation: z.enum(["rebuild", "append"]).optional(),
    elapsedMs: z.number().nonnegative().optional(),
    documentCount: z.number().int().nonnegative().optional(),
    docPartCount: z.number().int().nonnegative().optional(),
});

export const ingestionTraceEventSchema = jobProgressSchema.extend({
    state: jobStateSchema,
    timestamp: z.string(),
});

export const jobStatusSchema = z.object({
    jobId: identifierSchema,
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    revisionId: identifierSchema,
    state: jobStateSchema,
    progress: jobProgressSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    error: z.string().optional(),
    warnings: z.array(z.string()),
    trace: z.array(ingestionTraceEventSchema).optional(),
});

export const pageRequestSchema = z.object({
    pageSize: z.number().int().positive().max(200).optional(),
    continuationToken: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .optional(),
});

export const sourceListRequestSchema = pageRequestSchema.extend({
    corpusId: identifierSchema,
    query: z.string().optional(),
    sourceTypes: sourceTypeSchema.array().optional(),
});

export const sourcePageSchema = z.object({
    items: z.array(sourceSchema),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z.string().optional(),
});

export const sourceContentRequestSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    revisionId: identifierSchema.optional(),
    offset: z.number().int().nonnegative().optional(),
    maxChars: z.number().int().positive().max(100_000).optional(),
});

export const sourceContentSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    revisionId: identifierSchema,
    mimeType: z.string(),
    offset: z.number().int().nonnegative(),
    content: z.string(),
    totalChars: z.number().int().nonnegative(),
    truncated: z.boolean(),
    nextOffset: z.number().int().nonnegative().optional(),
});

export const sourceReplaceRequestSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    expectedActiveRevisionId: identifierSchema,
    source: ingestRequestSchema.shape.source.omit({ sourceId: true }),
    retainRevisionHistory: z.boolean().optional(),
});

export const sourceForgetPreviewSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    activeRevisionId: identifierSchema,
    revisionCount: z.number().int().nonnegative(),
    derivedEntityCount: z.number().int().nonnegative(),
    derivedTopicCount: z.number().int().nonnegative(),
    derivedRelationshipCount: z.number().int().nonnegative(),
    confirmationToken: identifierSchema,
    expiresAt: z.string(),
});

export const sourceForgetRequestSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    confirmationToken: identifierSchema,
});

export const sourceForgetResultSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema,
    deletedRevisionCount: z.number().int().nonnegative(),
    indexVersion: z.string(),
});

export const reindexResultSchema = z.object({
    corpusId: identifierSchema,
    sourceId: identifierSchema.optional(),
    sourceCount: z.number().int().nonnegative(),
    indexVersion: z.string(),
});

export const jobListRequestSchema = pageRequestSchema.extend({
    corpusId: identifierSchema.optional(),
    sourceId: identifierSchema.optional(),
    states: z.array(jobStateSchema).optional(),
});

export const jobPageSchema = z.object({
    items: z.array(jobStatusSchema),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z.string().optional(),
});

export const searchRequestSchema = z.object({
    corpusId: identifierSchema,
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    maxResponseChars: z.number().int().positive().optional(),
    sourceTypes: z.array(sourceTypeSchema).optional(),
    tags: z.array(z.string()).optional(),
    sourceIds: z.array(identifierSchema).optional(),
});

export const searchResultSchema = z.object({
    query: z.string(),
    matches: z.array(
        z.object({
            evidenceId: z.string(),
            corpusId: identifierSchema,
            sourceId: identifierSchema,
            revisionId: identifierSchema,
            title: z.string(),
            canonicalUri: z.string().optional(),
            locator: z.string().optional(),
            snippet: z.string(),
            score: z.number(),
            sourceType: sourceTypeSchema,
            capturedAt: z.string().optional(),
            indexedAt: z.string(),
        }),
    ),
    warnings: z.array(z.string()),
    capabilitiesUsed: z.array(z.string()),
    indexVersion: z.string(),
});

export const answerRequestSchema = z.object({
    corpusId: identifierSchema,
    question: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    maxResponseChars: z.number().int().positive().optional(),
    sourceIds: z.array(identifierSchema).optional(),
});

export const answerResultSchema = z.object({
    question: z.string(),
    answer: z.string(),
    citations: searchResultSchema.shape.matches,
    grounded: z.literal(true),
    indexVersion: z.string(),
    warnings: z.array(z.string()),
});

export const knowledgeGraphSchema = z.object({
    entities: z.array(
        z.object({
            name: z.string(),
            types: z.array(z.string()),
            mentionCount: z.number().int().nonnegative(),
            sourceIds: z.array(identifierSchema),
        }),
    ),
    topics: z.array(
        z.object({
            name: z.string(),
            mentionCount: z.number().int().nonnegative(),
            sourceIds: z.array(identifierSchema),
        }),
    ),
    relationships: z.array(
        z.object({
            fromEntity: z.string(),
            toEntity: z.string(),
            relationshipType: z.string(),
            count: z.number().int().nonnegative(),
            sourceIds: z.array(identifierSchema),
        }),
    ),
});

export const capabilitiesSchema = z.object({
    chatProvider: z.string().optional(),
    embeddingProvider: z.string().optional(),
    features: z.object({
        knowledgeExtraction: z.boolean(),
        queryTranslation: z.boolean(),
        vectorSimilarity: z.boolean(),
        structuredSearch: z.boolean(),
        exactSearch: z.boolean(),
        management: z.boolean(),
        groundedAnswer: z.boolean(),
    }),
    warnings: z.array(z.string()),
});

export const optionalJobStatusSchema = jobStatusSchema.nullable();
export const optionalSourceSchema = sourceSchema.nullable();
export const optionalCorpusStatusSchema = corpusStatusSchema.nullable();
export const clearedCountSchema = z.number().int().nonnegative();
