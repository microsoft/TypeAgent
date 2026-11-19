// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const supportStatuses = [
    "supported",
    "partiallySupported",
    "unsupported",
    "uncertain",
    "not_asserted",
] as const;
export type ViewSupportStatus = (typeof supportStatuses)[number];
export const supportCategories = [
    "quantity",
    "statistic-cohort",
    "command-lease",
    "scope-state",
    "correction-withdrawal",
    "coverage",
    "newContentSupport",
    "coverageNoteSupport",
    "preservation",
] as const;
export interface ViewSupportDecision {
    category: (typeof supportCategories)[number];
    status: ViewSupportStatus;
    choiceConfidence?: number;
}
export interface ViewSupportQuality {
    status: Exclude<ViewSupportStatus, "not_asserted">;
    confidence: number;
    unresolvedCategories: ViewSupportDecision["category"][];
    decisions: ViewSupportDecision[];
}

// Ordinal policy scores, not calibrated probabilities of truth. Provider choice
// confidence never raises factual support; the least-supported applicable check wins.
const scores: Record<ViewSupportStatus, number> = {
    supported: 1,
    partiallySupported: 0.5,
    uncertain: 0.25,
    unsupported: 0,
    not_asserted: 1,
};

export function supportQuality(
    decisions: ViewSupportDecision[],
): ViewSupportQuality {
    if (
        !decisions.length ||
        decisions.length > supportCategories.length ||
        new Set(decisions.map((item) => item.category)).size !==
            decisions.length ||
        decisions.some(
            (item) =>
                !item ||
                typeof item !== "object" ||
                Object.keys(item).some(
                    (key) =>
                        !["category", "status", "choiceConfidence"].includes(
                            key,
                        ),
                ) ||
                !supportCategories.includes(item.category) ||
                !supportStatuses.includes(item.status) ||
                (item.choiceConfidence !== undefined &&
                    (!Number.isFinite(item.choiceConfidence) ||
                        item.choiceConfidence < 0 ||
                        item.choiceConfidence > 1)),
        )
    )
        throw new Error("Invalid support decisions");
    const applicable = decisions.filter(
        (item) => item.status !== "not_asserted",
    );
    const weakest = applicable.reduce<ViewSupportStatus>(
        (status, item) =>
            scores[item.status] < scores[status] ? item.status : status,
        applicable.length ? "supported" : "uncertain",
    ) as ViewSupportQuality["status"];
    return {
        status: weakest,
        confidence: scores[weakest],
        unresolvedCategories: decisions
            .filter(
                (item) =>
                    item.status !== "supported" &&
                    item.status !== "not_asserted",
            )
            .map((item) => item.category),
        decisions: structuredClone(decisions),
    };
}

export function incompletePreservation(
    quality: ViewSupportQuality | undefined,
): boolean {
    if (!quality) return false;
    return (
        quality.decisions.find((item) => item.category === "preservation")
            ?.status !== "supported"
    );
}

export function worstSupportQuality(
    ...values: Array<ViewSupportQuality | undefined>
): ViewSupportQuality | undefined {
    return values
        .filter((value): value is ViewSupportQuality => value !== undefined)
        .map(parseSupportQuality)
        .reduce<ViewSupportQuality | undefined>(
            (prior, next) =>
                !prior || next.confidence < prior.confidence ? next : prior,
            undefined,
        );
}

export function parseSupportQuality(value: unknown): ViewSupportQuality {
    if (!value || typeof value !== "object")
        throw new Error("Invalid support quality");
    const raw = value as Record<string, unknown>;
    if (
        Object.keys(raw).some(
            (key) =>
                ![
                    "status",
                    "confidence",
                    "unresolvedCategories",
                    "decisions",
                ].includes(key),
        ) ||
        !Array.isArray(raw.decisions)
    )
        throw new Error("Invalid support quality");
    const quality = supportQuality(raw.decisions);
    if (
        raw.status !== quality.status ||
        raw.confidence !== quality.confidence ||
        JSON.stringify(raw.unresolvedCategories) !==
            JSON.stringify(quality.unresolvedCategories)
    )
        throw new Error("Inconsistent support quality");
    return quality;
}
