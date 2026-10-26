// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    questionInventorySchema,
    questionSlotSchema,
    questionDetailsSchema,
} from "./schemaViewProtocol.js";
import {
    viewBuildJobSchema,
    viewPublicationStatusSchema,
    viewVersionSchema,
    viewSnapshotSchema,
} from "./viewProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const inventoryPageRequestSchema = z.strictObject({
    corpusId: id,
    pageSize: z.number().int().min(1).max(100).optional(),
    continuationToken: z.string().regex(/^\d+$/).optional(),
    query: z.string().max(1000).optional(),
    viewId: id.optional(),
});
export const viewSummaryRequestSchema = inventoryPageRequestSchema.extend({
    kind: z
        .enum([
            "wiki",
            "projectBrief",
            "timeline",
            "schemaView",
            "troubleshootingGuide",
        ])
        .optional(),
});
export const questionSummaryRequestSchema = inventoryPageRequestSchema.extend({
    viewId: id.optional(),
    answerFilter: z.enum(["open", "answered"]).optional(),
    attentionOnly: z.boolean().optional(),
});
export const questionReadRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    slotId: id,
});
export const viewPublicationBatchRequestSchema = z.strictObject({
    corpusId: id,
    viewIds: id
        .array()
        .max(100)
        .refine(
            (ids) => new Set(ids).size === ids.length,
            "View IDs must be unique",
        ),
});
const page = <T extends z.ZodType>(item: T) =>
    z.strictObject({
        items: item.array().max(100),
        total: z.number().int().nonnegative(),
        nextContinuationToken: z.string().regex(/^\d+$/).optional(),
    });
export const viewSummarySchema = viewVersionSchema
    .pick({
        corpusId: true,
        viewId: true,
        revisionId: true,
        state: true,
    })
    .extend({
        content: z.strictObject({
            kind: z.enum([
                "wiki",
                "projectBrief",
                "timeline",
                "schemaView",
                "troubleshootingGuide",
            ]),
            title: z.string(),
        }),
        maintained: z.boolean(),
        publication: viewPublicationStatusSchema,
    });
export const viewSummaryPageSchema = page(viewSummarySchema).extend({
    latestBuild: viewBuildJobSchema
        .pick({ jobId: true, corpusId: true, state: true })
        .optional(),
    ...viewSnapshotSchema.pick({
        head: true,
        wikiFamily: true,
        projectFamily: true,
    }).shape,
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
            .pick({
                answerState: true,
                reviewState: true,
                freshness: true,
            })
            .extend({
                candidateCount: z.number().int().nonnegative(),
                hasUnreviewedCandidates: z.boolean(),
            }),
    });
export const questionSummaryPageSchema = page(questionSummarySchema).extend({
    ...questionInventorySchema.pick({ head: true, maintenanceError: true })
        .shape,
});
export const questionDetailSchema =
    questionInventorySchema.shape.items.element.optional();
const result = viewBuildJobSchema.shape.results.element;
export const viewBuildSummarySchema = viewBuildJobSchema
    .pick({
        jobId: true,
        corpusId: true,
        createdAt: true,
        updatedAt: true,
        state: true,
    })
    .extend({
        maintenance: z.boolean(),
        results: result
            .pick({
                viewId: true,
                state: true,
                reason: true,
                revisionId: true,
                conflictId: true,
            })
            .extend({
                current: z.boolean(),
                snapshot: result.shape.snapshot
                    .pick({ pipeline: true })
                    .extend({
                        definition: z.strictObject({
                            kind: viewSummarySchema.shape.content.shape.kind,
                        }),
                    }),
            })
            .array(),
    });
export const viewBuildSummaryPageSchema = page(viewBuildSummarySchema);
export const viewPublicationBatchSchema = viewPublicationStatusSchema
    .array()
    .max(100);
export const inventoryToolNames = {
    listViewSummaries: "memory_view_summaries",
    listQuestionSummaries: "memory_question_summaries",
    getQuestion: "memory_question",
    listViewBuildSummaries: "memory_view_build_summaries",
    getViewPublications: "memory_view_publications",
} as const;
