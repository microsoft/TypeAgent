// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

export const viewSeparationToolName = "memory_view_separate";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const head = z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable();
const text = z.string().min(1).max(2000);
const citation = z.strictObject({
    sourceId: id,
    revisionId: id,
    locator: z.string().min(1),
    excerpt: z.string().min(1),
    evidence: z
        .strictObject({ kind: z.literal("event"), eventId: id })
        .optional(),
});
export const viewSeparationRequestSchema = z.discriminatedUnion("operation", [
    z.strictObject({
        operation: z.literal("preview"),
        corpusId: id,
        viewId: id,
        expectedHead: head,
        expectedVersion: z.number().int().positive(),
        revisionId: id,
    }),
    z.strictObject({ operation: z.literal("read"), corpusId: id, viewId: id }),
    z.strictObject({
        operation: z.literal("confirm"),
        corpusId: id,
        receiptId: id,
        expectedHead: head,
        confirmationToken: hash,
    }),
    z.strictObject({
        operation: z.literal("cancel"),
        corpusId: id,
        receiptId: id,
        expectedHead: head,
    }),
]);
export const viewSeparationProposalSchema = z.strictObject({
    receiptId: id,
    corpusId: id,
    viewId: id,
    acceptedRevisionId: id,
    acceptedVersion: z.number().int().positive(),
    contentHash: hash,
    definitionHash: hash,
    assessmentHash: hash,
    confirmationToken: hash,
    reason: text,
    overview: z.strictObject({
        title: z.string(),
        retainedSectionIds: id.array(),
        retainedHumanUnits: z.string().array(),
    }),
    destinations: z
        .strictObject({
            viewId: id,
            purpose: text,
            sectionIds: id.array().max(96),
            citations: citation.array().min(1).max(96),
            acceptedRevisionId: id.optional(),
        })
        .array()
        .min(2)
        .max(4),
    unresolved: text.array().max(16),
    state: z.enum([
        "proposed",
        "confirmed",
        "incomplete",
        "cancelled",
        "stale",
        "active",
    ]),
    reasonForState: z.string(),
    createdAt: z.string(),
    confirmedAt: z.string().optional(),
});
export const viewSeparationResultSchema = z.strictObject({
    head,
    proposal: viewSeparationProposalSchema.nullable(),
});
