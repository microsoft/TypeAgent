// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Id } from "./types.js";

export type NodeId = string;

export type NodeKind = "entity" | "episode";

export interface GraphNode {
    id: NodeId;
    label: string;
    kind: NodeKind;
    /** Back-reference to the source object (episode id, belief id, etc.). */
    ref?: Id;
}

export interface GraphEdge {
    from: NodeId;
    to: NodeId;
    type: string; // e.g. "about", "mentions", "approach", "caused_by"
    weight: number; // accumulated evidence strength
}

/**
 * A typed, weighted knowledge graph. This is the structural backbone that lets
 * AEMG do associative recall — reaching memories that share no words with the
 * query but are connected through entities and relations. Plain chunk-RAG has
 * no equivalent.
 */
export class KnowledgeGraph {
    private readonly nodeMap = new Map<NodeId, GraphNode>();
    // adjacency: from -> (edgeKey -> edge), edges are undirected for traversal
    private readonly adjacency = new Map<NodeId, Map<string, GraphEdge>>();

    static entityId(label: string): NodeId {
        return `entity:${label.trim().toLowerCase()}`;
    }

    static episodeId(ref: Id): NodeId {
        return `episode:${ref}`;
    }

    addEntity(label: string): GraphNode {
        const id = KnowledgeGraph.entityId(label);
        return this.ensureNode({ id, label, kind: "entity" });
    }

    addEpisode(ref: Id, label: string): GraphNode {
        const id = KnowledgeGraph.episodeId(ref);
        return this.ensureNode({ id, label, kind: "episode", ref });
    }

    /**
     * Add (or reinforce) a typed edge. Adding the same edge again accumulates
     * its weight, so repeated co-occurrence strengthens the association.
     */
    addEdge(from: NodeId, to: NodeId, type: string, weight = 1): void {
        if (from === to) {
            return;
        }
        this.link(from, to, type, weight);
        this.link(to, from, type, weight);
    }

    getNode(id: NodeId): GraphNode | undefined {
        return this.nodeMap.get(id);
    }

    hasNode(id: NodeId): boolean {
        return this.nodeMap.has(id);
    }

    neighbors(id: NodeId): GraphEdge[] {
        const edges = this.adjacency.get(id);
        return edges ? Array.from(edges.values()) : [];
    }

    nodes(): IterableIterator<GraphNode> {
        return this.nodeMap.values();
    }

    get nodeCount(): number {
        return this.nodeMap.size;
    }

    // --- internals -------------------------------------------------------

    private ensureNode(node: GraphNode): GraphNode {
        const existing = this.nodeMap.get(node.id);
        if (existing) {
            return existing;
        }
        this.nodeMap.set(node.id, node);
        this.adjacency.set(node.id, new Map());
        return node;
    }

    private link(from: NodeId, to: NodeId, type: string, weight: number): void {
        const edges = this.adjacency.get(from) ?? new Map<string, GraphEdge>();
        const key = `${to}\u0000${type}`;
        const existing = edges.get(key);
        if (existing) {
            existing.weight += weight;
        } else {
            edges.set(key, { from, to, type, weight });
        }
        this.adjacency.set(from, edges);
    }
}
