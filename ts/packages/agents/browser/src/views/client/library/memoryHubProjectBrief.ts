// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProjectBriefContent,
    ProjectBriefDetails,
} from "@typeagent/memory-service";
import { rbNode, rbButton } from "./memoryHubRunbookUi";

const headings: Record<ProjectBriefDetails["kind"], string> = {
    goalsScope: "Goals and scope",
    owners: "Owners and responsibilities",
    status: "Project, incident and capacity status",
    milestones: "Milestones and provisional commitments",
    decisions: "Decisions",
    risks: "Risks, blockers and open questions",
    context: "Source-grounded as-of and context",
};

export function createProjectBriefEditor(
    original: ProjectBriefContent,
    changed: () => void,
    showEvidence: (
        sourceId: string,
        revisionId: string,
        locator: string,
    ) => void,
) {
    const content: ProjectBriefContent = JSON.parse(JSON.stringify(original));
    const root = rbNode("section");
    root.setAttribute("aria-label", "Project brief fixed template");
    function text(
        label: string,
        value: string,
        update: (value: string) => void,
        multiline = false,
    ) {
        const wrapper = rbNode("label", label);
        const input = multiline
            ? document.createElement("textarea")
            : document.createElement("input");
        input.setAttribute("aria-label", label);
        input.value = value;
        if (input instanceof HTMLTextAreaElement) input.rows = 8;
        input.oninput = () => {
            update(input.value);
            changed();
        };
        wrapper.append(input);
        return wrapper;
    }
    function choice<T extends string>(
        label: string,
        value: T,
        values: readonly T[],
        update: (value: T) => void,
    ) {
        const wrapper = rbNode("label", label);
        const select = document.createElement("select");
        select.setAttribute("aria-label", label);
        for (const value of values) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.append(option);
        }
        select.value = value;
        select.onchange = () => {
            const selected = values.find((value) => value === select.value);
            if (selected === undefined)
                throw new Error("Unsupported project field choice");
            update(selected);
            changed();
        };
        wrapper.append(select);
        return wrapper;
    }
    function detailsFields(details: ProjectBriefDetails): HTMLElement[] {
        switch (details.kind) {
            case "owners":
                return details.assignments.flatMap((entry, index) => [
                    text(
                        `Responsibility ${index + 1}`,
                        entry.responsibility,
                        (value) => (entry.responsibility = value),
                    ),
                    choice(
                        `Owner state ${index + 1}`,
                        entry.state,
                        ["known", "unknown", "unassigned"],
                        (value) => {
                            entry.state = value;
                            if (value !== "known") entry.owner = null;
                        },
                    ),
                    text(
                        `Owner ${index + 1} (blank means unknown)`,
                        entry.owner ?? "",
                        (value) => (entry.owner = value.trim() || null),
                    ),
                ]);
            case "status":
                return [
                    choice(
                        "Project status",
                        details.project,
                        ["unknown", "active", "blocked", "complete"],
                        (value) => (details.project = value),
                    ),
                    choice(
                        "Incident status",
                        details.incident,
                        ["unknown", "open", "closed", "notApplicable"],
                        (value) => (details.incident = value),
                    ),
                    choice(
                        "Capacity validation",
                        details.capacity,
                        [
                            "unknown",
                            "pendingOwnerReview",
                            "validated",
                            "notApplicable",
                        ],
                        (value) => (details.capacity = value),
                    ),
                ];
            case "milestones":
                return details.items.flatMap((entry, index) => [
                    choice(
                        `Milestone ${index + 1} commitment`,
                        entry.status,
                        [
                            "proposed",
                            "confirmed",
                            "blocked",
                            "deferred",
                            "unknown",
                        ],
                        (value) => (entry.status = value),
                    ),
                    text(
                        `Milestone ${index + 1} date (blank means unknown)`,
                        entry.date ?? "",
                        (value) => (entry.date = value.trim() || null),
                    ),
                ]);
            case "decisions":
                return details.items.map((entry, index) =>
                    choice(
                        `Decision ${index + 1} state`,
                        entry.status,
                        [
                            "observed",
                            "proposed",
                            "attempted",
                            "rejected",
                            "deferred",
                            "confirmed",
                            "unknown",
                            "blocked",
                            "notApplicable",
                        ],
                        (value) => (entry.status = value),
                    ),
                );
            case "risks":
                return details.items.map((entry, index) =>
                    choice(
                        `Risk ${index + 1} state`,
                        entry.status,
                        ["open", "blocked", "resolved", "unknown"],
                        (value) => (entry.status = value),
                    ),
                );
            case "context":
                return [
                    rbNode(
                        "p",
                        `Project knowledge as-of: ${details.asOf ?? "Unknown"}. Generation and source capture times are not project knowledge times.`,
                    ),
                    choice(
                        "As-of evidence basis",
                        details.basis,
                        ["unknown", "recordEvidence"],
                        (value) => {
                            details.basis = value;
                            if (value === "unknown") details.asOf = null;
                        },
                    ),
                    text(
                        "Project as-of (blank means unknown)",
                        details.asOf ?? "",
                        (value) => (details.asOf = value.trim() || null),
                    ),
                ];
            case "goalsScope":
                return [];
        }
    }
    root.append(
        rbNode(
            "p",
            "Project briefs are reading artifacts, not executable guides. Unknown owners and dates are explicit. Edits never change original sources and require exact-artifact evidence checking before publication.",
        ),
        text(
            "Project brief title",
            content.title,
            (value) => (content.title = value),
        ),
        text(
            "Project brief summary",
            content.summary ?? "",
            (value) => (content.summary = value),
            true,
        ),
    );
    for (const section of content.sections) {
        const group = rbNode("fieldset");
        group.append(
            rbNode("legend", headings[section.details.kind]),
            text(
                `${headings[section.details.kind]} heading`,
                section.heading,
                (value) => (section.heading = value),
            ),
            text(
                `${headings[section.details.kind]} narrative and checked facts`,
                section.body,
                (value) => (section.body = value),
                true,
            ),
            ...detailsFields(section.details),
        );
        root.append(group);
    }
    const evidence = rbNode("details");
    evidence.append(rbNode("summary", "Read exact original evidence"));
    for (const citation of content.citations)
        evidence.append(
            rbButton(
                `${citation.sourceId} @ ${citation.revisionId} ${citation.locator}`,
                () =>
                    showEvidence(
                        citation.sourceId,
                        citation.revisionId,
                        citation.locator,
                    ),
            ),
        );
    root.append(evidence);
    return { element: root, read: () => content };
}
