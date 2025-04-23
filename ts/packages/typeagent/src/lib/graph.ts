// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readJsonFile, writeJsonFile } from "../objStream.js";
import { MultiMap } from "./multimap.js";

/**
 * An in-memory Graph
 */
export interface Graph<TNode, TEdge, TNodeId> {
    size(): number;
    getNode(id: TNodeId): TNode | undefined;
    getNodeAndEdges(
        id: TNodeId,
    ): [TNode, GraphEdge<TEdge, TNodeId>[]] | undefined;
    putNode(node: TNode, id: TNodeId): void;
    removeNode(id: TNodeId): TNode | undefined;
    entries(): IterableIterator<[TNodeId, TNode]>;
    nodeIds(): IterableIterator<TNodeId>;
    nodes(): IterableIterator<TNode>;

    pushEdge(
        fromNodeId: TNodeId,
        toNodeId: TNodeId,
        value: TEdge,
        comparer?: (
            value: GraphEdge<TEdge, TNodeId>,
            toValue: GraphEdge<TEdge, TNodeId>,
        ) => boolean,
    ): void;
    getEdges(fromNodeId: TNodeId): GraphEdge<TEdge, TNodeId>[] | undefined;
    edges(): IterableIterator<[TNodeId, GraphEdge<TEdge, TNodeId>[]]>;
    findEdge(
        fromNodeId: TNodeId,
        predicate: (
            value: GraphEdge<TEdge, TNodeId>,
            index: number,
            obj: GraphEdge<TEdge, TNodeId>[],
        ) => boolean,
    ): GraphEdge<TEdge, TNodeId> | undefined;
    indexOfEdge(
        fromNodeId: TNodeId,
        predicate: (
            value: GraphEdge<TEdge, TNodeId>,
            index: number,
            obj: GraphEdge<TEdge, TNodeId>[],
        ) => boolean,
    ): number;
    removeEdgeAt(fromNodeId: TNodeId, pos: number): boolean;
    clearEdges(fromNodeId: TNodeId): void;

    snapshot(): GraphSnapshot<TNode, TEdge, TNodeId>;
}

export type GraphEdge<TEdge, TNodeId> = {
    toNodeId: TNodeId;
    value: TEdge;
};

export type GraphSnapshot<TNode, TEdge, TNodeId> = {
    nodes: [TNodeId, TNode][];
    edges: [TNodeId, GraphEdge<TEdge, TNodeId>[]][];
};

export function createGraph<TNode, TEdge, TNodeId = number>(
    loadFrom?: GraphSnapshot<TNode, TEdge, TNodeId>,
): Graph<TNode, TEdge, TNodeId> {
    // node id -> node
    const graphNodes = new Map<TNodeId, TNode>(
        loadFrom ? loadFrom.nodes : undefined,
    );
    // node id -> GraphEdge[]
    const graphEdges = new MultiMap<TNodeId, GraphEdge<TEdge, TNodeId>>(
        loadFrom ? loadFrom.edges : undefined,
    );
    return {
        size() {
            return graphNodes.size;
        },
        getNode,
        getNodeAndEdges,
        putNode,
        entries,
        nodeIds: () => graphNodes.keys(),
        nodes: () => graphNodes.values(),
        removeNode,
        pushEdge,
        getEdges,
        edges,
        findEdge,
        indexOfEdge,
        removeEdgeAt,
        clearEdges,
        snapshot,
    };

    function entries(): IterableIterator<[TNodeId, TNode]> {
        return graphNodes.entries();
    }

    function getNode(id: TNodeId): TNode | undefined {
        return graphNodes.get(id);
    }

    function getNodeAndEdges(
        id: TNodeId,
    ): [TNode, GraphEdge<TEdge, TNodeId>[]] | undefined {
        const node = getNode(id);
        if (node) {
            return [node, getEdges(id) ?? []];
        }
        return undefined;
    }

    function putNode(node: TNode, id: TNodeId): void {
        graphNodes.set(id, node);
    }

    function removeNode(id: TNodeId): TNode | undefined {
        const entity = graphNodes.get(id);
        if (entity) {
            graphNodes.delete(id);
            graphEdges.delete(id);
            return entity;
        }
        return undefined;
    }

    function pushEdge(
        fromNodeId: TNodeId,
        toNodeId: TNodeId,
        value: TEdge,
        comparer?: (
            value: GraphEdge<TEdge, TNodeId>,
            toValue: GraphEdge<TEdge, TNodeId>,
        ) => boolean,
    ): void {
        graphEdges.addUnique(fromNodeId, { toNodeId, value }, comparer);
    }

    function getEdges(
        fromNodeId: TNodeId,
    ): GraphEdge<TEdge, TNodeId>[] | undefined {
        return graphEdges.get(fromNodeId);
    }

    function edges(): IterableIterator<[TNodeId, GraphEdge<TEdge, TNodeId>[]]> {
        return graphEdges.entries();
    }

    function findEdge(
        fromNodeId: TNodeId,
        predicate: (
            value: GraphEdge<TEdge, TNodeId>,
            index: number,
            obj: GraphEdge<TEdge, TNodeId>[],
        ) => boolean,
    ): GraphEdge<TEdge, TNodeId> | undefined {
        return graphEdges.find(fromNodeId, predicate);
    }

    function removeEdgeAt(fromNodeId: TNodeId, pos: number): boolean {
        return graphEdges.removeAt(fromNodeId, pos);
    }

    function indexOfEdge(
        fromNodeId: TNodeId,
        predicate: (
            value: GraphEdge<TEdge, TNodeId>,
            index: number,
            obj: GraphEdge<TEdge, TNodeId>[],
        ) => boolean,
    ): number {
        return graphEdges.indexOf(fromNodeId, predicate);
    }

    function clearEdges(fromNodeId: TNodeId): void {
        graphEdges.delete(fromNodeId);
    }

    function snapshot(): GraphSnapshot<TNode, TEdge, TNodeId> {
        return {
            nodes: [...entries()],
            edges: [...edges()],
        };
    }
}

export function saveGraphToFile<TNode, TEdge, TNodeId = number>(
    graph: Graph<TNode, TEdge, TNodeId>,
    filePath: string,
): Promise<void> {
    return writeJsonFile(filePath, graph.snapshot());
}

export async function loadGraphFromFile<TNode, TEdge, TNodeId = number>(
    filePath: string,
): Promise<Graph<TNode, TEdge, TNodeId> | undefined> {
    const snapshot =
        await readJsonFile<GraphSnapshot<TNode, TEdge, TNodeId>>(filePath);
    if (snapshot) {
        return createGraph<TNode, TEdge, TNodeId>(snapshot);
    }
    return undefined;
}
