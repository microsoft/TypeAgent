// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { DomainError } from "./domain/index.js";
import type { QueryIrV1 } from "./query/index.js";
import type {
    MemoryGetRequest,
    MemoryGetResult,
    MemoryQueryRequest,
    MemoryQueryResult,
    ChangeMemoryVisibilityRequest,
    ChangeMemoryVisibilityResult,
    MemoryFeedbackRequest,
    MemoryFeedbackResult,
    RecordTurnRequest,
    RecordTurnResult,
    ReviseMemoryRequest,
    ReviseMemoryResult,
    StoreMemoryRequest,
    StoreMemoryResult,
} from "./services/index.js";

export const serviceName = "agent-memory-mcp";
export const serviceVersion = "0.0.1";

export type MemoryStatus = {
    service: string;
    version: string;
    schemaVersion: number;
    database: "not-initialized" | "ready";
};

export interface MemoryStatusProvider {
    getSchemaVersion(): number;
}

export interface RecordTurnProvider {
    record(request: RecordTurnRequest): RecordTurnResult;
}

export interface MemoryQueryProvider {
    query(request: MemoryQueryRequest): MemoryQueryResult;
}

export interface MemoryGetProvider {
    get(request: MemoryGetRequest): MemoryGetResult;
}

export interface MemoryLifecycleProvider {
    store(request: StoreMemoryRequest): StoreMemoryResult;
    revise(request: ReviseMemoryRequest): ReviseMemoryResult;
    changeVisibility(
        request: ChangeMemoryVisibilityRequest,
    ): ChangeMemoryVisibilityResult;
    feedback(request: MemoryFeedbackRequest): MemoryFeedbackResult;
}

export type MemoryServerServices = {
    status?: MemoryStatusProvider;
    recordTurn?: RecordTurnProvider;
    query?: MemoryQueryProvider;
    get?: MemoryGetProvider;
    lifecycle?: MemoryLifecycleProvider;
};

export function createMemoryServer(
    services: MemoryServerServices = {},
): McpServer {
    const server = new McpServer({
        name: serviceName,
        version: serviceVersion,
    });

    server.registerTool(
        "memory_status",
        {
            description:
                "Report the agent-memory service and storage schema status.",
            inputSchema: z.object({}).strict(),
            annotations: readOnlyAnnotations,
        },
        async () => {
            const status: MemoryStatus = {
                service: serviceName,
                version: serviceVersion,
                schemaVersion: services.status?.getSchemaVersion() ?? 0,
                database:
                    services.status === undefined ? "not-initialized" : "ready",
            };

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(status),
                    },
                ],
                structuredContent: status,
            };
        },
    );

    server.registerTool(
        "memory_record_turn",
        {
            description:
                "Atomically record one completed agent turn and its memory facets.",
            inputSchema: z.object(recordTurnInputShape).strict(),
            annotations: mutationAnnotations,
        },
        async (input) => {
            if (services.recordTurn === undefined) {
                return serviceUnavailable("Turn recording is not initialized");
            }
            try {
                const result = services.recordTurn.record(
                    input as unknown as RecordTurnRequest,
                );
                return jsonResult(result);
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_query",
        {
            description:
                "Retrieve a deterministic working-memory packet using path language or version 1 query IR.",
            inputSchema: memoryQuerySchema,
            annotations: telemetryAnnotations,
        },
        async (input) => {
            if (services.query === undefined) {
                return serviceUnavailable("Memory query is not initialized");
            }
            try {
                const result = services.query.query(
                    input as unknown as MemoryQueryRequest,
                );
                const { text, ...packetMetadata } = result.packet;
                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: {
                        retrievalId: result.retrievalId,
                        packet: packetMetadata,
                        ...(result.resolvedTemporal === undefined
                            ? {}
                            : {
                                  resolvedTemporal: result.resolvedTemporal,
                              }),
                    },
                };
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_get",
        {
            description:
                "Fetch exact scoped memory records in request order without ranking.",
            inputSchema: memoryGetSchema,
            annotations: readOnlyAnnotations,
        },
        async (input) => {
            if (services.get === undefined) {
                return serviceUnavailable(
                    "Exact memory retrieval is not initialized",
                );
            }
            try {
                const result = services.get.get(
                    input as unknown as MemoryGetRequest,
                );
                const { text, ...metadata } = result;
                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: metadata,
                };
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_store",
        {
            description: "Store a new explicit durable memory assertion.",
            inputSchema: memoryStoreSchema,
            annotations: mutationAnnotations,
        },
        async (input) => {
            if (services.lifecycle === undefined) {
                return serviceUnavailable(
                    "Memory lifecycle is not initialized",
                );
            }
            try {
                return jsonResult(
                    services.lifecycle.store(
                        input as unknown as StoreMemoryRequest,
                    ) as unknown as Record<string, unknown>,
                );
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_revise",
        {
            description:
                "Append a durable memory revision using optimistic concurrency.",
            inputSchema: memoryReviseSchema,
            annotations: mutationAnnotations,
        },
        async (input) => {
            if (services.lifecycle === undefined) {
                return serviceUnavailable(
                    "Memory lifecycle is not initialized",
                );
            }
            try {
                return jsonResult(
                    services.lifecycle.revise(
                        input as unknown as ReviseMemoryRequest,
                    ) as unknown as Record<string, unknown>,
                );
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_forget",
        {
            description:
                "Forget or restore durable memories using reversible state events.",
            inputSchema: memoryVisibilitySchema,
            annotations: destructiveAnnotations,
        },
        async (input) => {
            if (services.lifecycle === undefined) {
                return serviceUnavailable(
                    "Memory lifecycle is not initialized",
                );
            }
            try {
                return jsonResult(
                    services.lifecycle.changeVisibility(
                        input as unknown as ChangeMemoryVisibilityRequest,
                    ) as unknown as Record<string, unknown>,
                );
            } catch (error) {
                return toolError(error);
            }
        },
    );

    server.registerTool(
        "memory_feedback",
        {
            description:
                "Record whether durable memories in a retrieval helped the caller.",
            inputSchema: memoryFeedbackSchema,
            annotations: mutationAnnotations,
        },
        async (input) => {
            if (services.lifecycle === undefined) {
                return serviceUnavailable(
                    "Memory lifecycle is not initialized",
                );
            }
            try {
                return jsonResult(
                    services.lifecycle.feedback(
                        input as unknown as MemoryFeedbackRequest,
                    ) as unknown as Record<string, unknown>,
                );
            } catch (error) {
                return toolError(error);
            }
        },
    );

    return server;
}

export async function startMemoryServer(
    services: MemoryServerServices = {},
): Promise<McpServer> {
    const server = createMemoryServer(services);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}

const scopeShape = {
    scopeId: z.string(),
    userId: z.string(),
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
    sessionId: z.string().optional(),
};

const provenanceShape = {
    sourceType: z.enum(["user", "agent", "tool", "import", "derived"]),
    actorId: z.string(),
    observedAt: z.string(),
    sourceTurnIds: z.array(z.string()).optional(),
    sourceEntityIds: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
};

const recordTurnInputShape = {
    turnId: z.string(),
    idempotencyKey: z.string(),
    scope: z.object(scopeShape).strict(),
    conversationId: z.string(),
    sequence: z.number().int().nonnegative(),
    primaryTopicPath: z.string(),
    secondaryTopicPaths: z.array(z.string()).optional(),
    requestSummary: z.string(),
    outcomeSummary: z.string(),
    occurredAt: z.string(),
    provenance: z.object(provenanceShape).strict(),
    terms: z
        .array(
            z
                .object({
                    text: z.string(),
                    role: z
                        .enum([
                            "subject",
                            "method",
                            "artifact",
                            "person",
                            "place",
                        ])
                        .optional(),
                })
                .strict(),
        )
        .optional(),
    actions: z
        .array(
            z
                .object({
                    actionId: z.string().optional(),
                    sequence: z.number().int().nonnegative(),
                    name: z.string(),
                    summary: z.string(),
                    status: z.enum(["completed", "failed", "skipped"]),
                    toolName: z.string().optional(),
                    affectedGoalIds: z.array(z.string()).optional(),
                    affectedArtifactIds: z.array(z.string()).optional(),
                    affectedOutputIds: z.array(z.string()).optional(),
                    designNoteIds: z.array(z.string()).optional(),
                })
                .strict(),
        )
        .optional(),
    artifactChanges: z
        .array(
            z
                .object({
                    artifactId: z.string(),
                    change: z.enum(["created", "updated", "deleted"]),
                    summary: z.string(),
                    kind: z.string().optional(),
                    name: z.string().optional(),
                    uri: z.string().optional(),
                })
                .strict(),
        )
        .optional(),
    goals: z
        .array(
            z
                .object({
                    goalId: z.string().optional(),
                    topicPath: z.string().optional(),
                    desiredState: z.string(),
                    state: z
                        .enum(["active", "achieved", "abandoned"])
                        .optional(),
                    revision: z.number().int().positive().optional(),
                })
                .strict(),
        )
        .optional(),
    designNotes: z
        .array(
            z.object({
                designNoteId: z.string().optional(),
                topicPath: z.string().optional(),
                title: z.string(),
                body: z.string(),
                addressedGoalIds: z.array(z.string()).optional(),
                state: z.enum(["draft", "accepted", "superseded"]).optional(),
                revision: z.number().int().positive().optional(),
            }),
        )
        .optional(),
    outputs: z
        .array(
            z
                .object({
                    outputId: z.string().optional(),
                    topicPath: z.string().optional(),
                    artifactId: z.string(),
                    state: z
                        .enum(["current", "superseded", "deleted"])
                        .optional(),
                    designNotes: z
                        .array(
                            z
                                .object({
                                    designNoteId: z.string(),
                                    revision: z
                                        .number()
                                        .int()
                                        .positive()
                                        .optional(),
                                })
                                .strict(),
                        )
                        .optional(),
                    revision: z.number().int().positive().optional(),
                })
                .strict(),
        )
        .optional(),
    properties: z
        .array(
            z
                .object({
                    definitionId: z.string().optional(),
                    topicPath: z.string().optional(),
                    name: z.string().optional(),
                    valueType: z
                        .enum(["string", "number", "boolean", "string-list"])
                        .optional(),
                    required: z.boolean().optional(),
                    allowedValues: z.array(z.string()).optional(),
                    value: z.union([
                        z.string(),
                        z.number(),
                        z.boolean(),
                        z.array(z.string()),
                    ]),
                })
                .strict(),
        )
        .optional(),
};

const queryEntityKindSchema = z.enum([
    "topic",
    "turn",
    "action",
    "term",
    "artifact",
    "artifactChange",
    "goal",
    "designNote",
    "output",
    "property",
    "memory",
]);
const queryScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const queryExpressionSchema: z.ZodType = z.lazy(() =>
    z.discriminatedUnion("type", [
        z
            .object({
                type: z.literal("match"),
                clauseId: z.string(),
                text: z.string(),
                channels: z
                    .array(
                        z.enum([
                            "lexical",
                            "topic",
                            "term",
                            "artifact",
                            "facet",
                        ]),
                    )
                    .optional(),
            })
            .strict(),
        z
            .object({
                type: z.literal("filter"),
                field: z.string(),
                operator: z.enum(["equals", "in", "exists", "prefix"]),
                value: z
                    .union([queryScalarSchema, z.array(queryScalarSchema)])
                    .optional(),
            })
            .strict(),
        z
            .object({
                type: z.literal("and"),
                children: z.array(queryExpressionSchema),
            })
            .strict(),
        z
            .object({
                type: z.literal("or"),
                children: z.array(queryExpressionSchema),
            })
            .strict(),
        z
            .object({
                type: z.literal("softAnd"),
                children: z.array(queryExpressionSchema),
                minimumShouldMatch: z.number().int().positive().optional(),
            })
            .strict(),
        z
            .object({
                type: z.literal("not"),
                child: queryExpressionSchema,
            })
            .strict(),
    ]),
);
const queryIrSchema = z
    .object({
        version: z.literal(1),
        scopeId: z.string(),
        targetKinds: z.array(queryEntityKindSchema),
        expression: queryExpressionSchema,
        source: z
            .discriminatedUnion("type", [
                z
                    .object({ type: z.literal("term"), term: z.string() })
                    .strict(),
                z
                    .object({
                        type: z.literal("artifact"),
                        artifactId: z.string(),
                    })
                    .strict(),
                z
                    .object({ type: z.literal("turn"), turnId: z.string() })
                    .strict(),
            ])
            .optional(),
        topic: z
            .object({
                rootPath: z.string(),
                traversal: z.enum(["exact", "children", "descendants"]),
                roles: z.array(z.enum(["primary", "secondary"])).optional(),
            })
            .strict()
            .optional(),
        temporal: z
            .discriminatedUnion("type", [
                z
                    .object({
                        type: z.literal("during"),
                        start: z.string(),
                        end: z.string(),
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal("asOf"),
                        instant: z.string(),
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal("changedDuring"),
                        start: z.string(),
                        end: z.string(),
                        projection: z.enum(["matchingEvents", "endState"]),
                    })
                    .strict(),
            ])
            .optional(),
        include: z
            .array(
                z.enum([
                    "topics",
                    "terms",
                    "actions",
                    "artifacts",
                    "goals",
                    "designNotes",
                    "outputs",
                    "properties",
                    "provenance",
                    "lineage",
                ]),
            )
            .optional(),
        projection: z.array(z.string()).optional(),
        orderBy: z
            .array(
                z
                    .object({
                        field: z.enum([
                            "hitCount",
                            "quality",
                            "occurredAt",
                            "recordedAt",
                            "entityId",
                        ]),
                        direction: z.enum(["asc", "desc"]),
                    })
                    .strict(),
            )
            .optional(),
        detail: z.enum(["cards", "snippets", "full"]),
        tokenBudget: z.number().int().min(1).max(32_768),
        maxResults: z.number().int().min(1).max(1_000),
        timezone: z
            .object({
                timeZone: z.string(),
                utcOffsetMinutes: z.number().int(),
                resolvedAt: z.string(),
            })
            .strict(),
        continuation: z
            .object({
                queryHash: z.string(),
                indexVersion: z.number().int().nonnegative(),
                lastEntityId: z.string(),
                sortValues: z.array(queryScalarSchema),
            })
            .strict()
            .optional(),
    })
    .strict();

const memoryQuerySchema = z
    .object({
        scopeId: z.string().min(1),
        query: z.string().min(1).max(16_384).optional(),
        ir: queryIrSchema.optional(),
        timeZone: z.string().min(1).max(128).optional(),
        now: z.string().optional(),
        continuation: z.string().max(16_384).optional(),
        repeatTopicBrief: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) => (value.query === undefined) !== (value.ir === undefined),
        {
            message: "Provide exactly one path query or structured query IR",
        },
    );

const memoryGetSchema = z
    .object({
        scopeId: z.string().min(1),
        memoryIds: z.array(z.string().min(1)).min(1).max(100),
        revision: z.number().int().positive().optional(),
        tokenBudget: z.number().int().min(1).max(32_768),
        detail: z.enum(["cards", "snippets", "full"]).optional(),
    })
    .strict()
    .refine(
        (value) => value.revision === undefined || value.memoryIds.length === 1,
        { message: "revision requires exactly one memory ID" },
    );

const memoryKindSchema = z.enum([
    "fact",
    "preference",
    "instruction",
    "procedure",
    "episode",
    "observation",
    "summary",
]);
const memoryRelationTypeSchema = z.enum([
    "supports",
    "contradicts",
    "supersedes",
    "derived_from",
    "related_to",
]);
const lifecycleScopeSchema = z.object(scopeShape).strict();
const lifecycleProvenanceSchema = z.object(provenanceShape).strict();

const memoryStoreSchema = z
    .object({
        content: z.string().min(1).max(1_000_000),
        kind: memoryKindSchema,
        scope: lifecycleScopeSchema,
        provenance: lifecycleProvenanceSchema,
        structuredContent: z.unknown().optional(),
        tags: z.array(z.string().min(1).max(256)).max(100).optional(),
        confidence: z.number().min(0).max(1).optional(),
        importance: z.number().min(0).max(1).optional(),
        validFrom: z.string().optional(),
        validUntil: z.string().optional(),
        relations: z
            .array(
                z
                    .object({
                        type: memoryRelationTypeSchema,
                        targetMemoryId: z.string(),
                    })
                    .strict(),
            )
            .max(100)
            .optional(),
        idempotencyKey: z.string().min(1).max(512).optional(),
    })
    .strict();

const memoryReviseSchema = z
    .object({
        memoryId: z.string(),
        scope: lifecycleScopeSchema,
        expectedRevision: z.number().int().positive(),
        content: z.string().min(1).max(1_000_000).optional(),
        structuredContent: z.unknown().optional(),
        kind: memoryKindSchema.optional(),
        tags: z.array(z.string().min(1).max(256)).max(100).optional(),
        confidence: z.number().min(0).max(1).optional(),
        importance: z.number().min(0).max(1).optional(),
        validFrom: z.string().nullable().optional(),
        validUntil: z.string().nullable().optional(),
        provenance: lifecycleProvenanceSchema,
        reason: z.string().min(1).max(4096),
        idempotencyKey: z.string().min(1).max(512).optional(),
    })
    .strict();

const memoryVisibilitySchema = z
    .object({
        memoryIds: z.array(z.string()).min(1).max(100),
        scope: lifecycleScopeSchema,
        action: z.enum(["forget", "restore"]).optional(),
        reason: z.string().min(1).max(4096),
        actorId: z.string().min(1).max(512),
        expectedRevisions: z
            .record(z.string(), z.number().int().positive())
            .optional(),
        idempotencyKey: z.string().min(1).max(512).optional(),
    })
    .strict();

const memoryFeedbackSchema = z
    .object({
        retrievalId: z.string(),
        outcomes: z
            .array(
                z
                    .object({
                        memoryId: z.string(),
                        outcome: z.enum(["useful", "unhelpful", "unused"]),
                        reason: z.string().min(1).max(4096).optional(),
                    })
                    .strict(),
            )
            .min(1)
            .max(100),
    })
    .strict();

const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
};
const mutationAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
};
const telemetryAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
};
const destructiveAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
};

function jsonResult(result: Record<string, unknown>) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
    };
}

function serviceUnavailable(message: string) {
    return errorResult("INVALID_STATE_TRANSITION", message);
}

function toolError(error: unknown) {
    if (error instanceof DomainError) {
        const code = error.code === "SCOPE_MISMATCH" ? "NOT_FOUND" : error.code;
        return errorResult(code, error.message);
    }
    console.error("agent-memory tool failed");
    return errorResult("INVARIANT_VIOLATION", "Memory operation failed");
}

function errorResult(code: string, message: string) {
    const error = { code, message };
    return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(error) }],
        structuredContent: { error },
    };
}
