// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    getRuntimeConfigGeneration,
    type ChatModel,
} from "@typeagent/aiclient";
import { captureTopicBuild } from "../src/topicCapture.js";
import {
    createConfiguredTopicGenerator,
    createConfiguredTopicConceptSummarizer,
    createTopicSnapshot,
} from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { validateTopicSnapshot } from "../src/topicSnapshot.js";
import { topicClusterSignature } from "../src/topicDecision.js";
import { prioritizeTopicMaintenance } from "../src/topicClusterMaintenance.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { TypedViewStore } from "../src/viewStore.js";
import { viewHash } from "../src/viewContent.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type { TopicOccurrence, TopicSnapshot } from "../src/topicTypes.js";
import type { ViewBuildJob, ViewSynthesisAdapter } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

class TopicIndex extends FakeSemanticCorpusIndex {
    public async listSubjects() {
        return { items: [], total: 0 };
    }
    public async readFragments(): Promise<never> {
        throw new Error(
            "No Wiki candidates exist in the offline topic fixture",
        );
    }
    public constructor(
        indexDirectory: string,
        private readonly seedCount = 55,
    ) {
        super(indexDirectory);
    }
    public async getTopicOccurrences(sourceIds: ReadonlySet<string>) {
        return this.documents
            .filter((document) => sourceIds.has(document.source.sourceId))
            .filter((document) => !document.content.startsWith("Context only:"))
            .flatMap((document) =>
                Array.from(
                    {
                        length:
                            document.source.sourceId === "seed"
                                ? this.seedCount
                                : 1,
                    },
                    (_, ordinal) =>
                        indexedTopicOccurrence(
                            {
                                sourceId: document.source.sourceId,
                                revisionId: document.revision.revisionId,
                                blockOrdinal: ordinal,
                                text: document.content,
                                score: 1,
                            },
                            document.source.sourceId === "seed"
                                ? `Topic ${ordinal}`
                                : `Additional topic ${ordinal}`,
                            0,
                        ),
                ),
            );
    }
}

class CapturedIndex extends FakeSemanticCorpusIndex {
    public constructor(private readonly occurrences: TopicOccurrence[]) {
        super("unused");
    }
    public async getTopicOccurrences() {
        return structuredClone(this.occurrences);
    }
}

test.each([false, true])(
    "successive in-flight evidence cuts catch up after reopen without publishing private work: reuse=%s",
    async (reuse) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "topic-continuous-cuts-"),
        );
        const cuts = Array.from({ length: 3 }, () => ({
            reached: deferred(),
            release: deferred(),
        }));
        let runs = 0,
            calls = 0,
            processedNodes = 0;
        const generate = createConfiguredTopicGenerator({
            model: {
                completionSettings: {},
                complete: async (messages) => {
                    if (typeof messages === "string")
                        throw new Error("Expected structured prompt");
                    const payload = JSON.parse(String(messages[1].content)) as {
                        nodes: Array<{ id: string }>;
                    };
                    calls++;
                    processedNodes += payload.nodes.length;
                    return {
                        success: true,
                        data: JSON.stringify({
                            concepts: [],
                            deferred: payload.nodes.map(({ id }) => ({
                                nodeId: id,
                                reason: "Incidental mention",
                            })),
                        }),
                    };
                },
            },
            mode: { kind: "generative" },
        });
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-continuous-cuts",
            generate: async () => {
                throw new Error("Unexpected article request");
            },
            validate: async () => {
                throw new Error("Unexpected article validation");
            },
            generateTopics: (input, signal, save) => {
                const cut = cuts[runs++];
                let held = false;
                return generate(input, signal, async (snapshot) => {
                    if (save) await save(snapshot);
                    if (cut && !held && snapshot.curationProgress) {
                        held = true;
                        cut.reached.resolve();
                        await cut.release.promise;
                    }
                });
            },
        };
        const open = () =>
            new FileMemoryService(root, {
                sourceSynopses: false,
                topicCurationReuse: reuse,
                topicWatermark: reuse,
                indexFactory: (_, directory) => new TopicIndex(directory, 48),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        let hold: (() => void) | undefined;
        try {
            const { corpusId } = await service.createCorpus(
                "Continuous offline evidence cuts",
            );
            hold = service.deferTopicMaintenance(corpusId);
            const ingest = async (sourceId: string) => {
                const accepted = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId,
                        sourceType: "text",
                        title: sourceId,
                        text: "The pilot remains blocked.",
                    },
                });
                expect(
                    (
                        await waitForMemoryJob(service, accepted.jobId, {
                            pollIntervalMs: 5,
                        })
                    ).state,
                ).toBe("complete");
            };
            await ingest("seed");
            for (const [ordinal, cut] of cuts.entries()) {
                const job = await service.rebuildTopics(corpusId);
                await cut.reached.promise;
                await ingest(`zz-${ordinal * 2}`);
                await ingest(`zz-${ordinal * 2 + 1}`);
                expect(
                    (await service.queryTopics({ corpusId })).totalNodes,
                ).toBe(0);
                cut.release.resolve();
                expect(
                    (await waitTopicJob(service, job)).results[0].state,
                ).toBe("stale");
                const state = await new TypedViewStore(root).getTopicState(
                    corpusId,
                );
                expect(state.family.dirty).toBe(true);
                if (reuse)
                    expect(
                        state.continuation?.curationPackets?.length,
                    ).toBeGreaterThanOrEqual(2);
                else expect(state.continuation).toBeUndefined();
            }
            await service.close();
            hold();
            service = open();
            hold = service.deferTopicMaintenance(corpusId);
            expect((await service.queryTopics({ corpusId })).totalNodes).toBe(
                0,
            );
            expect(
                (
                    await waitTopicJob(
                        service,
                        await service.rebuildTopics(corpusId),
                    )
                ).state,
            ).toBe("complete");
            expect(
                (await service.queryTopics({ corpusId, pageSize: 100 }))
                    .totalNodes,
            ).toBe(54);
            expect(calls).toBe(reuse ? 5 : 6);
            expect(processedNodes).toBe(reuse ? 60 : 126);
            const current = await new TypedViewStore(root).getTopicState(
                corpusId,
            );
            expect(current.continuation).toBeUndefined();
            expect(current.family.dirty).toBe(false);
        } finally {
            for (const cut of cuts) cut.release.resolve();
            await service.close();
            hold?.();
            await rm(root, { recursive: true, force: true });
        }
    },
    30_000,
);

const occurrences = [0, 1].map((ordinal) =>
    indexedTopicOccurrence(
        {
            sourceId: "seed",
            revisionId: "r1",
            blockOrdinal: ordinal,
            text: "The pilot remains blocked; this is not general approval.",
            score: 1,
        },
        `Topic ${ordinal}`,
        0,
    ),
);

function capture(
    current?: TopicSnapshot,
    changes: Partial<Parameters<typeof captureTopicBuild>[0]> = {},
) {
    return captureTopicBuild({
        corpusId: "offline",
        actor: "offline",
        index: new CapturedIndex(occurrences),
        sources: [{ sourceId: "seed", revisionId: "r1" }],
        suppressions: [],
        model: "offline",
        indexGeneration: "generation-1",
        topicCurationReuse: true,
        ...(current ? { current } : {}),
        ...changes,
    });
}

async function priorSnapshot() {
    const input = await capture();
    const snapshot = createTopicSnapshot(input, input.model);
    const witness = input.topicInput!.curationInputFingerprint;
    if (!witness) throw new Error("Expected captured dependency witness");
    snapshot.curationInputFingerprint = witness;
    snapshot.recipe += ":curated-lazy-v6";
    snapshot.curationProgress = {
        concepts: [],
        deferred: [
            { nodeId: snapshot.nodes[0].id, reason: "Incidental mention" },
        ],
    };
    return snapshot;
}

test.each([false, true])(
    "generation-only reuse is opt-in and preserves independent physical ownership: %s",
    async (enabled) => {
        const current = await priorSnapshot();
        const next = await capture(current, {
            indexGeneration: "generation-2",
            topicCurationReuse: enabled,
        });
        expect(next.fingerprint).not.toBe(current.inputFingerprint);
        expect(Boolean(next.topicInput!.reusableCuration)).toBe(enabled);
        const snapshot = createTopicSnapshot(next, next.model);
        expect(snapshot.inputFingerprint).toBe(next.fingerprint);
        expect(snapshot.generation).not.toBe(current.generation);
        expect(snapshot.influenceSources).toEqual(next.influenceSources);
        validateTopicSnapshot(snapshot);
    },
);

test.each([
    { model: "changed-model" },
    { curationRecipe: "changed-policy" },
    { corpusId: "changed-corpus" },
    { sources: [{ sourceId: "seed", revisionId: "r2" }] },
    { sources: [] },
    {
        suppressions: [
            { kind: "topic" as const, sourceId: "other", name: "x" },
        ],
    },
    { influenceEvents: [{ eventId: "event", fingerprint: "a".repeat(64) }] },
    {
        index: new CapturedIndex(
            occurrences.map((entry) => ({
                ...entry,
                context: { role: "user", chronology: "New qualification" },
            })),
        ),
    },
    {
        index: new CapturedIndex(
            occurrences.map((entry) => ({
                ...entry,
                citations: entry.citations.map((citation) => ({
                    ...citation,
                    excerpt: "Governing correction: approval is withdrawn.",
                })),
            })),
        ),
    },
    {
        sources: [
            { sourceId: "seed", revisionId: "r1" },
            { sourceId: "new", revisionId: "r1" },
        ],
        index: new CapturedIndex([
            ...occurrences,
            { ...occurrences[0], sourceId: "new", id: "new-occurrence" },
        ]),
    },
])("changed dependency closure cannot seed curation: %#", async (changes) => {
    expect(
        (await capture(await priorSnapshot(), changes)).topicInput!
            .reusableCuration,
    ).toBeUndefined();
});

test("legacy snapshots and human labels cannot silently acquire a reuse witness", async () => {
    const current = await priorSnapshot();
    delete current.curationInputFingerprint;
    expect(
        (await capture(current, { indexGeneration: "generation-2" }))
            .topicInput!.reusableCuration,
    ).toBeUndefined();
    expect((await capture(current)).topicInput!.reusableCuration).toEqual(
        current.curationProgress,
    );
    current.nodes[0].authorship = "human";
    expect(
        (await capture(current)).topicInput!.reusableCuration,
    ).toBeUndefined();
});

test("raw/custom snapshots do not certify the default generator's dependency closure", async () => {
    const input = await capture();
    const custom = createTopicSnapshot(input, input.model);
    expect(custom.curationInputFingerprint).toBeUndefined();
    const current = await priorSnapshot();
    current.nodes[0].scope = "Changed generated qualification";
    expect(
        (await capture(current, { indexGeneration: "generation-2" }))
            .topicInput!.reusableCuration,
    ).toBeUndefined();
});

test("unchanged Decision receipts and maintenance priorities rebind only after old-state validation", async () => {
    const current = await priorSnapshot();
    current.recipe = "offline:editorial-v1:curated-decision-v1";
    const concept = {
        id: `concept:${"a".repeat(32)}`,
        label: "Pilot approval",
        scope: "Pilot only",
        purpose: "Distinguish a blocked pilot from general approval",
        memberIds: current.nodes.map((node) => node.id),
        summary: "",
        summaryState: "pending" as const,
        citations: current.nodes.flatMap((node) => node.citations),
        salience: 4,
        validation: {
            recipe: "cluster-local-v1" as const,
            signature: "",
            modelIdentity: "offline-decision",
            inputFingerprint: current.inputFingerprint,
        },
    };
    concept.validation.signature = topicClusterSignature(
        current,
        concept,
        concept.validation.modelIdentity,
    );
    prioritizeTopicMaintenance(
        current,
        concept,
        [concept.memberIds[0]],
        0.8,
        "Recheck uncertainty",
    );
    current.curationProgress = { concepts: [concept], deferred: [] };
    // Capture the witness under the same Decision recipe as the saved state.
    const witness = (
        await capture(undefined, { curationRecipe: "curated-decision-v1" })
    ).topicInput!.curationInputFingerprint;
    if (!witness) throw new Error("Expected Decision reuse witness");
    current.curationInputFingerprint = witness;
    validateTopicSnapshot(current);
    const next = await capture(current, {
        curationRecipe: "curated-decision-v1",
        indexGeneration: "generation-2",
    });
    const rebound = createTopicSnapshot(next, next.model);
    validateTopicSnapshot(rebound);
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async () => {
                throw new Error(
                    "Unchanged Decision input must not call authoring",
                );
            },
        },
        mode: {
            kind: "decision",
            createOptions: () => ({
                model: {
                    provider: "azure",
                    model: "offline-decision",
                    providerSource: "factory",
                    configGeneration: getRuntimeConfigGeneration(),
                    decide: async () => {
                        throw new Error(
                            "Unchanged Decision input must not reclassify members",
                        );
                    },
                },
            }),
        },
    });
    const generated = await generate(next, new AbortController().signal);
    validateTopicSnapshot(generated);
    expect(generated.curation!.concepts[0].memberIds).toEqual(
        concept.memberIds,
    );
    expect(
        rebound.curationProgress!.concepts[0].validation!.inputFingerprint,
    ).toBe(next.fingerprint);
    expect(rebound.curationProgress!.concepts[0].maintenance!.priority).toBe(
        0.8,
    );
    expect(concept.validation.inputFingerprint).toBe(current.inputFingerprint);
    expect(concept.validation.signature).not.toBe(
        rebound.curationProgress!.concepts[0].validation!.signature,
    );
    concept.validation.signature = "0".repeat(64);
    await expect(
        capture(current, {
            curationRecipe: "curated-decision-v1",
            indexGeneration: "generation-2",
        }),
    ).rejects.toThrow("Stale topic cluster validation receipt");
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test.each([
    [48, "zz-added", 1],
    [55, "zz-added", 1],
    [48, "aa-added", 3],
] as const)(
    "packet prefix replay preserves current output and respects ordering and tail boundaries: %s %s",
    async (count, sourceId, remainingCalls) => {
        const seed = Array.from({ length: count }, (_, ordinal) =>
            indexedTopicOccurrence(
                {
                    sourceId: "seed",
                    revisionId: "r1",
                    blockOrdinal: ordinal,
                    text: "The pilot remains blocked; this is not general approval.",
                    score: 1,
                },
                `Topic ${ordinal}`,
                0,
            ),
        );
        let calls = 0;
        const generate = createConfiguredTopicGenerator({
            model: {
                completionSettings: {},
                complete: async (messages) => {
                    calls++;
                    if (typeof messages === "string")
                        throw new Error("Expected structured prompt");
                    const payload = JSON.parse(String(messages[1].content)) as {
                        nodes: Array<{ id: string }>;
                    };
                    return {
                        success: true,
                        data: JSON.stringify({
                            concepts: [],
                            deferred: payload.nodes.map(({ id }) => ({
                                nodeId: id,
                                reason: "Incidental mention",
                            })),
                        }),
                    };
                },
            },
            mode: { kind: "generative" },
        });
        const input = await capture(undefined, {
            index: new CapturedIndex(seed),
            topicWatermark: true,
        });
        const previous = await generate(input, new AbortController().signal);
        expect(previous.curationPackets).toHaveLength(Math.ceil(count / 24));
        const added = indexedTopicOccurrence(
            {
                sourceId,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "Additional pilot evidence remains qualified.",
                score: 1,
            },
            "Additional topic",
            0,
        );
        const next = await capture(previous, {
            topicWatermark: true,
            indexGeneration: "generation-2",
            sources: [
                ...input.influenceSources!,
                { sourceId, revisionId: "r1" },
            ],
            index: new CapturedIndex([...seed, added]),
        });
        expect(next.topicInput?.reusableCuration).toBeUndefined();
        expect(next.topicInput?.reusableCurationPackets).toHaveLength(
            Math.ceil(count / 24),
        );
        const before = calls;
        const candidate = await generate(next, new AbortController().signal);
        expect(calls - before).toBe(remainingCalls);
        const controlInput = structuredClone(next);
        delete controlInput.topicInput!.reusableCurationPackets;
        const control = await generate(
            controlInput,
            new AbortController().signal,
        );
        expect(candidate.curation).toEqual(control.curation);
        expect(candidate.nodes).toEqual(control.nodes);
        validateTopicSnapshot(candidate);
        const corrupt = structuredClone(previous);
        corrupt.curationPackets![0].response.deferred[0].reason =
            "Corrupt receipt";
        await expect(
            capture(corrupt, {
                topicWatermark: true,
                indexGeneration: "generation-2",
                index: new CapturedIndex(seed),
            }),
        ).rejects.toThrow("packet receipt");
        const invalid = structuredClone(previous);
        invalid.curationPackets![0].response.deferred[0].nodeId =
            "invented-node";
        invalid.curationPackets![0].responseFingerprint = viewHash(
            invalid.curationPackets![0].response,
        );
        const invalidInput = await capture(invalid, {
            topicWatermark: true,
            indexGeneration: "generation-2",
            index: new CapturedIndex([...seed, added]),
            sources: [
                ...input.influenceSources!,
                { sourceId, revisionId: "r1" },
            ],
        });
        if (sourceId === "zz-added") {
            const priorCalls = calls;
            await expect(
                generate(invalidInput, new AbortController().signal),
            ).rejects.toThrow("invented");
            expect(calls).toBe(priorCalls);
        }
    },
);

test("packet receipts compact prior concept membership and replay exact consolidation", async () => {
    const seed = Array.from({ length: 48 }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: "seed",
                revisionId: "r1",
                blockOrdinal: ordinal,
                text: "Pilot evidence remains qualified.",
                score: 1,
            },
            `Pilot ${ordinal}`,
            0,
        ),
    );
    let calls = 0;
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async (messages) => {
                calls++;
                if (typeof messages === "string")
                    throw new Error("Expected structured prompt");
                const payload = JSON.parse(String(messages[1].content)) as {
                    nodes: Array<{ id: string }>;
                };
                return {
                    success: true,
                    data: JSON.stringify({
                        concepts: [
                            {
                                label: "Pilot evidence",
                                scope: "Pilot only",
                                purpose: "Track qualified pilot evidence",
                                memberIds: payload.nodes.map(({ id }) => id),
                                evidenceIds: ["e0"],
                                salience: 4,
                            },
                        ],
                        deferred: [],
                    }),
                };
            },
        },
        mode: { kind: "generative" },
    });
    const previous = await generate(
        await capture(undefined, {
            topicWatermark: true,
            index: new CapturedIndex(seed),
        }),
        new AbortController().signal,
    );
    expect(previous.curation?.concepts[0].memberIds).toHaveLength(48);
    expect(
        previous.curationPackets?.[1].response.concepts[0].memberIds,
    ).toHaveLength(25);
    const added = indexedTopicOccurrence(
        {
            sourceId: "zz-added",
            revisionId: "r1",
            blockOrdinal: 0,
            text: "Additional pilot evidence.",
            score: 1,
        },
        "Pilot additional evidence",
        0,
    );
    const next = await capture(previous, {
        topicWatermark: true,
        indexGeneration: "generation-2",
        sources: [
            ...previous.influenceSources,
            { sourceId: "zz-added", revisionId: "r1" },
        ],
        index: new CapturedIndex([...seed, added]),
    });
    const before = calls;
    const candidate = await generate(next, new AbortController().signal);
    expect(calls - before).toBe(1);
    delete next.topicInput!.reusableCurationPackets;
    const control = await generate(next, new AbortController().signal);
    expect(candidate.curation).toEqual(control.curation);
});

test.each(
    (["append", "correction", "forget", "staged-correction"] as const).flatMap(
        (change) => [[change, false] as const, [change, true] as const],
    ),
)(
    "production private watermark is durable, unpublished, and fails closed for %s (frozen: %s)",
    async (change, frozen) => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "topic-watermark-"),
        );
        const checkpointed = deferred(),
            release = deferred();
        let calls = 0,
            held = false;
        let activeSignal: AbortSignal | undefined;
        const generate = createConfiguredTopicGenerator({
            model: {
                completionSettings: {},
                complete: async (messages) => {
                    calls++;
                    if (typeof messages === "string")
                        throw new Error("Expected structured prompt");
                    const payload = JSON.parse(String(messages[1].content)) as {
                        nodes: Array<{ id: string }>;
                    };
                    return {
                        success: true,
                        data: JSON.stringify({
                            concepts: [],
                            deferred: payload.nodes.map(({ id }) => ({
                                nodeId: id,
                                reason: "Incidental mention",
                            })),
                        }),
                    };
                },
            },
            mode: {
                kind: "generative",
                ...(frozen
                    ? {
                          settings: {
                              concurrency: 2,
                              frozenPreparation: true,
                              priorDeltas: true,
                              compactIds: true,
                          },
                      }
                    : {}),
            },
        });
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-watermark",
            generate: async () => {
                throw new Error("Unexpected article call");
            },
            validate: async () => {
                throw new Error("Unexpected article validation");
            },
            generateTopics: (input, signal, save) => {
                activeSignal = signal;
                return generate(input, signal, async (snapshot) => {
                    if (save) await save(snapshot);
                    if (!held && snapshot.curationProgress) {
                        held = true;
                        checkpointed.resolve();
                        await release.promise;
                    }
                });
            },
        };
        const open = () =>
            new FileMemoryService(directory, {
                sourceSynopses: false,
                topicCurationReuse: true,
                topicWatermark: true,
                indexFactory: (_, root) => new TopicIndex(root, 48),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        let finishHold: (() => void) | undefined;
        try {
            const { corpusId } = await service.createCorpus(
                "Offline private watermark",
            );
            finishHold = service.deferTopicMaintenance(corpusId);
            const ingest = async (sourceId: string, text: string) => {
                const accepted = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId,
                        sourceType: "text",
                        title: sourceId,
                        text,
                    },
                });
                expect(
                    (
                        await waitForMemoryJob(service, accepted.jobId, {
                            pollIntervalMs: 5,
                        })
                    ).state,
                ).toBe("complete");
            };
            await ingest("seed", "The pilot remains blocked.");
            const pinned = await service.rebuildTopics(corpusId);
            await checkpointed.promise;
            if (change !== "correction") {
                for (let index = 0; index < 3; index++)
                    await ingest(`zz-${index}`, "Additional pilot evidence.");
            } else
                await ingest(
                    "seed",
                    "Governing correction: approval is withdrawn.",
                );
            expect(activeSignal?.aborted).toBe(change === "correction");
            expect(
                service
                    .getMaintenanceStatus()
                    .pending.filter((key) => key === `${corpusId}:topics`),
            ).toHaveLength(1);
            expect(
                (await service.listViewBuilds(corpusId)).filter(
                    (job) => job.state === "running",
                ),
            ).toHaveLength(1);
            expect((await service.queryTopics({ corpusId })).totalNodes).toBe(
                0,
            );
            release.resolve();
            expect((await waitTopicJob(service, pinned)).results[0].state).toBe(
                "stale",
            );
            const state = await new TypedViewStore(directory).getTopicState(
                corpusId,
            );
            if (change !== "correction") {
                expect(state.continuation?.curationPackets).toHaveLength(
                    frozen ? 1 : 2,
                );
                expect(state.snapshot?.curationProgress?.deferred).toHaveLength(
                    frozen ? 48 : 24,
                );
                expect(state.family.dirty).toBe(true);
                expect(calls).toBe(frozen ? 4 : 2);
                if (change === "forget") {
                    const preview = await service.previewForgetSource(
                        corpusId,
                        "seed",
                    );
                    await service.forgetSource({
                        corpusId,
                        sourceId: "seed",
                        confirmationToken: preview.confirmationToken,
                    });
                    expect(
                        (
                            await new TypedViewStore(directory).getTopicState(
                                corpusId,
                            )
                        ).continuation,
                    ).toBeUndefined();
                } else if (change === "staged-correction") {
                    await ingest(
                        "seed",
                        "Governing correction: approval is withdrawn.",
                    );
                    expect(
                        (
                            await new TypedViewStore(directory).getTopicState(
                                corpusId,
                            )
                        ).continuation,
                    ).toBeUndefined();
                }
                await service.close();
                finishHold();
                finishHold = undefined;
                service = open();
                finishHold = service.deferTopicMaintenance(corpusId);
                expect(
                    (
                        await new TypedViewStore(directory).getTopicState(
                            corpusId,
                        )
                    ).continuation?.curationPackets?.length ?? 0,
                ).toBe(change === "append" ? (frozen ? 1 : 2) : 0);
            } else expect(state.continuation).toBeUndefined();
            const before = calls;
            if (change === "append") {
                finishHold?.();
                finishHold = undefined;
                const drained = await service.drainMaintenance(15000);
                expect(drained.failures).toEqual([]);
                expect(drained.pending).toEqual([]);
                expect(drained.running).toEqual([]);
                expect(drained.settled).toBe(true);
                expect(
                    (await service.listViewBuilds(corpusId)).filter((job) =>
                        job.results.some(
                            (result) =>
                                result.snapshot.pipeline === "topics-v1",
                        ),
                    ),
                ).toHaveLength(2);
            } else
                expect(
                    (
                        await waitTopicJob(
                            service,
                            await service.rebuildTopics(corpusId),
                        )
                    ).state,
                ).toBe("complete");
            const expectedCalls =
                change === "staged-correction"
                    ? 3
                    : change === "correction"
                      ? 2
                      : 1;
            expect(calls - before).toBe(
                // Custom adapters cannot certify a different host curation policy.
                frozen && change === "append"
                    ? 6
                    : frozen
                      ? expectedCalls * 2
                      : expectedCalls,
            );
            const page = await service.queryTopics({ corpusId, pageSize: 100 });
            expect(page.totalNodes).toBe(
                change === "correction" ? 48 : change === "forget" ? 3 : 51,
            );
            expect(
                (await new TypedViewStore(directory).getTopicState(corpusId))
                    .continuation,
            ).toBeUndefined();
            if (change === "correction")
                expect(
                    page.nodes.every((node) =>
                        node.citations.every((citation) =>
                            citation.excerpt.includes("approval is withdrawn"),
                        ),
                    ),
                ).toBe(true);
            if (change === "forget")
                expect(
                    page.nodes.every((node) =>
                        node.citations.every(
                            (citation) => citation.sourceId !== "seed",
                        ),
                    ),
                ).toBe(true);
        } finally {
            release.resolve();
            await service.close();
            finishHold?.();
            await rm(directory, { recursive: true, force: true });
        }
    },
    60000,
);

test("audited lazy concept prose survives unchanged semantic input without recuration or reauditing", async () => {
    const current = await priorSnapshot();
    const concept = {
        id: `concept:${"b".repeat(32)}`,
        label: "Pilot approval",
        scope: "Pilot only",
        purpose: "Keep pilot status separate from general approval",
        memberIds: current.nodes.map((node) => node.id),
        summary: "",
        summaryState: "pending" as const,
        citations: current.nodes.flatMap((node) => node.citations),
        salience: 4,
    };
    let summaryCalls = 0;
    const summarize = createConfiguredTopicConceptSummarizer(undefined, {
        completionSettings: {},
        complete: async () => ({
            success: true,
            data: JSON.stringify(
                ++summaryCalls === 1
                    ? {
                          summary:
                              "The pilot remains blocked; this is not general approval.",
                          evidenceIds: [0],
                      }
                    : { safe: true, failures: [] },
            ),
        }),
    });
    const audited = await summarize(concept, new AbortController().signal);
    delete current.curationProgress;
    current.curation = {
        concepts: [
            {
                ...concept,
                summary: audited.summary,
                summaryState: "ready",
                summaryCitations: audited.citations,
            },
        ],
        deferred: [],
    };
    validateTopicSnapshot(current);
    const next = await capture(current, {
        indexGeneration: "generation-2",
        sources: [
            { sourceId: "seed", revisionId: "r1" },
            { sourceId: "unrelated", revisionId: "r1" },
        ],
    });
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async () => {
                throw new Error(
                    "Unchanged audited concepts must not be reclassified",
                );
            },
        },
        mode: { kind: "generative" },
    });
    const generated = await generate(next, new AbortController().signal);
    expect(generated.curation).toEqual(current.curation);
    expect(summaryCalls).toBe(2);
    validateTopicSnapshot(generated);
});

async function waitTopicJob(service: FileMemoryService, job: ViewBuildJob) {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Topic job disappeared");
        if (current.state !== "running") return current;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Offline topic job timed out");
}

test.each([
    [false, "unrelated", 3],
    [true, "unrelated", 2],
    [true, "correction", 3],
    [true, "new-topic", 3],
] as const)(
    "production checkpoint churn preserves only unaffected work and reaches current durable output: reuse=%s change=%s",
    async (reuse, change, expectedRemainingCalls) => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "topic-work-reuse-"),
        );
        const checkpointed = deferred(),
            release = deferred();
        let calls = 0,
            interrupt = true;
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages) => {
                calls++;
                if (typeof messages === "string")
                    throw new Error("Expected structured offline prompt");
                const payload = JSON.parse(String(messages[1].content)) as {
                    nodes: Array<{ id: string }>;
                };
                return {
                    success: true,
                    data: JSON.stringify({
                        concepts: [],
                        deferred: payload.nodes.map(({ id }) => ({
                            nodeId: id,
                            reason: "Incidental mention",
                        })),
                    }),
                };
            },
        };
        const generate = createConfiguredTopicGenerator({
            model,
            mode: { kind: "generative" },
        });
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-churn",
            generate: async () => {
                throw new Error("Unexpected article call");
            },
            validate: async () => {
                throw new Error("Unexpected article validation");
            },
            generateTopics: (input, signal, save) =>
                generate(input, signal, async (snapshot) => {
                    if (save) await save(snapshot);
                    if (interrupt && snapshot.curationProgress) {
                        interrupt = false;
                        checkpointed.resolve();
                        await release.promise;
                    }
                }),
        };
        const open = () =>
            new FileMemoryService(directory, {
                sourceSynopses: false,
                topicCurationReuse: reuse,
                indexFactory: (_, indexDirectory) =>
                    new TopicIndex(indexDirectory),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        let finishHold: (() => void) | undefined;
        try {
            const { corpusId } = await service.createCorpus(
                "Offline checkpoint churn",
            );
            finishHold = service.deferTopicMaintenance(corpusId);
            const ingest = async (sourceId: string, text: string) => {
                const accepted = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId,
                        sourceType: "text",
                        title: sourceId,
                        text,
                    },
                });
                const job = await waitForMemoryJob(service, accepted.jobId, {
                    pollIntervalMs: 5,
                });
                expect(job.state).toBe("complete");
                return accepted;
            };
            await ingest("seed", "The pilot remains blocked.");
            const obsolete = await service.rebuildTopics(corpusId);
            await checkpointed.promise;
            expect(calls).toBe(1);
            await ingest(
                change === "correction" ? "seed" : "additional",
                change === "unrelated"
                    ? "Context only: no extracted topic."
                    : "Governing correction: approval is withdrawn.",
            );
            expect((await service.queryTopics({ corpusId })).totalNodes).toBe(
                0,
            );
            release.resolve();
            expect(
                (await waitTopicJob(service, obsolete)).results[0].state,
            ).toBe("stale");
            const before = calls;
            expect(
                (
                    await waitTopicJob(
                        service,
                        await service.rebuildTopics(corpusId),
                    )
                ).state,
            ).toBe("complete");
            expect(calls - before).toBe(expectedRemainingCalls);
            const page = await service.queryTopics({ corpusId, pageSize: 100 });
            expect(page.totalNodes).toBe(change === "new-topic" ? 56 : 55);
            if (change === "correction")
                expect(
                    page.nodes.every((node) =>
                        node.citations.every((citation) =>
                            citation.excerpt.includes("approval is withdrawn"),
                        ),
                    ),
                ).toBe(true);
            const completedCalls = calls;
            await ingest(
                "more-context",
                "Context only: another unrelated document.",
            );
            expect(
                (
                    await waitTopicJob(
                        service,
                        await service.rebuildTopics(corpusId),
                    )
                ).state,
            ).toBe("complete");
            expect(calls - completedCalls).toBe(reuse ? 0 : 3);
            expect(
                (await service.queryTopics({ corpusId, pageSize: 100 })).nodes,
            ).toEqual(page.nodes);
            await service.close();
            finishHold = undefined;
            service = open();
            expect(
                (await service.queryTopics({ corpusId, pageSize: 100 })).nodes,
            ).toEqual(page.nodes);
        } finally {
            release.resolve();
            await service.close();
            finishHold?.();
            await rm(directory, { recursive: true, force: true });
        }
    },
    60000,
);
