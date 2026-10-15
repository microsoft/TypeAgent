// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().max(120000);
const count = z.number().int().nonnegative();
const source = z.strictObject({ sourceId: id, revisionId: id });
const citation = source.extend({
    locator: z.string().regex(/^indexed:\d+:[0-9a-f]{64}:\d+-\d+$/),
    excerpt: z.string().min(1).max(2000),
});
const alias = z.strictObject({ label: text, scope: text });
export const topicOccurrenceSchema = source.extend({
    id,
    ordinal: count,
    label: text,
    scope: text,
    citations: citation.array(),
});
const topicNodeSchema = z.strictObject({
    id,
    identity: text,
    label: text,
    scope: text,
    aliases: alias.array(),
    occurrenceIds: id.array(),
    summary: text,
    summaryState: z.enum(["pending", "ready", "failed"]),
    summaryAuthorship: z.literal("generated"),
    citations: citation.array(),
    limits: text.array(),
    authorship: z.enum(["generated", "human"]),
});
const parent = z.strictObject({ parentId: id, childId: id });
const related = z.strictObject({
    fromId: id,
    toId: id,
    kind: z.literal("related"),
});
export const topicQueryRequestSchema = z.strictObject({
    corpusId: id,
    topicId: id.optional(),
    search: z.string().max(1000).optional(),
    depth: z.number().int().min(0).max(10).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    continuationToken: z.string().min(1).max(2000).optional(),
});
export const topicQueryPageSchema = z.strictObject({
    generation: id.nullable(),
    nodes: topicNodeSchema
        .extend({
            occurrenceIds: id.array().max(20),
            citations: citation.array().max(8),
            occurrenceCount: count,
            citationCount: count,
            omittedOccurrences: count,
            omittedCitations: count,
        })
        .array()
        .max(200),
    parents: parent.array().max(200),
    related: related.array().max(200),
    neighborhoods: z
        .strictObject({
            topicId: id,
            label: text,
            scope: text,
            sharedSources: count,
            score: z.number().min(0).max(1),
        })
        .array()
        .max(200),
    totalNodes: count,
    matchingNodes: count,
    omittedNodes: count,
    omittedParents: count,
    omittedRelated: count,
    omittedNeighborhoods: count,
    nextContinuationToken: z.string().max(2000).optional(),
    limits: text.array(),
    io: z.strictObject({
        stateBytes: count,
        snapshotBytes: count,
        elapsedMs: z.number().nonnegative(),
    }),
});
export const topicBuildInputSchema = z.strictObject({
    occurrences: topicOccurrenceSchema.array(),
    indexGeneration: id.optional(),
    authoredLabels: z
        .strictObject({ id, label: text, aliases: alias.array() })
        .array()
        .optional(),
    reusableSummaries: z
        .strictObject({
            id,
            summary: text,
            citations: citation.array(),
            limits: text.array(),
        })
        .array()
        .optional(),
});
export const topicSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    corpusId: id,
    generation: id,
    inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    recipe: text,
    generatedAt: text,
    occurrences: topicOccurrenceSchema.array(),
    influenceSources: source.array(),
    nodes: topicNodeSchema.array(),
    parents: parent.array(),
    related: related.array(),
    limits: text.array(),
});
export const topicToolNames = {
    queryTopics: "memory_topics_query",
    rebuildTopics: "memory_topics_rebuild",
} as const;
