// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProjectBriefContent,
    ProjectBriefDetails,
    ProjectBriefSection,
    ViewFactInventory,
    ViewInventoryItem,
} from "./viewTypes.js";
import {
    evidenceArray,
    evidenceChoice,
    evidenceRecord,
    evidenceText,
} from "./viewSynthesisEvidence.js";
import { factStatuses, renderInventoryItem } from "./viewInventory.js";

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
    const ids = () => evidenceArray(raw.inventoryIds, 128).map(evidenceText);
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
            result = { kind, inventoryIds: ids() };
            break;
        case "owners":
            result = {
                kind,
                assignments: evidenceArray(raw.assignments, 128).map(
                    (value) => {
                        const entry = evidenceRecord(value);
                        const assignment = {
                            inventoryId: evidenceText(entry.inventoryId),
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
                inventoryIds: ids(),
            };
            break;
        case "milestones":
            result = {
                kind,
                items: items(["inventoryId", "status", "date"]).map(
                    (entry) => ({
                        inventoryId: evidenceText(entry.inventoryId),
                        status: evidenceChoice(entry.status, [
                            "proposed",
                            "confirmed",
                            "blocked",
                            "deferred",
                            "unknown",
                        ] as const),
                        date: nullableText(entry.date),
                    }),
                ),
            };
            break;
        case "decisions":
            result = {
                kind,
                items: items(["inventoryId", "status"]).map((entry) => ({
                    inventoryId: evidenceText(entry.inventoryId),
                    status: evidenceChoice(entry.status, factStatuses),
                })),
            };
            break;
        case "risks":
            result = {
                kind,
                items: items(["inventoryId", "status"]).map((entry) => ({
                    inventoryId: evidenceText(entry.inventoryId),
                    status: evidenceChoice(entry.status, [
                        "open",
                        "blocked",
                        "resolved",
                        "unknown",
                    ] as const),
                })),
            };
            break;
        case "context":
            result = {
                kind,
                asOf: nullableText(raw.asOf),
                basis: evidenceChoice(raw.basis, [
                    "recordEvidence",
                    "unknown",
                ] as const),
                inventoryIds: ids(),
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

export function projectDetailIds(details: ProjectBriefDetails): string[] {
    if ("inventoryIds" in details) return details.inventoryIds;
    if (details.kind === "owners")
        return details.assignments.map((entry) => entry.inventoryId);
    return details.items.map((entry) => entry.inventoryId);
}

export function validateProjectBrief(content: ProjectBriefContent): void {
    const roles = new Set(content.sections.map((section) => section.role));
    if (
        content.sections.length !== projectBriefRoles.length ||
        projectBriefRoles.some((role) => !roles.has(role))
    )
        throw new Error(
            "Project brief requires the fixed goals/scope, owners, status, milestones, decisions, risks and context template",
        );
    for (const section of content.sections) {
        const details = parseProjectBriefDetails(section.details);
        if (details.kind !== section.role)
            throw new Error(
                "Project brief section role and typed details must match",
            );
        if (!projectDetailIds(details).length)
            throw new Error(
                "Project brief typed fields require source inventory context, including explicit unknowns",
            );
    }
}

function fieldEvidence(
    items: ViewInventoryItem[],
    kind: ViewInventoryItem["kind"],
    pattern: RegExp,
): boolean {
    return items.some(
        (item) =>
            item.kind === kind &&
            item.status === "confirmed" &&
            pattern.test(item.statement) &&
            item.citations.some((citation) => pattern.test(citation.excerpt)),
    );
}

export function validateProjectBriefEvidence(
    content: ProjectBriefContent,
    inventory: ViewFactInventory,
): void {
    validateProjectBrief(content);
    for (const section of content.sections)
        validateSectionEvidence(section, inventory);
}

function validateSectionEvidence(
    section: ProjectBriefSection,
    inventory: ViewFactInventory,
): void {
    const details = section.details;
    const items = projectDetailIds(details).map((id) => {
        const item = inventory.items.find((item) => item.id === id);
        if (!item || !section.body.includes(renderInventoryItem(item)))
            throw new Error(
                "Typed project fields must reference checked facts visible in the actual section",
            );
        return item;
    });
    switch (details.kind) {
        case "goalsScope":
            if (!items.some((item) => item.kind === "goal"))
                throw new Error(
                    "Project brief goals/scope require a checked goal fact",
                );
            break;
        case "owners":
            validateOwnership(details, items);
            break;
        case "status":
            validateStatus(details, items);
            break;
        case "milestones":
            validateMilestones(details, items);
            break;
        case "decisions":
            for (const entry of details.items)
                if (
                    checkedFact(items, entry.inventoryId, "decision").status !==
                    entry.status
                )
                    throw new Error(
                        "Decision state differs from checked evidence",
                    );
            break;
        case "risks":
            validateRisks(details, items);
            break;
        case "context":
            validateContext(details, items, inventory);
            break;
    }
}

function checkedFact(
    items: ViewInventoryItem[],
    id: string,
    kind: ViewInventoryItem["kind"],
): ViewInventoryItem {
    const item = items.find((item) => item.id === id && item.kind === kind);
    if (!item)
        throw new Error(
            `Project ${kind} field requires a checked ${kind} fact`,
        );
    return item;
}

function validateOwnership(
    details: Extract<ProjectBriefDetails, { kind: "owners" }>,
    items: ViewInventoryItem[],
): void {
    for (const assignment of details.assignments) {
        const item = checkedFact(items, assignment.inventoryId, "owner");
        if (
            !item.statement.includes(assignment.responsibility) ||
            !item.citations.some((citation) =>
                citation.excerpt.includes(assignment.responsibility),
            ) ||
            (assignment.owner !== null &&
                (!item.statement.includes(assignment.owner) ||
                    !item.citations.some((citation) =>
                        citation.excerpt.includes(assignment.owner!),
                    ))) ||
            (assignment.state === "known" && item.status !== "confirmed") ||
            (assignment.state === "unknown" &&
                !["unknown", "blocked"].includes(item.status)) ||
            (assignment.state === "unassigned" &&
                !fieldEvidence(
                    [item],
                    "owner",
                    new RegExp(
                        `\\b(?:owner(?:ship)?(?:\\s+is|\\s*:)?\\s+unassigned|no owner(?:\\s+is)?\\s+assigned)\\b|^(?:Owner:\\s*)?${assignment.responsibility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+has no owner\\.?$`,
                        "i",
                    ),
                ))
        )
            throw new Error(
                "Project ownership is not supported by the checked source fact",
            );
    }
}

function validateStatus(
    details: Extract<ProjectBriefDetails, { kind: "status" }>,
    items: ViewInventoryItem[],
): void {
    for (const [kind, state] of [
        ["projectStatus", details.project],
        ["incidentStatus", details.incident],
        ["capacity", details.capacity],
    ] as const) {
        if (!items.some((item) => item.kind === kind))
            throw new Error(`Project status lacks ${kind} context`);
        if (
            ["unknown", "notApplicable"].includes(state) &&
            !items.some((item) => item.kind === kind && item.status === state)
        )
            throw new Error(
                `Project ${kind} unknown/not-applicable state differs from checked evidence`,
            );
    }
    if (
        details.project !== "unknown" &&
        !fieldEvidence(
            items,
            "projectStatus",
            new RegExp(
                `\\bproject(?: status)?\\s*(?:is|:)?\\s*${details.project}\\b`,
                "i",
            ),
        )
    )
        throw new Error(
            "Project status requires explicit project evidence; incident closure is not project completion",
        );
    if (
        details.incident !== "unknown" &&
        details.incident !== "notApplicable" &&
        !fieldEvidence(
            items,
            "incidentStatus",
            new RegExp(
                `\\bincident(?: status)?\\s*(?:is|:)?\\s*${details.incident}\\b`,
                "i",
            ),
        )
    )
        throw new Error("Incident status requires explicit incident evidence");
    validateCapacity(details.capacity, items);
}

function validateCapacity(
    state: Extract<ProjectBriefDetails, { kind: "status" }>["capacity"],
    items: ViewInventoryItem[],
): void {
    if (
        state === "validated" &&
        !fieldEvidence(
            items,
            "capacity",
            /\bcapacity(?: validation)?\s*(?:is|:)?\s*validated\b/i,
        )
    )
        throw new Error(
            "Capacity validation requires confirmed source evidence",
        );
    const blocked = items.some(
        (item) => item.kind === "capacity" && item.status === "blocked",
    );
    if (blocked && state !== "pendingOwnerReview")
        throw new Error(
            "Blocked capacity validation must remain pending owner review",
        );
    if (state === "pendingOwnerReview" && !blocked)
        throw new Error(
            "Pending capacity review requires a blocked source fact",
        );
}

function validateMilestones(
    details: Extract<ProjectBriefDetails, { kind: "milestones" }>,
    items: ViewInventoryItem[],
): void {
    for (const entry of details.items) {
        const item = checkedFact(items, entry.inventoryId, "milestone");
        if (
            entry.status !== item.status ||
            (entry.date !== null &&
                (!item.statement.includes(entry.date) ||
                    !item.citations.some((citation) =>
                        citation.excerpt.includes(entry.date!),
                    )))
        )
            throw new Error(
                "Milestone status/date must retain the source's provisional commitment",
            );
    }
}

function validateRisks(
    details: Extract<ProjectBriefDetails, { kind: "risks" }>,
    items: ViewInventoryItem[],
): void {
    for (const entry of details.items) {
        const item = checkedFact(items, entry.inventoryId, "risk");
        const expected =
            item.status === "blocked"
                ? "blocked"
                : item.status === "confirmed" &&
                    /\b(?:risk|blocker)(?: is|:)? resolved\b/i.test(
                        item.statement,
                    ) &&
                    item.citations.some((citation) =>
                        /\b(?:risk|blocker)(?: is|:)? resolved\b/i.test(
                            citation.excerpt,
                        ),
                    )
                  ? "resolved"
                  : item.status === "unknown"
                    ? "unknown"
                    : "open";
        if (entry.status !== expected)
            throw new Error("Risk state differs from checked evidence");
    }
}

function validateContext(
    details: Extract<ProjectBriefDetails, { kind: "context" }>,
    items: ViewInventoryItem[],
    inventory: ViewFactInventory,
): void {
    if (
        !items.some((item) =>
            ["timing", "projectAsOf", "background"].includes(item.kind),
        )
    )
        throw new Error(
            "Project brief context requires checked context or unknown timing evidence",
        );
    if (
        details.asOf === null &&
        inventory.items.some(
            (item) =>
                item.kind === "projectAsOf" && item.status === "confirmed",
        )
    )
        throw new Error(
            "Project as-of cannot be unknown when checked record evidence confirms it",
        );
    if (
        details.asOf !== null &&
        !items.some(
            (item) =>
                item.kind === "projectAsOf" &&
                item.status === "confirmed" &&
                item.statement.includes(details.asOf!) &&
                /\bproject (?:knowledge )?as.of\b/i.test(item.statement) &&
                item.citations.some(
                    (citation) =>
                        citation.excerpt.includes(details.asOf!) &&
                        /\bproject (?:knowledge )?as.of\b/i.test(
                            citation.excerpt,
                        ),
                ),
        )
    )
        throw new Error(
            "Project as-of requires record evidence, not source capture/modified time",
        );
}

export function emptyProjectBrief(): ProjectBriefContent {
    return {
        kind: "projectBrief",
        title: "Build validation",
        citations: [],
        sections: projectBriefRoles.map((role) => ({
            id: role,
            role,
            heading: role,
            body: "Selected evidence",
            details: parseProjectBriefDetails({
                kind: role,
                ...(role === "owners"
                    ? {
                          assignments: [
                              {
                                  inventoryId: "unknown",
                                  responsibility: "Ownership",
                                  state: "unknown",
                                  owner: null,
                              },
                          ],
                      }
                    : ["milestones", "decisions", "risks"].includes(role)
                      ? {
                            items: [
                                {
                                    inventoryId: "unknown",
                                    status: "unknown",
                                    ...(role === "milestones"
                                        ? { date: null }
                                        : {}),
                                },
                            ],
                        }
                      : {
                            inventoryIds: ["unknown"],
                            ...(role === "status"
                                ? {
                                      project: "unknown",
                                      incident: "unknown",
                                      capacity: "unknown",
                                  }
                                : {}),
                            ...(role === "context"
                                ? { asOf: null, basis: "unknown" }
                                : {}),
                        }),
            }),
        })),
    };
}
