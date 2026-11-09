// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    MemoryBatchImport,
    MemoryBatchImportRequest,
} from "../src/batchImport.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import type { TopicOccurrence } from "../src/topicTypes.js";
import type { DocumentIngestRequest } from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

function gate() {
    let release!: () => void;
    let enter!: () => void;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    return { pending, entered, release, enter, fail: false };
}

async function waitFor<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
): Promise<T> {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const value = await read();
        if (done(value)) return value;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Offline batch maintenance did not settle");
}

describe("durable batch maintenance coalescing", () => {
    let root: string;
    let service: GatedService;
    let captures: string[][];
    let discoveries: string[][];
    let generations: number;
    let synopsisCalls: number;
    let captureHold: ReturnType<typeof gate> | undefined;
    const gates = new Map<string, ReturnType<typeof gate>>();

    class BatchIndex extends FakeSemanticCorpusIndex {
        public async getTopicOccurrences(
            sourceIds: ReadonlySet<string>,
        ): Promise<TopicOccurrence[]> {
            captures.push([...sourceIds].sort());
            if (captureHold) {
                const held = captureHold;
                held.enter();
                await held.pending;
                captureHold = undefined;
            }
            return this.documents
                .filter((document) => sourceIds.has(document.source.sourceId))
                .map((document) =>
                    indexedTopicOccurrence(
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            blockOrdinal: 0,
                            text: document.content,
                            score: 1,
                        },
                        "durable batch maintenance",
                        0,
                    ),
                );
        }

        public async listSubjects(
            _offset: number,
            _limit: number,
            sourceIds: ReadonlySet<string>,
        ) {
            discoveries.push([...sourceIds].sort());
            return { items: [], total: 0 };
        }

        public async readFragments(): Promise<never> {
            throw new Error("Empty offline subject list has no fragments");
        }
    }

    class GatedService extends FileMemoryService {
        public override async ingestDocument(
            request: DocumentIngestRequest,
            signal?: AbortSignal,
        ) {
            const held = gates.get(request.source.title ?? "");
            if (held) {
                held.enter();
                await held.pending;
                signal?.throwIfAborted();
                if (held.fail) throw new Error("Offline member failure");
            }
            return super.ingestDocument(request, signal);
        }
    }

    function open(sourceSynopses = false) {
        return new GatedService(root, {
            sourceSynopses,
            sourceSynopsisModel: {
                identity: "unexpected-active-import-synopsis",
                fits: () => true,
                complete: async () => {
                    synopsisCalls++;
                    throw new Error(
                        "Source synopsis started during the gated import",
                    );
                },
            },
            indexFactory: (_corpusId, directory) => new BatchIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-batch-topics",
                generate: async () => {
                    throw new Error("Unexpected article model call");
                },
                validate: async () => {
                    throw new Error("Unexpected article support call");
                },
                generateTopics: async (input, signal) => {
                    signal.throwIfAborted();
                    generations++;
                    const snapshot = createTopicSnapshot(input, input.model);
                    for (const node of snapshot.nodes) {
                        node.summary = node.citations[0].excerpt;
                        node.citations = node.citations.slice(0, 1);
                        node.summaryState = "ready";
                    }
                    return snapshot;
                },
            },
        });
    }

    function request(corpusId: string, key: string): MemoryBatchImportRequest {
        return {
            corpusId,
            idempotencyKey: key,
            documents: [0, 1, 2].map((index) => ({
                source: {
                    sourceId: `${key}-${index}`,
                    sourceType: "markdown",
                    title: `${key}-${index}`,
                    markdown: `# ${key} ${index}\n\nDurable batch maintenance preserves completed sources.`,
                },
            })),
        };
    }

    async function settled(batch: MemoryBatchImport) {
        return waitFor(
            () => service.getBatchImport(batch.batchId),
            (current) => !["running", "cancelling"].includes(current.state),
        );
    }

    async function maintained(corpusId: string, sourceCount: number) {
        await waitFor(
            () => service.listViewBuilds(corpusId),
            (jobs) =>
                jobs.some(
                    (job) =>
                        job.state === "complete" &&
                        job.results.some(
                            (result) =>
                                result.snapshot.pipeline === "topics-v1" &&
                                result.snapshot.influenceSources?.length ===
                                    sourceCount,
                        ),
                ),
        );
        await waitFor(
            async () => discoveries,
            (values) =>
                values.filter((ids) => ids.length === sourceCount).length >= 2,
        );
    }

    async function noPrematureMaintenance(corpusId: string) {
        // Let the existing 250 ms automatic-admission timers fire, if any.
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        expect(captures).toEqual([]);
        expect(discoveries).toEqual([]);
        expect(generations).toBe(0);
        expect(await service.listViewBuilds(corpusId)).toEqual([]);
        expect((await service.queryTopics({ corpusId })).generation).toBeNull();
    }

    beforeEach(async () => {
        root = path.resolve(
            ".test-fixtures",
            `batch-maintenance-${randomUUID()}`,
        );
        await mkdir(root, { recursive: true });
        gates.clear();
        captures = [];
        discoveries = [];
        generations = 0;
        captureHold = undefined;
        service = open();
    });

    afterEach(async () => {
        for (const held of gates.values()) held.release();
        captureHold?.release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    test.each(["complete", "failed", "cancelled"] as const)(
        "one stable admission after a batch settles with a %s final member",
        async (outcome) => {
            const { corpusId } = await service.createCorpus(outcome);
            const held = gate();
            gates.set("first-2", held);
            const batch = await service.startBatchImport(
                request(corpusId, "first"),
            );
            await held.entered;
            await noPrematureMaintenance(corpusId);
            held.fail = outcome === "failed";
            const cancellation =
                outcome === "cancelled"
                    ? service.cancelBatchImport(batch.batchId)
                    : undefined;
            held.release();
            await cancellation;
            const finished = await settled(batch);
            expect(finished.state).toBe(
                outcome === "complete"
                    ? "complete"
                    : outcome === "failed"
                      ? "partial"
                      : "cancelled",
            );
            const count = outcome === "complete" ? 3 : 2;
            await maintained(corpusId, count);
            expect(captures).toHaveLength(1);
            expect(captures[0]).toHaveLength(count);
            expect(generations).toBe(1);
        },
    );

    test("overlapping batches release only after the last corpus member settles", async () => {
        const { corpusId } = await service.createCorpus("overlapping");
        const firstGate = gate();
        const secondGate = gate();
        gates.set("first-2", firstGate);
        gates.set("second-2", secondGate);
        const first = await service.startBatchImport(
            request(corpusId, "first"),
        );
        const second = await service.startBatchImport(
            request(corpusId, "second"),
        );
        await Promise.all([firstGate.entered, secondGate.entered]);
        await noPrematureMaintenance(corpusId);
        firstGate.release();
        expect((await settled(first)).state).toBe("complete");
        await noPrematureMaintenance(corpusId);
        secondGate.release();
        expect((await settled(second)).state).toBe("complete");
        await maintained(corpusId, 6);
        expect(captures).toHaveLength(1);
        expect(generations).toBe(1);
    });

    test("a batch admitted during snapshot capture prevents late automatic generation", async () => {
        const { corpusId } = await service.createCorpus("late-admission");
        captureHold = gate();
        const firstCapture = captureHold;
        const source = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "seed",
                sourceType: "markdown",
                title: "Seed",
                markdown:
                    "Durable batch maintenance captures current source evidence.",
            },
        });
        await waitForMemoryJob(service, source.jobId, { pollIntervalMs: 10 });
        await firstCapture.entered;
        const batch = await service.startBatchImport(
            request(corpusId, "first"),
        );
        expect(generations).toBe(0);
        firstCapture.release();
        expect((await settled(batch)).state).toBe("complete");
        await maintained(corpusId, 4);
        expect(captures).toHaveLength(2);
        expect(captures[1]).toHaveLength(4);
        expect(generations).toBe(1);
    });

    test("retry reacquires the hold without replaying completed members", async () => {
        const { corpusId } = await service.createCorpus("retry");
        const held = gate();
        held.fail = true;
        gates.set("first-2", held);
        const batch = await service.startBatchImport(
            request(corpusId, "first"),
        );
        await held.entered;
        held.release();
        expect((await settled(batch)).state).toBe("partial");
        const retryGate = gate();
        gates.set("first-2", retryGate);
        await service.retryBatchImport(batch.batchId);
        await retryGate.entered;
        await noPrematureMaintenance(corpusId);
        retryGate.release();
        expect((await settled(batch)).state).toBe("complete");
        await maintained(corpusId, 3);
        expect(captures).toHaveLength(1);
        expect(await service.listSources(corpusId)).toHaveLength(3);
    });

    test("explicit manual topic rebuilds are not silently deferred by a batch", async () => {
        const { corpusId } = await service.createCorpus("manual");
        const held = gate();
        gates.set("first-2", held);
        const batch = await service.startBatchImport(
            request(corpusId, "first"),
        );
        await held.entered;
        const manual = await service.rebuildTopics(corpusId);
        await waitFor(
            () => service.getViewBuild({ corpusId, jobId: manual.jobId }),
            (job) => job?.state === "complete",
        );
        expect(captures).toHaveLength(1);
        expect(captures[0]).toHaveLength(2);
        held.release();
        await settled(batch);
        await maintained(corpusId, 3);
        expect(captures).toHaveLength(2);
    });

    test("pausing a family during a batch remains effective after settlement", async () => {
        const { corpusId } = await service.createCorpus("paused");
        const held = gate();
        gates.set("first-2", held);
        const batch = await service.startBatchImport(
            request(corpusId, "first"),
        );
        await held.entered;
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        held.release();
        await settled(batch);
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        expect(captures).toEqual([]);
        expect(generations).toBe(0);
    });

    test.each(["complete", "interrupted"] as const)(
        "startup settles durable interrupted batches with a %s member before automatic admission",
        async (memberState) => {
            const { corpusId } = await service.createCorpus("recovery");
            const held = gate();
            if (memberState === "interrupted") gates.set("first-2", held);
            const batch = await service.startBatchImport(
                request(corpusId, "first"),
            );
            if (memberState === "complete") await settled(batch);
            else await held.entered;
            const closing = service.close();
            held.release();
            await closing;
            expect(captures).toEqual([]);
            const file = path.join(root, "batches", `${batch.batchId}.json`);
            const stored = JSON.parse(await readFile(file, "utf8")) as {
                state: string;
                members: Array<{ state: string; jobId?: string }>;
            };
            stored.state = "running";
            stored.members[2].state = "ingesting";
            if (memberState === "interrupted") delete stored.members[2].jobId;
            await writeFile(file, JSON.stringify(stored));
            service = open();
            const recovered = await service.getBatchImport(batch.batchId);
            expect(recovered.state).toBe(
                memberState === "complete" ? "complete" : "interrupted",
            );
            expect(recovered.members[2].state).toBe(memberState);
            await maintained(corpusId, memberState === "complete" ? 3 : 2);
            expect(captures).toHaveLength(1);
            expect(generations).toBe(1);
        },
    );

    test("source synopses do not start while their own corpus still imports", async () => {
        await service.close();
        synopsisCalls = 0;
        service = open(true);
        const { corpusId } = await service.createCorpus(
            "Synopsis import guard",
        );
        const held = gate();
        gates.set("guarded-2", held);
        await service.startBatchImport(request(corpusId, "guarded"));
        await held.entered;
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(synopsisCalls).toBe(0);
        const closing = service.close();
        held.release();
        await closing;
        expect(synopsisCalls).toBe(0);
    });

    test("an ordinary single-source ingestion still schedules maintenance", async () => {
        const { corpusId } = await service.createCorpus("single");
        const ingestion = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "single",
                sourceType: "markdown",
                title: "Single",
                markdown:
                    "Durable batch maintenance also preserves standalone capture.",
            },
        });
        await waitForMemoryJob(service, ingestion.jobId, {
            pollIntervalMs: 10,
        });
        await maintained(corpusId, 1);
        expect(captures).toEqual([["single"]]);
        expect(generations).toBe(1);
    });
});
