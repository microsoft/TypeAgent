// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

export const memoryToolNames = {
    corpusCreate: "memory_corpus_create",
    corpusList: "memory_corpus_list",
    corpusClear: "memory_corpus_clear",
    sourceList: "memory_source_list",
    sourceGet: "memory_source_get",
    documentIngest: "memory_document_ingest",
    jobGet: "memory_job_get",
    jobWait: "memory_job_wait",
    jobCancel: "memory_job_cancel",
    search: "memory_search",
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

export const revisionSchema = z.object({
    revisionId: identifierSchema,
    sourceId: identifierSchema,
    contentHash: z.string(),
    mimeType: z.string(),
    capturedAt: z.string().optional(),
    sourceModifiedAt: z.string().optional(),
    indexedAt: z.string().optional(),
    pipelineVersion: z.string(),
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
    }),
    warnings: z.array(z.string()),
});

export const optionalJobStatusSchema = jobStatusSchema.nullable();
export const optionalSourceSchema = sourceSchema.nullable();
export const clearedCountSchema = z.number().int().nonnegative();
