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
            return snapshot;
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
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(directory, { recursive: true, force: true });
    });
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
            await service.forgetSource({
                corpusId,
                sourceId: "context",
                confirmationToken: preview.confirmationToken,
            });
            release();
            hold = undefined;
            entered = undefined;
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
