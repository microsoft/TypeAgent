// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    curateTopics,
    type TopicCurationCompletion,
    type TopicCurationOptions,
} from "../src/topicCuration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import type {
    TopicCuration,
    TopicCurationPacket,
    TopicSnapshot,
} from "../src/topicTypes.js";
import { compactTopicCompletion } from "../src/topicCurationTransport.js";

function snapshot(count = 50): TopicSnapshot {
    const occurrences = Array.from({ length: count }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${String(index).padStart(4, "0")}`,
                revisionId: "revision",
                blockOrdinal: 0,
                text: "The service policy requires an explicit approval before installation.",
                score: 1,
            },
            "Service policy",
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "frozen-fixture",
        generation: "generation",
        inputFingerprint: "a".repeat(64),
        recipe: "curated-fixture",
        generatedAt: "2026-11-11T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("frozen-fixture", occurrences),
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        parents: [],
        related: [],
        limits: [],
    };
}

interface Payload {
    nodes: Array<{
        id: string;
        label: string;
        scope: string;
        purpose?: string;
        role?: "new" | "prior";
        evidenceIds: string[];
    }>;
}

function merged(payload: unknown) {
    const packet = payload as Payload;
    return {
        concepts: [
            {
                label: "Service policy",
                scope: "Installation approval",
                purpose: "Explain the approval required before installation",
                memberIds: packet.nodes.map(({ id }) => id),
                evidenceIds: [
                    ...new Set(
                        packet.nodes.flatMap(({ evidenceIds }) => evidenceIds),
                    ),
                ],
                salience: 6,
            },
        ],
        deferred: [],
    };
}

const settings: TopicCurationOptions = {
    concurrency: 2,
    frozenPreparation: true,
    priorDeltas: true,
    compactIds: true,
};

test("frozen preparation overlaps, reconciles serially and installs complete windows only", async () => {
    const value = snapshot();
    const packets: TopicCurationPacket[] = [];
    const checkpoints: number[] = [];
    let active = 0;
    let maximum = 0;
    const complete: TopicCurationCompletion = async (
        _rules,
        payload,
        _schema,
        call,
    ) => {
        expect(call?.rawNodes).toBeDefined();
        if (call?.phase === "preparation") {
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
        } else {
            expect(call?.phase).toBe("reconciliation");
            expect(active).toBe(0);
        }
        return merged(payload);
    };
    value.curation = await curateTopics(
        value,
        (node) => node.citations,
        complete,
        new AbortController().signal,
        true,
        async (current) => {
            checkpoints.push(
                current.concepts.reduce(
                    (sum, concept) => sum + concept.memberIds.length,
                    0,
                ),
            );
        },
        undefined,
        { ...settings, onPacket: (packet) => packets.push(packet) },
    );
    expect(maximum).toBe(2);
    expect(checkpoints).toEqual([48, 50]);
    expect(value.curation.concepts).toHaveLength(1);
    expect(value.curation.concepts[0].memberIds).toHaveLength(50);
    validateTopicSnapshot(value);
    const replay = snapshot();
    replay.curation = await curateTopics(
        replay,
        (node) => node.citations,
        async () => {
            throw new Error("An exact window replay must not call a provider");
        },
        new AbortController().signal,
        true,
        undefined,
        undefined,
        { ...settings, replayPackets: packets },
    );
    expect(replay.curation).toEqual(value.curation);
    validateTopicSnapshot(replay);
    const appended = snapshot(52);
    let appendedRaw = 0;
    appended.curation = await curateTopics(
        appended,
        (node) => node.citations,
        async (_rules, payload, _schema, call) => {
            if (call?.phase === "preparation")
                appendedRaw += call.rawNodes ?? 0;
            return merged(payload);
        },
        new AbortController().signal,
        true,
        undefined,
        undefined,
        { ...settings, replayPackets: packets },
    );
    expect(appendedRaw).toBe(4);
    expect(appended.curation.concepts[0].memberIds).toHaveLength(52);
    validateTopicSnapshot(appended);
});

test("a failed preparation aborts and drains its sibling without installing a window", async () => {
    let active = 0;
    let calls = 0;
    let checkpoints = 0;
    let receipts = 0;
    const value = snapshot(48);
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => {
                const ordinal = ++calls;
                active++;
                try {
                    if (ordinal === 1)
                        throw new Error("Synthetic preparation failure");
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    return merged(payload);
                } finally {
                    active--;
                }
            },
            new AbortController().signal,
            true,
            async () => {
                checkpoints++;
            },
            undefined,
            {
                ...settings,
                onPacket: () => {
                    receipts++;
                },
            },
        ),
    ).rejects.toThrow("Synthetic preparation failure");
    expect(active).toBe(0);
    expect(checkpoints).toBe(0);
    expect(receipts).toBe(0);
    expect(value.curation).toBeUndefined();
});

test("cold continuation retains an installed window and resumes only unprocessed raw nodes", async () => {
    const value = snapshot();
    let saved: TopicCuration | undefined;
    const receipts: TopicCurationPacket[] = [];
    await expect(
        curateTopics(
            value,
            (node) => node.citations,
            async (_rules, payload) => merged(payload),
            new AbortController().signal,
            true,
            async (current) => {
                saved = structuredClone(current);
                throw new Error("Synthetic checkpoint stop");
            },
            undefined,
            { ...settings, onPacket: (packet) => receipts.push(packet) },
        ),
    ).rejects.toThrow("Synthetic checkpoint stop");
    expect(saved?.concepts[0].memberIds).toHaveLength(48);
    let prepared = 0;
    const resumed = await curateTopics(
        snapshot(),
        (node) => node.citations,
        async (_rules, payload, _schema, call) => {
            if (call?.phase === "preparation") prepared += call.rawNodes ?? 0;
            return merged(payload);
        },
        new AbortController().signal,
        true,
        undefined,
        saved,
        { ...settings, onPacket: (packet) => receipts.push(packet) },
    );
    expect(prepared).toBe(2);
    expect(receipts.map(({ start, end }) => [start, end])).toEqual([
        [0, 48],
        [48, 50],
    ]);
    expect(resumed.concepts[0].memberIds).toHaveLength(50);
});

test("delta responses retain omitted priors exactly but still repair omitted new nodes", async () => {
    const value = snapshot(3);
    const first = snapshot(1);
    const prior = await curateTopics(
        first,
        (node) => node.citations,
        async (_rules, payload) => merged(payload),
        new AbortController().signal,
        true,
    );
    let calls = 0;
    const result = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload, _schema, call) => {
            const packet = payload as Payload;
            expect(packet.nodes.some(({ role }) => role === "prior")).toBe(
                true,
            );
            if (++calls === 1) return { concepts: [], deferred: [] };
            expect(call?.kind).toBe("omission-repair");
            return {
                concepts: [],
                deferred: packet.nodes
                    .filter(({ role }) => role === "new")
                    .map(({ id }) => ({
                        nodeId: id,
                        reason: "Fixture deferral",
                    })),
            };
        },
        new AbortController().signal,
        true,
        undefined,
        prior,
        { priorDeltas: true },
    );
    expect(calls).toBe(2);
    expect(result.concepts).toEqual(prior.concepts);
    expect(result.deferred).toHaveLength(2);
});

test("compact identifiers preserve factual prose and reject unknown returned aliases", async () => {
    const value = snapshot(1);
    const factual = value.nodes[0].id;
    const complete = compactTopicCompletion(async (_rules, payload, schema) => {
        const packet = payload as Payload & { evidence: unknown[] };
        expect(packet.nodes[0].id).toBe("n0");
        expect(packet.nodes[0].label).toBe(factual);
        expect(packet.evidence).toEqual([{ excerpt: factual }]);
        expect(JSON.stringify(schema)).not.toContain(factual);
        return {
            concepts: [],
            deferred: [{ nodeId: "n99", reason: "Invalid" }],
        };
    });

    await expect(
        complete(
            "Fixture",
            {
                nodes: [{ id: factual, label: factual }],
                evidence: [{ excerpt: factual }],
            },
            {
                name: "fixture",
                schema: { type: "string", enum: [factual] },
            },
        ),
    ).rejects.toThrow("Unknown compact topic identifier");
});

test("delta window receipts retain audited prior summaries exactly on replay", async () => {
    const first = snapshot(1);
    const prior = await curateTopics(
        first,
        (node) => node.citations,
        async (_rules, payload) => merged(payload),
        new AbortController().signal,
        true,
    );
    prior.concepts[0].summaryState = "ready";
    prior.concepts[0].summary =
        "Installation requires explicit approval under the service policy.";
    const value = snapshot(3);
    const packets: TopicCurationPacket[] = [];
    const result = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload) => {
            const packet = payload as Payload;
            return {
                concepts: [],
                deferred: packet.nodes
                    .filter(({ role }) => role === "new")
                    .map(({ id }) => ({
                        nodeId: id,
                        reason: "Synthetic unchanged-prior comparison",
                    })),
            };
        },
        new AbortController().signal,
        true,
        undefined,
        prior,
        { ...settings, onPacket: (packet) => packets.push(packet) },
    );
    expect(result.concepts).toEqual(prior.concepts);
    expect(packets[0].response.concepts).toEqual([]);
    const replayPrior = structuredClone(prior);
    const replayed = await curateTopics(
        snapshot(3),
        (node) => node.citations,
        async () => {
            throw new Error("Unchanged delta window must replay");
        },
        new AbortController().signal,
        true,
        undefined,
        replayPrior,
        {
            ...settings,
            replayPackets: packets,
        },
    );
    expect(replayed).toEqual(result);
});

test("unknown compact response IDs use the existing bounded contract repair", async () => {
    let calls = 0;
    const value = snapshot(1);
    const result = await curateTopics(
        value,
        (node) => node.citations,
        async (_rules, payload, _schema, call) => {
            if (++calls === 1)
                return {
                    concepts: [],
                    deferred: [{ nodeId: "n99", reason: "Synthetic bad ID" }],
                };
            expect(call?.kind).toBe("contract-repair");
            return merged(payload);
        },
        new AbortController().signal,
        true,
        undefined,
        undefined,
        { compactIds: true },
    );
    expect(calls).toBe(2);
    expect(result.concepts[0].memberIds).toEqual([value.nodes[0].id]);
});

test("parallel preparation rejects non-lazy use and ordinary speculative watermark replay", async () => {
    const value = snapshot(1);
    const cases: Array<[boolean, TopicCurationOptions]> = [
        [false, settings],
        [true, { concurrency: 2, replayPackets: [] }],
    ];
    for (const [lazy, options] of cases)
        await expect(
            curateTopics(
                value,
                (node) => node.citations,
                async (_rules, payload) => merged(payload),
                new AbortController().signal,
                lazy,
                undefined,
                undefined,
                options,
            ),
        ).rejects.toThrow();
});
