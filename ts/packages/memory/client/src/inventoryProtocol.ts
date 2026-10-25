// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    questionInventorySchema,
    questionSlotSchema,
    questionDetailsSchema,
} from "./schemaViewProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const inventoryPageRequestSchema = z.strictObject({
    corpusId: id,
    pageSize: z.number().int().min(1).max(100).optional(),
    continuationToken: z.string().regex(/^\d+$/).optional(),
    query: z.string().max(1000).optional(),
    viewId: id.optional(),
});
export const questionSummaryRequestSchema = inventoryPageRequestSchema.extend({
    answerFilter: z.enum(["open", "answered"]).optional(),
    attentionOnly: z.boolean().optional(),
});
export const questionReadRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    slotId: id,
});
export const questionSummarySchema = questionInventorySchema.shape.items.element
    .pick({
        corpusId: true,
        viewId: true,
        viewTitle: true,
        attentionScore: true,
        fingerprint: true,
    })
    .extend({
        slot: questionSlotSchema
            .pick({ id: true, question: true, approval: true })
            .extend({
                rubric: questionSlotSchema.shape.rubric.pick({
                    requireConfirmation: true,
                }),
                discoveryCitationCount: z.number().int().nonnegative(),
            }),
        details: questionDetailsSchema
            .pick({ answerState: true, reviewState: true, freshness: true })
            .extend({
                candidateCount: z.number().int().nonnegative(),
                hasUnreviewedCandidates: z.boolean(),
            }),
    });
export const questionSummaryPageSchema = z.strictObject({
    items: questionSummarySchema.array().max(100),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z.string().regex(/^\d+$/).optional(),
    ...questionInventorySchema.pick({ head: true, maintenanceError: true })
        .shape,
});
export const questionDetailSchema =
    questionInventorySchema.shape.items.element.optional();
export const inventoryToolNames = {
    listQuestionSummaries: "memory_question_summaries",
    getQuestion: "memory_question_get",
} as const;
