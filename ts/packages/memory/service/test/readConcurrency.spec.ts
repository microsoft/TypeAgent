// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import type { FileMemoryServiceOptions } from "../src/fileMemoryService.js";
import type { IndexedDocument } from "../src/types.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

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
        searchedDirectories = { documents: [], procedures: [] };
        failInitialization = undefined;
        initializationBlock = undefined;
        const factory = (kind: Kind) => (_id: string, directory: string) => {
            counts[kind].created++;
            return new (class extends FakeProcedureCorpusIndex {
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
            procedureIndexFactory: factory("procedures"),
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
        await service.saveProcedure({
            corpusId,
            procedureId: "guide",
            document: {
                title: "Zephyr deployment",
                steps: ["Inspect the deployment logs"],
                citations: [],
            },
        });
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
    function procedureSearch() {
        return service.searchProcedures({
            corpusId,
            query: "Zephyr",
            states: ["saved"],
        });
    }

    test("unchanged published document generations and loaded procedure generations are reused", async () => {
        await procedureSearch();
        const initialized = {
            documents: counts.documents.initialized,
            procedures: counts.procedures.initialized,
        };
        await Promise.all([
            documentSearch(),
            documentSearch(),
            procedureSearch(),
            procedureSearch(),
            service.getKnowledgeGraph(corpusId),
            service.getSourceKnowledge(corpusId, "source"),
        ]);
        expect(counts.documents.initialized).toBe(initialized.documents);
        expect(counts.procedures.initialized).toBe(initialized.procedures);
    });

    test("cold concurrent callers share one runtime and initialize each generation once", async () => {
        await service.close();
        counts.documents.created = 0;
        counts.documents.initialized = 0;
        counts.procedures.initialized = 0;
        service = new FileMemoryService(root, options);
        const results = await Promise.all([
            documentSearch(),
            documentSearch(),
            procedureSearch(),
            procedureSearch(),
            service.getSourceKnowledge(corpusId, "source"),
        ]);
        expect(results[0]).toMatchObject({ matches: [{ sourceId: "source" }] });
        expect(counts.documents.created).toBe(1);
        expect(counts.documents.initialized).toBe(1);
        expect(counts.procedures.initialized).toBe(1);
    });

    test("document and procedure searches overlap after preparation", async () => {
        await procedureSearch();
        const documents = block("documents");
        const procedures = block("procedures");
        const first = documentSearch();
        const second = procedureSearch();
        await within(
            Promise.all([
                documents.entered.promise,
                procedures.entered.promise,
            ]),
        );
        documents.resume.resolve();
        procedures.resume.resolve();
        expect((await first).matches).toHaveLength(1);
        expect(await second).toHaveLength(1);
    });

    test("reindex publication waits for readers and later readers wait behind the writer", async () => {
        const reader = block("documents");
        const first = documentSearch();
        await within(reader.entered.promise);
        const firstDirectory = searchedDirectories.documents.at(-1);
        const beforeRebuilds = rebuilds;
        const beforeSearches = counts.documents.searched;
        const reindex = service.reindexCorpus(corpusId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const later = documentSearch();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(rebuilds).toBe(beforeRebuilds);
        expect(counts.documents.searched).toBe(beforeSearches);
        reader.resume.resolve();
        const firstResult = await first;
        const publication = await reindex;
        const laterResult = await later;
        expect(firstResult.indexVersion).toBe(publication.indexVersion);
        expect(searchedDirectories.documents.at(-1)).not.toBe(firstDirectory);
        expect(laterResult.indexVersion).toBe(publication.indexVersion);
        expect(laterResult.matches).toHaveLength(1);
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

    test("saving and archiving procedures invalidate the generation cache", async () => {
        expect(await procedureSearch()).toHaveLength(1);
        await service.saveProcedure({
            corpusId,
            procedureId: "guide",
            expectedVersion: 1,
            document: {
                title: "Zephyr revised deployment",
                steps: ["Inspect revised logs"],
                citations: [],
            },
        });
        expect((await procedureSearch())[0].version.version).toBe(2);
        const loaded = counts.procedures.initialized;
        await procedureSearch();
        expect(counts.procedures.initialized).toBe(loaded);
        await service.archiveProcedure(corpusId, "guide", 2);
        expect(await procedureSearch()).toEqual([]);
        expect(
            await service.searchProcedures({
                corpusId,
                query: "Zephyr",
                states: ["archived"],
            }),
        ).toHaveLength(1);
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

    test("close waits through cold index preparation and its subsequent read", async () => {
        const gate = { entered: deferred(), resume: deferred() };
        initializationBlock = gate;
        releases.push(gate.resume.resolve);
        const reading = procedureSearch();
        await within(gate.entered.promise);
        let closed = false;
        const closing = service.close().then(() => {
            closed = true;
        });
        try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).toBe(false);
        } finally {
            gate.resume.resolve();
            await Promise.allSettled([reading, closing]);
        }
        await expect(reading).resolves.toHaveLength(1);
        await closing;
        expect(closed).toBe(true);
    });
});
