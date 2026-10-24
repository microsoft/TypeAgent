// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { viewMaintenanceDefinitionSchema } from "./viewMaintenanceProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().min(1).max(120000);
const source = z.strictObject({ sourceId: id, revisionId: id });
const citation = source.extend({
    locator: z
        .string()
        .regex(/^(chars:\d+-\d+|indexed:\d+:[0-9a-f]{64}:\d+-\d+)$/),
    excerpt: text,
    evidence: z
        .strictObject({ kind: z.literal("event"), eventId: id })
        .optional(),
});
const objectKey = z.string().min(1).max(200);
function boundedRecord(value: z.ZodType) {
    return z
        .record(objectKey, value)
        .refine(
            (record) => Object.keys(record).length <= 64,
            "At most 64 object properties are supported",
        );
}
function answerSchema(depth: number): z.ZodType {
    const primitives = [
        z.strictObject({
            type: z.literal("string"),
            enum: text.array().min(1).max(64).optional(),
        }),
        z.strictObject({ type: z.literal("number") }),
        z.strictObject({ type: z.literal("boolean") }),
    ] as const;
    if (!depth)
        return z.union(primitives).meta({ id: "TypeAgentMemoryAnswerSchema0" });
    return z
        .union([
            ...primitives,
            z.strictObject({
                type: z.literal("object"),
                properties: boundedRecord(answerSchema(depth - 1)),
                required: objectKey.array().max(64),
            }),
        ])
        .meta({ id: `TypeAgentMemoryAnswerSchema${depth}` });
}
function answerValue(depth: number): z.ZodType {
    const primitives = [
        z.string().max(120000),
        z.number().finite(),
        z.boolean(),
        z.null(),
    ] as const;
    if (!depth)
        return z.union(primitives).meta({ id: "TypeAgentMemorySchemaValue0" });
    const child = answerValue(depth - 1);
    return z
        .union([...primitives, child.array().max(1000), boundedRecord(child)])
        .meta({ id: `TypeAgentMemorySchemaValue${depth}` });
}
export const answerSchemaSchema = answerSchema(6);
export const schemaValueSchema = answerValue(6);
export const questionRubricSchema = z.strictObject({
    version: z.number().int().positive(),
    selection: z.enum(["mostRecent", "independentSupport", "manual"]),
    requireConfirmation: z.boolean(),
    authoritySourceIds: id.array().max(1000),
    freshnessDays: z.number().positive().finite().optional(),
});
const approval = z.enum(["proposed", "approved", "rejected"]);
export const questionAdmissionSchema = z.strictObject({
    version: z.literal(1),
    actor: z.enum(["user", "policy"]),
    policyVersion: z.literal(1),
    recipeIdentity: z.string().min(1).max(1000),
    modelIdentity: z.string().min(1).max(1000),
    inputFingerprint: z.string().min(1).max(1000),
    reason: z.string().min(1).max(2000),
});
export const questionSlotSchema = z.strictObject({
    id,
    question: text,
    cardinality: z.enum(["singleton", "record", "collection"]),
    schema: answerSchemaSchema,
    itemKey: objectKey.optional(),
    rubric: questionRubricSchema,
    approval,
    discoveryCitations: citation.array().max(1000),
    admission: questionAdmissionSchema.optional(),
});
export const schemaViewDefinitionSchema = z.strictObject({
    construction: z.literal("schema-defined-v1"),
    title: text,
    slots: questionSlotSchema.array().min(1).max(32),
    template: z.literal("questions-v1"),
    discovery: z.strictObject({
        enabled: z.boolean(),
        maxProposals: z.number().int().min(0).max(8),
        lastEvaluatedScope: z.string().min(1).max(200).optional(),
    }),
});
const review = z.enum(["unreviewed", "confirmed", "rejected"]);
export const answerCandidateSchema = z.strictObject({
    id,
    value: schemaValueSchema,
    itemKey: objectKey.optional(),
    origin: z.enum(["source", "user"]),
    review,
    citations: citation.array().max(1000),
    opposingCitations: citation.array().max(1000),
    effectiveAt: z.string().max(200).optional(),
    assertionOwner: z.string().max(200).optional(),
    independenceKey: z.string().max(200).optional(),
    derivedFrom: id.array().max(1000),
    support: z
        .strictObject({
            citation,
            independenceKey: z.string().max(200).optional(),
            assertionOwner: z.string().max(200).optional(),
            effectiveAt: z.string().max(200).optional(),
            derivedFrom: id.array().max(1000),
        })
        .array()
        .max(1000),
});
export const questionDetailsSchema = z.strictObject({
    kind: z.literal("question"),
    slotId: id,
    candidates: answerCandidateSchema.array().max(64),
    selectedCandidateIds: id.array().max(64),
    answerState: z.enum(["pending", "partial", "answered", "conflicted"]),
    reviewState: review,
    freshness: z.enum(["current", "stale", "expired"]),
    coverage: z.enum(["unknown", "partial"]),
    evaluatedSources: source.array().max(100000),
    scopeFingerprint: z.string().min(1).max(200),
});
export const schemaViewContentSchema = z.strictObject({
    kind: z.literal("schemaView"),
    construction: z.literal("schema-defined-v1"),
    title: text,
    summary: text.optional(),
    sections: z
        .strictObject({
            id,
            role: z.literal("question"),
            heading: z.string().max(120000),
            body: z.string().max(120000),
            details: questionDetailsSchema,
        })
        .array()
        .min(1)
        .max(32),
    citations: citation.array().max(10000),
});
export const questionInventorySchema = z.strictObject({
    head: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .nullable(),
    items: z
        .strictObject({
            corpusId: id,
            viewId: id,
            viewTitle: text,
            viewVersion: z.number().int().positive(),
            viewRevisionId: id,
            definitionRevision: z.string().min(1).max(200),
            slot: questionSlotSchema,
            details: questionDetailsSchema,
            attentionScore: z.number().finite(),
            fingerprint: z.string().min(1).max(200),
        })
        .array()
        .max(100000),
    maintenanceError: z.string().max(120000).optional(),
});
const editBase = {
    corpusId: id,
    viewId: id,
    expectedHead: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .nullable(),
    expectedVersion: z.number().int().nonnegative(),
};
export const questionCorpusRequestSchema = z.strictObject({ corpusId: id });
export const questionEditRequestSchema = z.strictObject({
    ...editBase,
    slotId: id,
    edit: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("slot"), slot: questionSlotSchema }),
        z.strictObject({ kind: z.literal("review"), candidateId: id, review }),
        z.strictObject({
            kind: z.literal("assert"),
            value: schemaValueSchema,
            itemKey: objectKey.optional(),
        }),
        z.strictObject({ kind: z.literal("approval"), approval }),
        z.strictObject({
            kind: z.literal("discovery"),
            enabled: z.boolean(),
            maxProposals: z.number().int().min(0).max(8),
        }),
    ]),
});
export const schemaViewPageRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    revisionId: id.optional(),
    slotId: id.optional(),
    itemKey: objectKey.optional(),
});
export const schemaViewPageSchema = z.strictObject({
    uri: z
        .string()
        .min(1)
        .max(8192)
        .refine(
            (value) => value.startsWith("memory-view://"),
            "Expected a memory-view URI",
        ),
    revisionId: id,
    markdown: z.string().max(4000000),
});
export const schemaViewProposalRequestSchema = z.strictObject({
    ...editBase,
    specification: z.string().min(1).max(32768),
    maintenance: viewMaintenanceDefinitionSchema,
});
export const schemaQuestionDiscoveryRequestSchema = z.strictObject(editBase);
export const schemaViewToolNames = {
    listQuestions: "memory_questions_list",
    editQuestion: "memory_question_edit",
    getViewPage: "memory_view_page",
    proposeSchemaView: "memory_schema_view_propose",
    discoverSchemaQuestions: "memory_schema_questions_discover",
} as const;
