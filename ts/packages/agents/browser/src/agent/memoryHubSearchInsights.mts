// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryService,
    MemoryKnowledgeGraph,
} from "@typeagent/memory-service";
import type {
    MemoryHubEvidence,
    MemoryHubSearchInsights,
    MemoryHubSearchRequest,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuerySupport.mjs";

async function sourceGraph(
    service: MemoryService,
    evidence: MemoryHubEvidence,
): Promise<MemoryKnowledgeGraph> {
    const source = await service.getSource(
        evidence.corpusId,
        evidence.objectId,
    );
    if (!source || source.activeRevisionId !== evidence.revisionId) {
        throw new Error(
            "Query evidence is not the active retained revision; current knowledge is not substituted for historical evidence.",
        );
    }
    const graph = await service.getSourceKnowledge(
        evidence.corpusId,
        evidence.objectId,
    );
    const current = await service.getSource(
        evidence.corpusId,
        evidence.objectId,
    );
    if (!current || current.activeRevisionId !== evidence.revisionId) {
        throw new Error(
            "Source changed while loading query insights; retry the search.",
        );
    }
    return graph;
}

function aggregate(
    graphs: MemoryKnowledgeGraph[],
): Pick<MemoryHubSearchInsights, "topTopics" | "relatedEntities"> {
    const topics = new Map<string, number>();
    const entities = new Map<
        string,
        { name: string; type: string; count: number }
    >();
    for (const graph of graphs) {
        for (const topic of graph.topics) {
            topics.set(
                topic.name,
                (topics.get(topic.name) ?? 0) + topic.mentionCount,
            );
        }
        for (const entity of graph.entities) {
            const type = entity.types[0] ?? "type unavailable";
            const key = JSON.stringify([entity.name, type]);
            const previous = entities.get(key);
            entities.set(key, {
                name: entity.name,
                type,
                count: (previous?.count ?? 0) + entity.mentionCount,
            });
        }
    }
    return {
        topTopics: [...topics]
            .sort(
                (left, right) =>
                    right[1] - left[1] || left[0].localeCompare(right[0]),
            )
            .slice(0, 20)
            .map(([name]) => name),
        relatedEntities: [...entities.values()]
            .sort(
                (left, right) =>
                    right.count - left.count ||
                    left.name.localeCompare(right.name) ||
                    left.type.localeCompare(right.type),
            )
            .slice(0, 20)
            .map(({ name, type }) => ({ name, type })),
    };
}

export async function memoryHubSearchInsights(
    service: MemoryService,
    request: MemoryHubSearchRequest,
    matches: MemoryHubEvidence[],
): Promise<MemoryHubSearchInsights> {
    const result: MemoryHubSearchInsights = {
        provider: "canonical",
        status: "unsupported",
        ...(request.corpusId === undefined
            ? {}
            : { corpusId: request.corpusId }),
        topTopics: [],
        relatedEntities: [],
    };
    const sources = [
        ...new Map(
            matches
                .filter((match) => match.kind === "source")
                .map((match) => [
                    JSON.stringify([
                        match.corpusId,
                        match.objectId,
                        match.revisionId,
                    ]),
                    match,
                ]),
        ).values(),
    ];
    if (!sources.length) {
        result.message =
            "No document-source evidence was returned. Conversation/procedure-only query insights are not supplied by the source knowledge API.";
        return result;
    }
    if (typeof service.getSourceKnowledge !== "function") {
        result.message =
            "This host does not expose canonical source knowledge for query insights.";
        return result;
    }
    try {
        const graphs = await timed(
            Promise.all(
                sources
                    .slice(0, 20)
                    .map((evidence) => sourceGraph(service, evidence)),
            ),
        );
        Object.assign(result, aggregate(graphs));
        result.status = "available";
        result.message = `Derived knowledge from ${Math.min(sources.length, 20)} exact active source revisions in returned query evidence; at most 20 topics/entities. Not corpus-wide statistics.`;
    } catch (error) {
        result.status = "unavailable";
        result.message = error instanceof Error ? error.message : String(error);
    }
    return result;
}
