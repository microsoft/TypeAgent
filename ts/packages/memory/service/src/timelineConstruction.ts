// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewFactInventory,
    ViewSynthesisOutput,
    TimelineRecord,
    ViewRelationshipInput,
} from "./viewTypes.js";
import {
    evidenceArray,
    evidenceRecord,
    evidenceText,
    exactEvidenceCoverage,
} from "./viewSynthesisEvidence.js";
import { renderInventoryItem } from "./viewInventory.js";
import { viewSourceKey } from "./viewContent.js";
import { viewHash } from "./viewMerge.js";
import {
    orderTimeline,
    validateTimelineEvidence,
    timelineCorrectionSupported,
    timelineTimestamp,
} from "./timeline.js";

export function hydrateTimelineConstruction(
    input: ViewBuildSnapshot,
    inventory: ViewFactInventory,
    value: unknown,
): ViewSynthesisOutput {
    const raw = evidenceRecord(value);
    if (
        Object.keys(raw).some(
            (key) =>
                ![
                    "content",
                    "corrections",
                    "outcome",
                    "missingEvidence",
                ].includes(key),
        ) ||
        raw.outcome !== "chronology"
    )
        throw new Error("Unsupported timeline construction shape");
    const content = evidenceRecord(raw.content);
    if (
        Object.keys(content).some(
            (key) => !["title", "summary", "records"].includes(key),
        )
    )
        throw new Error(
            "Timeline construction cannot supply host-owned timestamps or provenance",
        );
    const retained = input.inputs.flatMap((source) => source.records ?? []);
    const relationships: ViewRelationshipInput[] = [];
    const sections = evidenceArray(content.records, 1000).map(
        (value): TimelineRecord => {
            const record = evidenceRecord(value);
            if (
                Object.keys(record).some(
                    (key) =>
                        !["recordId", "prose", "inventoryIds"].includes(key),
                )
            )
                throw new Error("Timeline record metadata is host-owned");
            const source = retained.find(
                (entry) => entry.id === record.recordId,
            );
            if (!source)
                throw new Error(
                    "Unknown or temporally excluded timeline record",
                );
            const items = evidenceArray(record.inventoryIds, 128).map((id) => {
                const item = inventory.items.find((entry) => entry.id === id);
                if (
                    !item ||
                    !item.citations.every(
                        (citation) =>
                            viewSourceKey(citation) ===
                                viewSourceKey(source.citation) &&
                            citation.locator === source.citation.locator &&
                            citation.excerpt === source.citation.excerpt,
                    )
                )
                    throw new Error(
                        "Timeline facts must be grounded to their exact record",
                    );
                if (
                    (item.occurredAt &&
                        timelineTimestamp(item.occurredAt) !==
                            source.details.occurredAt) ||
                    (item.learnedAt &&
                        timelineTimestamp(item.learnedAt) !==
                            source.details.learnedAt)
                )
                    throw new Error(
                        "Inventory record timing contradicts retained chronology",
                    );
                return item;
            });
            if (!items.length)
                throw new Error(
                    "Timeline record needs checked inventory facts",
                );
            relationships.push({
                id: `support:${viewHash([input.definition.viewId, source.id]).slice(0, 32)}`,
                predicate: "supportedBy",
                from: {
                    kind: "section",
                    viewId: input.definition.viewId,
                    sectionId: source.id,
                },
                to: {
                    kind: "source",
                    sourceId: source.citation.sourceId,
                    revisionId: source.citation.revisionId,
                    ...(source.citation.evidence
                        ? { evidence: source.citation.evidence }
                        : {}),
                },
                citations: [source.citation],
            });
            return {
                id: source.id,
                role: "event",
                heading: source.details.eventType,
                body: [
                    evidenceText(record.prose),
                    ...items.map(renderInventoryItem),
                ].join("\n\n"),
                details: {
                    ...structuredClone(source.details),
                    inventoryIds: items.map((item) => item.id),
                },
            };
        },
    );
    exactEvidenceCoverage(
        sections,
        retained.map((record) => record.id),
        (record) => record.id,
        "Timeline omitted or duplicated eligible records",
    );
    for (const value of evidenceArray(raw.corrections, 1000)) {
        const correction = evidenceRecord(value);
        if (
            Object.keys(correction).some(
                (key) => !["from", "to", "predicate"].includes(key),
            ) ||
            !["corrects", "supersedes"].includes(String(correction.predicate))
        )
            throw new Error("Unsupported timeline correction contract");
        const from = retained.find((record) => record.id === correction.from);
        const to = retained.find((record) => record.id === correction.to);
        const predicate =
            correction.predicate === "corrects" ? "corrects" : "supersedes";
        if (
            !from ||
            !to ||
            from.id === to.id ||
            !timelineCorrectionSupported(from, to, predicate)
        )
            throw new Error(
                "Correction requires grounded existing endpoints and non-reversed knowledge time",
            );
        relationships.push({
            id: `correction:${viewHash(correction).slice(0, 32)}`,
            predicate,
            from: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: from.id,
            },
            to: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: to.id,
            },
            citations: [from.citation],
        });
    }
    const output: ViewSynthesisOutput = {
        content: {
            kind: "timeline",
            title: evidenceText(content.title),
            summary: evidenceText(content.summary),
            generatedAt: new Date().toISOString(),
            sections: orderTimeline(sections),
            citations: retained.map((record) => record.citation),
        },
        relationships,
        outcome: "chronology",
        missingEvidence: evidenceArray(raw.missingEvidence, 100).map(
            evidenceText,
        ),
        inventory,
    };
    validateTimelineEvidence(
        input,
        output.content as Extract<typeof output.content, { kind: "timeline" }>,
    );
    return output;
}
