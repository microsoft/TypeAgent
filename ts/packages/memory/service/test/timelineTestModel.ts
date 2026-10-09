// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import type { ViewBuildSnapshot, ViewFactInventory } from "../src/viewTypes.js";
import { projectBriefTestAnswer } from "./projectBriefTestModel.js";

export function timelineTestAnswer(
    name: string,
    value: unknown,
    prose = "Retained record evidence.",
): unknown {
    if (
        name === "memory_project_brief_construction" ||
        (name === "memory_source_fact_inventory" &&
            (value as ViewBuildSnapshot).definition.kind === "projectBrief")
    )
        return projectBriefTestAnswer(name, value);
    if (name !== "memory_timeline_construction")
        return inventoryTestAnswer(name, value);
    const raw = value as {
        input: ViewBuildSnapshot;
        inventory: ViewFactInventory;
    };
    const records = raw.input.inputs.flatMap((input) => input.records ?? []);
    return {
        content: {
            title: "Evidence-linked incident timeline",
            summary: "Occurrence and knowledge remain distinct.",
            records: records.map((record) => ({
                recordId: record.id,
                prose,
                inventoryIds: raw.inventory.items
                    .filter((item) =>
                        item.citations.some(
                            (citation) =>
                                citation.locator === record.citation.locator &&
                                citation.excerpt === record.citation.excerpt &&
                                citation.sourceId ===
                                    record.citation.sourceId &&
                                citation.revisionId ===
                                    record.citation.revisionId,
                        ),
                    )
                    .map((item) => item.id),
            })),
        },
        corrections: records.flatMap((from) => {
            const target =
                from.details.identity.kind === "canonicalEvent"
                    ? (
                          JSON.parse(from.citation.excerpt) as {
                              metadata?: { corrects?: string };
                          }
                      ).metadata?.corrects
                    : /^Corrects: ([^\r\n]+)$/m.exec(
                          from.citation.excerpt,
                      )?.[1];
            const to = records.find(
                (record) =>
                    (record.details.identity.kind === "canonicalEvent"
                        ? record.details.identity.eventId
                        : record.details.identity.sourceRecordId) === target,
            );
            return to
                ? [{ from: from.id, to: to.id, predicate: "corrects" }]
                : [];
        }),
        outcome: "chronology",
        missingEvidence: [],
    };
}
