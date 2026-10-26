// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AcquisitionRequest } from "@typeagent/memory-service";
import type { MemoryAcquisitionProgress } from "@typeagent/browser-control-rpc/serviceTypes";

export function acquisitionProgress(
    request: AcquisitionRequest,
): MemoryAcquisitionProgress {
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

export async function acquisitionOperation<T>(
    operation: () => Promise<T>,
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/unavailable|unsupported|not configured/i.test(message))
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
