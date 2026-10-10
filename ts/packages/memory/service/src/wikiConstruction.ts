// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewFactInventory,
    ViewRelationshipInput,
    ViewSynthesisOutput,
    WikiPage,
} from "./viewTypes.js";
import {
    evidenceArray,
    evidenceChoice,
    evidenceRecord,
    evidenceText,
} from "./viewSynthesisEvidence.js";
import { renderInventoryItem } from "./viewInventory.js";
import { viewHash } from "./viewMerge.js";
import { validateWikiEvidence, wikiIndex, wikiTaxonomy } from "./wiki.js";

export function hydrateWikiConstruction(
    input: ViewBuildSnapshot,
    inventory: ViewFactInventory,
    value: unknown,
    evidenceEdges: (
        input: ViewBuildSnapshot,
        sectionId: string,
        items: ViewFactInventory["items"],
    ) => ViewRelationshipInput[],
): ViewSynthesisOutput {
    const raw = evidenceRecord(value);
    if (
        raw.outcome !== "knowledgePages" ||
        Object.keys(raw).some(
            (key) =>
                ![
                    "content",
                    "relationships",
                    "outcome",
                    "missingEvidence",
                ].includes(key),
        )
    )
        throw new Error("Unsupported wiki construction shape");
    const content = evidenceRecord(raw.content);
    if (
        Object.keys(content).some(
            (key) => !["title", "summary", "pages"].includes(key),
        )
    )
        throw new Error("Wiki index and merged identities are host-owned");
    const relationships: ViewRelationshipInput[] = [];
    const sections = evidenceArray(content.pages, 32).map((value): WikiPage => {
        const page = evidenceRecord(value);
        if (
            Object.keys(page).some(
                (key) =>
                    ![
                        "id",
                        "title",
                        "taxonomy",
                        "prose",
                        "inventoryIds",
                    ].includes(key),
            )
        )
            throw new Error("Unsupported wiki page construction field");
        const id = evidenceText(page.id);
        const items = evidenceArray(page.inventoryIds, 128).map((value) => {
            const item = inventory.items.find((entry) => entry.id === value);
            if (!item)
                throw new Error(
                    "Wiki page references unknown inventory identity",
                );
            return item;
        });
        relationships.push(...evidenceEdges(input, id, items));
        return {
            id,
            role: "page",
            heading: evidenceText(page.title),
            body: [
                evidenceText(page.prose),
                ...items.map(renderInventoryItem),
            ].join("\n\n"),
            details: {
                kind: "page",
                taxonomy: evidenceChoice(page.taxonomy, wikiTaxonomy),
                inventoryIds: items.map((item) => item.id),
                mergedPageIds: [],
            },
        };
    });
    for (const value of evidenceArray(raw.relationships, 128)) {
        const edge = evidenceRecord(value);
        if (
            Object.keys(edge).some(
                (key) => !["from", "to", "predicate"].includes(key),
            )
        )
            throw new Error("Wiki relationship proof is host-owned");
        const from = evidenceText(edge.from);
        const to = evidenceText(edge.to);
        const predicate = evidenceChoice(edge.predicate, [
            "relatedTo",
            "contradicts",
        ] as const);
        relationships.push({
            id: `page-edge:${viewHash([input.definition.viewId, predicate, from, to]).slice(0, 32)}`,
            predicate,
            from: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: from,
            },
            to: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: to,
            },
            citations: relationships
                .filter(
                    (edge) =>
                        edge.predicate === "supportedBy" &&
                        [from, to].includes(edge.from.sectionId),
                )
                .flatMap((edge) => edge.citations),
        });
    }
    const output: ViewSynthesisOutput = {
        content: {
            kind: "wiki",
            title: evidenceText(content.title),
            summary: evidenceText(content.summary),
            index: wikiIndex(sections),
            sections,
            citations: relationships
                .filter((edge) => edge.predicate === "supportedBy")
                .flatMap((edge) => edge.citations),
        },
        relationships,
        inventory,
        outcome: "knowledgePages",
        missingEvidence: evidenceArray(raw.missingEvidence, 100).map(
            evidenceText,
        ),
    };
    validateWikiEvidence(
        output.content as Extract<typeof output.content, { kind: "wiki" }>,
        inventory,
        relationships,
    );
    return output;
}
