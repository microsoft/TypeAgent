// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    identifierSchema,
    eventFilterSchema,
    eventSenderSchema,
    eventAuthoritySchema,
} from "./protocol.js";

const id = z.string().min(1).max(500);
const count = z.number().int().nonnegative();
const state = z.enum(["ready", "building", "stale", "error", "unsupported"]);
const evidenceKind = z.enum(["document", "event"]);
export const graphQueryRequestSchema = z
    .strictObject({
        corpusId: identifierSchema,
        kind: z.enum(["entities", "topics", "hierarchy"]),
        nodeId: id.optional(),
        search: z.string().max(1000).optional(),
        maxNodes: z.number().int().min(1).max(250).optional(),
        maxEdges: z.number().int().min(1).max(500).optional(),
        pageBy: z.enum(["nodes", "edges"]).optional(),
        evidenceKinds: evidenceKind.array().max(2).optional(),
        eventFilter: eventFilterSchema.optional(),
        expectedGeneration: id.optional(),
        continuationToken: z.string().min(1).max(2000).optional(),
    })
    .refine(
        (request) =>
            request.pageBy !== "edges" || (request.maxNodes ?? 100) >= 2,
        {
            path: ["maxNodes"],
            message: "Edge paging requires at least two endpoint nodes",
        },
    );
export const graphSupportRequestSchema = z
    .strictObject({
        corpusId: identifierSchema,
        generation: id,
        nodeId: id.optional(),
        edgeId: id.optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        continuationToken: z.string().min(1).max(2000).optional(),
    })
    .refine(
        (request) => !!request.nodeId !== !!request.edgeId,
        "Select exactly one node or edge",
    );
const graphSupportSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("document"),
        corpusId: identifierSchema,
        sourceId: id,
        revisionId: id,
        title: z.string().optional(),
        locator: z.string().optional(),
    }),
    z.strictObject({
        kind: z.literal("event"),
        corpusId: identifierSchema,
        eventId: id,
        conversationId: id.optional(),
        turnId: id.optional(),
        eventTime: z.string(),
        sender: eventSenderSchema.optional(),
        authority: eventAuthoritySchema.optional(),
        title: z.string().optional(),
    }),
]);
const coverage = z.strictObject({
    state,
    total: count,
    eligible: count,
    indexed: count,
});
export const graphQueryResultSchema = z.strictObject({
    corpusId: identifierSchema,
    generation: id,
    state,
    nodes: z
        .strictObject({
            id,
            kind: z.enum(["entity", "topic"]),
            label: z.string(),
            types: z.string().array(),
            mentionCount: count,
            supportCount: count,
            distinctEventCount: count.optional(),
            distinctTurnCount: count.optional(),
            scope: z.string().optional(),
            topicId: id.optional(),
            summaryState: z.enum(["pending", "ready", "failed"]).optional(),
        })
        .array()
        .max(250),
    edges: z
        .strictObject({
            id,
            source: id,
            target: id,
            type: z.string(),
            label: z.string().optional(),
            count,
            supportCount: count,
            distinctEventCount: count.optional(),
            distinctTurnCount: count.optional(),
        })
        .array()
        .max(500),
    counts: z.strictObject({
        nodes: count,
        edges: count,
        omittedNodes: count,
        omittedEdges: count,
    }),
    limits: z.strictObject({
        maxNodes: z.number().int().min(1).max(250),
        maxEdges: z.number().int().min(1).max(500),
        maxBytes: z.number().int().positive().optional(),
    }),
    coverage: z.strictObject({
        documents: coverage,
        events: coverage,
        topics: z.strictObject({ state, generation: id.optional() }).optional(),
        reasons: z.string().array(),
    }),
    nextContinuationToken: z.string().optional(),
});
export const graphSupportPageSchema = z.strictObject({
    items: graphSupportSchema.array().max(50),
    total: count,
    nextContinuationToken: z.string().optional(),
    generation: id,
});
export const graphToolNames = {
    queryKnowledgeGraph: "memory_graph_query",
    queryGraphSupport: "memory_graph_support",
} as const;
