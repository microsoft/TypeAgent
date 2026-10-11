// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import { parseIndexedLocator } from "./indexedFragments.js";
import { wikiIndex, viewSourceKey } from "./viewContent.js";
import type {
    ViewBuildSnapshot,
    ViewDefinitionInput,
    ViewSynthesisOutput,
    WikiContent,
} from "./viewTypes.js";

export function informationalWiki(content: {
    kind: string;
    construction?: string;
}): boolean {
    return (
        content.kind === "wiki" &&
        content.construction === "informational-wiki-v1"
    );
}

export function validateWikiSelector(definition: ViewDefinitionInput): void {
    const wiki = definition.wiki;
    if (!wiki) {
        if (definition.kind === "wiki")
            throw new Error("Wiki construction requires informational-wiki-v1");
        return;
    }
    if (
        definition.kind !== "wiki" ||
        definition.maintenance !== undefined ||
        wiki.construction !== "informational-wiki-v1" ||
        Object.keys(wiki).some(
            (key) =>
                ![
                    "construction",
                    "query",
                    "aliases",
                    "excludedSourceIds",
                ].includes(key),
        ) ||
        !wiki.query?.trim() ||
        wiki.query.length > 200 ||
        !Array.isArray(wiki.aliases) ||
        wiki.aliases.length > 7 ||
        wiki.aliases.some(
            (alias) =>
                typeof alias !== "string" ||
                !alias.trim() ||
                alias.length > 200,
        ) ||
        !Array.isArray(wiki.excludedSourceIds) ||
        wiki.excludedSourceIds.length > 32 ||
        wiki.excludedSourceIds.some(
            (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id),
        ) ||
        new Set(wiki.excludedSourceIds).size !== wiki.excludedSourceIds.length
    )
        throw new Error("Invalid informational wiki retrieval definition");
}

export function validateInformationalContent(content: WikiContent): void {
    if (content.sections.length !== 1 || content.index.length !== 1)
        throw new Error(
            "An informational wiki record contains exactly one page",
        );
    const page = content.sections[0];
    if (
        page.details.kind !== "page" ||
        !("construction" in page.details) ||
        page.details.construction !== "informational-wiki-v1" ||
        Object.keys(page.details).some(
            (key) =>
                ![
                    "kind",
                    "construction",
                    "taxonomy",
                    "note",
                    "mergedPageIds",
                ].includes(key),
        ) ||
        !["concept", "system", "project"].includes(page.details.taxonomy) ||
        typeof page.details.note !== "string" ||
        page.details.note.length > 4000 ||
        page.details.mergedPageIds.length !== 0 ||
        !content.summary?.startsWith(
            "Limited summary: selected indexed fragments only;",
        )
    )
        throw new Error(
            "Invalid informational wiki page or missing explicit coverage limit",
        );
    const expected = wikiIndex(content.sections)[0];
    const actual = content.index[0];
    if (
        !actual ||
        actual.pageId !== expected.pageId ||
        actual.title !== expected.title ||
        actual.taxonomy !== expected.taxonomy ||
        Object.keys(actual).some(
            (key) => !["pageId", "title", "taxonomy"].includes(key),
        )
    )
        throw new Error(
            "Informational index must match the exact current page",
        );
}

export function validateInformationalOutput(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
): void {
    if (
        input.pipeline !== "informational-wiki-v1" ||
        output.content.kind !== "wiki" ||
        !informationalWiki(output.content) ||
        output.inventory !== undefined ||
        output.inventoryAudit !== undefined ||
        output.coverage !== undefined ||
        output.outcome !== "knowledgePages"
    )
        throw new Error(
            "Informational construction cannot use legacy inventory contracts",
        );
    validateInformationalContent(output.content);
    const supplied = input.inputs.flatMap((entry) => entry.passages ?? []);
    for (const citation of [
        ...output.content.citations,
        ...output.relationships.flatMap((edge) => edge.citations),
    ]) {
        parseIndexedLocator(citation.locator);
        if (
            !supplied.some(
                (fragment) =>
                    viewSourceKey(fragment) === viewSourceKey(citation) &&
                    fragment.locator === citation.locator &&
                    fragment.excerpt === citation.excerpt,
            )
        )
            throw new Error(
                "Informational citation is not an exact supplied indexed fragment",
            );
    }
    if (
        !output.content.citations.length ||
        output.content.sections[0].id !== input.definition.viewId
    )
        throw new Error(
            "Informational page lacks citations or changed stable identity",
        );
}

export function informationalSchema(ids: string[]): StructuredOutputJsonSchema {
    return {
        name: "informational_wiki",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                title: { type: "string" },
                prose: { type: "string" },
                limits: { type: "string" },
                citationIds: {
                    type: "array",
                    items: { type: "string", enum: ids },
                },
            },
            required: ["title", "prose", "limits", "citationIds"],
        },
    };
}

export function hydrateInformational(
    input: ViewBuildSnapshot,
    value: unknown,
): ViewSynthesisOutput {
    if (
        !value ||
        typeof value !== "object" ||
        !("title" in value) ||
        typeof value.title !== "string" ||
        !value.title.trim() ||
        !("prose" in value) ||
        typeof value.prose !== "string" ||
        !value.prose.trim() ||
        !("limits" in value) ||
        typeof value.limits !== "string" ||
        !value.limits.trim() ||
        !("citationIds" in value) ||
        !Array.isArray(value.citationIds) ||
        !value.citationIds.length ||
        Object.keys(value).some(
            (key) => !["title", "prose", "limits", "citationIds"].includes(key),
        )
    )
        throw new Error("Invalid informational synthesis response");
    const fragments = input.inputs.flatMap((entry) => entry.passages ?? []);
    const citations = [...new Set<unknown>(value.citationIds)].map((id) => {
        if (typeof id !== "string" || !/^f\d+$/.test(id))
            throw new Error("Unknown informational fragment citation ID");
        const citation = fragments[Number(id.slice(1))];
        if (!citation)
            throw new Error("Unknown informational fragment citation ID");
        return citation;
    });
    const viewId = input.definition.viewId;
    const content: WikiContent = {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: value.title,
        summary: `Limited summary: selected indexed fragments only; ${value.limits}. Updated ${new Date().toISOString()}. Search sources or retry a deeper bounded refresh.`,
        sections: [
            {
                id: viewId,
                role: "page",
                heading: value.title,
                body: `${value.prose}\n\nCoverage limits: ${value.limits}`,
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
        index: [],
        citations,
    };
    content.index = wikiIndex(content.sections);
    return {
        content,
        outcome: "knowledgePages",
        missingEvidence: [value.limits],
        relationships: [...new Set(citations.map(viewSourceKey))].map(
            (key, position) => {
                const supporting = citations.filter(
                    (citation) => viewSourceKey(citation) === key,
                );
                const citation = supporting[0];
                return {
                    id: `fragment:${position}`,
                    predicate: "supportedBy",
                    from: { kind: "section", viewId, sectionId: viewId },
                    to: {
                        kind: "source",
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                    },
                    citations: supporting,
                };
            },
        ),
    };
}
