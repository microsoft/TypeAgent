// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import type { AcquisitionRequest } from "@typeagent/memory-service";
import { jobStateSchema } from "./protocol.js";

const id = z.string().min(1).max(200);
export type AcquisitionProgress = Pick<
    AcquisitionRequest,
    | "corpusId"
    | "requestId"
    | "sourceId"
    | "state"
    | "createdAt"
    | "updatedAt"
    | "calls"
    | "retries"
    | "consumers"
> & {
    hasError: boolean;
    receipt?: Pick<
        NonNullable<AcquisitionRequest["receipt"]>,
        "jobId" | "revisionId" | "state"
    >;
};
export interface MemoryAcquisitionProgressService {
    listAcquisitionProgress(corpusId: string): Promise<AcquisitionProgress[]>;
    runAcquisitionProgress(corpusId: string): Promise<AcquisitionProgress[]>;
    cancelAcquisitionProgress(request: {
        corpusId: string;
        requestId: string;
    }): Promise<AcquisitionProgress>;
}
export const acquisitionCorpusRequestSchema = z.strictObject({ corpusId: id });
export const acquisitionCancelRequestSchema = z.strictObject({
    corpusId: id,
    requestId: id,
});
export const acquisitionProgressSchema = z.strictObject({
    corpusId: id,
    requestId: id,
    sourceId: id,
    state: z.enum([
        "pending",
        "deferred",
        "fetching",
        "acquired",
        "ingesting",
        "ingested",
        "resolved",
        "cancelled",
        "failed",
    ]),
    createdAt: z.string().max(200),
    updatedAt: z.string().max(200),
    calls: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    consumers: z
        .strictObject({ viewId: id, slotId: id, definitionRevision: id })
        .array()
        .max(1000),
    hasError: z.boolean(),
    receipt: z
        .strictObject({
            jobId: id,
            revisionId: id,
            state: jobStateSchema,
        })
        .optional(),
});
export const acquisitionProgressListSchema = acquisitionProgressSchema
    .array()
    .max(10000);
export function projectAcquisitionProgress(
    request: AcquisitionRequest,
): AcquisitionProgress {
    return {
        corpusId: request.corpusId,
        requestId: request.requestId,
        sourceId: request.sourceId,
        state: request.state,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        calls: request.calls,
        retries: request.retries,
        consumers: request.consumers.map(
            ({ viewId, slotId, definitionRevision }) => ({
                viewId,
                slotId,
                definitionRevision,
            }),
        ),
        hasError: Boolean(request.error),
        ...(request.receipt
            ? {
                  receipt: {
                      jobId: request.receipt.jobId,
                      revisionId: request.receipt.revisionId,
                      state: request.receipt.state,
                  },
              }
            : {}),
    };
}
export async function safeAcquisitionOperation<T>(
    operation: () => Promise<T>,
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
            /unsupported|not supported|unavailable|not configured/i.test(
                message,
            )
        )
            throw new Error(
                "Acquisition capability is unavailable on this host.",
            );
        if (/disabled/i.test(message))
            throw new Error("Acquisition is disabled by host policy.");
        throw new Error(
            "Acquisition operation failed. Request details are restricted to trusted host diagnostics.",
        );
    }
}
export const acquisitionToolNames = {
    listAcquisitionProgress: "memory_acquisitions_list",
    runAcquisitionProgress: "memory_acquisitions_run",
    cancelAcquisitionProgress: "memory_acquisition_cancel",
} as const;
