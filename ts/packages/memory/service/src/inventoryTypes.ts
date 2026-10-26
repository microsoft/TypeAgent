// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryPage } from "./types.js";
import type { MemoryQuestion, QuestionInventory } from "./schemaViewTypes.js";

export interface InventoryPageRequest {
    corpusId: string;
    pageSize?: number;
    continuationToken?: string;
    query?: string;
    viewId?: string;
}

export interface QuestionSummaryRequest extends InventoryPageRequest {
    answerFilter?: "open" | "answered";
    attentionOnly?: boolean;
}

export interface QuestionReadRequest {
    corpusId: string;
    viewId: string;
    slotId: string;
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
