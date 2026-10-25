// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    topicBuildInputSchema,
    topicQueryPageSchema,
    topicQueryRequestSchema,
    topicSnapshotSchema,
} from "../dist/topicProtocol.js";

test("lazy detail requests are explicit and pending concept prose crosses strict response contracts", () => {
    const request = {
        corpusId: "test",
        curated: true,
        topicId: "concept:one",
        summarize: true,
    };
    assert.deepEqual(topicQueryRequestSchema.parse(request), request);
    for (const invalid of [
        { corpusId: "test", summarize: true },
        { ...request, curated: false },
        { ...request, search: "bulk" },
        { ...request, continuationToken: "next" },
    ])
        assert.equal(topicQueryRequestSchema.safeParse(invalid).success, false);
    const concept = {
        id: "concept:one",
        label: "Lease lifetime",
        scope: "Runtime",
        purpose: "Distinguish command completion from resource lifetime",
        memberIds: ["topic:one"],
        summary: "",
        summaryState: "pending",
        citations: [
            {
                sourceId: "source",
                revisionId: "r1",
                locator: `indexed:0:${"a".repeat(64)}:0-4`,
                excerpt: "text",
            },
        ],
        salience: 7,
        memberCount: 1,
        omittedMembers: 0,
        citationCount: 1,
        omittedCitations: 0,
    };
    const page = {
        generation: "g1",
        nodes: [],
        parents: [],
        related: [],
        neighborhoods: [],
        totalNodes: 1,
        matchingNodes: 1,
        omittedNodes: 1,
        omittedParents: 0,
        omittedRelated: 0,
        omittedNeighborhoods: 0,
        limits: [],
        io: { stateBytes: 1, snapshotBytes: 1, elapsedMs: 1 },
        concepts: [concept],
        totalConcepts: 1,
    };
    assert.deepEqual(topicQueryPageSchema.parse(page), page);
    assert.equal(
        topicQueryPageSchema.safeParse({
            ...page,
            concepts: [{ ...concept, summaryState: "ready" }],
        }).success,
        false,
    );
    assert.equal(
        topicQueryPageSchema.safeParse({
            ...page,
            concepts: [{ ...concept, summary: "Unaudited pending prose" }],
        }).success,
        false,
    );
});

test("curated queries and bounded concepts extend, not replace, raw topic contracts", () => {
    assert.equal(
        topicQueryRequestSchema.parse({ corpusId: "test", curated: true })
            .curated,
        true,
    );
    assert.equal(
        topicQueryRequestSchema.safeParse({ corpusId: "test", curated: "yes" })
            .success,
        false,
    );
    const snapshot = {
        schemaVersion: 1,
        corpusId: "test",
        generation: "g1",
        inputFingerprint: "a".repeat(64),
        recipe: "curated-v1",
        generatedAt: "2026-10-24",
        occurrences: [],
        influenceSources: [],
        nodes: [],
        parents: [],
        related: [],
        limits: [],
        curation: { concepts: [], deferred: [] },
    };
    assert.deepEqual(topicSnapshotSchema.parse(snapshot), snapshot);
    assert.equal(
        topicSnapshotSchema.safeParse({
            ...snapshot,
            curation: { concepts: [], deferred: [], approved: true },
        }).success,
        false,
    );
});

test("topic query schema preserves generation, continuation, honest omissions and actual IO", () => {
    const page = {
        generation: "generation1",
        nodes: [],
        parents: [],
        related: [],
        neighborhoods: [],
        totalNodes: 250,
        matchingNodes: 250,
        omittedNodes: 250,
        omittedParents: 0,
        omittedRelated: 0,
        omittedNeighborhoods: 0,
        nextContinuationToken: "opaque",
        limits: ["Complete state read, bounded response"],
        io: { stateBytes: 400000, snapshotBytes: 200000, elapsedMs: 1.5 },
    };
    assert.deepEqual(topicQueryPageSchema.parse(page), page);
    assert.equal(
        topicQueryPageSchema.safeParse({ ...page, io: undefined }).success,
        false,
    );
    assert.equal(
        topicQueryRequestSchema.safeParse({ corpusId: "test", pageSize: 201 })
            .success,
        false,
    );
    assert.equal(
        topicQueryRequestSchema.safeParse({ corpusId: "test", depth: 0 })
            .success,
        true,
    );
    assert.equal(
        topicQueryRequestSchema.safeParse({ corpusId: "test", sourceLimit: 20 })
            .success,
        false,
    );
});

test("complete build incidence is unbounded by display pages and never summary evidence", () => {
    const occurrences = Array.from({ length: 250 }, (_, index) => ({
        id: `occurrence${index}`,
        ordinal: 0,
        sourceId: `source${index}`,
        revisionId: "r1",
        label: "review",
        scope: `source${index}`,
        citations: [
            {
                sourceId: `source${index}`,
                revisionId: "r1",
                locator: `indexed:0:${"a".repeat(64)}:0-4`,
                excerpt: "text",
            },
        ],
    }));
    assert.equal(
        topicBuildInputSchema.parse({ occurrences }).occurrences.length,
        250,
    );
    occurrences[0].citations[0].locator = "synopsis:generated";
    assert.equal(
        topicBuildInputSchema.safeParse({ occurrences }).success,
        false,
    );
});
