// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import type { MemoryTopicService, TopicOccurrence } from "../src/topicTypes.js";
import type { MemoryService } from "../src/types.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewSynthesisAdapter,
} from "../src/viewTypes.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

class TopicIndex extends FakeSemanticCorpusIndex {
    public async getTopicOccurrences(
        sourceIds: ReadonlySet<string>,
    ): Promise<TopicOccurrence[]> {
        return this.documents
            .filter((document) => sourceIds.has(document.source.sourceId))
            .filter((document) => !document.content.startsWith("Context only:"))
            .flatMap((document) =>
                ["command lifetime", "held lease", "resource failure"].map(
                    (label) =>
                        indexedTopicOccurrence(
                            {
                                sourceId: document.source.sourceId,
                                revisionId: document.revision.revisionId,
                                blockOrdinal: 0,
                                text: document.content,
                                score: 1,
                            },
                            label,
                            0,
                        ),
                ),
            );
    }
}

function topics(
    service: MemoryService & Partial<MemoryTopicService>,
): MemoryTopicService {
    if (!service.queryTopics || !service.rebuildTopics)
        throw new Error("Production topic service is not wired");
    return {
        queryTopics: service.queryTopics.bind(service),
        rebuildTopics: service.rebuildTopics.bind(service),
    };
}
async function waitTopicJob(
    service: FileMemoryService,
    job: ViewBuildJob,
): Promise<ViewBuildJob> {
    for (let attempt = 0; attempt < 500; attempt++) {
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Topic job was purged");
        if (current.state !== "running") return current;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Offline topic build timed out");
}

describe("production topic service vertical slice", () => {
    let directory: string;
    let service: FileMemoryService;
    let calls: number;
    let hold: Promise<void> | undefined;
    let entered: (() => void) | undefined;
    let generationSignal: AbortSignal | undefined;
    let curated = false;
    let summaryCalls = 0;
    let summaryHold: Promise<void> | undefined;
    let summaryEntered: (() => void) | undefined;
    let summaryFailure = false;
    const synthesis: ViewSynthesisAdapter = {
        identity: "offline-topics",
        generate: async () => {
            throw new Error("Unexpected article model call");
        },
        validate: async () => {
            throw new Error("Unexpected article support call");
        },
        generateTopics: async (input, signal) => {
            signal.throwIfAborted();
            generationSignal = signal;
            calls++;
            entered?.();
            if (hold) await hold;
            signal.throwIfAborted();
            const snapshot = createTopicSnapshot(input, input.model);
            for (const node of snapshot.nodes) {
                node.summary = node.citations[0].excerpt.slice(0, 1000);
                node.citations = node.citations.slice(0, 1);
                node.summaryState = "ready";
            }
            if (snapshot.nodes.length >= 3) {
                const [a, b, c] = snapshot.nodes.map((node) => node.id);
                snapshot.parents = [
                    { parentId: a, childId: c },
                    { parentId: b, childId: c },
                ];
                snapshot.related = [
                    { fromId: a, toId: b, kind: "related" },
                    { fromId: b, toId: a, kind: "related" },
                ];
            }
            if (curated) {
                expect(input.model).toContain("topics-curated-lazy-v6");
                snapshot.curation = {
                    concepts: [
                        {
                            id: `concept:${"a".repeat(32)}`,
                            label: "Command and lease lifetime",
                            scope: "Resource lifetime",
                            purpose:
                                "Distinguish command completion from held resources",
                            summary: "",
                            summaryState: "pending",
                            memberIds: snapshot.nodes.map((node) => node.id),
                            citations: snapshot.nodes[0].citations,
                            salience: 7,
                        },
                    ],
                    deferred: [],
                };
            }
            return snapshot;
        },
        generateTopicSummary: async (concept, signal) => {
            summaryCalls++;
            summaryEntered?.();
            if (summaryHold) await summaryHold;
            signal.throwIfAborted();
            if (summaryFailure)
                throw new Error("Intentional concept summary failure");
            return {
                summary: "Command lifetime differs from held lease lifetime.",
                citations: concept.citations,
            };
        },
    };
    class PrototypeAdapter implements ViewSynthesisAdapter {
        readonly #marker = true;
        get identity() {
            return synthesis.identity;
        }
        generate = synthesis.generate;
        validate = synthesis.validate;
        generateTopics(input: ViewBuildSnapshot, signal: AbortSignal) {
            if (!this.#marker || !synthesis.generateTopics)
                throw new Error("Offline prototype adapter lost its receiver");
            return synthesis.generateTopics(input, signal);
        }
        generateTopicSummary(
            ...args: Parameters<
                NonNullable<ViewSynthesisAdapter["generateTopicSummary"]>
            >
        ) {
            return synthesis.generateTopicSummary!(...args);
        }
    }
    function open() {
        return new FileMemoryService(directory, {
            indexFactory: (_corpusId, directory) => new TopicIndex(directory),
            viewSynthesisAdapter: Object.freeze(new PrototypeAdapter()),
            sourceSynopsisModel: {
                identity: "offline-independent-failure",
                fits: () => true,
                complete: async () => {
                    throw new Error("Intentional offline synopsis failure");
                },
            },
        });
    }
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "topic-service-"));
        calls = 0;
        hold = undefined;
        entered = undefined;
        generationSignal = undefined;
        curated = false;
        summaryCalls = 0;
        summaryHold = undefined;
        summaryEntered = undefined;
        summaryFailure = false;
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(directory, { recursive: true, force: true });
    });

    async function conceptCorpus() {
        curated = true;
        const { corpusId } = await service.createCorpus("Lazy concepts");
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        const admitted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "worksheet",
                sourceType: "text",
                title: "Timing",
                text: "Command lifetime differs from held lease lifetime.",
            },
        });
        await waitForMemoryJob(service, admitted.jobId, { pollIntervalMs: 10 });
        const receipt = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "resume",
        });
        if (!receipt.job) throw new Error("Concept build was not admitted");
        const job = await waitTopicJob(service, receipt.job);
        expect(job.results[0].missingEvidence ?? []).toEqual([]);
        return corpusId;
    }

    test("concept browsing and hierarchy are evidence-backed without summaries; explicit details coalesce and cache durably", async () => {
        const corpusId = await conceptCorpus();
        const initial = await service.queryTopics({ corpusId, curated: true });
        const topicId = initial.concepts![0].id;
        expect(initial.concepts![0].summaryState).toBe("pending");
        expect(initial.concepts![0].summary).toBe("");
        expect(initial.concepts![0].citations.length).toBeGreaterThan(0);
        expect(initial.concepts!.map((concept) => concept.label)).toEqual([
            "Command and lease lifetime",
        ]);
        expect(summaryCalls).toBe(0);
        let release!: () => void;
        summaryHold = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            summaryEntered = resolve;
        });
        const request = { corpusId, topicId, curated: true, summarize: true };
        const first = service.queryTopics(request);
        try {
            await started;
            const second = service.queryTopics(request);
            release();
            const pages = await Promise.all([first, second]);
            expect(summaryCalls).toBe(1);
            expect(
                pages.every(
                    (page) => page.concepts![0].summaryState === "ready",
                ),
            ).toBe(true);
            await service.queryTopics(request);
            expect(summaryCalls).toBe(1);
            await service.close();
            service = open();
            expect(
                (await service.queryTopics(request)).concepts![0].summary,
            ).toContain("held lease lifetime");
            expect(summaryCalls).toBe(1);
        } finally {
            release();
        }
    });

    test("lazy concept failures propagate and remain explicitly retryable", async () => {
        const corpusId = await conceptCorpus();
        const topicId = (await service.queryTopics({ corpusId, curated: true }))
            .concepts![0].id;
        summaryFailure = true;
        const request = { corpusId, topicId, curated: true, summarize: true };
        await expect(service.queryTopics(request)).rejects.toThrow(
            "Intentional concept summary failure",
        );
        expect(
            (await service.queryTopics({ corpusId, curated: true }))
                .concepts![0].summaryState,
        ).toBe("pending");
        summaryFailure = false;
        expect(
            (await service.queryTopics(request)).concepts![0].summaryState,
        ).toBe("ready");
        expect(summaryCalls).toBe(2);
        await expect(
            service.queryTopics({ corpusId, summarize: true }),
        ).rejects.toThrow("one explicit curated topic");
    });

    test.each(["clear", "close"] as const)(
        "%s aborts a held lazy summary without requiring adapter cooperation",
        async (operation) => {
            const corpusId = await conceptCorpus();
            const topicId = (
                await service.queryTopics({ corpusId, curated: true })
            ).concepts![0].id;
            let release!: () => void;
            summaryHold = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = new Promise<void>((resolve) => {
                summaryEntered = resolve;
            });
            const pending = service.queryTopics({
                corpusId,
                topicId,
                curated: true,
                summarize: true,
            });
            const rejected =
                expect(pending).rejects.toThrow(/cleared|closing/i);
            try {
                await started;
                if (operation === "clear") {
                    await service.clearCorpus(corpusId);
                    expect(
                        (await service.queryTopics({ corpusId, curated: true }))
                            .concepts ?? [],
                    ).toEqual([]);
                } else {
                    await service.close();
                }
                await rejected;
            } finally {
                release();
            }
        },
    );

    test("source replacement completes while lazy summary is held and rejects stale prose", async () => {
        const corpusId = await conceptCorpus();
        const topicId = (await service.queryTopics({ corpusId, curated: true }))
            .concepts![0].id;
        let release!: () => void;
        summaryHold = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            summaryEntered = resolve;
        });
        const pending = service.queryTopics({
            corpusId,
            topicId,
            curated: true,
            summarize: true,
        });
        const rejected = expect(pending).rejects.toThrow(
            /evidence changed|superseded/i,
        );
        try {
            await started;
            await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "topics",
                operation: "pause",
            });
            const changed = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "worksheet",
                    sourceType: "text",
                    title: "Updated timing",
                    text: "Resource failure does not establish command completion.",
                },
            });
            await waitForMemoryJob(service, changed.jobId, {
                pollIntervalMs: 10,
            });
            release();
            await rejected;
            expect(
                (await service.queryTopics({ corpusId, curated: true }))
                    .concepts ?? [],
            ).toHaveLength(0);
        } finally {
            release();
        }
    }, 60000);
    test("a replacement index aborts obsolete topic work without waiting under ingestion locks", async () => {
        const { corpusId } = await service.createCorpus("Superseded topics");
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        const first = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "worksheet",
                sourceType: "text",
                title: "Timing",
                text: "Command lifetime differs from held lease lifetime.",
            },
        });
        expect((await waitForMemoryJob(service, first.jobId)).state).toBe(
            "complete",
        );
        let release!: () => void;
        hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        try {
            const resumed = await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "topics",
                operation: "resume",
            });
            if (!resumed.job) throw new Error("Expected held topic job");
            await started;
            const obsoleteSignal = generationSignal;
            const changed = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "worksheet",
                    sourceType: "text",
                    title: "Timing update",
                    text: "Resource failure does not establish command completion.",
                },
            });
            expect((await waitForMemoryJob(service, changed.jobId)).state).toBe(
                "complete",
            );
            expect(obsoleteSignal?.aborted).toBe(true);
            expect(
                (
                    await service.getViewBuild({
                        corpusId,
                        jobId: resumed.job.jobId,
                    })
                )?.state,
            ).toBe("running");
            release();
            hold = undefined;
            entered = undefined;
            const obsolete = await waitTopicJob(service, resumed.job);
            expect(obsolete.results[0].state).toBe("stale");
            const fresh = await waitTopicJob(
                service,
                await service.rebuildTopics(corpusId),
            );
            expect(fresh.state).toBe("complete");
        } finally {
            release();
            hold = undefined;
            entered = undefined;
        }
    }, 60000);

    test("startup reconciliation preserves the history head for an unchanged implicit topic family", async () => {
        const { corpusId } = await service.createCorpus("Offline no-op");
        const before = await service.listViews(corpusId);
        await service.close();
        service = open();
        const after = await service.listViews(corpusId);
        expect(after.head).toBe(before.head);
        expect(after.views).toEqual(before.views);
        expect(calls).toBe(0);
    });
    test("source forgetting purges read-but-not-cited influence and rejects a late topic result", async () => {
        const { corpusId } = await service.createCorpus("Offline privacy");
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        for (const [sourceId, markdown] of [
            ["worksheet", "Held lease remains distinct from command lifetime."],
            [
                "context",
                "Context only: original context read by incidence capture, not cited.",
            ],
        ]) {
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "markdown",
                    title: sourceId,
                    markdown,
                },
            });
            await waitForMemoryJob(service, admitted.jobId, {
                pollIntervalMs: 10,
            });
        }
        let release!: () => void;
        hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const receipt = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "resume",
        });
        if (!receipt.job)
            throw new Error("Resumed topic family did not admit its job");
        const job = receipt.job;
        try {
            await started;
            const baseline = await service.queryTopics({ corpusId });
            expect(baseline.totalNodes).toBe(3);
            expect(
                baseline.nodes.every((node) =>
                    node.citations.every(
                        (citation) => citation.sourceId === "worksheet",
                    ),
                ),
            ).toBe(true);
            const preview = await service.previewForgetSource(
                corpusId,
                "context",
            );
            if (!generationSignal)
                throw new Error("Topic generator did not receive its signal");
            const cancelled = new Promise<void>((resolve) => {
                generationSignal!.addEventListener("abort", () => resolve(), {
                    once: true,
                });
            });
            const forgotten = service.forgetSource({
                corpusId,
                sourceId: "context",
                confirmationToken: preview.confirmationToken,
            });
            await cancelled;
            release();
            hold = undefined;
            entered = undefined;
            await forgotten;
            expect(
                await service.getViewBuild({ corpusId, jobId: job.jobId }),
            ).toBeUndefined();
            const current = await service.queryTopics({ corpusId });
            expect(current.generation).not.toBe(baseline.generation);
            expect(
                await service.getSource(corpusId, "context"),
            ).toBeUndefined();
            const fresh = await waitTopicJob(
                service,
                await service.rebuildTopics(corpusId),
            );
            expect(fresh.state).toBe("complete");
            expect((await service.queryTopics({ corpusId })).totalNodes).toBe(
                3,
            );
        } finally {
            release();
            hold = undefined;
            entered = undefined;
        }
    });
    test("persisted snapshots browse via production API; source replacement withdraws old incidence; restart is a no-op", async () => {
        const { corpusId } = await service.createCorpus("Offline topics");
        const source = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "worksheet",
                sourceType: "markdown",
                title: "Timing",
                markdown:
                    "Local command median 38 ms. The held lease and acquisition-p95 cohort are different.",
            },
        });
        await waitForMemoryJob(service, source.jobId, { pollIntervalMs: 10 });
        const firstJob = await waitTopicJob(
            service,
            await topics(service).rebuildTopics(corpusId),
        );
        expect(firstJob.state).toBe("complete");
        const first = await topics(service).queryTopics({
            corpusId,
            pageSize: 1,
        });
        expect(first.totalNodes).toBe(3);
        expect(first.nodes).toHaveLength(1);
        expect(first.nextContinuationToken).toBeDefined();
        expect(first.nodes[0].citations[0].revisionId).toBe(source.revisionId);
        expect(first.nodes[0].summaryState).toBe("ready");
        const replacement = await service.replaceSource({
            corpusId,
            sourceId: source.sourceId,
            expectedActiveRevisionId: source.revisionId,
            source: {
                sourceType: "markdown",
                title: "Timing",
                markdown:
                    "Local command median corrected to 41 ms. Acquisition-p95 cohort remains distinct.",
            },
        });
        await waitForMemoryJob(service, replacement.jobId, {
            pollIntervalMs: 10,
        });
        await waitTopicJob(
            service,
            await topics(service).rebuildTopics(corpusId),
        );
        const second = await topics(service).queryTopics({
            corpusId,
            pageSize: 200,
        });
        expect(
            second.nodes.every((node) =>
                node.citations.every(
                    (citation) =>
                        citation.revisionId === replacement.revisionId,
                ),
            ),
        ).toBe(true);
        expect(second.nodes.map((node) => node.id)).toContain(
            first.nodes[0].id,
        );
        await expect(
            topics(service).queryTopics({
                corpusId,
                pageSize: 1,
                continuationToken: first.nextContinuationToken!,
            }),
        ).rejects.toThrow(/stale/);
        const head = (await service.listViews(corpusId)).head;
        const generation = second.generation;
        const count = calls;
        await service.close();
        service = open();
        await service.initialize();
        expect(
            (await topics(service).queryTopics({ corpusId })).generation,
        ).toBe(generation);
        expect((await service.listViews(corpusId)).head).toBe(head);
        expect(calls).toBe(count);
    });
});
