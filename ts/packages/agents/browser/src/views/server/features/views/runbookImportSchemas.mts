// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import type { MemoryHubRunbookImportFunctions } from "@typeagent/browser-control-rpc/runbookImportViewTypes";

const text = z.string().trim().min(1).max(8192);
const corpus = { corpusId: text };
const batch = z.strictObject({
    ...corpus,
    batchId: z.string().regex(/^[a-f0-9]{64}$/),
});
const relativePath = z
    .string()
    .min(1)
    .max(1024)
    .refine(
        (value) =>
            !/[\\:\0]/.test(value) &&
            !value.startsWith("/") &&
            value
                .split("/")
                .every((part) => part !== "" && part !== "." && part !== ".."),
        "Only selected relative file paths are accepted; traversal and host paths are unavailable",
    );
const file = z.strictObject({
    relativePath,
    contentBase64: z
        .string()
        .max(10 * 1024 * 1024)
        .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
    mimeType: z.string().max(100).optional(),
    description: z.string().max(8192).optional(),
});
const identity = {
    ...corpus,
    idempotencyKey: z.string().trim().min(1).max(200),
};

export const runbookImportRequestSchema = z
    .discriminatedUnion("kind", [
        z.strictObject({
            ...identity,
            kind: z.literal("folder"),
            files: z.array(file).min(1).max(200),
        }),
        z.strictObject({
            ...identity,
            kind: z.literal("wiki"),
            files: z.array(file).min(1).max(200),
        }),
        z.strictObject({
            ...identity,
            kind: z.literal("urls"),
            urls: z.array(z.string().min(1).max(8192)).min(1).max(50),
        }),
    ])
    .superRefine((request, context) => {
        if (
            Buffer.byteLength(
                JSON.stringify({
                    method: "memoryHubStartRunbookImport",
                    params: request,
                }),
            ) >
            10 * 1024 * 1024
        ) {
            context.addIssue({
                code: "custom",
                message: "Runbook request exceeds the 10 MB gateway body limit",
            });
        }
        if (
            request.kind !== "urls" &&
            request.files.filter(
                (file) => !/\.(?:png|jpe?g|gif|webp)$/i.test(file.relativePath),
            ).length > 50
        ) {
            context.addIssue({
                code: "custom",
                message:
                    "Select at most 50 source documents; nothing is silently truncated",
            });
        }
    });
export const runbookImportViewSchemas: Record<
    keyof MemoryHubRunbookImportFunctions,
    z.ZodType
> = {
    memoryHubStartRunbookImport: runbookImportRequestSchema,
    memoryHubRunbookBatches: z.strictObject(corpus),
    memoryHubRunbookBatch: batch,
    memoryHubRetryRunbookBatch: batch,
    memoryHubCancelRunbookBatch: batch,
    memoryHubRunbookJobs: z.strictObject(corpus),
    memoryHubRetryRunbookSynthesis: z.strictObject({
        ...corpus,
        sourceId: text,
        revisionId: text,
    }),
};
