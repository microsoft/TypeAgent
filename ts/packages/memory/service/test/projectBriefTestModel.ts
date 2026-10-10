// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import type { ViewFactKind, ViewFactStatus } from "../src/viewTypes.js";

const {
    evidenceArray,
    evidenceRecord,
    evidenceText,
}: typeof import("../src/viewSynthesisEvidence.js") = await import(
    new URL("../../dist/viewSynthesisEvidence.js", import.meta.url).href
);

export const projectSources = {
    charter:
        "Goal: Reduce payment workload latency while preserving safe capacity headroom.\n\nScope: Payments reliability investigation and capacity validation; no live configuration changes.\n\nOwner: Capacity validation owner unknown; service-owner review is required.\n\nMilestone: Peak-load rehearsal is proposed; no committed date.\n\nDecision: Reporting-query explanation rejected by trace correlation; pool-pressure explanation retained.\n\nContext: Project knowledge as-of is unknown; source capture time is not project status time.",
    baseline:
        "Project status: active; project is not complete.\n\nIncident status: closed after recorded recovery, not project completion.\n\nCapacity: BLOCKED pending owner review and peak-load validation.\n\nRisk: Workload memory and headroom remain open questions; no universal pool target is authorized.",
    replacement:
        "Project status: active; project is not complete.\n\nIncident status: closed after recorded recovery, not project completion.\n\nCapacity: BLOCKED pending owner review and measured headroom validation.\n\nRisk: Peak-load rehearsal reached the workload-memory warning level. Require measured headroom before selecting a pool target; the recorded value of 100 is not universal.",
};

function classify(statement: string): {
    kind: ViewFactKind;
    status: ViewFactStatus;
} {
    if (statement.startsWith("Project status:"))
        return { kind: "projectStatus", status: "confirmed" };
    if (statement.startsWith("Incident status:"))
        return { kind: "incidentStatus", status: "confirmed" };
    if (statement.startsWith("Capacity:"))
        return { kind: "capacity", status: "blocked" };
    if (statement.startsWith("Owner:"))
        return { kind: "owner", status: "unknown" };
    if (statement.startsWith("Milestone:"))
        return { kind: "milestone", status: "proposed" };
    if (statement.startsWith("Decision:"))
        return { kind: "decision", status: "rejected" };
    if (statement.startsWith("Risk:"))
        return { kind: "risk", status: "observed" };
    if (statement.startsWith("Context:"))
        return { kind: "timing", status: "unknown" };
    return { kind: "goal", status: "observed" };
}

// These responses inspect only synthetic retained source passages, not expectation files.
export function projectBriefTestAnswer(
    name: string,
    value: unknown,
    prose = "Source-grounded project context.\n\n",
): unknown {
    if (name === "memory_source_fact_inventory") {
        const response = evidenceRecord(inventoryTestAnswer(name, value));
        for (const item of evidenceArray(response.items).map(evidenceRecord))
            Object.assign(item, classify(evidenceText(item.statement)));
        return response;
    }
    if (name !== "memory_project_brief_construction")
        return inventoryTestAnswer(name, value);
    const inventory = evidenceRecord(evidenceRecord(value).inventory);
    const items = evidenceArray(inventory.items).map(evidenceRecord);
    const ids = (...kinds: string[]) =>
        items
            .filter((item) => kinds.includes(evidenceText(item.kind)))
            .map((item) => evidenceText(item.id));
    const one = (kind: string) => {
        const id = ids(kind)[0];
        if (!id) throw new Error(`Synthetic source lacks ${kind}`);
        return id;
    };
    const details = [
        { kind: "goalsScope", inventoryIds: ids("goal") },
        {
            kind: "owners",
            assignments: [
                {
                    inventoryId: one("owner"),
                    responsibility: "Capacity validation",
                    state: "unknown",
                    owner: null,
                },
            ],
        },
        {
            kind: "status",
            project: "active",
            incident: "closed",
            capacity: "pendingOwnerReview",
            inventoryIds: ids("projectStatus", "incidentStatus", "capacity"),
        },
        {
            kind: "milestones",
            items: [
                {
                    inventoryId: one("milestone"),
                    status: "proposed",
                    date: null,
                },
            ],
        },
        {
            kind: "decisions",
            items: [{ inventoryId: one("decision"), status: "rejected" }],
        },
        {
            kind: "risks",
            items: [{ inventoryId: one("risk"), status: "open" }],
        },
        {
            kind: "context",
            asOf: null,
            basis: "unknown",
            inventoryIds: ids("timing"),
        },
    ];
    return {
        content: {
            title: "Payments reliability project brief",
            summary:
                "Incident closed; project active. Capacity blocked pending owner review.",
            sections: details.map((detail) => ({
                id: detail.kind,
                role: detail.kind,
                heading: detail.kind,
                prose,
                inventoryIds:
                    "inventoryIds" in detail
                        ? detail.inventoryIds
                        : detail.kind === "owners"
                          ? detail.assignments!.map(
                                (entry) => entry.inventoryId,
                            )
                          : detail.items!.map((entry) => entry.inventoryId),
                details: detail,
            })),
        },
        exclusions: [],
        outcome: "projectSummary",
        missingEvidence: [
            "Owner sign-off, committed milestone date and project knowledge as-of are unknown.",
        ],
    };
}
