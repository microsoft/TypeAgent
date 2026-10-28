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
]);
export const understandingRequestSchema = z
    .strictObject({
        evidenceSnapshotId: z.string().uuid().optional(),
        phase: z.enum(["retrieve", "initial", "refine"]).optional(),
        corpusId: identifierSchema,
        question: z.string().trim().min(1).max(2000),
        retrievalPolicy: z.enum(["sourcesOnly", "sourcesAndViews"]).optional(),
        knowledgeCheckpointId: identifierSchema.optional(),
        parentSnapshotId: z.string().uuid().optional(),
        parentTurnId: z.string().uuid().optional(),
        selection: z
            .discriminatedUnion("mode", [
                z.strictObject({ mode: z.literal("auto") }),
                z.strictObject({
                    mode: z.literal("only"),
                    modules: moduleKind.array().min(1).max(5),
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
        .max(4),
    warnings: z.string().array(),
});
export const understandingModuleRequestSchema = z.strictObject({
    corpusId: identifierSchema,
    snapshotId: z.string().uuid(),
    kind: z.enum(["timeline", "relationships", "concepts", "sources"]),
});
export const understandingModuleResultSchema = z.strictObject({
    schemaVersion: z.literal(1),
    snapshotId: z.string().uuid(),
    corpusId: identifierSchema,
    kind: z.enum(["timeline", "relationships", "concepts", "sources"]),
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
