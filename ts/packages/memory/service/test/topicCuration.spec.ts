// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    queryTopicSnapshot,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import { curateTopics } from "../src/topicCuration.js";
import type { TopicSnapshot, TopicCuration } from "../src/topicTypes.js";

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

test("lazy curation consolidates repeated concepts across batches without merging homonyms or generating prose", async () => {
    const value = snapshot(55);
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (rules, payload) => {
            calls++;
            expect(rules).toContain("Do not write a summary");
            const input = payload as {
                nodes: Array<{
                    id: string;
                    scope: string;
                    evidenceIds: string[];
                }>;
                evidence: Array<{ id: string; sourceId: string }>;
            };
            expect(JSON.stringify(input).length).toBeLessThanOrEqual(32000);
            const planet = input.nodes.filter(
                (node) =>
                    node.scope === "Astronomy" ||
                    node.evidenceIds.some(
                        (id) =>
                            input.evidence.find((entry) => entry.id === id)
                                ?.sourceId === "source-0",
                    ),
            );
            const chemical = input.nodes.filter(
                (node) => !planet.includes(node),
            );
            return {
                concepts: [
                    {
                        nodes: planet,
                        label: "Mercury (planet)",
                        scope: "Astronomy",
                    },
                    {
                        nodes: chemical,
                        label: "Mercury (element)",
                        scope: "Chemistry",
                    },
                ]
                    .filter((group) => group.nodes.length)
                    .map((group) => ({
                        label: group.label,
                        scope: group.scope,
                        purpose: "A substantive explanation of Mercury",
                        memberIds: group.nodes.map((node) => node.id),
                        evidenceIds: [
                            ...new Set(
                                group.nodes.flatMap((node) => node.evidenceIds),
                            ),
                        ],
                        salience: 6,
                    })),
                deferred: [],
            };
        },
        new AbortController().signal,
        true,
    );
    validateTopicSnapshot(value);
    expect(calls).toBeGreaterThan(1);
    expect(value.curation.concepts).toHaveLength(2);
    expect(
        value.curation.concepts
            .map((concept) => concept.memberIds.length)
            .sort((a, b) => a - b),
    ).toEqual([1, 54]);
    expect(
        value.curation.concepts.every(
            (concept) =>
                concept.summary === "" && concept.summaryState === "pending",
        ),
    ).toBe(true);
    expect(value.occurrences).toHaveLength(55);
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

test("lazy curation packs interleaved labels by source without discarding original evidence", async () => {
    const value = snapshot(120);
    value.occurrences = value.occurrences.map((_occurrence, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${index % 10}`,
                revisionId: "r1",
                blockOrdinal: index,
                text: `Reference ${index}: ${"x".repeat(1700)}`,
                score: 1,
            },
            `Topic ${String(index).padStart(3, "0")}`,
            0,
        ),
    );
    value.nodes = initialTopicNodes(value.corpusId, value.occurrences);
    value.influenceSources = value.occurrences.map(
        ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
    );
    const original = structuredClone(value.occurrences);
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) =>
            value.occurrences
                .filter(
                    (entry) => entry.sourceId === node.citations[0].sourceId,
                )
                .flatMap((entry) => entry.citations)
                .slice(0, 8),
        async (_rules, payload) => {
            calls++;
            const batch = payload as {
                nodes: Array<{ id: string }>;
                evidence: Array<{ sourceId: string; excerpt: string }>;
            };
            expect(batch.nodes.length).toBeLessThanOrEqual(24);
            expect(JSON.stringify(payload).length).toBeLessThanOrEqual(32000);
            expect(
                batch.evidence.every((citation) =>
                    original.some((occurrence) =>
                        occurrence.citations.some(
                            (entry) =>
                                entry.sourceId === citation.sourceId &&
                                entry.excerpt === citation.excerpt,
                        ),
                    ),
                ),
            ).toBe(true);
            return {
                concepts: [],
                deferred: batch.nodes.map(({ id }) => ({
                    nodeId: id,
                    reason: "Insufficient self-contained explanatory content",
                })),
            };
        },
        new AbortController().signal,
        true,
    );
    expect(calls).toBeLessThanOrEqual(10);
    expect(value.curation.deferred).toHaveLength(120);
    expect(value.occurrences).toEqual(original);
    validateTopicSnapshot(value);
});

test("curation resumes only validated checkpoint membership after a later provider failure", async () => {
    const value = snapshot(55);
    let checkpoint: TopicCuration | undefined;
    let calls = 0;
    const decide = async (_rules: string, payload: unknown) => {
        const batch = payload as { nodes: Array<{ id: string }> };
        return {
            concepts: [],
            deferred: batch.nodes.map(({ id }) => ({
                nodeId: id,
                reason: "Incidental mention",
            })),
        };
    };
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (rules, payload) => {
                if (++calls === 2) throw new Error("Provider interrupted");
                return decide(rules, payload);
            },
            new AbortController().signal,
            true,
            async (progress) => {
                validateTopicSnapshot({ ...value, curationProgress: progress });
                checkpoint = progress;
            },
        ),
    ).rejects.toThrow("Provider interrupted");
    expect(checkpoint!.deferred).toHaveLength(24);
    const saved = new Set(checkpoint!.deferred.map((entry) => entry.nodeId));
    const resumed = await curateTopics(
        value,
        (node) => node.citations,
        async (rules, payload) => {
            const batch = payload as { nodes: Array<{ id: string }> };
            expect(batch.nodes.every(({ id }) => !saved.has(id))).toBe(true);
            return decide(rules, payload);
        },
        new AbortController().signal,
        true,
        undefined,
        checkpoint,
    );
    expect(resumed.deferred).toHaveLength(55);
    validateTopicSnapshot({ ...value, curation: resumed });
    const invalid = structuredClone(checkpoint!);
    invalid.deferred[0].nodeId = "invented";
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            decide,
            new AbortController().signal,
            true,
            undefined,
            invalid,
        ),
    ).rejects.toThrow("Invalid partial topic curation membership");
});

test("curation checkpoint persistence failure stops before another model request", async () => {
    const value = snapshot(55);
    let calls = 0;
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                calls++;
                const batch = payload as { nodes: Array<{ id: string }> };
                return {
                    concepts: [],
                    deferred: batch.nodes.map(({ id }) => ({
                        nodeId: id,
                        reason: "Incidental mention",
                    })),
                };
            },
            new AbortController().signal,
            true,
            async () => {
                throw new Error("Checkpoint persistence failed");
            },
        ),
    ).rejects.toThrow("Checkpoint persistence failed");
    expect(calls).toBe(1);
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

test.each([
    ["label", 200, false],
    ["scope", 200, false],
    ["purpose", 2000, false],
    ["summary", 1600, false],
    ["scope", 200, true],
] as const)(
    "curation repairs an overlength %s (limit %i, lazy %s) once against unchanged evidence",
    async (field, limit, lazy) => {
        const value = snapshot();
        const payloads: unknown[] = [];
        value.curation = await curateTopics(
            value,
            (node) => node.citations,
            async (rules, payload) => {
                payloads.push(structuredClone(payload));
                expect(rules).toContain(
                    "Labels and scopes must each be at most 200 characters",
                );
                if (payloads.length === 2) {
                    expect(rules).toContain(
                        `concept.${field} has ${limit + 1} characters`,
                    );
                    expect(payload).toEqual(payloads[0]);
                }
                const input = payload as {
                    nodes: Array<{ id: string }>;
                    evidence: Array<{ id: string }>;
                };
                return {
                    concepts: input.nodes.map((node, index) => ({
                        label: "Mercury",
                        scope: `Domain ${index}`,
                        purpose: "A durable explanation",
                        ...(lazy
                            ? {}
                            : { summary: "Mercury is a chemical element." }),
                        memberIds: [node.id],
                        evidenceIds: [input.evidence[index].id],
                        salience: 6,
                        ...(payloads.length === 1 && index === 1
                            ? { [field]: "x".repeat(limit + 1) }
                            : {}),
                    })),
                    deferred: [],
                };
            },
            new AbortController().signal,
            lazy,
        );
        expect(payloads).toHaveLength(2);
        expect(value.curation.concepts).toHaveLength(3);
        validateTopicSnapshot(value);
    },
);

test("lazy curation repairs an overlength deferral reason without losing prior decisions", async () => {
    const value = snapshot();
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            calls++;
            const input = payload as { nodes: Array<{ id: string }> };
            return {
                concepts: [],
                deferred: input.nodes.map((node, index) => ({
                    nodeId: node.id,
                    reason:
                        calls === 1 && index === 1
                            ? "x".repeat(2001)
                            : "Incidental mention without explanatory substance",
                })),
            };
        },
        new AbortController().signal,
        true,
    );
    expect(calls).toBe(2);
    expect(value.curation.deferred).toHaveLength(3);
    validateTopicSnapshot(value);
});

test("curation rejects a second overlength response without repeated repair or partial publication", async () => {
    const value = snapshot(1);
    let calls = 0;
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                calls++;
                const input = payload as { nodes: Array<{ id: string }> };
                return {
                    concepts: [],
                    deferred: [
                        { nodeId: input.nodes[0].id, reason: "x".repeat(2001) },
                    ],
                };
            },
            new AbortController().signal,
            true,
        ),
    ).rejects.toThrow("deferred.reason has 2001 characters (maximum 2000)");
    expect(calls).toBe(2);
    expect(value.curation).toBeUndefined();
});

test("bounded-text repair still rejects invented evidence identities", async () => {
    const value = snapshot(1);
    let calls = 0;
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                calls++;
                const input = payload as { nodes: Array<{ id: string }> };
                return {
                    concepts: [
                        {
                            label: "Mercury",
                            scope: calls === 1 ? "x".repeat(201) : "Astronomy",
                            purpose: "A durable explanation",
                            memberIds: [input.nodes[0].id],
                            evidenceIds: [calls === 1 ? "e0" : "invented"],
                            salience: 6,
                        },
                    ],
                    deferred: [],
                };
            },
            new AbortController().signal,
            true,
        ),
    ).rejects.toThrow("Unknown curated concept evidence");
    expect(calls).toBe(2);
    expect(value.curation).toBeUndefined();
});

test("bounded-text repair cannot publish after cancellation", async () => {
    const value = snapshot(1);
    const controller = new AbortController();
    let calls = 0;
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                calls++;
                const input = payload as { nodes: Array<{ id: string }> };
                if (calls === 2)
                    controller.abort(new Error("Repair cancelled"));
                return {
                    concepts: [],
                    deferred: [
                        {
                            nodeId: input.nodes[0].id,
                            reason:
                                calls === 1
                                    ? "x".repeat(2001)
                                    : "Incidental mention",
                        },
                    ],
                };
            },
            controller.signal,
            true,
        ),
    ).rejects.toThrow("Repair cancelled");
    expect(calls).toBe(2);
    expect(value.curation).toBeUndefined();
});

test.each(["duplicate", "missing", "unknown"] as const)(
    "curation repairs %s membership once without dropping evidence",
    async (mode) => {
        const value = snapshot(3);
        let calls = 0;
        let firstPayload: unknown;
        value.curation = await curateTopics(
            value,
            (node) => node.citations,
            async (rules, payload) => {
                calls++;
                const input = payload as { nodes: Array<{ id: string }> };
                if (calls === 1) firstPayload = structuredClone(payload);
                else {
                    if (mode === "missing") {
                        expect(input.nodes).toHaveLength(1);
                        expect(payload).toMatchObject({
                            evidence: (firstPayload as { evidence: unknown })
                                .evidence,
                        });
                    } else expect(payload).toEqual(firstPayload);
                    expect(rules).toContain("EXACTLY once");
                }
                const deferred = input.nodes.map((node) => ({
                    nodeId: node.id,
                    reason: "Incidental mention",
                }));
                if (calls === 1) {
                    if (mode === "duplicate")
                        deferred[1].nodeId = deferred[0].nodeId;
                    if (mode === "missing") deferred.pop();
                    if (mode === "unknown") deferred[1].nodeId = "unknown";
                }
                return { concepts: [], deferred };
            },
            new AbortController().signal,
            true,
        );
        expect(calls).toBe(2);
        expect(value.curation.deferred).toHaveLength(3);
        validateTopicSnapshot(value);
    },
);

test("omission repair retains validated deferrals and consolidates through nominated concepts", async () => {
    const value = snapshot(3);
    let calls = 0;
    const result = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            calls++;
            const input = payload as {
                nodes: Array<{ id: string; evidenceIds: string[] }>;
                evidence: unknown[];
            };
            expect(input.evidence).toHaveLength(3);
            const nodes = calls === 1 ? [input.nodes[0]] : input.nodes;
            if (calls === 2) {
                expect(input.nodes).toHaveLength(2);
                expect(
                    input.nodes.some((node) => node.id.startsWith("concept:")),
                ).toBe(true);
            }
            return {
                concepts: [
                    {
                        label: "Mercury",
                        scope: "Reference",
                        purpose: "Compare supported reference observations",
                        memberIds: nodes.map((node) => node.id),
                        evidenceIds: nodes.flatMap((node) => node.evidenceIds),
                        salience: 5,
                    },
                ],
                deferred:
                    calls === 1
                        ? [
                              {
                                  nodeId: input.nodes[1].id,
                                  reason: "Incidental mention retained without rewriting",
                              },
                          ]
                        : [],
            };
        },
        new AbortController().signal,
        true,
    );
    expect(calls).toBe(2);
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].memberIds).toHaveLength(2);
    expect(result.deferred).toEqual([
        {
            nodeId: value.nodes[1].id,
            reason: "Incidental mention retained without rewriting",
        },
    ]);
    validateTopicSnapshot({ ...value, curation: result });
});

test("an omission after generic contract repair gets only one targeted completion", async () => {
    const value = snapshot(3);
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            calls++;
            const input = payload as { nodes: Array<{ id: string }> };
            const deferred = input.nodes.map((node) => ({
                nodeId: node.id,
                reason: "Incidental mention",
            }));
            if (calls === 1) deferred[1].nodeId = deferred[0].nodeId;
            if (calls === 2) deferred.pop();
            if (calls === 3) expect(input.nodes).toHaveLength(1);
            return { concepts: [], deferred };
        },
        new AbortController().signal,
        true,
    );
    expect(calls).toBe(3);
    expect(value.curation.deferred).toHaveLength(3);
    validateTopicSnapshot(value);
});

test.each(["omission", "provider", "abort"])(
    "targeted omission repair propagates %s without accepting partial results",
    async (mode) => {
        const value = snapshot(2);
        const controller = new AbortController();
        let calls = 0;
        await expect(
            curateTopics(
                value,
                (node) => node.citations,
                async () => {
                    calls++;
                    if (calls === 2 && mode === "provider")
                        throw new Error("Provider unavailable");
                    if (calls === 2 && mode === "abort") controller.abort();
                    return { concepts: [], deferred: [] };
                },
                controller.signal,
                true,
            ),
        ).rejects.toThrow(
            mode === "provider"
                ? "Provider unavailable"
                : mode === "abort"
                  ? /abort/i
                  : "omitted occurrence decisions",
        );
        expect(calls).toBe(2);
        expect(value.curation).toBeUndefined();
    },
);

test.each([false, true])(
    "omission repair checks original members of reconsidered concepts (unrelated source: %s)",
    async (unrelated) => {
        const value = snapshot(4);
        let calls = 0;
        let selectedEvidence = "";
        const operation = curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                calls++;
                const input = payload as {
                    nodes: Array<{ id: string; evidenceIds: string[] }>;
                };
                if (calls === 1)
                    selectedEvidence =
                        input.nodes[unrelated ? 2 : 1].evidenceIds[0];
                return {
                    concepts: [
                        {
                            label: "Mercury",
                            scope: "Reference",
                            purpose: "Reference concept",
                            memberIds:
                                calls === 1
                                    ? input.nodes
                                          .slice(0, 2)
                                          .map((node) => node.id)
                                    : input.nodes.map((node) => node.id),
                            evidenceIds:
                                calls === 1
                                    ? [input.nodes[0].evidenceIds[0]]
                                    : [selectedEvidence],
                            salience: 5,
                        },
                    ],
                    deferred:
                        calls === 1
                            ? [
                                  {
                                      nodeId: input.nodes[2].id,
                                      reason: "Incidental mention",
                                  },
                              ]
                            : [],
                };
            },
            new AbortController().signal,
            true,
        );
        if (unrelated)
            await expect(operation).rejects.toThrow(
                "unrelated occurrence sources",
            );
        else {
            value.curation = await operation;
            expect(value.curation.concepts[0].memberIds).toHaveLength(3);
            expect(value.curation.deferred).toHaveLength(1);
            validateTopicSnapshot(value);
        }
        expect(calls).toBe(2);
    },
);

test("curation repairs evidence membership without accepting another occurrence's source", async () => {
    const value = snapshot(2);
    let calls = 0;
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        async (rules, payload) => {
            calls++;
            const input = payload as {
                nodes: Array<{ id: string; evidenceIds: string[] }>;
            };
            if (calls === 2)
                expect(rules).toContain("unrelated occurrence sources");
            return {
                concepts: input.nodes.map((node, index) => ({
                    label: "Mercury",
                    scope: `Domain ${index}`,
                    purpose: "A substantive reference",
                    memberIds: [node.id],
                    evidenceIds:
                        calls === 1 && index === 0
                            ? input.nodes[1].evidenceIds
                            : node.evidenceIds,
                    salience: 6,
                })),
                deferred: [],
            };
        },
        new AbortController().signal,
        true,
    );
    expect(calls).toBe(2);
    expect(value.curation.concepts).toHaveLength(2);
    validateTopicSnapshot(value);
});
