// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    queryTopicSnapshot,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import { curateTopics } from "../src/topicCuration.js";
import type { TopicSnapshot } from "../src/topicTypes.js";

function snapshot(count = 3): TopicSnapshot {
    const occurrences = Array.from({ length: count }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${index}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: `Mercury ${index === 0 ? "is a planet" : "is a chemical element"}.`,
                score: 1,
            },
            "Mercury",
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "test",
        generation: "generation",
        inputFingerprint: "a".repeat(64),
        recipe: "curated-v1",
        generatedAt: "2026-10-24T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("test", occurrences),
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        parents: [],
        related: [],
        limits: [],
    };
}

test("curation separates scoped homonyms, retains every occurrence and supports raw queries", async () => {
    const value = snapshot();
    const original = structuredClone(value.occurrences);
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            const input = payload as {
                nodes: Array<{ id: string }>;
                evidence: Array<{ id: string; sourceId: string }>;
            };
            return {
                concepts: input.nodes.map((node, index) => ({
                    label: "Mercury",
                    scope: index === 0 ? "Astronomy" : `Chemistry ${index}`,
                    purpose: "A durable reference explanation",
                    summary:
                        index === 0
                            ? "Mercury is a planet."
                            : "Mercury is a chemical element.",
                    memberIds: [node.id],
                    evidenceIds: [input.evidence[index].id],
                    salience: 6,
                })),
                deferred: [],
            };
        },
        new AbortController().signal,
    );
    validateTopicSnapshot(value);
    expect(value.occurrences).toEqual(original);
    expect(value.curation.concepts).toHaveLength(3);
    const page = queryTopicSnapshot(value, {
        corpusId: "test",
        curated: true,
        pageSize: 1,
    });
    expect(page.concepts).toHaveLength(1);
    expect(page.totalConcepts).toBe(3);
    expect(page.totalNodes).toBe(3);
    const next = queryTopicSnapshot(value, {
        corpusId: "test",
        curated: true,
        pageSize: 1,
        continuationToken: page.nextContinuationToken!,
    });
    expect(next.concepts![0].id).not.toBe(page.concepts![0].id);
    expect(() =>
        queryTopicSnapshot(value, {
            corpusId: "test",
            pageSize: 1,
            continuationToken: page.nextContinuationToken!,
        }),
    ).toThrow();
    expect(queryTopicSnapshot(value, { corpusId: "test" }).nodes).toHaveLength(
        3,
    );
});

test("large curation batches remain bounded and account for every deferred raw topic", async () => {
    const value = snapshot(205);
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            calls++;
            expect(JSON.stringify(payload).length).toBeLessThanOrEqual(34000);
            const input = payload as { nodes: Array<{ id: string }> };
            expect(input.nodes.length).toBeLessThanOrEqual(24);
            return {
                concepts: [],
                deferred: input.nodes.map((node) => ({
                    nodeId: node.id,
                    reason: "Passing mention, insufficient explanatory substance",
                })),
            };
        },
        new AbortController().signal,
    );
    expect(calls).toBe(Math.ceil(205 / 24));
    expect(value.curation.deferred).toHaveLength(205);
    validateTopicSnapshot(value);
});

test("curation rejects missing decisions and invented member or evidence identities", async () => {
    const value = snapshot();
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async () => ({
                concepts: [],
                deferred: [],
            }),
            new AbortController().signal,
        ),
    ).rejects.toThrow("omitted occurrence decisions");
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async () => ({
                concepts: [],
                deferred: [{ nodeId: "invented", reason: "Unavailable" }],
            }),
            new AbortController().signal,
        ),
    ).rejects.toThrow("invented or duplicated");
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                const input = payload as { nodes: Array<{ id: string }> };
                return {
                    concepts: [
                        {
                            label: "Mercury",
                            scope: "Astronomy",
                            purpose: "Reference",
                            summary: "Mercury is a planet.",
                            memberIds: [input.nodes[0].id],
                            evidenceIds: ["e00"],
                            salience: 5,
                        },
                    ],
                    deferred: [],
                };
            },
            new AbortController().signal,
        ),
    ).rejects.toThrow("Unknown curated concept evidence");
});

test("a model that ignores cancellation cannot publish late curation decisions", async () => {
    const value = snapshot();
    const controller = new AbortController();
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async () => {
                controller.abort(new Error("Curation cancelled"));
                return { concepts: [], deferred: [] };
            },
            controller.signal,
        ),
    ).rejects.toThrow("Curation cancelled");
    expect(value.curation).toBeUndefined();
});
