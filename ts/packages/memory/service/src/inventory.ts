// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryQuestion } from "./schemaViewTypes.js";
import type {
    MemoryQuestionSummary,
    ViewBuildSummary,
    InventoryPageRequest,
} from "./inventoryTypes.js";
import type { ViewBuildJob } from "./viewTypes.js";

export function validateInventoryPage(request: InventoryPageRequest): void {
    if (
        request.viewId !== undefined &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(request.viewId)
    )
        throw new Error("Invalid inventory view ID");
    if (
        request.pageSize !== undefined &&
        (!Number.isInteger(request.pageSize) ||
            request.pageSize < 1 ||
            request.pageSize > 100)
    )
        throw new Error("Inventory pageSize must be an integer from 1 to 100");
    if (
        request.query !== undefined &&
        (typeof request.query !== "string" || request.query.length > 1000)
    )
        throw new Error("Inventory query must be at most 1000 characters");
}

export function questionSummary(
    question: MemoryQuestion,
): MemoryQuestionSummary {
    const { slot, details } = question;
    return {
        corpusId: question.corpusId,
        viewId: question.viewId,
        viewTitle: question.viewTitle,
        attentionScore: question.attentionScore,
        fingerprint: question.fingerprint,
        slot: {
            id: slot.id,
            question: slot.question,
            approval: slot.approval,
            rubric: { requireConfirmation: slot.rubric.requireConfirmation },
            discoveryCitationCount: slot.discoveryCitations.length,
        },
        details: {
            answerState: details.answerState,
            reviewState: details.reviewState,
            freshness: details.freshness,
            candidateCount: details.candidates.length,
            hasUnreviewedCandidates: details.candidates.some(
                (candidate) => candidate.review === "unreviewed",
            ),
        },
    };
}

export function questionNeedsAttention(
    question: MemoryQuestionSummary,
): boolean {
    if (question.slot.approval === "rejected") return false;
    return (
        question.slot.approval === "proposed" ||
        question.details.answerState !== "answered" ||
        question.details.freshness !== "current" ||
        (question.slot.rubric.requireConfirmation &&
            question.details.hasUnreviewedCandidates)
    );
}

export function buildSummary(
    job: ViewBuildJob,
    latest?: ReadonlyMap<string, string>,
): ViewBuildSummary {
    return {
        jobId: job.jobId,
        corpusId: job.corpusId,
        state: job.state,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        maintenance: !!job.maintenancePlan,
        results: job.results.map((result) => ({
            viewId: result.viewId,
            state: result.state,
            reason: result.reason,
            current: !latest || latest.get(result.viewId) === job.jobId,
            ...(result.revisionId ? { revisionId: result.revisionId } : {}),
            ...(result.conflictId ? { conflictId: result.conflictId } : {}),
            snapshot: {
                pipeline: result.snapshot.pipeline,
                definition: { kind: result.snapshot.definition.kind },
            },
        })),
    };
}
