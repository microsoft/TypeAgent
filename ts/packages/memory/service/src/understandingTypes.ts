// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import type { IntegratedAnswerReader } from "./integratedAnswer.js";
import type {
    AnswerEvidence,
    AnswerDerivedReference,
    AnswerAssertionReference,
    MemoryAnswerRequest,
    MemoryAnswerResult,
    MemoryEvidence,
} from "./types.js";
import type {
    MemoryGraphService,
    MemoryGraphQueryResult,
    MemoryGraphSupport,
} from "./graphTypes.js";

export type UnderstandingModuleKind =
    | "explanation"
    | "timeline"
    | "relationships"
    | "concepts"
    | "sources";

export interface UnderstandingRequest {
    requestId?: string | undefined;
    evidenceSnapshotId?: string | undefined;
    phase?: "preview" | "retrieve" | "initial" | "refine" | undefined;
    corpusId: string;
    question: string;
    source?: { sourceId: string; revisionId: string } | undefined;
    retrievalPolicy?: MemoryAnswerRequest["retrievalPolicy"];
    knowledgeCheckpointId?: string | undefined;
    parentSnapshotId?: string | undefined;
    parentTurnId?: string | undefined;
    selection?:
        | {
              mode: "auto" | "only";
              modules?: UnderstandingModuleKind[] | undefined;
          }
        | undefined;
    focus?: { nodeId: string; generation: string } | undefined;
}

export interface UnderstandingClaim {
    text: string;
    evidenceIds: string[];
    role: "memory";
}

export interface UnderstandingAnswer {
    status: "answered" | "partial" | "noAnswer" | "needsClarification";
    title: string;
    summary: UnderstandingClaim;
    sections: { title: string; claims: UnderstandingClaim[] }[];
    unknowns: string[];
    followUps: string[];
}

export interface UnderstandingSignal {
    kind: "timeline" | "relationships" | "concepts";
    reason: "evolution" | "relatedEntity" | "usefulContext";
    evidenceIds: string[];
    candidateIds: string[];
}

export interface UnderstandingReaderResult extends UnderstandingAnswer {
    schemaVersion: 1;
    moduleSignals: UnderstandingSignal[];
    retrievalQueries: string[];
}

export type UnderstandingCitation =
    | { id: string; kind: "source"; source: MemoryEvidence }
    | {
          id: string;
          kind: "derived";
          reference: AnswerDerivedReference;
      }
    | {
          id: string;
          kind: "userAssertion";
          reference: AnswerAssertionReference;
      };

export interface UnderstandingDate {
    id: string;
    evidenceId: string;
    date: string;
    kind: "sourceSession" | "event";
    precision: string;
    label: string;
}

export interface UnderstandingEntity {
    id: string;
    nodeId: string;
    label: string;
    generation: string;
}

export interface UnderstandingCandidates {
    dates: UnderstandingDate[];
    entities: UnderstandingEntity[];
    warnings: string[];
}

export interface UnderstandingModule {
    kind: UnderstandingModuleKind;
    status: "ready" | "planned" | "unavailable";
    reason?: string;
}

export interface UnderstandingResult {
    provisional?: boolean;
    refinementFailed?: boolean;
    previousAnswer?: { text: string; evidenceIds: string[] };
    evidenceSnapshotId?: string;
    refinementPending?: boolean;
    schemaVersion: 1;
    snapshotId: string;
    turnId: string;
    corpusId: string;
    question: string;
    expiresAt: string;
    answer?: UnderstandingAnswer;
    citations: UnderstandingCitation[];
    modules: UnderstandingModule[];
    warnings: string[];
}

export interface UnderstandingModuleRequest {
    requestId?: string | undefined;
    corpusId: string;
    snapshotId: string;
    kind: "timeline" | "relationships" | "concepts" | "sources";
}

export interface UnderstandingModuleResult {
    schemaVersion: 1;
    snapshotId: string;
    corpusId: string;
    kind: UnderstandingModuleRequest["kind"];
    status: "ready" | "partial" | "unavailable";
    reason?: string;
    timeline?: UnderstandingDate[];
    concepts?: UnderstandingEntity[];
    graph?: MemoryGraphQueryResult;
    support?: { edgeId: string; items: MemoryGraphSupport[] }[];
    citations: UnderstandingCitation[];
}

export interface MemoryUnderstandingService {
    cancelUnderstanding?(request: {
        corpusId: string;
        requestId: string;
    }): Promise<boolean>;
    understand?(request: UnderstandingRequest): Promise<UnderstandingResult>;
    understandingModule?(
        request: UnderstandingModuleRequest,
    ): Promise<UnderstandingModuleResult>;
}

export interface UnderstandingHost extends MemoryGraphService {
    validateSource?(
        corpusId: string,
        source: NonNullable<UnderstandingRequest["source"]>,
    ): Promise<boolean>;
    validateSnapshot?(
        request: MemoryAnswerRequest,
        evidence: AnswerEvidence[],
        indexVersion: string | undefined,
        leaseExpiresAt?: number | undefined,
    ): Promise<boolean>;
    evidenceLeaseExpiresAt?(id: string): number | undefined;
    preview?(request: MemoryAnswerRequest): Promise<MemoryEvidence[]>;
    indexVersion?(corpusId: string): Promise<string>;
    answer(
        request: MemoryAnswerRequest,
        reader: IntegratedAnswerReader,
    ): Promise<MemoryAnswerResult>;
    validate(
        request: MemoryAnswerRequest,
        evidence: AnswerEvidence[],
    ): Promise<boolean>;
    validateSupport?(items: MemoryGraphSupport[]): Promise<boolean>;
}

export interface UnderstandingOptions {
    initialEndpoint?: string | undefined;
    briefInitial?: boolean;
    parallelGraphSupport?: boolean;
    refinementFallback?: boolean;
    model?: ChatModel | undefined;
    endpoint?: string | undefined;
    now?: () => number;
}
