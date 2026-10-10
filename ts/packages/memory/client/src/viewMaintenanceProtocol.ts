// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const head = z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable();
const subject = z.strictObject({
    key: id,
    title: z.string().trim().min(1).max(1000),
    taxonomy: z.enum(["concept", "system", "project"]),
    pageId: id.optional(),
});
const identity = subject.extend({
    pageId: id,
    state: z.enum(["active", "omitted", "merged"]),
    mergedInto: id.optional(),
});
const dependency = z.strictObject({
    sourceId: id,
    revisionId: id,
    contentHash: hash,
    metadataHash: hash,
    pipelineVersion: z.string().min(1),
    embeddingIdentity: z.string().optional(),
});
export const viewMaintenanceDefinitionSchema = z.strictObject({
    schemaVersion: z.literal(1),
    scope: z.discriminatedUnion("mode", [
        z.strictObject({ mode: z.literal("pinned") }),
        z.strictObject({
            mode: z.literal("currentSources"),
            sourceIds: id.array().min(1).max(32),
        }),
        z.strictObject({
            mode: z.literal("scopedSources"),
            sourceTypes: z
                .enum(["web", "markdown", "text", "html", "vtt"])
                .array()
                .min(1)
                .max(5)
                .optional(),
            tags: z
                .string()
                .trim()
                .min(1)
                .max(200)
                .array()
                .min(1)
                .max(32)
                .optional(),
            project: z.string().trim().min(1).max(200).optional(),
        }),
    ]),
    wikiDiscovery: z
        .strictObject({
            rules: z.literal("explicit-subjects-v1"),
            createDraftPages: z.boolean(),
            subjects: subject.array().max(32),
        })
        .optional(),
});
export const viewMaintenanceSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    fingerprint: hash,
    dependencies: dependency.array().max(32),
    subjects: identity.array().max(32),
    registry: identity.array().max(128),
    privacySources: id.array().max(128),
});
export const viewMaintenanceManifestSchema =
    viewMaintenanceSnapshotSchema.extend({
        acceptedRevisionId: id,
        acceptedAt: z.string(),
        pages: z
            .object({
                pageId: id,
                subjectKeys: id.array().max(128),
                contributing: dependency.array().max(32),
                context: dependency.array().max(32),
                inventoryIds: id.array().max(128),
            })
            .array()
            .max(32),
    });
export const viewMaintenancePlanRequestSchema = z.strictObject({
    corpusId: id,
    viewIds: id.array().min(1).max(32),
});
export const viewMaintenanceRequestSchema = z.strictObject({
    corpusId: id,
    expectedHead: head,
    targets: z
        .strictObject({
            viewId: id,
            expectedVersion: z.number().int().positive(),
        })
        .array()
        .min(1)
        .max(32),
});
export const viewMaintenanceUpdateSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    expectedHead: head,
    expectedVersion: z.number().int().positive(),
    maintenance: viewMaintenanceDefinitionSchema,
});
export const viewMaintenanceReadSchema = z.strictObject({
    corpusId: id,
    receiptId: id,
});
