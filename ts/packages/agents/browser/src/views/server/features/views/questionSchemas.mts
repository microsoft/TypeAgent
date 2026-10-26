// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    viewReadRequestSchema,
    viewMaintenanceUpdateSchema,
    questionSummaryRequestSchema,
    questionReadRequestSchema,
} from "@typeagent/memory-client";

const id = z.string().min(1).max(200);
const text = z.string().min(1).max(8192);
const schema: z.ZodType = z.lazy(() =>
    z.discriminatedUnion("type", [
        z.strictObject({
            type: z.literal("string"),
            enum: z.array(text).max(100).optional(),
        }),
        z.strictObject({ type: z.literal("number") }),
        z.strictObject({ type: z.literal("boolean") }),
        z.strictObject({
            type: z.literal("object"),
            properties: z.record(id, schema),
            required: z.array(id).max(100),
        }),
    ]),
);
const value: z.ZodType = z.lazy(() =>
    z.union([
        z.string().max(32768),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(value).max(1000),
        z.record(id, value),
    ]),
);
const approval = z.enum(["proposed", "approved", "rejected"]);
const base = {
    corpusId: id,
    viewId: id,
    expectedHead: id.nullable(),
    expectedVersion: z.number().int().nonnegative(),
};
const citation = z.strictObject({
    sourceId: id,
    revisionId: id,
    locator: text,
    excerpt: z.string().max(32768),
    evidence: z
        .strictObject({ kind: z.literal("event"), eventId: id })
        .optional(),
});
const slot = z.strictObject({
    id,
    question: text,
    cardinality: z.enum(["singleton", "record", "collection"]),
    schema,
    itemKey: id.optional(),
    rubric: z.strictObject({
        version: z.number().int().positive(),
        selection: z.enum(["mostRecent", "independentSupport", "manual"]),
        requireConfirmation: z.boolean(),
        authoritySourceIds: z.array(id).max(100),
        freshnessDays: z.number().positive().optional(),
    }),
    approval,
    discoveryCitations: z.array(citation).max(1000),
});
function protocol(schema: {
    safeParse(value: unknown): {
        success: boolean;
        error?: { message: string };
    };
}) {
    return z.unknown().superRefine((value, ctx) => {
        const result = schema.safeParse(value);
        if (!result.success)
            ctx.addIssue({
                code: "custom",
                message: result.error?.message ?? "Invalid question request",
            });
    });
}
export const questionSchemas = {
    memoryListQuestionSummaries: protocol(questionSummaryRequestSchema),
    memoryGetQuestion: protocol(questionReadRequestSchema),
    memoryListQuestions: z.strictObject({ corpusId: id }),
    memoryListAcquisitions: z.strictObject({ corpusId: id }),
    memoryRunAcquisitions: z.strictObject({ corpusId: id }),
    memoryCancelAcquisition: z.strictObject({ corpusId: id, requestId: id }),
    memoryEditQuestion: z.strictObject({
        ...base,
        slotId: id,
        edit: z.discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("slot"), slot }),
            z.strictObject({
                kind: z.literal("review"),
                candidateId: id,
                review: z.enum(["unreviewed", "confirmed", "rejected"]),
            }),
            z.strictObject({
                kind: z.literal("assert"),
                value,
                itemKey: id.optional(),
            }),
            z.strictObject({ kind: z.literal("approval"), approval }),
            z.strictObject({
                kind: z.literal("discovery"),
                enabled: z.boolean(),
                maxProposals: z.number().int().min(0).max(8),
            }),
        ]),
    }),
    memoryGetViewPage: z
        .strictObject({
            corpusId: id,
            viewId: id,
            revisionId: id.optional(),
            slotId: id.optional(),
            itemKey: id.optional(),
        })
        .superRefine((request, ctx) => {
            const { slotId: _slot, itemKey: _item, ...read } = request;
            const result = viewReadRequestSchema.safeParse(read);
            if (!result.success)
                ctx.addIssue({ code: "custom", message: result.error.message });
        }),
    memoryProposeSchemaView: z.strictObject({
        ...base,
        specification: z.string().min(1).max(32768),
        maintenance: protocol({
            safeParse(value: unknown) {
                return viewMaintenanceUpdateSchema.safeParse({
                    ...basePlaceholder,
                    maintenance: value,
                });
            },
        }),
    }),
    memoryDiscoverSchemaQuestions: z.strictObject(base),
};
const basePlaceholder = {
    corpusId: "corpus",
    viewId: "view",
    expectedHead: null,
    expectedVersion: 1,
};
