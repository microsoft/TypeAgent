// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProjectBriefDetails,
    ViewVersion,
    TimelineRecordDetails,
} from "./viewTypes.js";

export function timelineRecordText(details: TimelineRecordDetails): string {
    return [
        `Record: ${details.identity.kind === "canonicalEvent" ? details.identity.eventId : `${details.identity.sourceRecordId} (document-derived identity)`}`,
        `Type: ${details.eventType}; state: ${details.state}; outcome: ${details.outcome ?? "unknown"}`,
        `Occurred: ${details.occurredAt ?? "unknown"}`,
        `Learned: ${details.learnedAt ?? "unknown"}`,
        `Captured: ${details.capturedAt ?? "unknown"}`,
    ].join("\n");
}

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
        ...(content.kind === "timeline"
            ? [`Generated: ${content.generatedAt}`]
            : []),
        ...content.sections.map((section) =>
            [
                `## ${section.heading}`,
                section.details
                    ? section.details.kind === "event"
                        ? timelineRecordText(section.details)
                        : section.details.kind === "page"
                          ? `Page: ${section.id}; taxonomy: ${section.details.taxonomy}`
                          : projectBriefDetailsText(section.details)
                    : "",
                section.body,
            ]
                .filter(Boolean)
                .join("\n\n"),
        ),
    ].join("\n\n");
}
