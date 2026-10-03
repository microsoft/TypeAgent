// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryBatchImport,
    RunbookJobResult,
    RunbookSynthesisRequest,
} from "@typeagent/memory-service";

export type RunbookImportKind = "folder" | "wiki" | "urls";
export interface RunbookImportFile {
    relativePath: string;
    contentBase64: string;
    mimeType?: string;
    description?: string;
}
export type RunbookImportRequest =
    | {
          corpusId: string;
          idempotencyKey: string;
          kind: "folder" | "wiki";
          files: RunbookImportFile[];
      }
    | {
          corpusId: string;
          idempotencyKey: string;
          kind: "urls";
          urls: string[];
      };

export interface RunbookAcquisitionIssue {
    member: string;
    inputIndex?: number;
    state: "rejected" | "warning";
    reason: string;
}
export interface RunbookImportResponse {
    batch?: RunbookImportBatch;
    acquisition: RunbookAcquisitionIssue[];
    warnings: string[];
}
export interface RunbookBatchRequest {
    corpusId: string;
    batchId: string;
}
export type RunbookImportMember = MemoryBatchImport["members"][number] & {
    canonicalUri?: string;
};
export interface RunbookImportBatch extends MemoryBatchImport {
    members: RunbookImportMember[];
}
export interface MemoryHubRunbookImportFunctions {
    memoryHubStartRunbookImport(
        request: RunbookImportRequest,
    ): Promise<RunbookImportResponse>;
    memoryHubRunbookBatches(request: {
        corpusId: string;
    }): Promise<RunbookImportBatch[]>;
    memoryHubRunbookBatch(
        request: RunbookBatchRequest,
    ): Promise<RunbookImportBatch>;
    memoryHubRetryRunbookBatch(
        request: RunbookBatchRequest,
    ): Promise<RunbookImportBatch>;
    memoryHubCancelRunbookBatch(
        request: RunbookBatchRequest,
    ): Promise<RunbookImportBatch>;
    memoryHubRunbookJobs(request: {
        corpusId: string;
    }): Promise<RunbookJobResult[]>;
    memoryHubRetryRunbookSynthesis(
        request: RunbookSynthesisRequest,
    ): Promise<RunbookJobResult>;
}

export const runbookImportLimits = {
    gatewayBytes: 10 * 1024 * 1024,
    coreBytes: 8 * 1024 * 1024,
    revisionAssetBytes: 6 * 1024 * 1024,
    documents: 50,
    selectedFiles: 200,
} as const;
