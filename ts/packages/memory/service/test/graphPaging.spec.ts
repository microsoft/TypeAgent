// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { boundGraphInventory, type GraphInventory } from "../src/graphQuery.js";
import type { KnowledgeGraphRequest } from "../src/graphTypes.js";

function inventory(): GraphInventory {
    return {
        nodes: Array.from({ length: 300 }, (_, ordinal) => ({
            id: `node:${ordinal}`,
            kind: "entity",
            label: `Entity ${ordinal}`,
            types: [],
            mentionCount: 1,
            supportCount: 1,
        })),
        edges: Array.from({ length: 600 }, (_, ordinal) => ({
            id: `edge:${ordinal}`,
            source: `node:${ordinal % 300}`,
            target: `node:${(ordinal + 151) % 300}`,
            type: `relation-${Math.floor(ordinal / 300)}`,
            count: 1,
            supportCount: 1,
        })),
        supports: new Map(),
    };
}

test("edge pages enumerate every cross-node-page relationship exactly once with bounded resolvable endpoints", () => {
    const graph = inventory();
    const request: KnowledgeGraphRequest = {
        corpusId: "corpus",
        kind: "entities",
        pageBy: "edges",
        maxNodes: 7,
        maxEdges: 23,
    };
    const seen = new Set<string>();
    let continuationToken: string | undefined;
    let pages = 0;
    do {
        const page = boundGraphInventory(
            { ...request, ...(continuationToken ? { continuationToken } : {}) },
            graph,
            "generation",
        );
        expect(page.nodes.length).toBeLessThanOrEqual(7);
        expect(page.edges.length).toBeGreaterThan(0);
        expect(page.edges.length).toBeLessThanOrEqual(23);
        expect(page.counts).toEqual({
            nodes: 300,
            edges: 600,
            omittedNodes: 300 - page.nodes.length,
            omittedEdges: 600 - page.edges.length,
        });
        const nodeIds = new Set(page.nodes.map((node) => node.id));
        for (const edge of page.edges) {
            expect(nodeIds.has(edge.source)).toBe(true);
            expect(nodeIds.has(edge.target)).toBe(true);
            expect(seen.has(edge.id)).toBe(false);
            seen.add(edge.id);
        }
        continuationToken = page.nextContinuationToken;
        expect(++pages).toBeLessThan(1000);
    } while (continuationToken);
    expect(seen).toEqual(new Set(graph.edges.map((edge) => edge.id)));
    expect(
        boundGraphInventory(
            { corpusId: "corpus", kind: "entities", maxNodes: 7 },
            graph,
            "generation",
        ).edges,
    ).toEqual([]);
});

test("edge continuations bind generation, filters, node/edge budgets and paging mode", () => {
    const graph = inventory();
    const request: KnowledgeGraphRequest = {
        corpusId: "corpus",
        kind: "entities",
        pageBy: "edges",
        maxNodes: 2,
        maxEdges: 1,
    };
    const first = boundGraphInventory(request, graph, "generation");
    const continuationToken = first.nextContinuationToken!;
    expect(first.nodes).toHaveLength(2);
    expect(first.edges).toHaveLength(1);
    for (const change of [
        { pageBy: "nodes" as const },
        { search: "Entity 1" },
        { eventFilter: { conversationIds: ["other"] } },
        { maxNodes: 3 },
        { maxEdges: 2 },
        { corpusId: "other" },
    ])
        expect(() =>
            boundGraphInventory(
                { ...request, ...change, continuationToken },
                graph,
                "generation",
            ),
        ).toThrow("continuation");
    expect(() =>
        boundGraphInventory(
            { ...request, continuationToken },
            graph,
            "changed",
        ),
    ).toThrow("generation");
    expect(() =>
        boundGraphInventory({ ...request, maxNodes: 1 }, graph, "generation"),
    ).toThrow("two endpoint nodes");
});

test("edge byte budgets retain a complete prefix and resume at the first omitted relationship", () => {
    const graph = inventory();
    for (const node of graph.nodes) {
        node.label = "🦉".repeat(600);
        node.types = Array(8).fill("🦉".repeat(80));
    }
    for (const edge of graph.edges) edge.label = "🦉".repeat(160);
    const request: KnowledgeGraphRequest = {
        corpusId: "corpus",
        kind: "entities",
        pageBy: "edges",
        maxNodes: 250,
        maxEdges: 500,
    };
    const seen = new Set<string>();
    let continuationToken: string | undefined;
    do {
        const page = boundGraphInventory(
            { ...request, ...(continuationToken ? { continuationToken } : {}) },
            graph,
            "generation",
        );
        expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThan(
            512 * 1024,
        );
        for (const edge of page.edges) {
            expect(seen.has(edge.id)).toBe(false);
            seen.add(edge.id);
        }
        expect(page.edges.length).toBeGreaterThan(0);
        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
    expect(seen.size).toBe(600);
});
