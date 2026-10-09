// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    validateAgentEdition,
    validateRunbookBindingArguments,
    validateRunbookCatalogIdentity,
} from "@typeagent/memory-service/agent-edition-validation";

export const memoryToolNames = {
    corpusCreate: "memory_corpus_create",
    corpusList: "memory_corpus_list",
    corpusGet: "memory_corpus_get",
    corpusClear: "memory_corpus_clear",
    corpusReindex: "memory_corpus_reindex",
    changesList: "memory_changes_list",
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
    eventAppend: "memory_event_append",
    eventGet: "memory_event_get",
    eventList: "memory_event_list",
    eventSearch: "memory_event_search",
    eventForget: "memory_event_forget",
    search: "memory_search",
    answer: "memory_answer",
    knowledgeGraphGet: "memory_knowledge_graph_get",
    capabilities: "memory_capabilities",
    howToSettingsGet: "memory_how_to_settings_get",
    howToSettingsUpdate: "memory_how_to_settings_update",
    runbookSynthesisRequest: "memory_runbook_synthesis_request",
    runbookJobGet: "memory_runbook_job_get",
    runbookJobsList: "memory_runbook_jobs_list",
    procedureCandidateCreate: "memory_procedure_candidate_create",
    procedureCandidateGet: "memory_procedure_candidate_get",
    procedureCandidateList: "memory_procedure_candidate_list",
    procedureCandidateReject: "memory_procedure_candidate_reject",
    procedureSave: "memory_procedure_save",
    procedureGet: "memory_procedure_get",
    procedureList: "memory_procedure_list",
    procedureSearch: "memory_procedure_search",
    procedureArchive: "memory_procedure_archive",
} as const;

export const identifierSchema = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const changeListRequestSchema = z.object({
    corpusId: identifierSchema,
    pageSize: z.number().int().min(1).max(200).optional(),
    continuationToken: z.string().min(1).max(2048).optional(),
});
export const changeReceiptSchema = z
    .object({
        changeId: z.string().uuid(),
        corpusId: identifierSchema,
        operation: z.enum(["replace", "forget", "suppress", "restore"]),
        createdAt: z.string().datetime(),
        outcome: z.literal("committed"),
        sourceId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        previousRevisionId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        revisionId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        counts: z
            .object({
                sources: z
                    .number()
                    .int()
                    .nonnegative()
                    .max(Number.MAX_SAFE_INTEGER),
                revisions: z
                    .number()
                    .int()
                    .nonnegative()
                    .max(Number.MAX_SAFE_INTEGER),
                knowledge: z
                    .number()
                    .int()
                    .nonnegative()
                    .max(Number.MAX_SAFE_INTEGER),
            })
            .strict(),
    })
    .strict();
export const changePageSchema = z.object({
    items: changeReceiptSchema.array(),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z.string().optional(),
});
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

export const revisionAssetDescriptorSchema = z
    .object({
        sourceId: identifierSchema,
        revisionId: identifierSchema,
        assetId: identifierSchema,
        mimeType: z.string(),
        name: z.string(),
        size: z.number().int().nonnegative(),
        hash: z.string(),
        description: z.string().optional(),
        instructionBearing: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
    })
    .strict();

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
            mode: z.literal("content"),
            maxCharsPerChunk: z.number().int().positive().optional(),
        })
        .optional(),
    embeddingIdentity: z.string().optional(),
    assets: z.array(revisionAssetDescriptorSchema).optional(),
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
        assets: z.never().optional(),
    }),
    pipeline: z
        .object({
            mode: z.literal("content").optional(),
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

export const runbookSynthesisRequestSchema = z
    .object({
        corpusId: identifierSchema,
        sourceId: identifierSchema,
        revisionId: identifierSchema,
    })
    .strict();

export const runbookJobResultSchema = z
    .object({
        jobId: identifierSchema,
        corpusId: identifierSchema,
        sourceId: identifierSchema,
        revisionId: identifierSchema,
        state: z.enum([
            "running",
            "complete",
            "failed",
            "interrupted",
            "cancelled",
        ]),
        createdAt: z.string(),
        updatedAt: z.string(),
        classification: z.enum(["runbook", "reference", "other"]).optional(),
        confidence: z.number().min(0).max(1).optional(),
        reason: z.string().optional(),
        candidateIds: z.array(identifierSchema),
        warnings: z.array(z.string()),
    })
    .strict();

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

export const eventSourceKindSchema = z.enum([
    "conversation",
    "document",
    "web-activity",
    "procedure",
    "system",
    "other",
]);

export const eventSenderSchema = z.enum([
    "user",
    "assistant",
    "system",
    "tool",
    "agent",
    "other",
]);

export const eventProducerSchema = z.object({
    producerId: identifierSchema,
    producerType: identifierSchema,
});

export const eventSchema = z.object({
    eventId: identifierSchema,
    corpusId: identifierSchema,
    idempotencyKey: z.string().min(1).max(500),
    producer: eventProducerSchema,
    eventType: identifierSchema,
    sourceKind: eventSourceKindSchema,
    observedAt: z.string(),
    eventTime: z.string(),
    createdAt: z.string(),
    content: z.string().max(1_000_000).optional(),
    conversationId: identifierSchema.optional(),
    runId: identifierSchema.optional(),
    turnId: identifierSchema.optional(),
    sender: eventSenderSchema.optional(),
    actionName: z.string().min(1).max(500).optional(),
    linkedSourceIds: z.array(identifierSchema).max(1_000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const eventAppendRequestSchema = eventSchema
    .omit({
        eventId: true,
        observedAt: true,
        eventTime: true,
        createdAt: true,
    })
    .extend({
        observedAt: z.string().optional(),
        eventTime: z.string().optional(),
    });

export const eventAppendResultSchema = z.object({
    event: eventSchema,
    replayed: z.boolean(),
});

export const eventFilterSchema = z.object({
    sourceKinds: z.array(eventSourceKindSchema).optional(),
    producerIds: z.array(identifierSchema).optional(),
    eventTypes: z.array(identifierSchema).optional(),
    conversationIds: z.array(identifierSchema).optional(),
    runIds: z.array(identifierSchema).optional(),
    linkedSourceIds: z.array(identifierSchema).optional(),
    observedFrom: z.string().optional(),
    observedTo: z.string().optional(),
    eventFrom: z.string().optional(),
    eventTo: z.string().optional(),
});

export const eventListRequestSchema = eventFilterSchema.extend({
    corpusId: identifierSchema,
    ...pageRequestSchema.shape,
});

export const eventPageSchema = z.object({
    items: z.array(eventSchema),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z.string().optional(),
});

export const eventSearchRequestSchema = eventFilterSchema.extend({
    corpusId: identifierSchema,
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
});

export const eventSearchResultSchema = z.object({
    query: z.string(),
    matches: z.array(
        z.object({
            event: eventSchema,
            snippet: z.string(),
            score: z.number(),
        }),
    ),
});

export const eventForgetRequestSchema = eventFilterSchema.extend({
    corpusId: identifierSchema,
    eventIds: z.array(identifierSchema).optional(),
    forgetLinkedSources: z.boolean().optional(),
});

export const eventForgetResultSchema = z.object({
    corpusId: identifierSchema,
    deletedEventCount: z.number().int().nonnegative(),
    deletedSourceCount: z.number().int().nonnegative(),
    retainedLinkedSourceIds: z.array(identifierSchema),
    indexVersion: z.string(),
});

export const searchRequestSchema = z.object({
    corpusId: identifierSchema,
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    maxResponseChars: z.number().int().positive().optional(),
    sourceTypes: z.array(sourceTypeSchema).optional(),
    tags: z.array(z.string()).optional(),
    sourceIds: z.array(identifierSchema).optional(),
    dateFrom: z.string().datetime({ offset: true }).optional(),
    dateTo: z.string().datetime({ offset: true }).optional(),
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
    answerMode: z.enum(["synthesized", "extractive"]).optional(),
});

export const answerResultSchema = z.object({
    question: z.string(),
    answer: z.string(),
    mode: z.enum(["synthesized", "extractive"]),
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
    derivedViews: z
        .object({
            kinds: z.enum(["troubleshootingGuide", "projectBrief"]).array(),
            drafts: z.literal(true),
            history: z.literal(true),
            publication: z.literal(true),
            search: z.literal(true),
            builds: z.literal(true).optional(),
            editMerging: z.literal(true).optional(),
        })
        .optional(),
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

export const personalHowToSettingsSchema = z.object({
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
    enabled: z.boolean(),
    detectCandidates: z.boolean(),
    preferences: z.record(z.string(), z.unknown()).optional(),
});

export const personalHowToSettingsUpdateSchema = z.object({
    corpusId: identifierSchema,
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean().optional(),
    detectCandidates: z.boolean().optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
});

export const procedureStateSchema = z.enum([
    "detected",
    "draft",
    "saved",
    "stale",
    "archived",
    "rejected",
]);

export const procedureCitationSchema = z.object({
    sourceId: identifierSchema,
    revisionId: identifierSchema,
    locator: z.string().optional(),
    excerpt: z.string().optional(),
});

export const procedureSectionSchema = z
    .object({
        heading: z.string().min(1),
        content: z.string(),
    })
    .passthrough();

export const runbookAssetReferenceSchema = z
    .object({
        sourceId: identifierSchema,
        revisionId: identifierSchema,
        assetId: identifierSchema,
        description: z.string().optional(),
    })
    .strict();

export const runbookBindingArgumentsSchema = z
    .unknown()
    .superRefine((value, context) => {
        try {
            validateRunbookBindingArguments(value);
        } catch (error) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    error instanceof Error
                        ? error.message
                        : "Invalid binding arguments",
            });
        }
    })
    .pipe(z.record(z.string(), z.json()))
    .meta({
        type: "object",
        description:
            "Bounded JSON argument map. Nested {$input: declaredInputId} references and {$literal: JSON} escapes; no execution.",
    });

export const runbookCatalogIdentitySchema = z
    .string()
    .superRefine((value, context) => {
        try {
            validateRunbookCatalogIdentity(value);
        } catch (error) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    error instanceof Error
                        ? error.message
                        : "Invalid catalog identity",
            });
        }
    });

const catalogBindingFields = {
    accepted: z.boolean(),
    targetId: identifierSchema,
    fingerprint: z.string().min(1),
    arguments: runbookBindingArgumentsSchema.optional(),
};

export const runbookBindingSchema = z.discriminatedUnion("kind", [
    z
        .object({
            ...catalogBindingFields,
            kind: z.literal("mcp"),
            serverId: identifierSchema,
            version: z.string().min(1),
        })
        .strict(),
    z
        .object({
            ...catalogBindingFields,
            kind: z.literal("macro"),
            version: z.number().int().positive(),
        })
        .strict(),
    z
        .object({
            ...catalogBindingFields,
            kind: z.literal("flow"),
            version: z.string().min(1),
        })
        .strict(),
    z
        .object({
            kind: z.literal("command"),
            accepted: z.boolean(),
            text: z.string().min(1),
        })
        .strict(),
    z
        .object({
            kind: z.literal("manual"),
            accepted: z.boolean(),
            reason: z.string().min(1),
        })
        .strict(),
]);

export const agentEditionInputSchema = z
    .object({
        id: identifierSchema,
        description: z.string().min(1),
        type: z.enum(["string", "number", "boolean", "enum"]),
        required: z.boolean(),
        secret: z.boolean(),
        enumValues: z.array(z.string()).optional(),
        defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
        examples: z
            .array(z.union([z.string(), z.number(), z.boolean()]))
            .optional(),
    })
    .strict();

export const agentEditionStepSchema = z
    .object({
        id: identifierSchema,
        title: z.string().min(1),
        humanText: z.string().min(1),
        agentInstruction: z.string().min(1),
        binding: runbookBindingSchema.optional(),
        safety: z.enum(["readOnly", "changesData", "unknown"]),
        needsAttention: z.boolean().optional(),
        attentionReasons: z.array(z.string()).optional(),
        manualReason: z.string().optional(),
        condition: z.string().optional(),
        alternatives: z
            .array(
                z
                    .object({
                        condition: z.string().min(1),
                        stepId: identifierSchema,
                    })
                    .strict(),
            )
            .optional(),
        verification: z.string().optional(),
        rollback: z.string().optional(),
        citations: z.array(procedureCitationSchema),
        assets: z.array(runbookAssetReferenceSchema).optional(),
    })
    .strict();

export const agentEditionReviewSchema = z.discriminatedUnion("state", [
    z
        .object({ state: z.literal("draft"), reason: z.string().optional() })
        .strict(),
    z
        .object({
            state: z.literal("reviewed"),
            procedureVersion: z.number().int().positive(),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            reviewedAt: z.string(),
            safetyConfirmed: z.literal(true),
            bindingValidation: z.literal("accepted"),
            argumentsValidation: z.literal("accepted").optional(),
        })
        .strict(),
]);

export const agentEditionSchema = z
    .object({
        schemaVersion: z.literal(1),
        goal: z.string().min(1),
        applicability: z.array(z.string()),
        inputs: z.array(agentEditionInputSchema),
        preconditions: z.array(z.string()),
        steps: z.array(agentEditionStepSchema).min(1),
        verification: z.array(z.string()),
        rollback: z.array(z.string()),
        synthesis: z
            .object({
                sourceReferences: z.array(procedureCitationSchema),
                linkedDocuments: z.array(procedureCitationSchema).optional(),
                synthesizedAt: z.string().optional(),
                model: z.string().optional(),
                promptVersion: z.string().optional(),
            })
            .strict(),
        review: agentEditionReviewSchema,
    })
    .strict()
    .superRefine((value, context) => {
        try {
            validateAgentEdition(value);
        } catch (error) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    error instanceof Error
                        ? error.message
                        : "Invalid agent edition",
            });
        }
    });

export const procedureDocumentSchema = z.object({
    title: z.string().min(1),
    summary: z.string().optional(),
    steps: z.array(z.string().min(1)).min(1),
    citations: z.array(procedureCitationSchema),
    additionalSections: z.array(procedureSectionSchema).optional(),
    agentEdition: agentEditionSchema.optional(),
});

export const procedureCandidateSchema = procedureDocumentSchema.extend({
    candidateId: identifierSchema,
    corpusId: identifierSchema,
    state: z.enum(["detected", "draft", "rejected", "saved"]),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const procedureCandidateCreateRequestSchema =
    procedureDocumentSchema.extend({
        corpusId: identifierSchema,
        candidateId: identifierSchema.optional(),
        state: z.enum(["detected", "draft"]).optional(),
    });

export const procedureCandidateListRequestSchema = z.object({
    corpusId: identifierSchema,
    states: z
        .array(z.enum(["detected", "draft", "rejected", "saved"]))
        .optional(),
});

export const procedureCandidateInputSchema = z.object({
    corpusId: identifierSchema,
    candidateId: identifierSchema,
});

export const procedureVersionSchema = z.object({
    corpusId: identifierSchema,
    procedureId: identifierSchema,
    version: z.number().int().positive(),
    state: z.enum(["saved", "stale", "archived"]),
    document: procedureDocumentSchema,
    canonicalJson: z.string(),
    markdown: z.string(),
    createdAt: z.string(),
    jsonHash: z.string(),
    markdownHash: z.string(),
    basedOnCandidateId: identifierSchema.optional(),
    previousVersion: z.number().int().positive().optional(),
});

export const procedureSummarySchema = z.object({
    corpusId: identifierSchema,
    procedureId: identifierSchema,
    title: z.string(),
    state: z.enum(["saved", "stale", "archived"]),
    latestVersion: z.number().int().positive(),
    updatedAt: z.string(),
});

export const procedureSaveRequestSchema = z.object({
    corpusId: identifierSchema,
    procedureId: identifierSchema.optional(),
    candidateId: identifierSchema.optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    document: procedureDocumentSchema.optional(),
    markdown: z.string().optional(),
    reviewAgentEdition: z.boolean().optional(),
    safetyConfirmed: z.boolean().optional(),
});

export const procedureGetRequestSchema = z.object({
    corpusId: identifierSchema,
    procedureId: identifierSchema,
    version: z.number().int().positive().optional(),
});

export const procedureListRequestSchema = z.object({
    corpusId: identifierSchema,
    states: z.array(z.enum(["saved", "stale", "archived"])).optional(),
});

export const procedureSearchRequestSchema = procedureListRequestSchema.extend({
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
});

export const procedureSearchMatchSchema = z.object({
    procedure: procedureSummarySchema,
    version: procedureVersionSchema,
    score: z.number(),
});

export const procedureArchiveRequestSchema = z.object({
    corpusId: identifierSchema,
    procedureId: identifierSchema,
    expectedVersion: z.number().int().positive().optional(),
});

export const optionalJobStatusSchema = jobStatusSchema.nullable();
export const optionalSourceSchema = sourceSchema.nullable();
export const optionalCorpusStatusSchema = corpusStatusSchema.nullable();
export const optionalEventSchema = eventSchema.nullable();
export const optionalProcedureCandidateSchema =
    procedureCandidateSchema.nullable();
export const optionalProcedureVersionSchema = procedureVersionSchema.nullable();

export const clearedCountSchema = z.number().int().nonnegative();
