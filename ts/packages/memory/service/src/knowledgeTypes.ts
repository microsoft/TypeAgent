// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QuestionSlot } from "./schemaViewTypes.js";
import type { ViewCitation } from "./viewTypes.js";

export type DiscoveryPolicy = "off" | "suggest" | "sourceObserved";
export type KnowledgeFamily = "questions" | "wiki" | "projects" | "topics";
export interface KnowledgeSource {
    sourceId: string;
    revisionId: string;
}
export interface CorpusQuestionInput {
    corpusId: string;
    fingerprint: string;
    passages: Array<ViewCitation & { passageId: string; title: string }>;
    existingQuestions: string[];
    existingContracts?: QuestionSlot[];
    existingContractCount?: number;
    maxProposals: number;
}
export interface CorpusQuestionProposal {
    subject: string;
    reason: string;
    slot: QuestionSlot;
    utility?: {
        consumerValue: number;
        substance: number;
        novelty: number;
        durability: number;
    };
}
export interface DiscoveryReceipt {
    fingerprint: string;
    adapterIdentity?: string;
    sources: KnowledgeSource[];
    state: "running" | "complete" | "failed" | "deferred";
    attempts: number;
    startedAt: string;
    completedAt?: string;
    proposals?: CorpusQuestionProposal[];
    processedProposals?: number;
    viewIds: string[];
    reason?: string;
}
export interface DiscoveryRoute {
    viewId: string;
    subject: string;
    terms: string[];
    sourceIds: string[];
    detached?: boolean;
}
export interface KnowledgeDiscoveryState {
    version: 1;
    policy: DiscoveryPolicy;
    policyVersion: 1;
    receipts: DiscoveryReceipt[];
    routes: DiscoveryRoute[];
    callTimes: number[];
    error?: string;
}
export interface KnowledgeDiscoveryUpdate {
    corpusId: string;
    policy: DiscoveryPolicy;
    retryFailed?: boolean;
}
export interface KnowledgeCheckpointRequest {
    corpusId: string;
    sourceIds?: string[];
    families?: KnowledgeFamily[];
    producerComplete?: boolean;
    timeoutMs?: number;
}
export type KnowledgeCheckpointState =
    | "pending"
    | "running"
    | "ready"
    | "partial"
    | "blocked"
    | "failed"
    | "superseded"
    | "cancelled";
export interface KnowledgeCheckpoint {
    version: 1;
    checkpointId: string;
    corpusId: string;
    createdAt: string;
    updatedAt: string;
    state: KnowledgeCheckpointState;
    sources: KnowledgeSource[];
    families: KnowledgeFamily[];
    excludedFamilies: KnowledgeFamily[];
    producerComplete: boolean;
    indexVersion: string;
    viewIds: string[];
    jobIds: string[];
    viewRevisions?: Array<{ viewId: string; revisionId: string }>;
    discoveryFingerprints: string[];
    coverage: { inspectedSources: number; deferredSources: number };
    reasons: string[];
}
export interface KnowledgeCheckpointRead {
    corpusId: string;
    checkpointId: string;
}
export interface KnowledgeCheckpointWait extends KnowledgeCheckpointRead {
    timeoutMs?: number;
}
export interface KnowledgeStatus {
    discovery: KnowledgeDiscoveryState;
    checkpoints: KnowledgeCheckpoint[];
}
export interface MemoryKnowledgeService {
    getKnowledgeStatus(corpusId: string): Promise<KnowledgeStatus>;
    updateKnowledgeDiscovery(
        request: KnowledgeDiscoveryUpdate,
    ): Promise<KnowledgeStatus>;
    createKnowledgeCheckpoint(
        request: KnowledgeCheckpointRequest,
    ): Promise<KnowledgeCheckpoint>;
    getKnowledgeCheckpoint(
        request: KnowledgeCheckpointRead,
    ): Promise<KnowledgeCheckpoint>;
    waitForKnowledgeCheckpoint(
        request: KnowledgeCheckpointWait,
    ): Promise<KnowledgeCheckpoint>;
}

export const knowledgeLimits = {
    windowPassages: 24,
    windowSources: 32,
    windowChars: 24000,
    windows: 3,
    proposals: 6,
    admissions: 8,
    liveSlots: 64,
    callsPerHour: 12,
    callTimeoutMs: 120000,
    coalesceMs: 2000,
    maxDelayMs: 15000,
} as const;
