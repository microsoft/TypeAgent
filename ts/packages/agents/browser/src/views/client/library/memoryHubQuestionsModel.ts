// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AnswerSchema,
    MemoryQuestion,
    MemoryQuestionSummary,
    SchemaValue,
} from "@typeagent/memory-service";
import type { HiddenItems } from "./memoryHubModel";

export type QuestionListItem = MemoryQuestion | MemoryQuestionSummary;
export function questionCandidateCount(question: QuestionListItem): number {
    return "candidateCount" in question.details
        ? question.details.candidateCount
        : question.details.candidates.length;
}
export function questionIdentity(
    question: Pick<MemoryQuestion, "corpusId" | "viewId"> & {
        slot: { id: string };
    },
): string {
    return JSON.stringify([
        "question",
        question.corpusId,
        question.viewId,
        question.slot.id,
    ]);
}

export function questionReason(question: QuestionListItem): string | undefined {
    if (question.slot.approval === "rejected") return undefined;
    if (question.slot.approval === "proposed")
        return "Approve proposed question";
    if (question.details.answerState === "conflicted")
        return "Resolve conflicting candidates";
    if (
        ("hasUnreviewedCandidates" in question.details
            ? question.details.hasUnreviewedCandidates
            : question.details.candidates.some(
                  (candidate) => candidate.review === "unreviewed",
              )) &&
        question.slot.rubric.requireConfirmation
    )
        return "Review candidate evidence";
    if (question.details.freshness !== "current") return "Review stale answer";
    if (
        question.details.answerState === "pending" ||
        question.details.answerState === "partial"
    )
        return "Supply a missing answer";
    return undefined;
}

function priority(question: QuestionListItem): number {
    return (
        (question.details.answerState === "conflicted" ? 400 : 0) +
        (question.slot.approval === "proposed" ? 300 : 0) +
        (question.slot.rubric.requireConfirmation &&
        question.details.reviewState === "unreviewed"
            ? 200
            : 0) +
        Math.max(
            0,
            Math.min(
                100,
                Number.isFinite(question.attentionScore)
                    ? question.attentionScore
                    : 0,
            ),
        )
    );
}

export function questionAttention<T extends QuestionListItem>(
    questions: T[],
    hidden: HiddenItems,
    now = Date.now(),
    allowance = 5,
): Array<{ id: string; title: string; questions: T[] }> {
    const groups = new Map<string, T[]>();
    for (const question of [...questions].sort(
        (a, b) =>
            priority(b) - priority(a) ||
            questionIdentity(a).localeCompare(questionIdentity(b)),
    )) {
        const state = hidden[questionIdentity(question)];
        if (
            !questionReason(question) ||
            (state?.fingerprint === question.fingerprint &&
                (state.until === undefined || state.until > now))
        )
            continue;
        const key = JSON.stringify([question.corpusId, question.viewId]);
        const group = groups.get(key) ?? [];
        group.push(question);
        groups.set(key, group);
    }
    return [...groups]
        .slice(0, Math.max(0, Math.min(20, Math.floor(allowance))))
        .map(([id, items]) => ({
            id,
            title: items[0].viewTitle,
            questions: items,
        }));
}

export function validateAnswer(
    schema: AnswerSchema,
    value: unknown,
): value is SchemaValue {
    switch (schema.type) {
        case "string":
            return (
                typeof value === "string" &&
                (!schema.enum || schema.enum.includes(value))
            );
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "boolean":
            return typeof value === "boolean";
        case "object": {
            if (!value || typeof value !== "object" || Array.isArray(value))
                return false;
            const record = value as Record<string, unknown>;
            return (
                schema.required.every((key) => Object.hasOwn(record, key)) &&
                Object.entries(record).every(
                    ([key, item]) =>
                        !!schema.properties[key] &&
                        validateAnswer(schema.properties[key], item),
                )
            );
        }
    }
}

export function parseQuestionAssertion(
    question: MemoryQuestion,
    json: string,
): SchemaValue {
    const value: unknown = JSON.parse(json);
    if (!validateAnswer(question.slot.schema, value))
        throw new Error("Answer does not match the question's schema.");
    return value;
}
