// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QuestionInventory } from "./schemaViewTypes.js";
import type {
    DocumentIngestRequest,
    DocumentIngestResult,
    IngestionJobStatus,
    MemorySource,
} from "./types.js";

export interface AcquisitionConsumer {
    viewId: string;
    slotId: string;
    definitionRevision: string;
}

export interface AcquisitionRequestInput {
    corpusId: string;
    principalId: string;
    policyId: string;
    toolId: string;
    resourceIdentity: string;
    scopeFingerprint: string;
    sourceTags?: string[];
    sourceProject?: string;
    authorizedArguments: Record<string, unknown>;
    consumers: AcquisitionConsumer[];
    lineage: { rootId: string; maxCalls: number };
    maxCalls?: number;
}

export type AcquisitionState =
    | "pending"
    | "deferred"
    | "fetching"
    | "acquired"
    | "ingesting"
    | "ingested"
    | "resolved"
    | "cancelled"
    | "failed";

export interface AcquisitionRequest extends AcquisitionRequestInput {
    requestId: string;
    sourceId: string;
    identity: string;
    lineageIdentity: string;
    state: AcquisitionState;
    createdAt: string;
    updatedAt: string;
    calls: number;
    retries: number;
    fence: number;
    lease?: { owner: string; expiresAt: number };
    staged?: DocumentIngestRequest;
    receipt?: DocumentIngestResult;
    error?: string;
}

export interface AcquisitionReadiness {
    authorityValid: boolean;
    scopeEvaluated: boolean;
    pendingJobIds: string[];
    pendingBatchIds: string[];
    consumers: Array<
        AcquisitionConsumer & { status: "missing" | "resolved" | "obsolete" }
    >;
}

export interface DeferredAcquisitionHost {
    listQuestions(corpusId: string): Promise<QuestionInventory>;
    /** Validate definition revisions and host-owned authority; callable inside the barrier without reacquiring it. */
    inspect(request: AcquisitionRequest): Promise<AcquisitionReadiness>;
    /** Serialize final authority checks and admission with existing removal barriers. */
    withAdmissionBarrier<T>(
        corpusId: string,
        operation: () => Promise<T>,
    ): Promise<T>;
    /** Runs inside the barrier; the adapter must not recursively reserve that barrier. */
    admit(request: DocumentIngestRequest): Promise<DocumentIngestResult>;
    getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined>;
    getJob(jobId: string): Promise<IngestionJobStatus | undefined>;
}

export interface AcquisitionTool {
    id: string;
    /** Interrupted calls can repeat before durable staging; provider idempotency is not assumed. */
    read(
        authorizedArguments: Record<string, unknown>,
        signal: AbortSignal,
    ): Promise<{
        title: string;
        text: string;
        canonicalUri?: string;
        authoredAt?: string;
        sourceModifiedAt?: string;
    }>;
}

export interface DeferredAcquisitionConfig {
    toolsEnabled?: boolean;
    periodicEnabled?: boolean;
    tools?: AcquisitionTool[];
    maxRequests?: number;
    maxCallsPerRequest?: number;
    maxLineageCalls?: number;
    maxRetries?: number;
    maxBytes?: number;
    maxDurationMs?: number;
    maxConcurrency?: number;
}

export interface AcquisitionRemoval {
    sourceIds?: string[];
    viewIds?: string[];
    identities?: string[];
    /** Uncertain upstream matching denies subsequent automatic acquisition. */
    uncertain?: boolean;
}

export interface AcquisitionPeriodicOptions {
    corpusIds: string[];
    intervalMs: number;
    maxTicks: number;
    onError?: (error: unknown) => void;
}

export interface MemoryAcquisitionService {
    requestAcquisition(
        request: AcquisitionRequestInput,
    ): Promise<AcquisitionRequest>;
    listAcquisitions(corpusId: string): Promise<AcquisitionRequest[]>;
    cancelAcquisition(request: {
        corpusId: string;
        requestId: string;
    }): Promise<AcquisitionRequest>;
    runAcquisitions(corpusId: string): Promise<AcquisitionRequest[]>;
    startAcquisitionPeriodic(
        options: AcquisitionPeriodicOptions,
    ): Promise<void>;
}
