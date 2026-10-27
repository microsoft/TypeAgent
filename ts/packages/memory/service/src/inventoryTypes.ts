// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryPage } from "./types.js";
import type { MemoryQuestion, QuestionInventory } from "./schemaViewTypes.js";
import type {
    ViewBuildJob,
    ViewBuildTargetResult,
    ViewBuildSnapshot,
    ViewMergeConflict,
    ViewDefinition,
    ViewPublicationStatus,
    ViewSnapshot,
    ViewVersion,
} from "./viewTypes.js";

export interface InventoryPageRequest {
    corpusId: string;
    pageSize?: number;
    continuationToken?: string;
    query?: string;
    viewId?: string;
}
export interface ViewSummaryRequest extends InventoryPageRequest {
    kind?: ViewDefinition["kind"];
}
export interface QuestionSummaryRequest extends InventoryPageRequest {
    viewId?: string;
    answerFilter?: "open" | "answered";
    attentionOnly?: boolean;
}
export interface QuestionReadRequest {
    corpusId: string;
    viewId: string;
    slotId: string;
}
export interface ViewSummary
    extends Pick<ViewVersion, "corpusId" | "viewId" | "revisionId" | "state"> {
    content: Pick<ViewVersion["content"], "kind" | "title">;
    maintained: boolean;
    publication: ViewPublicationStatus;
}
export interface ViewSummaryPage
    extends MemoryPage<ViewSummary>,
        Pick<ViewSnapshot, "head" | "wikiFamily" | "projectFamily"> {
    latestBuild?: Pick<ViewBuildJob, "jobId" | "corpusId" | "state">;
}
export interface MemoryQuestionSummary
    extends Pick<
        MemoryQuestion,
        "corpusId" | "viewId" | "viewTitle" | "attentionScore" | "fingerprint"
    > {
    slot: Pick<MemoryQuestion["slot"], "id" | "question" | "approval"> & {
        rubric: Pick<MemoryQuestion["slot"]["rubric"], "requireConfirmation">;
        discoveryCitationCount: number;
    };
    details: Pick<
        MemoryQuestion["details"],
        "answerState" | "reviewState" | "freshness"
    > & {
        candidateCount: number;
        hasUnreviewedCandidates: boolean;
    };
}
export interface QuestionSummaryPage
    extends MemoryPage<MemoryQuestionSummary>,
        Pick<QuestionInventory, "head" | "maintenanceError"> {}
export interface ViewBuildResultSummary
    extends Pick<
        ViewBuildTargetResult,
        "viewId" | "state" | "reason" | "revisionId" | "conflictId"
    > {
    current: boolean;
    conflictState?: ViewMergeConflict["state"] | "missing";
    snapshot: Pick<ViewBuildSnapshot, "pipeline"> & {
        definition: Pick<ViewDefinition, "kind">;
    };
}
export interface ViewBuildSummary
    extends Pick<
        ViewBuildJob,
        "jobId" | "corpusId" | "createdAt" | "updatedAt" | "state"
    > {
    maintenance: boolean;
    results: ViewBuildResultSummary[];
}
export interface ViewPublicationBatchRequest {
    corpusId: string;
    viewIds: string[];
}
export interface MemoryInventoryService {
    listViewSummaries(request: ViewSummaryRequest): Promise<ViewSummaryPage>;
    listQuestionSummaries(
        request: QuestionSummaryRequest,
    ): Promise<QuestionSummaryPage>;
    getQuestion(
        request: QuestionReadRequest,
    ): Promise<MemoryQuestion | undefined>;
    listViewBuildSummaries(
        request: InventoryPageRequest,
    ): Promise<MemoryPage<ViewBuildSummary>>;
    getViewPublications(
        request: ViewPublicationBatchRequest,
    ): Promise<ViewPublicationStatus[]>;
}
