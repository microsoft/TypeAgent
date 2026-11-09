// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function projectSummaryTestResponse(fragments: Array<{ text: string }>) {
    return {
        title: "Payments reliability",
        summary:
            "Payments reliability remains active with the incident closed while peak-load capacity validation awaits owner review.",
        completeness: "partial",
        goalsScope: fragments.map((fragment) => fragment.text).join("\n\n"),
        owners: "Capacity validation owner unknown.",
        status: "Project active; incident closed; capacity pending owner review.",
        milestones: "Peak-load rehearsal proposed; date unknown.",
        decisions: "Query explanation rejected.",
        risks: "Headroom remains an open question.",
        context: "Project knowledge as-of unknown.",
        limits: "Only selected indexed fragments were retrieved.",
        citationIds: fragments.map((_, position) => `f${position}`),
        projectState: "active",
        incidentState: "closed",
        capacityState: "pendingOwnerReview",
        assignments: [
            {
                id: "capacity-validation",
                responsibility: "Capacity validation",
                state: "unknown",
                owner: null,
            },
        ],
        milestoneItems: [
            {
                id: "peak-load-rehearsal",
                status: "proposed",
                date: null,
            },
        ],
        decisionItems: [
            {
                id: "query-explanation",
                status: "rejected",
            },
        ],
        openQuestions: ["What is the peak-load memory headroom?"],
        riskItems: [
            {
                id: "pool-headroom",
                status: "open",
            },
        ],
    };
}
