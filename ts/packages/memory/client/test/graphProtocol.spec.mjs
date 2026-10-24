// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    graphQueryRequestSchema,
    graphQueryResultSchema,
    graphSupportRequestSchema,
    graphSupportPageSchema,
    graphToolNames,
    eventFilterSchema,
    topicSnapshotSchema,
    topicOccurrenceSchema,
} from "../dist/index.js";

test("bounded graph requests reject excessive budgets and ambiguous evidence selection", () => {
    const request = {
        corpusId: "corpus",
        kind: "entities",
        evidenceKinds: ["document", "event"],
        eventFilter: {
            authorities: ["evidence-only"],
            conversationIds: ["chat"],
        },
        maxNodes: 250,
        maxEdges: 500,
    };
    assert.deepEqual(graphQueryRequestSchema.parse(request), request);
    for (const invalid of [
        { ...request, maxNodes: 251 },
        { ...request, maxEdges: 501 },
        { ...request, evidenceKinds: ["view"] },
        { ...request, kind: "confidence" },
        { ...request, extra: true },
    ])
        assert.equal(graphQueryRequestSchema.safeParse(invalid).success, false);
    for (const invalid of [
        { corpusId: "corpus", generation: "g" },
        { corpusId: "corpus", generation: "g", nodeId: "n", edgeId: "e" },
        { corpusId: "corpus", generation: "g", nodeId: "n", pageSize: 51 },
    ])
        assert.equal(
            graphSupportRequestSchema.safeParse(invalid).success,
            false,
        );
    assert.equal(graphToolNames.queryKnowledgeGraph, "memory_graph_query");
    const edges = {
        ...request,
        pageBy: "edges",
        maxNodes: 2,
        continuationToken: "opaque",
    };
    assert.deepEqual(graphQueryRequestSchema.parse(edges), edges);
    assert.equal(
        graphQueryRequestSchema.safeParse({ ...edges, maxNodes: 1 }).success,
        false,
    );
    assert.equal(
        graphQueryRequestSchema.safeParse({ ...request, pageBy: "unknown" })
            .success,
        false,
    );
});

test("canonical event filter rejects unknown authority, fields, invalid dates, inverted ranges and excessive selectors", () => {
    for (const filter of [
        { authorities: ["trusted"] },
        { authority: "evidence-only" },
        { conversationIds: ["chat"], unsupported: true },
        { observedFrom: "yesterday" },
        { eventFrom: "2026-10-24T10:00:00Z", eventTo: "2026-10-24T09:00:00Z" },
        {
            observedFrom: "2026-10-24T10:00:00Z",
            observedTo: "2026-10-24T09:00:00Z",
        },
        { producerIds: Array(201).fill("producer") },
        { turnIds: [false] },
    ]) {
        assert.equal(eventFilterSchema.safeParse(filter).success, false);
        assert.equal(
            graphQueryRequestSchema.safeParse({
                corpusId: "c",
                kind: "entities",
                eventFilter: filter,
            }).success,
            false,
        );
    }
    const filter = {
        authorities: ["evidence-only"],
        turnIds: ["turn"],
        eventFrom: "2026-10-24T09:00:00+01:00",
        eventTo: "2026-10-24T10:00:00Z",
    };
    assert.deepEqual(eventFilterSchema.parse(filter), filter);
});

test("all explicit readiness states and generation-bound inventory tokens round-trip", () => {
    for (const state of [
        "ready",
        "building",
        "stale",
        "error",
        "unsupported",
    ]) {
        const graph = {
            corpusId: "corpus",
            generation: "g",
            state,
            nodes: [],
            edges: [],
            counts: { nodes: 4, edges: 2, omittedNodes: 4, omittedEdges: 2 },
            limits: { maxNodes: 1, maxEdges: 1 },
            coverage: {
                documents: { state, total: 2, eligible: 1, indexed: 0 },
                events: { state, total: 3, eligible: 2, indexed: 0 },
                topics: { state },
                reasons: ["Explicit coverage"],
            },
            nextContinuationToken: "opaque",
        };
        assert.deepEqual(graphQueryResultSchema.parse(graph), graph);
        for (const summaryState of ["pending", "ready", "failed"]) {
            const node = {
                id: "opaque-graph-id",
                kind: "topic",
                label: "Maintained topic",
                types: [],
                mentionCount: 1,
                supportCount: 1,
                topicId: "maintained-topic-id",
                summaryState,
            };
            const inventory = { ...graph, nodes: [node] };
            assert.deepEqual(
                graphQueryResultSchema.parse(inventory).nodes[0],
                node,
            );
            for (const invalid of [
                { ...node, summaryState: "building" },
                { ...node, topicId: "" },
                { ...node, summary: "No summary text in inventories" },
            ])
                assert.equal(
                    graphQueryResultSchema.safeParse({
                        ...inventory,
                        nodes: [invalid],
                    }).success,
                    false,
                );
        }
    }
});

test("support preserves document revisions and all event authority distinctions without accepting evidence bodies", () => {
    const document = {
        kind: "document",
        corpusId: "corpus",
        sourceId: "source",
        revisionId: "revision",
        title: "Guide",
        locator: "indexed:0",
    };
    const items = [
        document,
        ...[
            "user-assertion",
            "evidence-only",
            "verified-observation",
            "explicit",
            "producer-reported",
        ].map((authority) => ({
            kind: "event",
            corpusId: "corpus",
            eventId: "event",
            conversationId: "chat",
            turnId: "turn",
            eventTime: "2026-10-24T00:00:00Z",
            sender: "assistant",
            authority,
            title: "turn.completed",
        })),
    ];
    const page = { generation: "g", items, total: items.length };
    assert.deepEqual(graphSupportPageSchema.parse(page), page);
    assert.equal(
        graphSupportPageSchema.safeParse({
            ...page,
            items: [{ ...document, content: "private" }],
        }).success,
        false,
    );
    assert.equal(
        graphSupportPageSchema.safeParse({
            ...page,
            items: [{ ...items[1], authority: "verified" }],
        }).success,
        false,
    );
});

test("maintained event topic protocol retains discriminated citations and separate influence", () => {
    const evidence = { kind: "event", eventId: "event" };
    const occurrence = {
        id: "occurrence",
        sourceId: "event",
        revisionId: "event",
        evidence,
        ordinal: 0,
        label: "recovery",
        scope: "event:corpus:chat:evidence-only",
        citations: [
            {
                sourceId: "event",
                revisionId: "event",
                locator: `indexed:0:${"a".repeat(64)}:0-4`,
                excerpt: "text",
                evidence,
            },
        ],
    };
    assert.deepEqual(topicOccurrenceSchema.parse(occurrence), occurrence);
    const snapshot = {
        schemaVersion: 1,
        corpusId: "corpus",
        generation: "generation",
        inputFingerprint: "a".repeat(64),
        recipe: "offline",
        generatedAt: "now",
        occurrences: [occurrence],
        influenceSources: [],
        influenceEvents: [{ eventId: "event", fingerprint: "b".repeat(64) }],
        nodes: [],
        parents: [],
        related: [],
        limits: [],
    };
    assert.deepEqual(topicSnapshotSchema.parse(snapshot), snapshot);
});
