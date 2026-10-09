// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProjectBriefDetails, ViewVersion } from "./viewTypes.js";

export function projectBriefDetailsText(details: ProjectBriefDetails): string {
    switch (details.kind) {
        case "goalsScope":
            return "";
        case "owners":
            return details.assignments
                .map(
                    (entry) =>
                        `${entry.responsibility}: ${entry.owner ?? (entry.state === "unassigned" ? "Unassigned" : "Unknown")} (${entry.state})`,
                )
                .join("\n");
        case "status":
            return [
                `Project: ${details.project}`,
                `Incident: ${details.incident} (distinct from project completion)`,
                `Capacity: ${details.capacity === "pendingOwnerReview" ? "BLOCKED pending owner review" : details.capacity}`,
            ].join("\n");
        case "milestones":
            return details.items
                .map(
                    (entry, index) =>
                        `Milestone ${index + 1}: ${entry.status}; date ${entry.date ?? "unknown"}`,
                )
                .join("\n");
        case "decisions":
            return details.items
                .map((entry, index) => `Decision ${index + 1}: ${entry.status}`)
                .join("\n");
        case "risks":
            return details.items
                .map((entry, index) => `Risk ${index + 1}: ${entry.status}`)
                .join("\n");
        case "context":
            return `Project knowledge as-of: ${details.asOf ?? "unknown"} (${details.basis}). Generation/source capture times are distinct.`;
    }
}

export function viewContentToText(content: ViewVersion["content"]): string {
    return [
        content.title,
        content.summary ?? "",
        ...content.sections.map((section) =>
            [
                `## ${section.heading}`,
                section.details ? projectBriefDetailsText(section.details) : "",
                section.body,
            ]
                .filter(Boolean)
                .join("\n\n"),
        ),
    ].join("\n\n");
}
