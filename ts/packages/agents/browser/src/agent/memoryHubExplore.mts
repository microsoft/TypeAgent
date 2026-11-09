// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    MemoryHubExploreResult,
    MemoryHubFunctions,
    MemoryHubGraphSource,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mapMemoryHubCorpora, pageMemoryHubCorpora } from "./memoryHub.mjs";
import {
    queryCorpora,
    timed,
    type MemoryHubReadService,
} from "./memoryHubQuery.mjs";
import { readScopedKnowledge } from "./memoryHubScopedKnowledge.mjs";

async function scopedOverview(
    service: MemoryHubReadService,
    corpusId: string,
    result: MemoryHubExploreResult,
) {
    const [entities, topics] = await Promise.all([
        readScopedKnowledge(service, corpusId, "entities"),
        readScopedKnowledge(service, corpusId, "topics"),
    ]);
    if (!entities || !topics)
        throw new Error("Scoped knowledge capability is unavailable.");
    for (const inventory of [entities, topics])
        for (const reason of inventory.first.coverage.reasons)
            result.errors.push({
                corpusId,
                operation: "graph",
                message: reason,
            });
    result.entities.push(
        ...entities.items.map((item) => ({
            id: item.id,
            name: item.title,
            types: entities.nodes.find((node) => node.id === item.id)!.types,
            mentionCount: item.mentions ?? 0,
            sources: item.sources,
            ...(item.graphSupport ? { graphSupport: item.graphSupport } : {}),
        })),
    );
    result.topics.push(
        ...topics.items.map((item) => ({
            id: item.id,
            name: item.title,
            mentionCount: item.mentions ?? 0,
            sources: item.sources,
            ...(item.graphSupport ? { graphSupport: item.graphSupport } : {}),
        })),
    );
    const names = new Map(entities.nodes.map((node) => [node.id, node.label]));
    result.relationships.push(
        ...entities.edges.map((edge) => ({
            id: edge.id,
            fromId: edge.source,
            toId: edge.target,
            type: edge.type,
            fromName: names.get(edge.source) ?? edge.source,
            toName: names.get(edge.target) ?? edge.target,
            count: edge.count,
            sources: [],
            graphSupport: {
                corpusId,
                generation: entities.first.generation,
                edgeId: edge.id,
            },
        })),
    );
    result.counts.entities += entities.first.counts.nodes;
    result.counts.topics += topics.first.counts.nodes;
    result.counts.relationships += entities.first.counts.edges;
    result.counts.events =
        (result.counts.events ?? 0) + entities.first.coverage.events.eligible;
    result.sourceInventory = "documents";
    const sources = await timed(
        service.listSourcesPage({ corpusId, pageSize: 6 }),
    );
    (result.contributingSources ??= []).push(
        ...sources.items.map((source) => ({
            corpusId,
            sourceId: source.sourceId,
            ...(source.title ? { title: source.title } : {}),
        })),
    );
}

export function identity(kind: string, corpusId: string, name: string): string {
    return JSON.stringify([kind, corpusId, name]);
}

export function graphSources(
    corpusId: string,
    sourceIds: string[],
): MemoryHubGraphSource[] {
    return [...new Set(sourceIds)]
        .sort()
        .map((sourceId) => ({ corpusId, sourceId }));
}

async function explore(
    service: MemoryHubReadService,
    request: { corpusId?: string; maxNodes?: number },
): Promise<MemoryHubExploreResult> {
    const maxNodes = request.maxNodes ?? 200;
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 5000)
        throw new Error("Explore node limit must be between 1 and 5000.");
    const corpora = await queryCorpora(service, request.corpusId);
    const result: MemoryHubExploreResult = {
        corpora: [],
        counts: {
            sources: 0,
            entities: 0,
            topics: 0,
            relationships: 0,
        },
        entities: [],
        topics: [],
        relationships: [],
        omittedEntities: 0,
        errors: [],
    };
    await mapMemoryHubCorpora(corpora, async (corpus) => {
        try {
            const status = await timed(service.getCorpus(corpus.corpusId));
            if (!status) throw new Error("Corpus is no longer available.");
            result.corpora.push(status);
            result.counts.sources += status.sourceCount;
        } catch (error) {
            result.errors.push({
                corpusId: corpus.corpusId,
                operation: "sources",
                message: error instanceof Error ? error.message : String(error),
            });
        }
        await Promise.all([
            (async () => {
                try {
                    if (service.queryKnowledgeGraph) {
                        await scopedOverview(service, corpus.corpusId, result);
                        return;
                    }
                    const graph = await timed(
                        service.getKnowledgeGraph(corpus.corpusId),
                    );
                    result.counts.entities += graph.entities.length;
                    result.counts.topics += graph.topics.length;
                    result.counts.relationships += graph.relationships.length;
                    result.entities.push(
                        ...graph.entities.map((entity) => ({
                            id: identity(
                                "entity",
                                corpus.corpusId,
                                entity.name,
                            ),
                            name: entity.name,
                            types: entity.types,
                            mentionCount: entity.mentionCount,
                            sources: graphSources(
                                corpus.corpusId,
                                entity.sourceIds,
                            ),
                        })),
                    );
                    result.topics.push(
                        ...graph.topics.map((topic) => ({
                            id: identity("topic", corpus.corpusId, topic.name),
                            name: topic.name,
                            mentionCount: topic.mentionCount,
                            sources: graphSources(
                                corpus.corpusId,
                                topic.sourceIds,
                            ),
                        })),
                    );
                    result.relationships.push(
                        ...graph.relationships.map((relationship) => ({
                            id: identity(
                                "relationship",
                                corpus.corpusId,
                                JSON.stringify([
                                    relationship.fromEntity,
                                    relationship.toEntity,
                                    relationship.relationshipType,
                                ]),
                            ),
                            fromId: identity(
                                "entity",
                                corpus.corpusId,
                                relationship.fromEntity,
                            ),
                            toId: identity(
                                "entity",
                                corpus.corpusId,
                                relationship.toEntity,
                            ),
                            type: relationship.relationshipType,
                            fromName: relationship.fromEntity,
                            toName: relationship.toEntity,
                            count: relationship.count,
                            sources: graphSources(
                                corpus.corpusId,
                                relationship.sourceIds,
                            ),
                        })),
                    );
                } catch (error) {
                    result.errors.push({
                        corpusId: corpus.corpusId,
                        operation: "graph",
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            })(),
        ]);
    });
    const contributors = new Map(
        [...result.entities, ...result.topics, ...result.relationships]
            .flatMap((item) => item.sources)
            .map((source) => [JSON.stringify(source), source]),
    );
    result.contributingSourceCount = result.sourceInventory
        ? result.counts.sources
        : contributors.size;
    result.contributingSources = [
        ...(result.contributingSources ?? []),
        ...contributors.values(),
    ]
        .sort(
            (a, b) =>
                a.corpusId.localeCompare(b.corpusId) ||
                a.sourceId.localeCompare(b.sourceId),
        )
        .slice(0, maxNodes);
    await Promise.all(
        result.contributingSources
            .filter((source) => !source.title)
            .slice(0, 6)
            .map(async (source) => {
                try {
                    const metadata = await timed(
                        service.getSource(source.corpusId, source.sourceId),
                    );
                    if (!metadata)
                        throw new Error(
                            "Contributing source is no longer available.",
                        );
                    source.title = metadata.title;
                } catch (error) {
                    result.errors.push({
                        corpusId: source.corpusId,
                        operation: "sources",
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            }),
    );
    result.entities.sort(
        (a, b) => b.mentionCount - a.mentionCount || a.id.localeCompare(b.id),
    );
    result.omittedEntities = Math.max(0, result.counts.entities - maxNodes);
    result.entities = result.entities.slice(0, maxNodes);
    result.relationships.sort(
        (a, b) => b.count - a.count || a.id.localeCompare(b.id),
    );
    result.relationships = result.relationships.slice(0, maxNodes);
    result.topics.sort(
        (a, b) => b.mentionCount - a.mentionCount || a.id.localeCompare(b.id),
    );
    result.topics = result.topics.slice(0, maxNodes);
    result.corpora.sort((a, b) => a.corpusId.localeCompare(b.corpusId));
    result.errors.sort(
        (a, b) =>
            a.corpusId.localeCompare(b.corpusId) ||
            a.operation.localeCompare(b.operation),
    );
    return result;
}

export function createMemoryHubExploreFunctions(
    getService: () => MemoryHubReadService,
): Pick<MemoryHubFunctions, "memoryHubExplore" | "memoryHubChanges"> {
    return {
        memoryHubExplore: (request) => explore(getService(), request),
        async memoryHubChanges(request) {
            const service = getService();
            const listChanges = service.listChanges;
            if (!listChanges)
                throw new Error(
                    "Durable Changes history is unavailable in this host.",
                );
            const corpora = await queryCorpora(service, request.corpusId);
            const scope = createHash("sha256")
                .update(
                    JSON.stringify([
                        "changes",
                        corpora.map((corpus) => corpus.corpusId),
                    ]),
                )
                .digest("hex");
            return pageMemoryHubCorpora(
                corpora,
                request,
                scope,
                "changes",
                (corpusId, pageSize, continuationToken) =>
                    timed(
                        listChanges.call(service, {
                            corpusId,
                            pageSize,
                            ...(continuationToken === undefined
                                ? {}
                                : { continuationToken }),
                        }),
                    ),
            );
        },
    };
}
