// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationCorpusName } from "@typeagent/memory-service";
import { createMemoryHubExploreFunctions } from "../dist/agent/memoryHubExplore.mjs";
import { createMemoryHubKnowledgeFunctions } from "../dist/agent/memoryHubKnowledge.mjs";

function node(corpusId, index, kind = "entity") {
    return {
        id: `graph:${corpusId}:${kind}:${index.toString(16).padStart(32, "0")}`,
        kind,
        label: `Item ${String(index).padStart(4, "0")}`,
        types: kind === "entity" ? ["person"] : [],
        mentionCount: 1,
        supportCount: 1,
    };
}

function fixture(size = 2) {
    const calls = [];
    const service = {
        listCorpora: async () => [
            { corpusId: "a", name: "Documents" },
            { corpusId: "b", name: conversationCorpusName },
        ],
        getCorpus: async (corpusId) => ({
            corpusId,
            name: corpusId === "a" ? "Documents" : conversationCorpusName,
            sourceCount: corpusId === "a" ? 1 : 0,
        }),
        listSourcesPage: async ({ corpusId }) => ({
            items:
                corpusId === "a"
                    ? [
                          {
                              sourceId: "doc",
                              title: "Document",
                              sourceType: "text",
                          },
                      ]
                    : [],
            total: corpusId === "a" ? 1 : 0,
        }),
        getKnowledgeGraph: async () => {
            throw new Error("Legacy document graph must not be used");
        },
        queryKnowledgeGraph: async (request) => {
            calls.push({ ...request });
            const offset = Number(request.continuationToken ?? 0);
            const edgePage = request.pageBy === "edges";
            const total = request.kind === "topics" ? 1 : size;
            const take = edgePage
                ? Math.floor(request.maxNodes / 2)
                : request.maxNodes;
            const end = Math.min(total, offset + take);
            const nodes = [];
            const edges = [];
            for (let i = offset; i < end; i++) {
                const first = node(
                    request.corpusId,
                    edgePage ? i * 2 : i,
                    request.kind === "topics" ? "topic" : "entity",
                );
                nodes.push(first);
                if (edgePage) {
                    const second = node(request.corpusId, i * 2 + 1);
                    nodes.push(second);
                    edges.push({
                        id: `edge:${request.corpusId}:${i}`,
                        source: first.id,
                        target: second.id,
                        type: "knows",
                        count: 1,
                        supportCount: 1,
                    });
                }
            }
            return {
                corpusId: request.corpusId,
                generation: "g1",
                state: "ready",
                nodes,
                edges,
                counts: {
                    nodes: edgePage ? total * 2 : total,
                    edges: edgePage ? total : 0,
                    omittedNodes: total - nodes.length,
                    omittedEdges: edgePage ? total - edges.length : 0,
                },
                limits: {
                    maxNodes: request.maxNodes,
                    maxEdges: request.maxEdges,
                },
                coverage: {
                    documents: {
                        state: "ready",
                        total: 1,
                        eligible: 1,
                        indexed: 1,
                    },
                    events: {
                        state: "ready",
                        total: 2,
                        eligible: request.corpusId === "b" ? 2 : 0,
                        indexed: 2,
                    },
                    reasons: [],
                },
                ...(end < total ? { nextContinuationToken: String(end) } : {}),
            };
        },
    };
    return { service, calls };
}

test("Overview includes the conversation corpus with bounded lazy event-aware support", async () => {
    const { service, calls } = fixture();
    const hub = createMemoryHubExploreFunctions(() => service);
    const result = await hub.memoryHubExplore({ maxNodes: 200 });
    assert.equal(result.counts.entities, 4);
    assert.equal(result.counts.topics, 2);
    assert.equal(result.counts.events, 2);
    assert.equal(result.sourceInventory, "documents");
    assert.equal(
        result.entities.filter((item) => item.graphSupport.corpusId === "b")
            .length,
        2,
    );
    assert.equal(new Set(result.entities.map((item) => item.id)).size, 4);
    assert.deepEqual(result.errors, []);
    assert.equal(calls.length, 4);
    assert.ok(
        calls.every((call) => call.maxNodes <= 250 && !call.continuationToken),
    );
    assert.deepEqual(result.contributingSources, [
        { corpusId: "a", sourceId: "doc", title: "Document" },
    ]);
});

test("selected event inventories preserve traversal beyond 250 and bind every page generation", async () => {
    const { service, calls } = fixture(503);
    const hub = createMemoryHubKnowledgeFunctions(() => service);
    const page = await hub.memoryHubKnowledge({
        corpusId: "b",
        kind: "entities",
        sort: "name",
        offset: 500,
        pageSize: 10,
    });
    assert.equal(page.total, 503);
    assert.equal(page.items.length, 3);
    assert.equal(page.items[0].title, "Item 0500");
    assert.equal(page.items[0].graphSupport.corpusId, "b");
    assert.equal(page.items[0].graphSupport.generation, "g1");
    assert.deepEqual(page.items[0].sources, []);
    assert.deepEqual(page.errors, []);
    assert.equal(calls.length, 3);
    assert.ok(calls.slice(1).every((call) => call.expectedGeneration === "g1"));
});

test("relationship inventories use independent edge paging rather than lose cross-page edges", async () => {
    const { service, calls } = fixture(503);
    const hub = createMemoryHubKnowledgeFunctions(() => service);
    const page = await hub.memoryHubKnowledge({
        corpusId: "b",
        kind: "relationships",
        offset: 500,
        pageSize: 10,
    });
    assert.equal(page.total, 503);
    assert.equal(page.items.length, 3);
    assert.ok(
        page.items.every(
            (item) => item.graphSupport.edgeId && !item.graphSupport.nodeId,
        ),
    );
    assert.ok(calls.every((call) => call.pageBy === "edges"));
    assert.equal(calls.length, 5);
    assert.deepEqual(page.errors, []);
});

test("inventory generation changes discard prior pages instead of mixing revisions", async () => {
    const { service } = fixture(503);
    const original = service.queryKnowledgeGraph;
    service.queryKnowledgeGraph = async (request) => ({
        ...(await original(request)),
        generation: request.continuationToken ? "g2" : "g1",
    });
    const hub = createMemoryHubKnowledgeFunctions(() => service);
    const page = await hub.memoryHubKnowledge({
        corpusId: "b",
        kind: "entities",
    });
    assert.equal(page.total, 0);
    assert.deepEqual(page.items, []);
    assert.match(page.errors[0].message, /generation changed/);
});
