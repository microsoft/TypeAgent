// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryGraphNode,
    MemoryGraphEdge,
    MemoryGraphQueryRequest,
    MemoryService,
} from "@typeagent/memory-service";
import type {
    MemoryHubGraphFunctions,
    MemoryHubGraphRequest,
    MemoryHubGraphResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mapMemoryHubCorpora } from "./memoryHub.mjs";
import { queryCorpora, timed } from "./memoryHubQuery.mjs";
import {
    buildGraphologyGraph,
    convertToCytoscapeElements,
} from "./knowledge/utils/graphologyLayoutEngine.mjs";

function graphBudget(value: number | undefined, fallback: number): number {
    const limit = value ?? fallback;
    if (!Number.isInteger(limit) || limit < 1 || limit > fallback)
        throw new Error(`Graph limit must be between 1 and ${fallback}.`);
    return limit;
}

function layout(
    nodes: MemoryGraphNode[],
    edges: MemoryGraphEdge[],
): MemoryHubGraphResult["presetLayout"] {
    if (!nodes.length) return { elements: [] };
    const graph = buildGraphologyGraph(
        nodes.map((node) => ({
            id: node.id,
            name: node.label,
            type: node.kind,
            count: node.mentionCount,
        })),
        edges.map((edge) => ({
            from: edge.source,
            to: edge.target,
            type: edge.type,
            strength: edge.count,
        })),
        {
            nodeLimit: 250,
            forceAtlas2Iterations: 20,
            noverlapIterations: 20,
            skipEdgeFiltering: true,
            preserveIsolatedNodes: true,
        },
    );
    const positions = new Map(
        convertToCytoscapeElements(
            graph,
            Math.max(250, Math.sqrt(nodes.length) * 50),
        )
            .filter((element) => element.data.source === undefined)
            .map((element) => [element.data.id, element]),
    );
    return {
        elements: [
            ...nodes.map((node) => {
                const placed = positions.get(node.id);
                const position = placed?.position;
                return {
                    data: {
                        ...node,
                        name: node.label,
                        label: node.label,
                        nodeType: node.kind,
                        type: node.types?.[0] ?? node.kind,
                        size: 35,
                        important: true,
                        color: placed?.data.color ?? "#5e81ac",
                    },
                    ...(position === undefined ? {} : { position }),
                };
            }),
            ...edges.map((edge) => ({
                data: { ...edge, label: edge.label ?? edge.type },
            })),
        ],
    };
}

function boundGraphResponse(result: MemoryHubGraphResult) {
    const largestFirst = result.corpora
        .map((corpus) => ({
            corpusId: corpus.corpusId,
            bytes: Buffer.byteLength(JSON.stringify(corpus)),
        }))
        .sort((a, b) => b.bytes - a.bytes);
    for (const corpus of largestFirst) {
        if (
            Buffer.byteLength(
                JSON.stringify({ success: true, data: result }),
            ) <=
            512 * 1024
        )
            break;
        const removed = result.corpora.find(
            (item) => item.corpusId === corpus.corpusId,
        )!;
        const ids = new Set([
            ...removed.graph.nodes.map((node) => node.id),
            ...removed.graph.edges.map((edge) => edge.id),
        ]);
        result.corpora = result.corpora.filter((item) => item !== removed);
        result.presetLayout.elements = result.presetLayout.elements.filter(
            (element) => !ids.has(element.data.id),
        );
        result.errors.push({
            corpusId: corpus.corpusId,
            message:
                "Graph exceeds the combined 512 KiB response budget. Narrow the search or evidence filters.",
        });
    }
}

export function createMemoryHubGraphFunctions(
    getService: () => MemoryService,
): MemoryHubGraphFunctions {
    async function graph(
        request: MemoryHubGraphRequest,
    ): Promise<MemoryHubGraphResult> {
        if (
            !request.corpusId &&
            (request.continuationToken || request.expectedGeneration)
        )
            throw new Error(
                "Graph paging and generation checks require one selected collection.",
            );
        const service = getService();
        const maxNodes = graphBudget(request.maxNodes, 250);
        const maxEdges = graphBudget(request.maxEdges, 500);
        const corpora = await queryCorpora(service, request.corpusId);
        const selected = corpora.slice(0, Math.min(maxNodes, maxEdges));
        const result: MemoryHubGraphResult = {
            corpora: [],
            errors: [],
            omittedCorpora: corpora.length - selected.length,
            presetLayout: { elements: [] },
        };
        const query = service.queryKnowledgeGraph;
        if (!query)
            throw new Error("This memory host does not support scoped graphs.");
        await mapMemoryHubCorpora(selected, async (corpus) => {
            try {
                const input: MemoryGraphQueryRequest = {
                    ...request,
                    corpusId: corpus.corpusId,
                    maxNodes: Math.floor(maxNodes / selected.length),
                    maxEdges: Math.max(
                        1,
                        Math.floor(maxEdges / selected.length),
                    ),
                };
                const graph = await timed(query.call(service, input));
                result.corpora.push({
                    corpusId: corpus.corpusId,
                    corpusName: corpus.name,
                    graph: {
                        generation: graph.generation,
                        nodes: graph.nodes,
                        edges: graph.edges,
                        ...(graph.coverage.topics?.generation
                            ? {
                                  topicGeneration:
                                      graph.coverage.topics.generation,
                              }
                            : {}),
                    },
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                result.errors.push({
                    corpusId: corpus.corpusId,
                    message:
                        message.length > 512
                            ? `${message.slice(0, 500)} [truncated]`
                            : message,
                });
            }
        });
        result.corpora.sort((a, b) => a.corpusId.localeCompare(b.corpusId));
        result.errors.sort((a, b) => a.corpusId.localeCompare(b.corpusId));
        result.presetLayout = layout(
            result.corpora.flatMap((item) => item.graph.nodes),
            result.corpora.flatMap((item) => item.graph.edges),
        );
        boundGraphResponse(result);
        result.errors.sort((a, b) => a.corpusId.localeCompare(b.corpusId));
        return result;
    }

    return {
        memoryHubGraph: graph,
        async memoryHubGraphSupport(request) {
            const service = getService();
            await queryCorpora(service, request.corpusId);
            if (!service.queryGraphSupport)
                throw new Error("Graph evidence paging is unsupported.");
            return timed(service.queryGraphSupport(request));
        },
        async memoryHubGraphEvent(request) {
            const service = getService();
            await queryCorpora(service, request.corpusId);
            const event = await timed(
                service.getEvent(request.corpusId, request.eventId),
            );
            if (!event)
                throw new Error("Event evidence is no longer available.");
            const content = JSON.stringify(event, null, 2);
            const offset = request.offset ?? 0;
            if (
                !Number.isSafeInteger(offset) ||
                offset < 0 ||
                offset > content.length
            )
                throw new Error("Invalid event evidence offset.");
            const next = Math.min(content.length, offset + 12_000);
            return {
                title: event.eventType,
                content: content.slice(offset, next),
                offset,
                totalChars: content.length,
                ...(next < content.length ? { nextOffset: next } : {}),
            };
        },
    };
}
