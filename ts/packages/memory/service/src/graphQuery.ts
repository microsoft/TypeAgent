// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    GraphSupport,
    KnowledgeGraphRequest,
    KnowledgeGraphResponse,
    KnowledgeGraphNode,
    KnowledgeGraphEdge,
    KnowledgeGraphCoverage,
    GraphReadState,
} from "./graphTypes.js";
import type { MemoryKnowledgeGraph } from "./types.js";
import {
    GraphProjectionUnavailable,
    graphProjectionLimits,
} from "./graphProjection.js";

export function graphSupportIdentity(support: GraphSupport): string {
    return JSON.stringify(
        support.kind === "event"
            ? [support.corpusId, "event", support.eventId]
            : [
                  support.corpusId,
                  "document",
                  support.sourceId,
                  support.revisionId,
              ],
    );
}

export function graphSupportCounts(supports: GraphSupport[]) {
    const events = supports.filter(
        (support): support is Extract<GraphSupport, { kind: "event" }> =>
            support.kind === "event",
    );
    return {
        distinctEventCount: new Set(events.map(graphSupportIdentity)).size,
        distinctTurnCount: new Set(
            events.flatMap((event) =>
                event.turnId
                    ? [
                          JSON.stringify([
                              event.corpusId,
                              event.conversationId ?? null,
                              event.turnId,
                          ]),
                      ]
                    : [],
            ),
        ).size,
    };
}

export function graphCoverageState(
    coverage: KnowledgeGraphCoverage,
): GraphReadState {
    const states = [
        coverage.documents.state,
        coverage.events.state,
        coverage.topics?.state,
    ];
    return (
        (["error", "unsupported", "stale", "building", "ready"] as const).find(
            (state) => states.includes(state),
        ) ?? "ready"
    );
}

export function graphIdentity(
    corpusId: string,
    kind: string,
    identity: unknown,
): string {
    return `graph:${corpusId}:${kind}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32)}`;
}

export interface GraphProjection {
    graph: MemoryKnowledgeGraph;
    supports: Map<string, GraphSupport>;
}
export interface GraphInventory {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    supports: Map<string, GraphSupport[]>;
}

export function graphInventory(
    request: KnowledgeGraphRequest,
    projections: GraphProjection[],
): GraphInventory {
    const nodes = new Map<string, KnowledgeGraphNode>();
    const edges = new Map<string, KnowledgeGraphEdge>();
    const supports = new Map<string, Map<string, GraphSupport>>();
    const support = (
        id: string,
        sourceIds: string[],
        projection: GraphProjection,
    ) => {
        const selected = supports.get(id) ?? new Map<string, GraphSupport>();
        for (const sourceId of sourceIds) {
            const reference = projection.supports.get(sourceId);
            if (reference)
                selected.set(graphSupportIdentity(reference), reference);
        }
        supports.set(id, selected);
        return selected.size;
    };
    const nodeId = (name: string) =>
        graphIdentity(
            request.corpusId,
            request.kind === "entities" ? "entity" : "topic",
            name.trim().toLowerCase(),
        );
    for (const projection of projections) {
        const entries =
            request.kind === "entities"
                ? projection.graph.entities
                : projection.graph.topics;
        for (const entry of entries) {
            const id = nodeId(entry.name);
            const node = nodes.get(id) ?? {
                id,
                kind:
                    request.kind === "entities"
                        ? ("entity" as const)
                        : ("topic" as const),
                label: entry.name,
                types: [],
                mentionCount: 0,
                supportCount: 0,
            };
            node.mentionCount += entry.mentionCount;
            if ("types" in entry && Array.isArray(entry.types))
                node.types = [
                    ...new Set([...node.types, ...(entry.types as string[])]),
                ].sort();
            node.supportCount = support(id, entry.sourceIds, projection);
            nodes.set(id, node);
        }
        if (request.kind !== "entities") continue;
        for (const relationship of projection.graph.relationships) {
            const source = nodeId(relationship.fromEntity),
                target = nodeId(relationship.toEntity);
            if (!nodes.has(source) || !nodes.has(target)) continue;
            const id = graphIdentity(request.corpusId, "edge", [
                source,
                target,
                relationship.relationshipType,
            ]);
            const edge = edges.get(id) ?? {
                id,
                source,
                target,
                type: relationship.relationshipType,
                label: relationship.relationshipType,
                count: 0,
                supportCount: 0,
            };
            edge.count += relationship.count;
            edge.supportCount = support(id, relationship.sourceIds, projection);
            edges.set(id, edge);
        }
    }
    if (request.kind === "topics")
        addTopicCooccurrences(request.corpusId, edges, supports);
    return {
        nodes: [...nodes.values()].map((node) => ({
            ...node,
            ...graphSupportCounts([...(supports.get(node.id)?.values() ?? [])]),
        })),
        edges: [...edges.values()].map((edge) => ({
            ...edge,
            ...graphSupportCounts([...(supports.get(edge.id)?.values() ?? [])]),
        })),
        supports: new Map(
            [...supports].map(([id, values]) => [id, [...values.values()]]),
        ),
    };
}

function addTopicCooccurrences(
    corpusId: string,
    edges: Map<string, KnowledgeGraphEdge>,
    supports: Map<string, Map<string, GraphSupport>>,
): void {
    const boundaries = new Map<string, Map<string, GraphSupport[]>>();
    for (const [nodeId, evidence] of supports) {
        for (const support of evidence.values()) {
            const boundary =
                support.kind === "document"
                    ? graphSupportIdentity(support)
                    : JSON.stringify([
                          support.corpusId,
                          "event-turn",
                          support.conversationId ?? null,
                          support.turnId ?? support.eventId,
                      ]);
            const nodes =
                boundaries.get(boundary) ?? new Map<string, GraphSupport[]>();
            const evidence = nodes.get(nodeId) ?? [];
            evidence.push(support);
            nodes.set(nodeId, evidence);
            boundaries.set(boundary, nodes);
        }
    }
    let examinedPairs = 0;
    let examinedSupports = 0;
    for (const boundary of boundaries.values()) {
        const ids = [...boundary.keys()].sort();
        for (let from = 0; from < ids.length; from++) {
            for (let to = from + 1; to < ids.length; to++) {
                if (++examinedPairs > graphProjectionLimits.edges)
                    throw new GraphProjectionUnavailable(
                        "Topic co-occurrence exceeds the bounded pair-computation budget.",
                    );
                const source = ids[from],
                    target = ids[to];
                const id = graphIdentity(corpusId, "edge", [
                    source,
                    target,
                    "co-occurrence",
                ]);
                const edge = edges.get(id) ?? {
                    id,
                    source,
                    target,
                    type: "co-occurrence",
                    label: "Shared document or event turn",
                    count: 0,
                    supportCount: 0,
                };
                const evidence =
                    supports.get(id) ?? new Map<string, GraphSupport>();
                for (const support of [
                    ...boundary.get(source)!,
                    ...boundary.get(target)!,
                ]) {
                    if (
                        ++examinedSupports >
                        graphProjectionLimits.semanticReferences * 4
                    )
                        throw new GraphProjectionUnavailable(
                            "Topic co-occurrence exceeds the bounded support-computation budget.",
                        );
                    evidence.set(graphSupportIdentity(support), support);
                }
                supports.set(id, evidence);
                edge.count++;
                edge.supportCount = evidence.size;
                edges.set(id, edge);
            }
        }
    }
}

export function boundGraphInventory(
    request: KnowledgeGraphRequest,
    inventory: GraphInventory,
    generation = "",
): Pick<
    KnowledgeGraphResponse,
    "nodes" | "edges" | "counts" | "limits" | "nextContinuationToken"
> {
    const maxNodes = graphLimit(request.maxNodes, 100, 250);
    const maxEdges = graphLimit(request.maxEdges, 200, 500);
    const search = request.search?.trim().toLowerCase();
    let nodes = inventory.nodes.filter(
        (node) => !search || node.label.toLowerCase().includes(search),
    );
    let edges = inventory.edges;
    if (request.nodeId) {
        const neighbors = new Set([request.nodeId]);
        for (const edge of edges) {
            if (edge.source === request.nodeId) neighbors.add(edge.target);
            if (edge.target === request.nodeId) neighbors.add(edge.source);
        }
        nodes = nodes.filter((node) => neighbors.has(node.id));
    }
    nodes.sort(
        (a, b) =>
            b.supportCount - a.supportCount ||
            b.mentionCount - a.mentionCount ||
            a.id.localeCompare(b.id),
    );
    const matching = new Set(nodes.map((node) => node.id));
    edges = edges.filter(
        (edge) => matching.has(edge.source) && matching.has(edge.target),
    );
    const totalNodes = nodes.length,
        totalEdges = edges.length;
    const pageBy = request.pageBy ?? "nodes";
    if (!["nodes", "edges"].includes(pageBy))
        throw new Error("Invalid graph paging mode");
    if (pageBy === "edges" && maxNodes < 2)
        throw new Error("Edge paging requires at least two endpoint nodes");
    const binding = graphIdentity(request.corpusId, "page", {
        ...request,
        pageBy,
        expectedGeneration: undefined,
        continuationToken: undefined,
    });
    const totalItems = pageBy === "edges" ? totalEdges : totalNodes;
    const offset = graphPageOffset(
        request.continuationToken,
        generation,
        binding,
        totalItems,
    );
    edges.sort(
        (a, b) => b.supportCount - a.supportCount || a.id.localeCompare(b.id),
    );
    const page =
        pageBy === "edges"
            ? graphEdgePage(nodes, edges, offset, maxNodes, maxEdges)
            : graphNodePage(nodes, edges, offset, maxNodes, maxEdges);
    nodes = page.nodes;
    edges = page.edges;
    const nextOffset =
        offset + (pageBy === "edges" ? edges.length : nodes.length);
    return {
        nodes,
        edges,
        counts: {
            nodes: totalNodes,
            edges: totalEdges,
            omittedNodes: totalNodes - nodes.length,
            omittedEdges: totalEdges - edges.length,
        },
        limits: { maxNodes, maxEdges, maxBytes: 512 * 1024 },
        ...(nextOffset < totalItems
            ? {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify({
                          generation,
                          binding,
                          offset: nextOffset,
                      }),
                  ).toString("base64url"),
              }
            : {}),
    };
}

function graphPageOffset(
    token: string | undefined,
    generation: string,
    binding: string,
    total: number,
): number {
    if (!token) return 0;
    const page = JSON.parse(
        Buffer.from(token, "base64url").toString("utf8"),
    ) as { generation: string; binding: string; offset: number };
    if (
        page.generation !== generation ||
        page.binding !== binding ||
        !Number.isSafeInteger(page.offset) ||
        page.offset < 0 ||
        page.offset >= total
    )
        throw new Error(
            "Graph generation changed or invalid inventory continuation token",
        );
    return page.offset;
}

function graphNodePage(
    nodes: KnowledgeGraphNode[],
    edges: KnowledgeGraphEdge[],
    offset: number,
    maxNodes: number,
    maxEdges: number,
) {
    nodes = nodes.slice(offset, offset + maxNodes);
    const included = new Set(nodes.map((node) => node.id));
    edges = edges
        .filter(
            (edge) => included.has(edge.source) && included.has(edge.target),
        )
        .slice(0, maxEdges);
    return boundedGraphPayload(nodes, edges);
}

function graphEdgePage(
    nodes: KnowledgeGraphNode[],
    edges: KnowledgeGraphEdge[],
    offset: number,
    maxNodes: number,
    maxEdges: number,
) {
    const available = new Map(nodes.map((node) => [node.id, node]));
    const selected = new Map<string, KnowledgeGraphNode>();
    const page: KnowledgeGraphEdge[] = [];
    let bytes = 0;
    for (const edge of edges.slice(offset, offset + maxEdges)) {
        const missing = [...new Set([edge.source, edge.target])]
            .filter((id) => !selected.has(id))
            .map((id) => compactGraphNode(available.get(id)!));
        const compact = compactGraphEdge(edge);
        const addedBytes =
            graphElementBytes(compact) +
            missing.reduce((sum, node) => sum + graphElementBytes(node), 0);
        if (
            selected.size + missing.length > maxNodes ||
            bytes + addedBytes > graphPayloadBudget
        )
            break;
        for (const node of missing) selected.set(node.id, node);
        page.push(compact);
        bytes += addedBytes;
    }
    if (!page.length && offset < edges.length)
        throw new GraphProjectionUnavailable(
            "An edge and its endpoints exceed the graph page budgets.",
        );
    return { nodes: [...selected.values()], edges: page };
}

const graphPayloadBudget = 480 * 1024;
function graphElementBytes(value: unknown) {
    return Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
}
function compactGraphNode(node: KnowledgeGraphNode): KnowledgeGraphNode {
    return {
        ...node,
        label: node.label.slice(0, 600),
        types: node.types.slice(0, 8).map((type) => type.slice(0, 80)),
        ...(node.scope ? { scope: node.scope.slice(0, 600) } : {}),
    };
}
function compactGraphEdge(edge: KnowledgeGraphEdge): KnowledgeGraphEdge {
    return {
        ...edge,
        type: edge.type.slice(0, 160),
        ...(edge.label ? { label: edge.label.slice(0, 160) } : {}),
    };
}

function boundedGraphPayload(
    nodes: KnowledgeGraphNode[],
    edges: KnowledgeGraphEdge[],
) {
    nodes = nodes.map(compactGraphNode);
    edges = edges.map(compactGraphEdge);
    let total =
        nodes.reduce((sum, node) => sum + graphElementBytes(node), 0) +
        edges.reduce((sum, edge) => sum + graphElementBytes(edge), 0);
    while (total > graphPayloadBudget) {
        const removed = edges.pop() ?? nodes.pop();
        if (!removed) break;
        total -= graphElementBytes(removed);
    }
    return { nodes, edges };
}

export function graphLimit(
    value: number | undefined,
    fallback: number,
    maximum: number,
): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error(
            `Graph limit must be an integer between 1 and ${maximum}`,
        );
    return value;
}
