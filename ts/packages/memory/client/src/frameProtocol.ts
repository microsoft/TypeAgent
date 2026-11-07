// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const temporal = z.strictObject({
    kind: z.enum(["calendar", "instant"]),
    raw: z.string().min(1).max(100),
});
const scalar = z.union([
    z.string().max(120000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    temporal,
]);
const field = z.strictObject({
    type: z.enum(["string", "number", "boolean", "calendar", "instant"]),
    optional: z.boolean().optional(),
    multiple: z.boolean().optional(),
    unit: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
});
export const frameSchemaSchema = z.strictObject({
    id,
    revision: z.number().int().positive(),
    description: z.string().min(1).max(120000),
    fields: z
        .record(id, field)
        .refine(
            (fields) =>
                Object.keys(fields).length > 0 &&
                Object.keys(fields).length <= 64,
        ),
});
export const frameSchemasSchema = frameSchemaSchema.array();
const comparison = z.strictObject({
    fieldId: id,
    op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
    value: z.union([
        z.string().max(120000),
        z.number().finite(),
        z.boolean(),
        temporal,
    ]),
    unit: z.string().min(1).max(200).optional(),
});
export const framePredicateSchema = z.union([
    z.strictObject({ and: comparison.array().max(64) }),
    z.strictObject({ or: comparison.array().max(64) }),
]);
export const frameCorpusRequestSchema = z.strictObject({ corpusId: id });
const frameQueryFields = z.strictObject({
    corpusId: id,
    schemaId: id,
    schemaRevision: z.number().int().positive(),
    predicate: framePredicateSchema.optional(),
    query: z.string().min(1).max(120000).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    cursor: z.string().min(1).max(8000).optional(),
    includeUnconfirmed: z.boolean().optional(),
    sourceIds: id.array().max(4096).optional(),
    repository: z.string().min(1).max(2000).optional(),
    commit: z.string().min(1).max(2000).optional(),
    environment: z.string().min(1).max(2000).optional(),
});
export const frameQueryRequestSchema = frameQueryFields.refine(
    (request) => request.predicate === undefined || request.query === undefined,
    "Provide either a structured frame predicate or natural-language query",
);
export const frameSearchFilterSchema = frameQueryFields
    .omit({ corpusId: true, limit: true, cursor: true })
    .refine(
        (request) =>
            request.predicate === undefined || request.query === undefined,
        "Provide either a structured frame predicate or natural-language query",
    );
const receipt = z.strictObject({
    ownerKey: z.string().min(1).max(1000),
    revisionId: id,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    state: z.enum(["pending", "ready", "failed"]),
    error: z.string().optional(),
});
export const frameProjectionStatusSchema = z.strictObject({
    version: z.literal(1),
    snapshot: z.string().regex(/^[0-9a-f]{64}$/),
    owners: receipt.array(),
    coverage: z.strictObject({
        ready: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        unavailableValues: z.number().int().nonnegative(),
    }),
});
const evidence = z.strictObject({
    sourceId: id,
    revisionId: id,
    locator: z.string().min(1),
    excerpt: z.string().max(120000),
    evidence: z
        .strictObject({ kind: z.literal("event"), eventId: id })
        .optional(),
});
const row = z.strictObject({
    schemaId: id,
    schemaRevision: z.number().int().positive(),
    itemKey: z.string().min(1).max(2000),
    values: z.record(id, z.union([scalar, scalar.array().max(10000)])),
    valueStates: z
        .record(
            id,
            z.enum(["unknown", "unevaluated", "unavailable", "conflicted"]),
        )
        .optional(),
    eligible: z.boolean(),
    origin: z.enum(["source", "user", "derived"]),
    granularity: z.enum(["source", "view", "section", "record"]),
    evidence: evidence.array(),
    opposition: evidence.array(),
    ownerKey: z.string().min(1).max(1000),
    ownerRevisionId: id,
    sourceIds: id.array(),
});
export const frameQueryResultSchema = frameProjectionStatusSchema.extend({
    schema: frameSchemaSchema,
    predicate: framePredicateSchema,
    rows: row.array().max(1000),
    nextCursor: z.string().optional(),
});
export const frameToolNames = {
    listFrameSchemas: "memory_list_frame_schemas",
    queryFrame: "memory_query_frame",
    getFrameProjectionStatus: "memory_get_frame_projection_status",
} as const;
