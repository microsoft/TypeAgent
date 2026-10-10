// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiContent,
    WikiPage,
    ViewFactInventory,
    ViewRelationshipInput,
} from "./viewTypes.js";
import { renderInventoryItem } from "./viewInventory.js";
import { viewSourceKey, wikiIndex } from "./viewContent.js";
export { wikiIndex } from "./viewContent.js";

export const wikiTaxonomy = ["concept", "system", "project"] as const;

export function validateWiki(content: WikiContent): void {
    if (!content.sections.length || content.sections.length > 32)
        throw new Error("Wiki requires 1 to 32 bounded pages");
    const retired = new Set<string>();
    const current = new Set(content.sections.map((page) => page.id));
    for (const page of content.sections) {
        const details = page.details;
        if (
            page.role !== "page" ||
            details?.kind !== "page" ||
            Object.keys(details).some(
                (key) =>
                    ![
                        "kind",
                        "taxonomy",
                        "inventoryIds",
                        "mergedPageIds",
                    ].includes(key),
            ) ||
            !wikiTaxonomy.includes(details.taxonomy) ||
            !Array.isArray(details.inventoryIds) ||
            !details.inventoryIds.length ||
            new Set(details.inventoryIds).size !==
                details.inventoryIds.length ||
            !details.inventoryIds.every(
                (id) => typeof id === "string" && id.length > 0,
            ) ||
            !Array.isArray(details.mergedPageIds)
        )
            throw new Error("Invalid fixed-taxonomy wiki page details");
        for (const id of details.mergedPageIds) {
            if (
                typeof id !== "string" ||
                !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ||
                retired.has(id) ||
                current.has(id)
            )
                throw new Error(
                    "Merged wiki identities must be unique retired pages",
                );
            retired.add(id);
        }
    }
    const expected = wikiIndex(content.sections);
    if (
        !Array.isArray(content.index) ||
        content.index.length !== expected.length ||
        content.index.some(
            (entry, position) =>
                !entry ||
                Object.keys(entry).some(
                    (key) => !["pageId", "title", "taxonomy"].includes(key),
                ) ||
                entry.pageId !== expected[position].pageId ||
                entry.title !== expected[position].title ||
                entry.taxonomy !== expected[position].taxonomy,
        )
    )
        throw new Error(
            "Wiki index must resolve every exact current page identity and title",
        );
}

export function validateWikiEvidence(
    content: WikiContent,
    inventory: ViewFactInventory,
    edges: ViewRelationshipInput[],
): void {
    validateWiki(content);
    for (const page of content.sections) {
        for (const id of page.details.inventoryIds) {
            const item = inventory.items.find((item) => item.id === id);
            if (!item || !page.body.includes(renderInventoryItem(item)))
                throw new Error(
                    "Wiki page facts must remain rendered checked inventory items",
                );
            for (const citation of item.citations) {
                if (
                    !edges.some(
                        (edge) =>
                            edge.predicate === "supportedBy" &&
                            edge.from.sectionId === page.id &&
                            edge.citations.some(
                                (proof) =>
                                    viewSourceKey(proof) ===
                                        viewSourceKey(citation) &&
                                    proof.locator === citation.locator &&
                                    proof.excerpt === citation.excerpt,
                            ),
                    )
                )
                    throw new Error(
                        "Wiki page lacks its exact inventory source proof",
                    );
            }
        }
    }
    for (const edge of edges) {
        if (edge.predicate !== "relatedTo" && edge.predicate !== "contradicts")
            continue;
        const from = content.sections.find(
            (page) => page.id === edge.from.sectionId,
        );
        const to = content.sections.find(
            (page) => page.id === edge.to.sectionId,
        );
        if (!from || !to || from.id === to.id)
            throw new Error(
                "Wiki relationships require distinct current page endpoints",
            );
        for (const page of [from, to]) {
            const citations = edges
                .filter(
                    (proof) =>
                        proof.predicate === "supportedBy" &&
                        proof.from.sectionId === page.id,
                )
                .flatMap((proof) => proof.citations);
            if (
                !edge.citations.some((citation) =>
                    citations.some(
                        (proof) =>
                            viewSourceKey(proof) === viewSourceKey(citation) &&
                            proof.locator === citation.locator &&
                            proof.excerpt === citation.excerpt,
                    ),
                )
            )
                throw new Error(
                    "Wiki relationship requires exact evidence from both endpoint pages",
                );
        }
    }
}

export function emptyWiki(): WikiContent {
    const sections: WikiPage[] = [
        {
            id: "context",
            role: "page",
            heading: "Context",
            body: "Selected evidence",
            details: {
                kind: "page",
                taxonomy: "concept",
                inventoryIds: ["validation"],
                mergedPageIds: [],
            },
        },
    ];
    return {
        kind: "wiki",
        title: "Wiki selection validation",
        index: wikiIndex(sections),
        sections,
        citations: [],
    };
}
