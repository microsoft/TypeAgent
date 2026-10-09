// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TimelineContent,
    ViewCitation,
    ViewRelationshipInput,
} from "@typeagent/memory-service";
import { rbNode, rbButton } from "./memoryHubRunbookUi";

export function createTimelineEditor(
    original: TimelineContent,
    originalEdges: ViewRelationshipInput[],
    changed: () => void,
    showEvidence: (citation: ViewCitation) => void,
) {
    const content: TimelineContent = JSON.parse(JSON.stringify(original));
    let edges: ViewRelationshipInput[] = JSON.parse(
        JSON.stringify(originalEdges),
    );
    const root = rbNode("section");
    root.setAttribute("aria-label", "Evidence-linked timeline");
    const records = rbNode("div");
    function text(
        label: string,
        value: string,
        update: (value: string) => void,
    ) {
        const wrapper = rbNode("label", label);
        const editor = document.createElement("textarea");
        editor.setAttribute("aria-label", label);
        editor.value = value;
        editor.rows = 6;
        editor.oninput = () => {
            update(editor.value);
            changed();
        };
        wrapper.append(editor);
        return wrapper;
    }
    function render() {
        records.replaceChildren();
        const table = rbNode("table");
        const header = rbNode("tr");
        for (const label of [
            "Record",
            "Type / state / outcome",
            "Occurred",
            "Learned",
            "Captured",
        ])
            header.append(rbNode("th", label));
        const head = rbNode("thead");
        head.append(header);
        const body = rbNode("tbody");
        for (const record of content.sections) {
            const row = rbNode("tr");
            const details = record.details;
            for (const value of [
                details.identity.kind === "canonicalEvent"
                    ? details.identity.eventId
                    : `${details.identity.sourceRecordId} (document-derived)`,
                `${details.eventType} / ${details.state} / ${details.outcome ?? "unknown"}`,
                details.occurredAt ?? "unknown",
                details.learnedAt ?? "unknown",
                details.capturedAt ?? "unknown",
            ])
                row.append(rbNode("td", value));
            body.append(row);
        }
        table.append(head, body);
        records.append(table);
        for (const record of content.sections) {
            const section = rbNode("article");
            section.append(
                rbNode("h5", record.heading),
                text(`Narrative ${record.id}`, record.body, (value) => {
                    record.body = value;
                }),
            );
            const citations = edges
                .filter((edge) => edge.from.sectionId === record.id)
                .flatMap((edge) => edge.citations);
            for (const citation of citations)
                section.append(
                    rbButton(
                        `Open exact ${citation.evidence ? "event" : "document"} evidence ${citation.sourceId}`,
                        () => showEvidence(citation),
                    ),
                );
            section.append(
                rbButton(`Remove record ${record.id}`, () => {
                    content.sections = content.sections.filter(
                        (entry) => entry.id !== record.id,
                    );
                    edges = edges.filter(
                        (edge) =>
                            edge.from.sectionId !== record.id &&
                            (edge.to.kind !== "section" ||
                                edge.to.sectionId !== record.id),
                    );
                    changed();
                    render();
                }),
            );
            records.append(section);
        }
        const corrections = rbNode("fieldset");
        corrections.append(rbNode("legend", "Explicit supported corrections"));
        for (const edge of edges.filter(
            (edge) =>
                edge.predicate === "corrects" ||
                edge.predicate === "supersedes",
        )) {
            const label = rbNode("label");
            const retained = document.createElement("input");
            retained.type = "checkbox";
            retained.checked = true;
            retained.onchange = () => {
                edges = retained.checked
                    ? [...edges, edge]
                    : edges.filter((entry) => entry.id !== edge.id);
                changed();
            };
            label.append(
                retained,
                rbNode(
                    "span",
                    `${edge.from.sectionId} ${edge.predicate} ${edge.to.kind === "section" ? edge.to.sectionId : "invalid target"}`,
                ),
            );
            corrections.append(label);
        }
        const choice = (label: string) => {
            const select = document.createElement("select");
            select.setAttribute("aria-label", label);
            for (const record of content.sections) {
                const option = document.createElement("option");
                option.value = record.id;
                option.textContent = `${record.id}: ${record.heading}`;
                select.append(option);
            }
            return select;
        };
        const from = choice("Correcting record");
        const to = choice("Corrected record");
        const predicate = document.createElement("select");
        predicate.setAttribute("aria-label", "Correction predicate");
        for (const value of ["corrects", "supersedes"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            predicate.append(option);
        }
        const correctionStatus = rbNode("p");
        correctionStatus.setAttribute("role", "status");
        corrections.append(
            from,
            predicate,
            to,
            rbButton("Add explicit correction", () => {
                const support = originalEdges.find(
                    (edge) =>
                        edge.predicate === "supportedBy" &&
                        edge.from.sectionId === from.value,
                );
                const selectedPredicate =
                    predicate.value === "corrects" ? "corrects" : "supersedes";
                if (
                    !support ||
                    from.value === to.value ||
                    edges.some(
                        (edge) =>
                            edge.predicate === selectedPredicate &&
                            edge.from.sectionId === from.value &&
                            edge.to.kind === "section" &&
                            edge.to.sectionId === to.value,
                    )
                ) {
                    correctionStatus.textContent =
                        "Choose distinct existing records with retained support and no duplicate correction. Saving additionally requires an explicit source-grounded target and knowledge ordering.";
                    return;
                }
                edges.push({
                    id: crypto.randomUUID(),
                    predicate: selectedPredicate,
                    from: support.from,
                    to: {
                        kind: "section",
                        viewId: support.from.viewId,
                        sectionId: to.value,
                    },
                    citations: support.citations,
                });
                changed();
                render();
            }),
            correctionStatus,
        );
        records.append(corrections);
    }
    root.append(
        rbNode(
            "p",
            `Generated: ${content.generatedAt}. IDs, occurrence, knowledge, capture and classification are read-only retained evidence. Rebuild with new grounding to change them. Narrative and correction removals are attributed edits; unsupported or missing required facts block saving/publication.`,
        ),
        text("Timeline title", content.title, (value) => {
            content.title = value;
        }),
        text("Timeline summary", content.summary ?? "", (value) => {
            content.summary = value;
        }),
        records,
    );
    render();
    return {
        element: root,
        read: (): TimelineContent => JSON.parse(JSON.stringify(content)),
        relationships: (): ViewRelationshipInput[] =>
            JSON.parse(JSON.stringify(edges)),
    };
}
