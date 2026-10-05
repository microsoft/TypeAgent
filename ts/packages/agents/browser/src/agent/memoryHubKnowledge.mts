// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversationCorpusName,
    type MemoryKnowledgeGraph,
} from "@typeagent/memory-service";
import type {
    MemoryHubFunctions,
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgeRequest,
    MemoryHubKnowledgePage,
} from "@typeagent/browser-control-rpc/viewRpc";
import { browserCorpusName } from "./browserMemoryService.mjs";
import { identity, graphSources } from "./memoryHubExplore.mjs";
import { mapMemoryHubCorpora } from "./memoryHub.mjs";
import {
    queryCorpora,
    timed,
    type MemoryHubReadService,
} from "./memoryHubQuery.mjs";

function derivedItems(
    corpusId: string,
    graph: MemoryKnowledgeGraph,
    kind: MemoryHubKnowledgeRequest["kind"],
): MemoryHubKnowledgeItem[] {
    if (kind === "entities")
        return graph.entities.map((item) => ({
            id: identity("entity", corpusId, item.name),
            title: item.name,
            subtitle: item.types.join(" · "),
            mentions: item.mentionCount,
            sources: graphSources(corpusId, item.sourceIds),
        }));
    if (kind === "topics")
        return graph.topics.map((item) => ({
            id: identity("topic", corpusId, item.name),
            title: item.name,
            mentions: item.mentionCount,
            sources: graphSources(corpusId, item.sourceIds),
        }));
    return graph.relationships.map((item) => ({
        id: identity(
            "relationship",
            corpusId,
            JSON.stringify([
                item.fromEntity,
                item.toEntity,
                item.relationshipType,
            ]),
        ),
        title: `${item.fromEntity} → ${item.relationshipType} → ${item.toEntity}`,
        mentions: item.count,
        sources: graphSources(corpusId, item.sourceIds),
    }));
}

function validate(request: MemoryHubKnowledgeRequest) {
    if (
        !["entities", "topics", "relationships", "sources"].includes(
            request.kind,
        )
    )
        throw new Error("Unsupported knowledge collection.");
    if (request.browserOnly && request.corpusId)
        throw new Error("Browser knowledge cannot use a selected corpus.");
    if (
        request.sort !== undefined &&
        !["name", "mentions"].includes(request.sort)
    )
        throw new Error("Unsupported knowledge sort.");
    if (
        request.query !== undefined &&
        (typeof request.query !== "string" || request.query.length > 512)
    )
        throw new Error("Knowledge filter must be at most 512 characters.");
    const offset = request.offset ?? 0;
    const pageSize = request.pageSize ?? 24;
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100
    )
        throw new Error("Invalid knowledge page.");
    return { offset, pageSize };
}

export function createMemoryHubKnowledgeFunctions(
    getService: () => MemoryHubReadService,
): Pick<MemoryHubFunctions, "memoryHubKnowledge"> {
    return {
        async memoryHubKnowledge(request): Promise<MemoryHubKnowledgePage> {
            const { offset, pageSize } = validate(request);
            const service = getService();
            let corpora = await queryCorpora(service, request.corpusId);
            if (request.browserOnly) {
                corpora = corpora.filter(
                    (corpus) => corpus.name === browserCorpusName,
                );
                if (corpora.length !== 1)
                    throw new Error(
                        "TypeAgent Browser Memory is unavailable or ambiguous.",
                    );
            }
            const items: MemoryHubKnowledgeItem[] = [];
            const errors: MemoryHubKnowledgePage["errors"] = [];
            await mapMemoryHubCorpora(corpora, async (corpus) => {
                try {
                    if (corpus.name === conversationCorpusName)
                        throw new Error(
                            "Conversation knowledge collections are unavailable; use Search for turn evidence.",
                        );
                    const graph = await timed(
                        service.getKnowledgeGraph(corpus.corpusId),
                    );
                    if (request.kind === "sources") {
                        const contributors = new Set(
                            [
                                ...graph.entities,
                                ...graph.topics,
                                ...graph.relationships,
                            ].flatMap((item) => item.sourceIds),
                        );
                        const sources = await timed(
                            service.listSources(corpus.corpusId),
                        );
                        const available = new Set(
                            sources.map((source) => source.sourceId),
                        );
                        const missing = [...contributors].filter(
                            (sourceId) => !available.has(sourceId),
                        ).length;
                        if (missing)
                            errors.push({
                                corpusId: corpus.corpusId,
                                operation: "sources",
                                message: `${missing} contributing source identities have unavailable metadata.`,
                            });
                        items.push(
                            ...sources
                                .filter((source) =>
                                    contributors.has(source.sourceId),
                                )
                                .map((source) => ({
                                    id: identity(
                                        "source",
                                        corpus.corpusId,
                                        source.sourceId,
                                    ),
                                    title: source.title ?? source.sourceId,
                                    subtitle: `${corpus.name} · ${source.sourceType}`,
                                    sources: [
                                        {
                                            corpusId: corpus.corpusId,
                                            sourceId: source.sourceId,
                                        },
                                    ],
                                })),
                        );
                    } else {
                        items.push(
                            ...derivedItems(
                                corpus.corpusId,
                                graph,
                                request.kind,
                            ).map((item) => ({
                                ...item,
                                subtitle: [item.subtitle, corpus.name]
                                    .filter(Boolean)
                                    .join(" · "),
                            })),
                        );
                    }
                } catch (error) {
                    errors.push({
                        corpusId: corpus.corpusId,
                        operation:
                            request.kind === "sources" ? "sources" : "graph",
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            });
            const query = request.query?.trim().toLocaleLowerCase() ?? "";
            const matches = items.filter((item) =>
                `${item.title} ${item.subtitle ?? ""}`
                    .toLocaleLowerCase()
                    .includes(query),
            );
            matches.sort(
                (a, b) =>
                    (request.sort === "name"
                        ? 0
                        : (b.mentions ?? 0) - (a.mentions ?? 0)) ||
                    a.title.localeCompare(b.title) ||
                    a.id.localeCompare(b.id),
            );
            errors.sort((a, b) => a.corpusId.localeCompare(b.corpusId));
            return {
                items: matches.slice(offset, offset + pageSize),
                total: matches.length,
                errors,
            };
        },
    };
}
