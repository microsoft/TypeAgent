// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    answerAssertionReferenceSchema,
    answerDerivedReferenceSchema,
    answerResultSchema,
    identifierSchema,
} from "./protocol.js";
import {
    graphQueryResultSchema,
    graphSupportPageSchema,
} from "./graphProtocol.js";
import { viewProviderIdentitySchema } from "./viewProtocol.js";

export const understandingToolNames = {
    understand: "memory_understand",
    module: "memory_understanding_module",
} as const;
const id = z.string().min(1).max(500);
const moduleKind = z.enum([
    "explanation",
    "timeline",
    "relationships",
    "concepts",
    "sources",
    "derivedViews",
]);
export const understandingRequestSchema = z
    .strictObject({
        requestId: z.string().uuid().optional(),
        evidenceSnapshotId: z.string().uuid().optional(),
        phase: z.enum(["preview", "retrieve", "initial", "refine"]).optional(),
        corpusId: identifierSchema,
        question: z.string().trim().min(1).max(2000),
        source: z
            .strictObject({
                sourceId: identifierSchema,
                revisionId: identifierSchema,
            })
            .optional(),
        retrievalPolicy: z.enum(["sourcesOnly", "sourcesAndViews"]).optional(),
        knowledgeCheckpointId: identifierSchema.optional(),
        parentSnapshotId: z.string().uuid().optional(),
        parentTurnId: z.string().uuid().optional(),
        selection: z
            .discriminatedUnion("mode", [
                z.strictObject({ mode: z.literal("auto") }),
                z.strictObject({
                    mode: z.literal("only"),
                    modules: moduleKind.array().min(1).max(6),
                }),
            ])
            .optional(),
        focus: z.strictObject({ nodeId: id, generation: id }).optional(),
    })
    .refine(
        (value) => !!value.parentSnapshotId === !!value.parentTurnId,
        "Parent snapshot and turn must be supplied together",
    )
    .refine(
        (value) => value.phase !== "refine" || !!value.evidenceSnapshotId,
        "Refinement requires a prepared evidence snapshot",
    )
    .refine(
        (value) => !value.source || value.retrievalPolicy !== "sourcesAndViews",
        "Document explanations require sources-only retrieval",
    );

const claim = z.strictObject({
    text: z.string().min(1).max(3000),
    evidenceIds: id.array().max(32),
    role: z.literal("memory"),
});
export const understandingCitationSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        id,
        kind: z.literal("source"),
        source: answerResultSchema.shape.citations.element,
    }),
    z.strictObject({
        id,
        kind: z.literal("derived"),
        reference: answerDerivedReferenceSchema,
    }),
    z.strictObject({
        id,
        kind: z.literal("userAssertion"),
        reference: answerAssertionReferenceSchema,
    }),
]);
const date = z.strictObject({
    id,
    evidenceId: id,
    date: z.string().min(1).max(100),
    kind: z.enum(["sourceSession", "event"]),
    precision: z.string().min(1).max(30),
    label: z.string().max(180),
});
export const understandingResultSchema = z.strictObject({
    provisional: z.boolean().optional(),
    refinementFailed: z.boolean().optional(),
    previousAnswer: z
        .strictObject({
            text: z.string().max(12000),
            evidenceIds: id.array().max(32),
        })
        .optional(),
    evidenceSnapshotId: z.string().uuid().optional(),
    refinementPending: z.boolean().optional(),
    schemaVersion: z.literal(1),
    snapshotId: z.string().uuid(),
    turnId: z.string().uuid(),
    corpusId: identifierSchema,
    question: z.string().min(1).max(2000),
    expiresAt: z.string().datetime(),
    answer: z
        .strictObject({
            status: z.enum([
                "answered",
                "partial",
                "noAnswer",
                "needsClarification",
            ]),
            title: z.string().min(1).max(160),
            summary: claim,
            sections: z
                .strictObject({
                    title: z.string().min(1).max(160),
                    claims: claim.array().max(12),
                })
                .array()
                .max(5),
            unknowns: z.string().max(500).array().max(8),
            followUps: z.string().max(240).array().max(3),
        })
        .optional(),
    citations: understandingCitationSchema.array().max(32),
    modules: z
        .strictObject({
            kind: moduleKind,
            status: z.enum(["ready", "planned", "unavailable"]),
            reason: z.string().max(2000).optional(),
        })
        .array()
        .max(6),
    warnings: z.string().array(),
});
export const understandingModuleRequestSchema = z.strictObject({
    requestId: z.string().uuid().optional(),
    corpusId: identifierSchema,
    snapshotId: z.string().uuid(),
    kind: z.enum([
        "timeline",
        "relationships",
        "concepts",
        "sources",
        "derivedViews",
    ]),
    viewId: id.optional(),
    revisionId: id.optional(),
    layoutId: id.optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(8).optional(),
    blockId: id.optional(),
    bodyOffset: z.number().int().nonnegative().optional(),
    citationOffset: z.number().int().nonnegative().optional(),
    citationId: id.optional(),
    citationBodyOffset: z.number().int().nonnegative().optional(),
});
export const understandingDerivedViewSchema = z.strictObject({
    schemaVersion: z.literal(1),
    viewId: id,
    revisionId: id,
    provider: viewProviderIdentitySchema,
    title: z.string(),
    selectedBlockIds: id.array(),
    sourceFragment: z
        .strictObject({
            blockId: id,
            citationId: id,
            role: z.enum(["support", "opposition"]),
            source: z.strictObject({
                sourceId: id,
                revisionId: id,
                locator: z.string(),
                evidence: z
                    .strictObject({ kind: z.literal("event"), eventId: id })
                    .optional(),
            }),
            text: z.string().max(1600),
            offset: z.number().int().nonnegative(),
            totalChars: z.number().int().nonnegative(),
            nextOffset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    presentation: z.strictObject({
        schemaVersion: z.literal(1),
        templateId: z.enum([
            "document-v1",
            "grouped-cards-v1",
            "table-v1",
            "sources-v1",
        ]),
        templateVersion: z.literal(1),
        layouts: z.strictObject({ id, label: z.string() }).array().max(16),
        layout: z.strictObject({
            id,
            label: z.string(),
            groups: z
                .strictObject({ id, label: z.string(), blockIds: id.array() })
                .array(),
        }),
    }),
    blocks: z
        .strictObject({
            id,
            heading: z.string(),
            role: z.string(),
            body: z.string().max(1600),
            bodyOffset: z.number().int().nonnegative(),
            bodyTotalChars: z.number().int().nonnegative(),
            nextBodyOffset: z.number().int().nonnegative().optional(),
            selectedForAnswer: z.boolean(),
            citations: z
                .strictObject({
                    id,
                    role: z.enum(["support", "opposition"]),
                    source: z.strictObject({
                        sourceId: id,
                        revisionId: id,
                        locator: z.string(),
                        evidence: z
                            .strictObject({
                                kind: z.literal("event"),
                                eventId: id,
                            })
                            .optional(),
                    }),
                })
                .array()
                .max(8),
            totalCitations: z.number().int().nonnegative(),
            nextCitationOffset: z.number().int().nonnegative().optional(),
        })
        .array()
        .max(8),
    offset: z.number().int().nonnegative(),
    totalBlocks: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().optional(),
    omittedBlocks: z.number().int().nonnegative(),
});
export const understandingModuleResultSchema = z.strictObject({
    schemaVersion: z.literal(1),
    snapshotId: z.string().uuid(),
    corpusId: identifierSchema,
    kind: z.enum([
        "timeline",
        "relationships",
        "concepts",
        "sources",
        "derivedViews",
    ]),
    derivedViews: understandingDerivedViewSchema.array().max(8).optional(),
    omittedViews: z.number().int().nonnegative().optional(),
    status: z.enum(["ready", "partial", "unavailable"]),
    reason: z.string().optional(),
    timeline: date.array().max(16).optional(),
    concepts: z
        .strictObject({
            id,
            nodeId: id,
            label: z.string().max(2000),
            generation: id,
        })
        .array()
        .max(6)
        .optional(),
    graph: graphQueryResultSchema.optional(),
    support: z
        .strictObject({
            edgeId: id,
            items: graphSupportPageSchema.shape.items,
        })
        .array()
        .max(16)
        .optional(),
    citations: understandingCitationSchema.array().max(32),
});
