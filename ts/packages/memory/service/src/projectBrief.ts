// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProjectBriefContent, ProjectBriefDetails } from "./viewTypes.js";
import {
    evidenceArray,
    evidenceChoice,
    evidenceRecord,
    evidenceText,
} from "./viewSynthesisEvidence.js";
import { factStatuses } from "./viewInventory.js";

export const projectBriefRoles = [
    "goalsScope",
    "owners",
    "status",
    "milestones",
    "decisions",
    "risks",
    "context",
] as const;

function nullableText(value: unknown): string | null {
    return value === null ? null : evidenceText(value);
}

export function parseProjectBriefDetails(value: unknown): ProjectBriefDetails {
    const raw = evidenceRecord(value);
    const kind = evidenceChoice(raw.kind, projectBriefRoles);
    const items = (keys: string[]) =>
        evidenceArray(raw.items, 128).map((value) => {
            const entry = evidenceRecord(value);
            if (Object.keys(entry).some((key) => !keys.includes(key)))
                throw new Error("Unsupported project item field");
            return entry;
        });
    let result: ProjectBriefDetails;
    switch (kind) {
        case "goalsScope":
            result = { kind };
            break;
        case "owners":
            result = {
                kind,
                assignments: evidenceArray(raw.assignments, 128).map(
                    (value) => {
                        const entry = evidenceRecord(value);
                        const assignment = {
                            id: evidenceText(entry.id),
                            responsibility: evidenceText(entry.responsibility),
                            state: evidenceChoice(entry.state, [
                                "known",
                                "unknown",
                                "unassigned",
                            ] as const),
                            owner: nullableText(entry.owner),
                        };
                        if (
                            (assignment.state === "known") !==
                            (assignment.owner !== null)
                        )
                            throw new Error(
                                "Unknown or unassigned ownership must not invent a name",
                            );
                        if (
                            Object.keys(entry).some(
                                (key) => !(key in assignment),
                            )
                        )
                            throw new Error(
                                "Unsupported project ownership field",
                            );
                        return assignment;
                    },
                ),
            };
            break;
        case "status":
            result = {
                kind,
                project: evidenceChoice(raw.project, [
                    "unknown",
                    "active",
                    "blocked",
                    "complete",
                ] as const),
                incident: evidenceChoice(raw.incident, [
                    "unknown",
                    "open",
                    "closed",
                    "notApplicable",
                ] as const),
                capacity: evidenceChoice(raw.capacity, [
                    "unknown",
                    "pendingOwnerReview",
                    "validated",
                    "notApplicable",
                ] as const),
            };
            break;
        case "milestones":
            result = {
                kind,
                items: items(["id", "status", "date"]).map((entry) => ({
                    id: evidenceText(entry.id),
                    status: evidenceChoice(entry.status, [
                        "proposed",
                        "confirmed",
                        "blocked",
                        "deferred",
                        "unknown",
                    ] as const),
                    date: nullableText(entry.date),
                })),
            };
            break;
        case "decisions":
            result = {
                kind,
                items: items(["id", "status"]).map((entry) => ({
                    id: evidenceText(entry.id),
                    status: evidenceChoice(entry.status, factStatuses),
                })),
            };
            break;
        case "risks": {
            const openQuestions =
                raw.openQuestions === undefined
                    ? undefined
                    : evidenceArray(raw.openQuestions, 128).map((entry) =>
                          evidenceText(entry),
                      );
            result = {
                kind,
                items: items(["id", "status"]).map((entry) => ({
                    id: evidenceText(entry.id),
                    status: evidenceChoice(entry.status, [
                        "open",
                        "blocked",
                        "resolved",
                        "unknown",
                    ] as const),
                })),
                ...(openQuestions !== undefined ? { openQuestions } : {}),
            };
            break;
        }
        case "context":
            result = {
                kind,
                asOf: nullableText(raw.asOf),
                basis: evidenceChoice(raw.basis, [
                    "recordEvidence",
                    "unknown",
                ] as const),
            };
            if ((result.basis === "unknown") !== (result.asOf === null))
                throw new Error(
                    "Project as-of must be unknown or grounded in record evidence",
                );
            break;
    }
    if (Object.keys(raw).some((key) => !(key in result)))
        throw new Error("Unsupported project brief detail field");
    return result;
}

export function emptyProjectBrief(): ProjectBriefContent {
    return {
        kind: "projectBrief",
        construction: "informational-project-summary-v1",
        status: "partial",
        title: "Build validation",
        summary: "Build validation summary",
        citations: [],
        sections: projectBriefRoles.map((role) => ({
            id: role,
            role,
            heading: role,
            body: "Selected indexed evidence",
            details: parseProjectBriefDetails({
                kind: role,
                ...(role === "owners"
                    ? { assignments: [] }
                    : ["milestones", "decisions", "risks"].includes(role)
                      ? { items: [] }
                      : role === "status"
                        ? {
                              project: "unknown",
                              incident: "unknown",
                              capacity: "unknown",
                          }
                        : role === "context"
                          ? { asOf: null, basis: "unknown" }
                          : {}),
            }),
        })),
    };
}
