// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FileMemoryServiceOptions } from "../src/fileMemoryService.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import type { IndexedDocument } from "../src/types.js";
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
                    () =>
                        reject(new Error("Concurrent operation did not start")),
                    2_000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitForJob(service: FileMemoryService, jobId: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const job = await service.getJob(jobId);
        if (job?.state === "complete") return;
        if (job?.state === "failed") throw new Error(job.error);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Fixture ingestion timed out");
}

describe("snapshot-safe indexed reads", () => {
    type Kind = "documents" | "procedures";
    let root: string;
    let service: FileMemoryService;
    let options: FileMemoryServiceOptions;
    let corpusId: string;
    let counts: Record<
        Kind,
        { created: number; initialized: number; searched: number }
    >;
    let blocks: Partial<
        Record<
            Kind,
            {
                entered: ReturnType<typeof deferred>;
                resume: ReturnType<typeof deferred>;
            }
        >
    >;
    let releases: Array<() => void>;
    let failInitialization: Kind | undefined;
    let initializationBlock:
        | {
              entered: ReturnType<typeof deferred>;
              resume: ReturnType<typeof deferred>;
          }
        | undefined;
    let rebuilds: number;
    let rebuildBlock: ReturnType<typeof blockRebuild> | undefined;
    let failRebuild: boolean;
    let searchedDirectories: Record<Kind, string[]>;

    beforeEach(async () => {
        root = await mkdtemp(
            path.join(os.tmpdir(), "memory-read-concurrency-"),
        );
        counts = {
            documents: { created: 0, initialized: 0, searched: 0 },
            procedures: { created: 0, initialized: 0, searched: 0 },
        };
        blocks = {};
        releases = [];
        rebuilds = 0;
        rebuildBlock = undefined;
        failRebuild = false;
        searchedDirectories = { documents: [], procedures: [] };
        failInitialization = undefined;
        initializationBlock = undefined;
        const factory = (kind: Kind) => (_id: string, directory: string) => {
            counts[kind].created++;
            return new (class extends FakeSemanticCorpusIndex {
                public override async initialize() {
                    counts[kind].initialized++;
                    const gate = initializationBlock;
                    initializationBlock = undefined;
                    if (gate) {
                        gate.entered.resolve();
                        await gate.resume.promise;
                    }
                    if (failInitialization === kind) {
                        failInitialization = undefined;
                        throw new Error("Expected initialization failure");
                    }
                    await super.initialize();
                }
                public override async rebuild(documents: IndexedDocument[]) {
                    rebuilds++;
                    const gate = rebuildBlock;
                    rebuildBlock = undefined;
                    if (gate) {
                        gate.entered.resolve();
                        await gate.resume.promise;
                    }
                    if (failRebuild) {
                        failRebuild = false;
                        throw new Error("Expected rebuild failure");
                    }
                    await super.rebuild(documents);
                }
                public override async search(
                    query: string,
                    limit: number,
                    tags?: string[],
                ) {
                    counts[kind].searched++;
                    searchedDirectories[kind].push(directory);
                    const block = blocks[kind];
                    delete blocks[kind];
                    if (block) {
                        block.entered.resolve();
                        await block.resume.promise;
                    }
                    return super.search(query, limit, tags);
                }
            })(directory);
        };
        options = {
            indexFactory: factory("documents"),
        };
        service = new FileMemoryService(root, options);
        corpusId = (await service.createCorpus("Snapshot fixture")).corpusId;
        const accepted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Zephyr source",
                text: "Zephyr deployment evidence",
            },
        });
        await waitForJob(service, accepted.jobId);
    });

    afterEach(async () => {
        for (const release of releases) release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    function block(kind: Kind) {
        const gate = { entered: deferred(), resume: deferred() };
        blocks[kind] = gate;
        releases.push(gate.resume.resolve);
        return gate;
    }
    function documentSearch() {
        return service.search({ corpusId, query: "Zephyr" });
    }

    function blockRebuild() {
        const gate = { entered: deferred(), resume: deferred() };
        rebuildBlock = gate;
        releases.push(gate.resume.resolve);
        return gate;
    }

    test("reindex prepares without blocking reads and publication waits for readers", async () => {
        const preparation = blockRebuild();
        const reindex = service.reindexCorpus(corpusId);
        await within(preparation.entered.promise);
        expect((await within(documentSearch())).matches).toHaveLength(1);
        const oldDirectory = searchedDirectories.documents.at(-1);
        const reader = block("documents");
        const first = documentSearch();
        await within(reader.entered.promise);
        let published = false;
        void reindex.then(() => {
            published = true;
        });
        preparation.resume.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(published).toBe(false);
        reader.resume.resolve();
        const firstResult = await first;
        const publication = await reindex;
        const laterResult = await documentSearch();
        expect(firstResult.indexVersion).toBe(publication.indexVersion);
        expect(searchedDirectories.documents.at(-1)).not.toBe(oldDirectory);
        expect(laterResult.indexVersion).toBe(publication.indexVersion);
        expect(laterResult.matches).toHaveLength(1);
    });

    test("failed reindex preserves the healthy generation", async () => {
        await documentSearch();
        const directory = searchedDirectories.documents.at(-1);
        failRebuild = true;
        await expect(service.reindexCorpus(corpusId)).rejects.toThrow(
            "Expected rebuild failure",
        );
        expect((await documentSearch()).matches).toHaveLength(1);
        expect(searchedDirectories.documents.at(-1)).toBe(directory);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    });

    test("concurrent ingestion prevents stale reindex publication", async () => {
        const preparation = blockRebuild();
        const reindex = service.reindexCorpus(corpusId);
        const rejected = expect(reindex).rejects.toThrow(
            "changed during reindex preparation",
        );
        await within(preparation.entered.promise);
        const accepted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "second",
                sourceType: "text",
                title: "Second",
                text: "Zephyr second",
            },
        });
        await waitForJob(service, accepted.jobId);
        preparation.resume.resolve();
        await rejected;
        expect((await documentSearch()).matches).toHaveLength(2);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    });

    test("forget waits for detached provider writes and never republishes forgotten text", async () => {
        const preview = await service.previewForgetSource(corpusId, "source");
        const preparation = blockRebuild();
        const reindex = service.reindexCorpus(corpusId);
        const stopped = expect(reindex).rejects.toThrow();
        await within(preparation.entered.promise);
        const removalBuild = blockRebuild();
        const forget = service.forgetSource({
            corpusId,
            sourceId: "source",
            confirmationToken: preview.confirmationToken,
        });
        await within(removalBuild.entered.promise);
        removalBuild.resume.resolve();
        let finished = false;
        void forget.then(() => {
            finished = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        preparation.resume.resolve();
        await stopped;
        await forget;
        expect((await documentSearch()).matches).toEqual([]);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
        await service.close();
        service = new FileMemoryService(root, options);
        expect((await documentSearch()).matches).toEqual([]);
    });

    test("clear drains detached rebuilds without restoring cleared documents after restart", async () => {
        const preparation = blockRebuild();
        const reindex = service.reindexCorpus(corpusId);
        const stopped = expect(reindex).rejects.toThrow();
        await within(preparation.entered.promise);
        const empty = blockRebuild();
        const clear = service.clearCorpus(corpusId);
        await within(empty.entered.promise);
        empty.resume.resolve();
        preparation.resume.resolve();
        expect(await clear).toBe(1);
        await stopped;
        await service.close();
        service = new FileMemoryService(root, options);
        expect((await documentSearch()).matches).toHaveLength(0);
        expect(await service.listSources(corpusId)).toHaveLength(0);
    });

    test("cancelled reindex waits for provider writes and preserves the active generation", async () => {
        const preparation = blockRebuild();
        const controller = new AbortController();
        const reindex = service.reindexCorpus(corpusId, controller.signal);
        const stopped = expect(reindex).rejects.toThrow();
        await within(preparation.entered.promise);
        controller.abort();
        expect((await within(documentSearch())).matches).toHaveLength(1);
        preparation.resume.resolve();
        await stopped;
        expect((await documentSearch()).matches).toHaveLength(1);
    });

    test("close cancels publication and waits for detached provider writes", async () => {
        const preparation = blockRebuild();
        const reindex = service.reindexCorpus(corpusId);
        const stopped = expect(reindex).rejects.toThrow("closing");
        await within(preparation.entered.promise);
        let finished = false;
        const closing = service.close().then(() => {
            finished = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        preparation.resume.resolve();
        await stopped;
        await closing;
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    });

    test("concurrent read repair coalesces provider work without holding the write reservation", async () => {
        await service.close();
        const indexRoot = path.join(root, corpusId, "index");
        const [generation] = await readdir(indexRoot);
        await rm(path.join(indexRoot, generation, "index-schema.json"));
        service = new FileMemoryService(root, options);
        const preparation = blockRebuild();
        const before = rebuilds;
        const first = documentSearch();
        await within(preparation.entered.promise);
        const second = documentSearch();
        try {
            await within(
                service.appendEvent({
                    corpusId,
                    idempotencyKey: "during-repair",
                    producer: { producerId: "test", producerType: "test" },
                    eventType: "turn.completed",
                    sourceKind: "conversation",
                    observedAt: "2026-10-19T00:00:00Z",
                    content: "Metadata write during document repair",
                }),
            );
            expect(rebuilds).toBe(before + 1);
        } finally {
            preparation.resume.resolve();
            await Promise.allSettled([first, second]);
        }
        expect((await first).matches).toHaveLength(1);
        expect((await second).matches).toHaveLength(1);
        expect(rebuilds).toBe(before + 1);
    });

    test("failed shared repair is released so a later read can retry", async () => {
        await service.close();
        const indexRoot = path.join(root, corpusId, "index");
        const [generation] = await readdir(indexRoot);
        await rm(path.join(indexRoot, generation, "index-schema.json"));
        service = new FileMemoryService(root, options);
        failRebuild = true;
        const preparation = blockRebuild();
        const first = documentSearch();
        const firstFailure = expect(first).rejects.toThrow(
            "Expected rebuild failure",
        );
        await within(preparation.entered.promise);
        const second = documentSearch();
        const secondFailure = expect(second).rejects.toThrow(
            "Expected rebuild failure",
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        preparation.resume.resolve();
        await Promise.all([firstFailure, secondFailure]);
        expect((await documentSearch()).matches).toHaveLength(1);
    });

    test("forget never changes an in-flight snapshot or resurrects removed evidence", async () => {
        const preview = await service.previewForgetSource(corpusId, "source");
        const reader = block("documents");
        const first = documentSearch();
        await within(reader.entered.promise);
        const forgotten = service.forgetSource({
            corpusId,
            sourceId: "source",
            confirmationToken: preview.confirmationToken,
        });
        reader.resume.resolve();
        expect((await first).matches).toHaveLength(1);
        await forgotten;
        expect((await documentSearch()).matches).toEqual([]);
        await expect(
            service.getSourceKnowledge(corpusId, "source"),
        ).rejects.toThrow("Unknown source");
    });

    test("failed initialization is not cached and can be retried", async () => {
        await service.close();
        service = new FileMemoryService(root, options);
        counts.documents.initialized = 0;
        failInitialization = "documents";
        await expect(documentSearch()).rejects.toThrow(
            "Expected initialization failure",
        );
        expect((await documentSearch()).matches).toHaveLength(1);
        await documentSearch();
        expect(counts.documents.initialized).toBe(2);
    });

    test("close waits for outstanding shared reads before releasing storage", async () => {
        const reader = block("documents");
        const search = documentSearch();
        await within(reader.entered.promise);
        let closed = false;
        const closing = service.close().then(() => {
            closed = true;
        });
        try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).toBe(false);
        } finally {
            reader.resume.resolve();
            await Promise.allSettled([search, closing]);
        }
        await search;
        await closing;
        expect(closed).toBe(true);
    });
});
