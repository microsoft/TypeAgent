// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHubGraphFunctions } from "../dist/agent/memoryHubGraph.mjs";

function fixture() {
    const calls = [];
    const service = {
        listCorpora: async () => [
            { corpusId: "a", name: "Documents" },
            { corpusId: "b", name: "Conversations" },
        ],
        queryKnowledgeGraph: async (request) => {
            calls.push(request);
            return {
                corpusId: request.corpusId,
                generation: `${request.corpusId}-generation`,
                state: "ready",
                nodes: [
                    {
                        id: `graph:${request.corpusId}:entity:${"1".repeat(32)}`,
                        kind: "entity",
                        label: "Casey",
                        types: ["person"],
                        mentionCount: 2,
                        supportCount: 1,
                    },
                ],
                edges: [],
                counts: {
                    nodes: 1,
                    edges: 0,
                    omittedNodes: 0,
                    omittedEdges: 0,
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
                        total: 0,
                        eligible: 0,
                        indexed: 0,
                    },
                    reasons: [],
                },
            };
        },
        queryGraphSupport: async (request) => ({
            generation: request.generation,
            items: [],
            total: 0,
        }),
        getEvent: async (corpusId, eventId) => ({
            corpusId,
            eventId,
            eventType: "user-turn",
            content: "Original event",
            metadata: { authority: "user-assertion" },
        }),
    };
    return {
        service,
        calls,
        hub: createMemoryHubGraphFunctions(() => service),
    };
}

test("graph federation uses qualified identities and partitions a global budget", async () => {
    const { hub, calls } = fixture();
    const graph = await hub.memoryHubGraph({
        kind: "entities",
        maxNodes: 250,
        maxEdges: 500,
    });
    assert.equal(graph.corpora.length, 2);
    assert.deepEqual(
        calls.map((call) => call.maxNodes),
        [125, 125],
    );
    assert.deepEqual(
        calls.map((call) => call.maxEdges),
        [250, 250],
    );
    const ids = graph.corpora.flatMap((corpus) =>
        corpus.graph.nodes.map((node) => node.id),
    );
    assert.equal(new Set(ids).size, 2);
    assert.equal(graph.presetLayout.elements.length, 2);
    const positions = graph.presetLayout.elements.map(
        (element) => element.position,
    );
    assert.ok(
        positions.every(
            (position) =>
                Number.isFinite(position?.x) && Number.isFinite(position?.y),
        ),
    );
    assert.equal(
        new Set(positions.map((position) => JSON.stringify(position))).size,
        2,
    );
    assert.ok(
        positions.every(
            (position) =>
                Math.abs(position.x) <= 251 && Math.abs(position.y) <= 251,
        ),
        "Small graphs must fit without shrinking labels into unreadable dots.",
    );
    assert.equal(graph.omittedCorpora, 0);
    assert.deepEqual(graph.errors, []);
});

test("inventory paging preserves the selected corpus, generation and limits", async () => {
    const { hub, calls } = fixture();
    await hub.memoryHubGraph({
        corpusId: "a",
        kind: "entities",
        maxNodes: 125,
        maxEdges: 250,
        continuationToken: "next-page",
        expectedGeneration: "a-generation",
    });
    assert.deepEqual(calls[0], {
        corpusId: "a",
        kind: "entities",
        maxNodes: 125,
        maxEdges: 250,
        continuationToken: "next-page",
        expectedGeneration: "a-generation",
    });
    await assert.rejects(
        hub.memoryHubGraph({
            kind: "entities",
            continuationToken: "next-page",
        }),
        /require one selected collection/,
    );
    assert.equal(calls.length, 1);
});

test("selected corpus never silently broadens graph or support scope", async () => {
    const { hub, calls } = fixture();
    const graph = await hub.memoryHubGraph({
        kind: "topics",
        corpusId: "b",
    });
    assert.equal(graph.corpora.length, 1);
    assert.equal(graph.corpora[0].corpusId, "b");
    assert.equal(calls[0].corpusId, "b");
    await assert.rejects(
        hub.memoryHubGraphSupport({
            corpusId: "missing",
            generation: "g1",
            nodeId: "node",
        }),
        /unavailable|not found|Unknown|exist/i,
    );
});

test("a failed corpus is partial coverage rather than empty success", async () => {
    const { service, hub } = fixture();
    const query = service.queryKnowledgeGraph;
    service.queryKnowledgeGraph = async (request) => {
        if (request.corpusId === "b") throw new Error("Projection unavailable");
        return query(request);
    };
    const graph = await hub.memoryHubGraph({ kind: "entities" });
    assert.equal(graph.corpora.length, 1);
    assert.deepEqual(graph.errors, [
        { corpusId: "b", message: "Projection unavailable" },
    ]);
});

test("global node and edge budgets disclose corpora not queried", async () => {
    const { hub, calls } = fixture();
    const graph = await hub.memoryHubGraph({
        kind: "entities",
        maxNodes: 1,
        maxEdges: 1,
    });
    assert.equal(calls.length, 1);
    assert.equal(graph.omittedCorpora, 1);
    for (const maxNodes of [0, 251, 1.5]) {
        await assert.rejects(
            hub.memoryHubGraph({ kind: "entities", maxNodes }),
            /Graph limit/,
        );
    }
});

test("event evidence is read directly and paged without timeline prerequisites", async () => {
    const { service, hub } = fixture();
    service.getEvent = async (corpusId, eventId) => ({
        corpusId,
        eventId,
        eventType: "user-turn",
        content: "x".repeat(15000),
    });
    const first = await hub.memoryHubGraphEvent({
        corpusId: "b",
        eventId: "e1",
    });
    assert.equal(first.content.length, 12000);
    assert.equal(first.nextOffset, 12000);
    const second = await hub.memoryHubGraphEvent({
        corpusId: "b",
        eventId: "e1",
        offset: first.nextOffset,
    });
    assert.equal(
        first.content.length + second.content.length,
        first.totalChars,
    );
    assert.equal(second.nextOffset, undefined);
    await assert.rejects(
        hub.memoryHubGraphEvent({ corpusId: "b", eventId: "e1", offset: -1 }),
        /offset/,
    );
});

test("forgotten event evidence is unavailable rather than substituted", async () => {
    const { service, hub } = fixture();
    service.getEvent = async () => undefined;
    await assert.rejects(
        hub.memoryHubGraphEvent({ corpusId: "b", eventId: "forgotten" }),
        /no longer available/,
    );
});

test("unsupported hosts and stale evidence generations are explicit failures", async () => {
    const { service, hub } = fixture();
    service.queryKnowledgeGraph = undefined;
    await assert.rejects(
        hub.memoryHubGraph({ kind: "entities" }),
        /does not support scoped graphs/,
    );
    service.queryGraphSupport = async () => {
        throw new Error("Graph generation changed");
    };
    await assert.rejects(
        hub.memoryHubGraphSupport({
            corpusId: "a",
            generation: "old",
            nodeId: "node",
        }),
        /generation changed/,
    );
});

test("the combined graph and layout payload obeys 512 KiB without losing healthy corpora", async () => {
    const { service, hub } = fixture();
    const query = service.queryKnowledgeGraph;
    service.queryKnowledgeGraph = async (request) => {
        const result = await query(request);
        if (request.corpusId === "b")
            result.nodes[0].label = "x".repeat(250000);
        return result;
    };
    const graph = await hub.memoryHubGraph({ kind: "entities" });
    assert.ok(
        Buffer.byteLength(JSON.stringify({ success: true, data: graph })) <=
            512 * 1024,
    );
    assert.deepEqual(
        graph.corpora.map((corpus) => corpus.corpusId),
        ["a"],
    );
    assert.equal(graph.errors[0].corpusId, "b");
    assert.match(graph.errors[0].message, /512 KiB/);
    assert.ok(
        graph.presetLayout.elements.every(
            (element) => !element.data.id.includes("graph:b:"),
        ),
    );
});
