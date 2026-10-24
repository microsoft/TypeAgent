// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewCitation,
    ViewHistoryEntry,
    ViewReadRequest,
    ViewSaveRequest,
    ViewSection,
} from "./viewTypes.js";
import type { ViewMaintenanceDefinition } from "./viewMaintenanceTypes.js";

export type SchemaValue =
    | string
    | number
    | boolean
    | null
    | SchemaValue[]
    | { [key: string]: SchemaValue };

export type AnswerSchema =
    | { type: "string"; enum?: string[] }
    | { type: "number" }
    | { type: "boolean" }
    | {
          type: "object";
          properties: Record<string, AnswerSchema>;
          required: string[];
      };

export interface QuestionRubric {
    version: number;
    selection: "mostRecent" | "independentSupport" | "manual";
    requireConfirmation: boolean;
    authoritySourceIds: string[];
    freshnessDays?: number;
}

export interface QuestionSlot {
    id: string;
    question: string;
    cardinality: "singleton" | "record" | "collection";
    schema: AnswerSchema;
    itemKey?: string;
    rubric: QuestionRubric;
    approval: "proposed" | "approved" | "rejected";
    discoveryCitations: ViewCitation[];
}

export interface SchemaViewDefinition {
    construction: "schema-defined-v1";
    title: string;
    slots: QuestionSlot[];
    template: "questions-v1";
    discovery: {
        enabled: boolean;
        maxProposals: number;
        lastEvaluatedScope?: string;
    };
}

export interface AnswerCandidate {
    id: string;
    value: SchemaValue;
    itemKey?: string;
    origin: "source" | "user";
    review: "unreviewed" | "confirmed" | "rejected";
    citations: ViewCitation[];
    opposingCitations: ViewCitation[];
    effectiveAt?: string;
    assertionOwner?: string;
    independenceKey?: string;
    derivedFrom: string[];
    support: Array<{
        citation: ViewCitation;
        independenceKey?: string;
        assertionOwner?: string;
        effectiveAt?: string;
        derivedFrom: string[];
    }>;
}

export interface QuestionDetails {
    kind: "question";
    slotId: string;
    candidates: AnswerCandidate[];
    selectedCandidateIds: string[];
    answerState: "pending" | "partial" | "answered" | "conflicted";
    reviewState: "unreviewed" | "confirmed" | "rejected";
    freshness: "current" | "stale" | "expired";
    coverage: "unknown" | "partial";
    evaluatedSources: Array<{ sourceId: string; revisionId: string }>;
    scopeFingerprint: string;
}

export type QuestionSection = Omit<ViewSection, "role" | "details"> & {
    role: "question";
    details: QuestionDetails;
};

export interface SchemaViewContent {
    kind: "schemaView";
    construction: "schema-defined-v1";
    title: string;
    summary?: string;
    sections: QuestionSection[];
    citations: ViewCitation[];
    agentEdition?: never;
}

export interface MemoryQuestion {
    corpusId: string;
    viewId: string;
    viewTitle: string;
    viewVersion: number;
    viewRevisionId: string;
    definitionRevision: string;
    slot: QuestionSlot;
    details: QuestionDetails;
    attentionScore: number;
    fingerprint: string;
}

export interface QuestionInventory {
    head: string | null;
    items: MemoryQuestion[];
    maintenanceError?: string;
}

export type QuestionEdit =
    | { kind: "slot"; slot: QuestionSlot }
    | { kind: "discovery"; enabled: boolean; maxProposals: number }
    | {
          kind: "review";
          candidateId: string;
          review: AnswerCandidate["review"];
      }
    | { kind: "assert"; value: SchemaValue; itemKey?: string }
    | { kind: "approval"; approval: QuestionSlot["approval"] };

export interface QuestionEditRequest {
    corpusId: string;
    viewId: string;
    slotId: string;
    expectedHead: string | null;
    expectedVersion: number;
    edit: QuestionEdit;
}

export interface SchemaViewPageRequest extends ViewReadRequest {
    slotId?: string;
    itemKey?: string;
}

export interface SchemaViewPage {
    uri: string;
    revisionId: string;
    markdown: string;
}

export interface SchemaViewProposalRequest {
    corpusId: string;
    viewId: string;
    expectedHead: string | null;
    expectedVersion: number;
    specification: string;
    maintenance: ViewMaintenanceDefinition;
}

export interface SchemaQuestionDiscoveryRequest {
    corpusId: string;
    viewId: string;
    expectedHead: string | null;
    expectedVersion: number;
}

export interface MemorySchemaViewService {
    listQuestions(corpusId: string): Promise<QuestionInventory>;
    editQuestion(request: QuestionEditRequest): Promise<ViewHistoryEntry>;
    getViewPage(request: SchemaViewPageRequest): Promise<SchemaViewPage>;
    proposeSchemaView(
        request: SchemaViewProposalRequest,
    ): Promise<ViewHistoryEntry>;
    discoverSchemaQuestions(
        request: SchemaQuestionDiscoveryRequest,
    ): Promise<ViewHistoryEntry>;
}

export type SchemaViewDraft = ViewSaveRequest & {
    content: SchemaViewContent;
};
