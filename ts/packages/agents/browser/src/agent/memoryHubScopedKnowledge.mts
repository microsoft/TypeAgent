// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryGraphQueryRequest,
    MemoryGraphQueryResult,
    MemoryService,
} from "@typeagent/memory-service";
import type {
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgeKind,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuerySupport.mjs";

export async function readScopedKnowledge(
    service: MemoryService,
    corpusId: string,
    kind: Exclude<MemoryHubKnowledgeKind, "sources">,
    allPages = false,
    search?: string,
) {
    if (!service.queryKnowledgeGraph) return undefined;
    const query = service.queryKnowledgeGraph.bind(service);
    const request: MemoryGraphQueryRequest = {
        corpusId,
        kind: kind === "topics" ? "topics" : "entities",
        ...(kind === "relationships" ? { pageBy: "edges" as const } : {}),
        maxNodes: 250,
        maxEdges: 500,
        ...(search ? { search } : {}),
    };
    const pages: MemoryGraphQueryResult[] = [];
    do {
        const page = await timed(query(request));
        if (pages[0] && page.generation !== pages[0].generation)
            throw new Error(
                "Graph generation changed while loading inventory. Refresh.",
            );
        pages.push(page);
        if (!allPages || !page.nextContinuationToken) break;
        request.continuationToken = page.nextContinuationToken;
        request.expectedGeneration = page.generation;
    } while (true);
    const first = pages[0]!;
    const nodes = new Map(
        pages.flatMap((page) => page.nodes).map((node) => [node.id, node]),
    );
    const edges = new Map(
        pages.flatMap((page) => page.edges).map((edge) => [edge.id, edge]),
    );
    const items: MemoryHubKnowledgeItem[] =
        kind === "relationships"
            ? [...edges.values()].map((edge) => ({
                  id: edge.id,
                  title: `${nodes.get(edge.source)?.label ?? edge.source} → ${edge.type} → ${nodes.get(edge.target)?.label ?? edge.target}`,
                  mentions: edge.count,
                  sources: [],
                  graphSupport: {
                      corpusId,
                      generation: first.generation,
                      edgeId: edge.id,
                  },
              }))
            : [...nodes.values()].map((node) => ({
                  id: node.id,
                  title: node.label,
                  subtitle: node.types.join(" · "),
                  mentions: node.mentionCount,
                  sources: [],
                  graphSupport: {
                      corpusId,
                      generation: first.generation,
                      nodeId: node.id,
                  },
              }));
    return {
        first,
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        items,
    };
}
