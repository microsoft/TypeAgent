// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import type {
    WikiAmbiguityReview,
    WikiAmbiguityResolution,
    ViewBuildSnapshot,
    WikiSubjectAssessment,
} from "@typeagent/memory-service";
import { viewVersionSchema, viewSynthesisSchema } from "./viewProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const wikiAmbiguityListRequestSchema = z.strictObject({
    corpusId: id,
});
export const wikiAmbiguityResolutionSchema = z.strictObject({
    status: z.enum(["resolved", "needs_review"]),
    reason: z.string().min(1).max(2000),
    groups: z
        .strictObject({
            action: z.enum(["keep_separate", "combine"]),
            ids: id.array().min(1),
            survivorId: id.nullable(),
            combined: z.string().nullable(),
            sections: z
                .strictObject({ id, sectionId: id, combinedSectionId: id })
                .array(),
        })
        .array(),
}) satisfies z.ZodType<WikiAmbiguityResolution>;

const inputSchema = z.custom<ViewBuildSnapshot>(
    (value) =>
        !!value &&
        typeof value === "object" &&
        "inputs" in value &&
        Array.isArray(value.inputs) &&
        "fingerprint" in value &&
        typeof value.fingerprint === "string" &&
        "definition" in value,
);
const assessmentSchema = z.custom<WikiSubjectAssessment>(
    (value) =>
        !!value &&
        typeof value === "object" &&
        "disposition" in value &&
        value.disposition === "ambiguous",
);
export const wikiAmbiguityReviewSchema = z.strictObject({
    id,
    corpusId: id,
    jobId: id,
    candidateId: id,
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    state: z.enum(["resolving", "needsReview", "conflict", "resolved"]),
    reason: z.string(),
    assessment: assessmentSchema,
    participants: z
        .strictObject({
            id,
            revisionId: id.nullable(),
            page: viewVersionSchema.optional(),
            input: inputSchema,
            draft: viewSynthesisSchema.optional(),
            proposal: z.unknown().optional(),
        })
        .array(),
    request: z.strictObject({
        model: z.literal("GPT_6_1_SOL"),
        logicalRequests: z.literal(1),
        state: z.enum([
            "reserved",
            "returned",
            "failed",
            "unavailable",
            "interrupted",
        ]),
        budget: z.unknown().optional(),
        requestFingerprint: z.string().optional(),
        transportRetries: z.number().int().nonnegative().optional(),
        transportAttempts: z
            .custom<
                NonNullable<WikiAmbiguityReview["request"]["transportAttempts"]>
            >((value) => Array.isArray(value))
            .optional(),
        raw: z.unknown().optional(),
    }),
    resolution: wikiAmbiguityResolutionSchema.optional(),
    verification: z.unknown().array().optional(),
    appliedRevisions: z.record(z.string(), z.string()).optional(),
    actor: z.string().optional(),
}) as z.ZodType<WikiAmbiguityReview>;
export const wikiAmbiguityReviewActionSchema = z
    .strictObject({
        corpusId: id,
        reviewId: id,
        expectedVersion: z.number().int().positive(),
        action: z.enum(["keep_separate", "approve", "edit"]),
        resolution: wikiAmbiguityResolutionSchema.optional(),
    })
    .superRefine((request, context) => {
        if ((request.action === "edit") !== !!request.resolution)
            context.addIssue({
                code: "custom",
                path: ["resolution"],
                message: "Only an edit requires and accepts a resolution",
            });
    });
export const wikiAmbiguityToolNames = {
    list: "memory_wiki_ambiguity_reviews",
    resolve: "memory_wiki_ambiguity_resolve",
} as const;
