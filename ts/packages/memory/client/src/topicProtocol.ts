// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().max(120000);
const count = z.number().int().nonnegative();
const source = z.strictObject({ sourceId: id, revisionId: id });
const eventEvidence = z.strictObject({ kind: z.literal("event"), eventId: id });
export const topicEventReferenceSchema = z.strictObject({
    eventId: id,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
const citation = source.extend({
    locator: z.string().regex(/^indexed:\d+:[0-9a-f]{64}:\d+-\d+$/),
    excerpt: z.string().min(1).max(2000),
    evidence: eventEvidence.optional(),
});
const alias = z.strictObject({ label: text, scope: text });
export const topicOccurrenceSchema = source.extend({
    evidence: eventEvidence.optional(),
    id,
    ordinal: count,
    label: text,
    scope: text,
    citations: citation.array(),
    context: z.strictObject({ role: text, chronology: text }).optional(),
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
const clusterValidation = z
    .strictObject({
        recipe: z.literal("cluster-local-v1"),
        signature: z.string().regex(/^[0-9a-f]{64}$/),
        modelIdentity: z.string().min(1),
        inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        coverage: z.literal("member-admission-v2").optional(),
        method: z.enum(["decision", "generative"]).optional(),
        validatedMemberIds: id.array().min(1).optional(),
        score: z.number().min(0).max(1).optional(),
        memberScores: z
            .strictObject({
                nodeId: id,
                score: z.number().min(0).max(1),
            })
            .array()
            .max(255)
            .optional(),
    })
    .refine(
        (validation) =>
            validation.coverage === undefined
                ? validation.method === undefined &&
                  validation.validatedMemberIds === undefined
                : validation.method !== undefined &&
                  validation.validatedMemberIds !== undefined &&
                  new Set(validation.validatedMemberIds).size ===
                      validation.validatedMemberIds.length &&
                  (validation.method !== "generative" ||
                      (validation.score === undefined &&
                          validation.memberScores === undefined)),
        "Validation method and checked membership must match declared coverage",
    );
const pendingAssignment = z.strictObject({
    nodeId: id,
    reason: z.string().min(1).max(2000),
    candidateTargetIds: id.array(),
    score: z.number().min(0).max(1).optional(),
});
const topicConceptSchema = z
    .strictObject({
        id,
        label: z.string().min(1).max(200),
        scope: z.string().min(1).max(200),
        purpose: z.string().min(1).max(2000),
        memberIds: id.array().min(1),
        summary: z.string().max(1600),
        summaryState: z.enum(["pending", "ready"]).optional(),
        citations: citation.array().min(1),
        salience: z.number().int().min(1).max(8),
        validation: clusterValidation.optional(),
        summaryCitations: citation.array().min(1).optional(),
        maintenance: z
            .strictObject({
                signature: z.string().regex(/^[0-9a-f]{64}$/),
                priority: z.number().min(0).max(1),
                reasons: z.string().min(1).max(2000).array().min(1).max(16),
                suspectMemberIds: id.array(),
            })
            .optional(),
    })
    .refine(
        (concept) =>
            concept.summaryState === "pending"
                ? concept.summary === ""
                : concept.summary.trim().length > 0,
        "Concept summary must be empty only while explicitly pending",
    );
const topicCurationSchema = z.strictObject({
    concepts: topicConceptSchema.array(),
    deferred: z
        .strictObject({ nodeId: id, reason: z.string().min(1).max(2000) })
        .array(),
    pending: pendingAssignment.array().optional(),
});
export const topicQueryRequestSchema = z
    .strictObject({
        corpusId: id,
        topicId: id.optional(),
        search: z.string().max(1000).optional(),
        depth: z.number().int().min(0).max(10).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
        continuationToken: z.string().min(1).max(2000).optional(),
        curated: z.boolean().optional(),
        summarize: z.boolean().optional(),
    })
    .refine(
        (request) =>
            !request.summarize ||
            (request.curated === true &&
                !!request.topicId &&
                !request.search &&
                !request.continuationToken),
        "Summary generation requires one explicit curated topic",
    );
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
    concepts: topicConceptSchema
        .safeExtend({
            memberIds: id.array().max(20),
            citations: citation.array().max(8),
            memberCount: count,
            omittedMembers: count,
            citationCount: count,
            omittedCitations: count,
        })
        .array()
        .max(200)
        .optional(),
    totalConcepts: count.optional(),
    pendingAssignments: pendingAssignment.array().max(200).optional(),
    pendingCount: count.optional(),
    omittedPendingAssignments: count.optional(),
});
export const topicBuildInputSchema = z.strictObject({
    occurrences: topicOccurrenceSchema.array(),
    maintainClusters: z.boolean().optional(),
    reusableCuration: topicCurationSchema.optional(),
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
    influenceEvents: topicEventReferenceSchema.array().optional(),
    nodes: topicNodeSchema.array(),
    parents: parent.array(),
    related: related.array(),
    limits: text.array(),
    curation: topicCurationSchema.optional(),
});
export const topicToolNames = {
    queryTopics: "memory_topics_query",
    rebuildTopics: "memory_topics_rebuild",
} as const;
