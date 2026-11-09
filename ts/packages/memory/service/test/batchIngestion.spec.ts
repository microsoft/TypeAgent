// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { BoundedIngestionGroup } from "../src/boundedIngestionGroup.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type {
    IndexedDocument,
    JobProgress,
    DocumentIngestResult,
} from "../src/types.js";
import type { MemoryBatchImport } from "../src/batchImport.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

async function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Batch fixture did not settle")),
                    4000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

describe("bounded ingestion admission", () => {
    test("schedules a lone admission with the exact 25 ms window", async () => {
        const timer = mock.method(globalThis, "setTimeout");
        try {
            const calls: number[][] = [];
            const group = new BoundedIngestionGroup<number>(async (items) => {
                calls.push(items);
            });
            const work = group.run(async () => {
                await group.submit(1);
            });
            expect(calls).toEqual([]);
            expect(timer.mock.calls[0]?.arguments[1]).toBe(25);
            await work;
            expect(calls).toEqual([[1]]);
        } finally {
            timer.mock.restore();
        }
    });

    test("groups exactly two admissions without changing their order", async () => {
        const calls: number[][] = [];
        const group = new BoundedIngestionGroup<number>(async (items) => {
            calls.push(items);
        });
        await group.run(async () => {
            await Promise.all([
                group.submit(1),
                group.submit(2),
                group.submit(3),
            ]);
        });
        expect(calls).toEqual([[1, 2], [3]]);
    });

    test("a lone durable admission makes progress while its peer is still unaccepted", async () => {
        const calls: number[][] = [];
        const group = new BoundedIngestionGroup<number>(async (items) => {
            calls.push(items);
        });
        await within(
            group.run(async () => {
                await group.submit(1);
                await group.submit(2);
            }),
        );
        expect(calls).toEqual([[1], [2]]);
    });

    test("independent group contexts cannot combine", async () => {
        const calls: number[][] = [];
        const group = new BoundedIngestionGroup<number>(async (items) => {
            calls.push(items);
        });
        await Promise.all([
            group.run(async () => {
                await group.submit(1);
            }),
            group.run(async () => {
                await group.submit(2);
            }),
        ]);
        expect(calls.map((items) => items[0]).sort()).toEqual([1, 2]);
        expect(calls.every((items) => items.length === 1)).toBe(true);
    });

    test("dispatch rejection reaches both admissions", async () => {
        const group = new BoundedIngestionGroup<number>(async () => {
            throw new Error("Expected dispatch failure");
        });
        await expect(
            group.run(async () => {
                await Promise.all([group.submit(1), group.submit(2)]);
            }),
        ).rejects.toThrow("Expected dispatch failure");
    });
});

describe("detached coalesced batch ingestion", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let appends: string[][];
    let rebuilds: string[][];
    let hold:
        | {
              entered: ReturnType<typeof deferred>;
              release: ReturnType<typeof deferred>;
              aborted: ReturnType<typeof deferred>;
              ignoreAbort: boolean;
              fail: boolean;
              partialWrite: boolean;
          }
        | undefined;
    let publicationFailure = false;
    const releases: Array<() => void> = [];

    class Index extends FakeSemanticCorpusIndex {
        private appending = false;
        public constructor(private readonly generationDirectory: string) {
            super(generationDirectory);
        }
        public override async rebuild(documents: IndexedDocument[]) {
            if (!this.appending)
                rebuilds.push(
                    documents.map((document) => document.source.sourceId),
                );
            await super.rebuild(documents);
        }
        public override async append(
            documents: IndexedDocument[],
            signal?: AbortSignal,
            progress?: (value: JobProgress) => Promise<void>,
        ) {
            appends.push(documents.map((document) => document.source.sourceId));
            const pending = hold;
            hold = undefined;
            if (pending) {
                if (pending.partialWrite)
                    await writeFile(
                        path.join(this.generationDirectory, "corpus_data.json"),
                        '{"messages":[',
                    );
                pending.entered.resolve();
                const onAbort = () => {
                    pending.aborted.resolve();
                    if (!pending.ignoreAbort) pending.release.resolve();
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                if (signal?.aborted) onAbort();
                try {
                    await pending.release.promise;
                } finally {
                    signal?.removeEventListener("abort", onAbort);
                }
                if (pending.fail) throw new Error("Shared provider failure");
                if (!pending.ignoreAbort) signal?.throwIfAborted();
            }
            // Deliberately write after an ignored abort to prove cleanup drains us.
            this.appending = true;
            try {
                await super.append(documents);
            } finally {
                this.appending = false;
            }
            await progress?.({
                completed: documents.length,
                total: documents.length,
                operation: "append",
                message: "Offline append",
            });
        }
    }

    function open() {
        return new FileMemoryService(root, {
            sourceSynopses: false,
            viewDrafts: false,
            informationalViews: false,
            indexFactory: (_, directory) => new Index(directory),
            revisionTextCheckpoint: async (point) => {
                if (publicationFailure && point === "manifest-prepared") {
                    publicationFailure = false;
                    throw new Error("Shared publication failure");
                }
            },
        });
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "batch-ingestion-"));
        appends = [];
        rebuilds = [];
        hold = undefined;
        publicationFailure = false;
        service = open();
        ({ corpusId } = await service.createCorpus("Grouped sources"));
    });
    afterEach(async () => {
        for (const release of releases.splice(0)) release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    function block(ignoreAbort = false, fail = false, partialWrite = false) {
        const pending = {
            entered: deferred(),
            release: deferred(),
            aborted: deferred(),
            ignoreAbort,
            fail,
            partialWrite,
        };
        releases.push(pending.release.resolve);
        hold = pending;
        return pending;
    }
    const source = (id: string) => ({
        sourceId: id,
        sourceType: "text" as const,
        title: id,
        text: `Canonical content for ${id}`,
    });
    async function ingest(id: string) {
        const result = await service.ingestDocument({
            corpusId,
            source: source(id),
        });
        expect(
            (
                await waitForMemoryJob(service, result.jobId, {
                    pollIntervalMs: 5,
                })
            ).state,
        ).toBe("complete");
        return result;
    }
    async function admit(ids = ["first", "second"]) {
        let accepted: DocumentIngestResult[] = [];
        await service.withIngestionGroup(async () => {
            accepted = await Promise.all(
                ids.map((id) =>
                    service.ingestDocument({ corpusId, source: source(id) }),
                ),
            );
        });
        return accepted;
    }
    const settle = (jobs: DocumentIngestResult[]) =>
        within(
            Promise.all(
                jobs.map((job) =>
                    waitForMemoryJob(service, job.jobId, { pollIntervalMs: 5 }),
                ),
            ),
        );
    test.each([false, true])(
        "deferred segment collection waits for an unpublished index (failure=%s)",
        async (fail) => {
            const retryScheduled = deferred();
            const callbacks: Array<() => void> = [];
            let awaitingRetry = false;
            const originalSetTimeout = globalThis.setTimeout;
            const timer = import.meta.jest
                .spyOn(globalThis, "setTimeout")
                .mockImplementation((callback, milliseconds, ...args) => {
                    if (milliseconds !== 250)
                        return originalSetTimeout(
                            callback,
                            milliseconds,
                            ...args,
                        );
                    callbacks.push(() => callback(...args));
                    if (awaitingRetry) retryScheduled.resolve();
                    return originalSetTimeout(() => {}, 0);
                });
            try {
                await ingest("seed");
                expect(callbacks.length).toBeGreaterThan(0);
                const segments = path.join(
                    root,
                    corpusId,
                    "index",
                    ".segments",
                );
                const orphan = path.join(segments, `${"a".repeat(64)}.json`);
                await mkdir(segments, { recursive: true });
                await writeFile(orphan, "{}");
                const pending = block(false, fail, true);
                const accepted = await admit();
                await within(pending.entered.promise);
                awaitingRetry = true;
                callbacks.at(-1)!();
                await within(retryScheduled.promise);
                expect(await readFile(orphan, "utf8")).toBe("{}");
                expect(
                    (await service.listSources(corpusId)).map(
                        (item) => item.sourceId,
                    ),
                ).toEqual(["seed"]);
                pending.release.resolve();
                const results = await settle(accepted);
                expect(
                    results.every(
                        (job) => job.state === (fail ? "failed" : "complete"),
                    ),
                ).toBe(true);
                timer.mockRestore();
                callbacks.at(-1)!();
                expect((await service.drainMaintenance()).settled).toBe(true);
            } finally {
                timer.mockRestore();
                await service.close();
            }
            await expect(
                readdir(path.join(root, corpusId, "index", ".segments")),
            ).resolves.toEqual([]);
        },
    );
    async function terminal(batch: MemoryBatchImport) {
        let polls = 0;
        while (["running", "cancelling"].includes(batch.state)) {
            if (++polls > 500)
                throw new Error(
                    JSON.stringify({
                        batch,
                        appends,
                        jobs: await Promise.all(
                            batch.members.map((member) =>
                                member.jobId
                                    ? service.getJob(member.jobId)
                                    : undefined,
                            ),
                        ),
                    }),
                );
            await new Promise((resolve) => setTimeout(resolve, 5));
            batch = await service.getBatchImport(batch.batchId);
        }
        return batch;
    }
    async function startBatch(ids = ["first", "second"]) {
        return service.startBatchImport({
            corpusId,
            idempotencyKey: "offline-batch",
            documents: ids.map((id) => ({ source: source(id) })),
        });
    }
    async function oneGeneration() {
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    }

    test("eight acquired sources share append generations while preserving eight distinct jobs and content", async () => {
        await ingest("seed");
        const batch = await within(
            terminal(
                await startBatch(
                    Array.from({ length: 8 }, (_, i) => `member-${i}`),
                ),
            ),
        );
        expect(
            batch.members.filter((member) => member.state !== "complete"),
        ).toEqual([]);
        expect(batch.state).toBe("complete");
        expect(new Set(batch.members.map((member) => member.jobId)).size).toBe(
            8,
        );
        expect(appends.length).toBeLessThan(8);
        expect(appends.flat().sort()).toEqual(
            Array.from({ length: 8 }, (_, i) => `member-${i}`),
        );
        expect(appends.every((items) => items.length <= 2)).toBe(true);
        for (const member of batch.members)
            expect(
                (
                    await service.getSourceContent({
                        corpusId,
                        sourceId: member.sourceId!,
                    })
                ).content,
            ).toBe(source(member.sourceId!).text);
        await oneGeneration();
    });

    test("an empty corpus builds one two-document generation", async () => {
        expect((await settle(await admit())).map((job) => job.state)).toEqual([
            "complete",
            "complete",
        ]);
        expect(rebuilds.map((items) => [...items].sort())).toEqual([
            ["first", "second"],
        ]);
        expect(appends).toEqual([]);
        await oneGeneration();
    });

    test("ordinary independent ingestions remain singleton operations", async () => {
        await ingest("seed");
        await Promise.all([ingest("first"), ingest("second")]);
        expect(appends.every((items) => items.length === 1)).toBe(true);
    });

    test("replacement and a new source use the existing separate paths", async () => {
        await ingest("first");
        const accepted: DocumentIngestResult[] = [];
        await service.withIngestionGroup(async () => {
            accepted.push(
                await service.ingestDocument({
                    corpusId,
                    source: { ...source("first"), text: "Updated first" },
                    pipeline: { updatePolicy: "replaceActiveRevision" },
                }),
            );
            accepted.push(
                await service.ingestDocument({
                    corpusId,
                    source: source("second"),
                }),
            );
        });
        expect(
            (await settle(accepted)).every((job) => job.state === "complete"),
        ).toBe(true);
        expect(rebuilds).toEqual([["first"], ["first"]]);
        expect(appends).toEqual([["second"]]);
    });

    test("same-source admissions preserve failIfExists semantics instead of merging", async () => {
        const jobs: DocumentIngestResult[] = [];
        await service.withIngestionGroup(async () => {
            jobs.push(
                await service.ingestDocument({
                    corpusId,
                    source: source("first"),
                }),
            );
            jobs.push(
                await service.ingestDocument({
                    corpusId,
                    source: source("first"),
                    pipeline: { updatePolicy: "failIfExists" },
                }),
            );
        });
        expect((await settle(jobs)).map((job) => job.state)).toEqual([
            "complete",
            "failed",
        ]);
        expect(await service.listSources(corpusId)).toHaveLength(1);
    });

    test("one invalid member does not fail an eligible peer", async () => {
        await ingest("seed");
        const batch = await within(
            terminal(
                await service.startBatchImport({
                    corpusId,
                    idempotencyKey: "bad-member",
                    documents: [
                        { source: source("first") },
                        {
                            source: {
                                ...source("second"),
                                contentHash: "not-the-content-hash",
                            },
                        },
                    ],
                }),
            ),
        );
        expect(batch.state).toBe("partial");
        expect(batch.members.map((member) => member.state)).toEqual([
            "complete",
            "failed",
        ]);
        expect(appends).toEqual([["first"]]);
    });

    test("a cancelled member discards the candidate and retries the uncancelled peer after provider writes drain", async () => {
        await ingest("seed");
        const pending = block(true);
        const jobs = await admit();
        await within(pending.entered.promise);
        await service.cancelJob(jobs[0]!.jobId);
        await within(pending.aborted.promise);
        expect((await service.getJob(jobs[1]!.jobId))!.state).not.toBe(
            "complete",
        );
        pending.release.resolve();
        expect((await settle(jobs)).map((job) => job.state)).toEqual([
            "cancelled",
            "complete",
        ]);
        expect(
            (await service.listSources(corpusId)).map((item) => item.sourceId),
        ).toEqual(["seed", "second"]);
        expect(appends.map((items) => [...items].sort())).toEqual([
            ["first", "second"],
            ["second"],
        ]);
        await oneGeneration();
    });

    test("source forgetting drains an abort-ignoring grouped provider before privacy purge and retries unaffected members", async () => {
        await ingest("seed");
        const preview = await service.previewForgetSource(corpusId, "seed");
        const pending = block(true);
        const jobs = await admit();
        await within(pending.entered.promise);
        let forgotten = false;
        const removal = service
            .forgetSource({
                corpusId,
                sourceId: "seed",
                confirmationToken: preview.confirmationToken,
            })
            .then(() => {
                forgotten = true;
            });
        await within(pending.aborted.promise);
        expect(forgotten).toBe(false);
        await expect(service.listSources(corpusId)).rejects.toThrow(
            "pending purge recovery",
        );
        pending.release.resolve();
        await within(removal);
        expect(
            (await settle(jobs)).every((job) => job.state === "complete"),
        ).toBe(true);
        expect(
            (await service.listSources(corpusId))
                .map((item) => item.sourceId)
                .sort(),
        ).toEqual(["first", "second"]);
        await oneGeneration();
    });

    test("a competing reindex discards stale grouped preparation and retries both sources", async () => {
        await ingest("seed");
        const pending = block();
        const jobs = await admit();
        await within(pending.entered.promise);
        await within(service.reindexCorpus(corpusId));
        pending.release.resolve();
        expect(
            (await settle(jobs)).every((job) => job.state === "complete"),
        ).toBe(true);
        expect(appends[0]).toHaveLength(2);
        expect(appends.slice(1).map((items) => items.length)).toEqual([1, 1]);
        expect(await service.listSources(corpusId)).toHaveLength(3);
        await oneGeneration();
    });

    test("corpus clear drains the grouped provider without retrying pre-clear admissions", async () => {
        await ingest("seed");
        const pending = block(true);
        const jobs = await admit();
        await within(pending.entered.promise);
        let cleared = false;
        const clearing = service.clearCorpus(corpusId).then(() => {
            cleared = true;
        });
        await within(pending.aborted.promise);
        expect(cleared).toBe(false);
        pending.release.resolve();
        await within(clearing);
        expect((await settle(jobs)).map((job) => job.state)).toEqual([
            "cancelled",
            "cancelled",
        ]);
        expect(await service.listSources(corpusId)).toEqual([]);
        expect(
            await readdir(path.join(root, corpusId, "revision-text")),
        ).toEqual([]);
        await oneGeneration();
    });

    test("shared provider failure is explicit per member and durable retry preserves source identities", async () => {
        await ingest("seed");
        const pending = block(false, true);
        const started = await startBatch();
        await within(pending.entered.promise).catch(async (error: unknown) => {
            throw new Error(
                `Provider admission stalled: ${String(error)}; ${JSON.stringify(await service.getBatchImport(started.batchId))}`,
            );
        });
        pending.release.resolve();
        const failed = await within(terminal(started));
        const affected = new Set(appends[0]);
        expect(
            failed.members
                .filter((member) => member.state === "failed")
                .map((member) => member.sourceId)
                .sort(),
        ).toEqual([...affected].sort());
        for (const member of failed.members.filter((member) =>
            affected.has(member.sourceId!),
        ))
            expect(member.reason).toContain("Shared provider failure");
        expect(await service.listSources(corpusId)).toHaveLength(
            3 - affected.size,
        );
        await oneGeneration();
        const retried = await within(
            terminal(await service.retryBatchImport(started.batchId)),
        );
        expect(retried.state).toBe("complete");
        expect(retried.members.map((member) => member.sourceId)).toEqual(
            failed.members.map((member) => member.sourceId),
        );
    });

    test("failed manifest publication exposes neither member and restart collects staged text", async () => {
        await ingest("seed");
        publicationFailure = true;
        const jobs = await admit();
        expect(
            (await settle(jobs)).every(
                (job) =>
                    job.state === "failed" &&
                    job.error?.includes("Shared publication failure"),
            ),
        ).toBe(true);
        expect(
            (await service.listSources(corpusId)).map((item) => item.sourceId),
        ).toEqual(["seed"]);
        await service.close();
        service = open();
        await service.initialize();
        expect(
            await readdir(path.join(root, corpusId, "revision-text")),
        ).toHaveLength(1);
        await oneGeneration();
    });

    test.each([false, true])(
        "restart recovers durable batch members across manifest publication (published: %s)",
        async (published) => {
            await ingest("seed");
            const pending = block(true);
            let batch = await startBatch();
            await within(pending.entered.promise);
            await within(
                (async () => {
                    while (batch.members.some((member) => !member.jobId)) {
                        await new Promise((resolve) => setTimeout(resolve, 5));
                        batch = await service.getBatchImport(batch.batchId);
                    }
                })(),
            );
            const checkpoints = await Promise.all(
                [
                    path.join(root, "batches", `${batch.batchId}.json`),
                    ...batch.members.map((member) =>
                        path.join(root, "jobs", `${member.jobId}.json`),
                    ),
                ].map(async (file) => ({ file, bytes: await readFile(file) })),
            );
            if (published) {
                pending.release.resolve();
                expect((await within(terminal(batch))).state).toBe("complete");
                await service.close();
            } else {
                let closed = false;
                const closing = service.close().then(() => {
                    closed = true;
                });
                await within(pending.aborted.promise);
                expect(closed).toBe(false);
                pending.release.resolve();
                await within(closing);
            }
            // Restore the real pre-completion receipts to model either durable crash
            // boundary without leaving a live owner or an undrained provider behind.
            for (const checkpoint of checkpoints)
                await writeFile(checkpoint.file, checkpoint.bytes);
            service = open();
            await service.initialize();
            const recovered = await service.getBatchImport(batch.batchId);
            expect(recovered.state).toBe(
                published ? "complete" : "interrupted",
            );
            expect(
                recovered.members.every(
                    (member) =>
                        member.state ===
                        (published ? "complete" : "interrupted"),
                ),
            ).toBe(true);
            for (const member of recovered.members)
                expect((await service.getJob(member.jobId!))?.error).toContain(
                    "interrupted",
                );
            expect(await service.listSources(corpusId)).toHaveLength(
                published ? 3 : 1,
            );
            const priorAppends = appends.length;
            expect(
                (
                    await within(
                        terminal(await service.retryBatchImport(batch.batchId)),
                    )
                ).state,
            ).toBe("complete");
            if (published) expect(appends).toHaveLength(priorAppends);
            for (const id of ["first", "second"])
                expect(
                    (await service.getSourceContent({ corpusId, sourceId: id }))
                        .content,
                ).toBe(source(id).text);
            await oneGeneration();
        },
    );
});
