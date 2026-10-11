// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function projectSummaryTestResponse(fragments: Array<{ text: string }>) {
    return {
        title: "Payments reliability",
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
    };
}
