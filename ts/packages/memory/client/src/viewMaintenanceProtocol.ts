// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const head = z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable();
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
});
export const viewMaintenanceSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    fingerprint: hash,
    dependencies: dependency.array().max(32),
    privacySources: id.array().max(128),
});
export const viewMaintenanceManifestSchema =
    viewMaintenanceSnapshotSchema.extend({
        acceptedRevisionId: id,
        acceptedAt: z.string(),
    });
export const viewMaintenancePlanRequestSchema = z.strictObject({
    corpusId: id,
    viewIds: id.array().min(1).max(32),
});
const explicitMaintenanceRequestSchema = z.strictObject({
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
export const viewMaintenanceRequestSchema = z.union([
    explicitMaintenanceRequestSchema,
    z.strictObject({
        corpusId: id,
        expectedHead: head,
        family: z.enum(["wiki", "projects"]),
        operation: z.enum(["update", "rebuild", "pause", "resume"]),
    }),
]);
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
