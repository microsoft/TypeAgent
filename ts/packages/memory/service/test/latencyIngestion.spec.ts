// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    FileMemoryService,
    type FileMemoryServiceOptions,
} from "../src/fileMemoryService.js";
import type { IndexedDocument, IngestionJobStatus } from "../src/types.js";
import type { MemoryBatchImport } from "../src/batchImport.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("bounded bulk publication and recovery", () => {
    let root: string;
    let service: FileMemoryService;
    let publications: string[][];
    let manifestPublications: number;
    class Index extends FakeSemanticCorpusIndex {
        public override async rebuild(documents: IndexedDocument[]) {
            publications.push(
                documents.map((document) => document.source.sourceId),
            );
            await super.rebuild(documents);
        }
    }
    function open(options: FileMemoryServiceOptions = {}) {
        return new FileMemoryService(root, {
            viewDrafts: false,
            sourceSynopses: false,
            ingestionCommitPolicy: {
                maxDocuments: 10,
                admissionWaitMs: 250,
            },
            indexFactory: (_, directory) => new Index(directory),
            revisionTextCheckpoint: async (point) => {
                if (point === "manifest-prepared") manifestPublications++;
            },
            ...options,
        });
    }
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-latency-"));
        publications = [];
        manifestPublications = 0;
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function complete(batch: MemoryBatchImport) {
        for (let attempt = 0; attempt < 1000; attempt++) {
            const current = await service.getBatchImport(batch.batchId);
            if (current.state !== "running") {
                expect(current.state).toBe("complete");
                return current;
            }
            await delay(5);
        }
        throw new Error("Offline bulk ingestion did not complete");
    }
    async function ingest(count: number) {
        const corpus = await service.createCorpus("Bulk source preservation");
        manifestPublications = 0;
        const batch = await complete(
            await service.startBatchImport({
                corpusId: corpus.corpusId,
                idempotencyKey: "fixed-bulk-fixture",
                documents: Array.from({ length: count }, (_, index) => ({
                    source: {
                        sourceId: `source-${index}`,
                        title: `Source ${index}`,
                        sourceType: "text",
                        text: `Unabridged canonical evidence ${index}. `.repeat(
                            10,
                        ),
                    },
                })),
            }),
        );
        return { corpus, batch };
    }

    test("manual segment cleanup survives close and is reconstructed for an explicit drain", async () => {
        await service.close();
        service = open({ maintenanceMode: "manual" });
        const { corpus } = await ingest(2);
        const segments = path.join(root, corpus.corpusId, "index", ".segments");
        await mkdir(segments, { recursive: true });
        const orphan = path.join(segments, `${"a".repeat(64)}.json`);
        await writeFile(orphan, "{}");
        expect((await service.getMaintenanceStatus()).settled).toBe(false);
        await service.close();
        expect(await readFile(orphan, "utf8")).toBe("{}");
        service = open({ maintenanceMode: "manual" });
        expect(await service.listSources(corpus.corpusId)).toHaveLength(2);
        expect(
            (await service.getMaintenanceStatus()).pending.some((key) =>
                key.includes(":segments:"),
            ),
        ).toBe(true);
        expect((await service.drainMaintenance()).settled).toBe(true);
        expect(await readdir(segments)).not.toContain(path.basename(orphan));
        expect(await service.listSources(corpus.corpusId)).toHaveLength(2);
    });

    test.each([
        [2, 5],
        [10, 1],
    ])(
        "%i-document budget publishes %i shared indexes for ten complete sources",
        async (maxDocuments, expectedPublications) => {
            await service.close();
            service = open({
                ingestionCommitPolicy: { maxDocuments, admissionWaitMs: 250 },
            });
            const { corpus, batch } = await ingest(10);
            expect(publications).toHaveLength(expectedPublications);
            expect(manifestPublications).toBe(expectedPublications);
            expect(publications[publications.length - 1]).toHaveLength(10);
            for (const member of batch.members) {
                const index = Number(member.memberId);
                const content = await service.getSourceContent({
                    corpusId: corpus.corpusId,
                    sourceId: `source-${index}`,
                });
                expect(content.content).toBe(
                    `Unabridged canonical evidence ${index}. `.repeat(10),
                );
                expect(
                    (
                        await service.getSource(
                            corpus.corpusId,
                            `source-${index}`,
                        )
                    )?.revisions,
                ).toHaveLength(1);
            }
        },
    );

    test("byte checkpoints do not truncate a source exceeding the group budget", async () => {
        await service.close();
        service = open({
            ingestionCommitPolicy: { maxDocuments: 10, maxBytes: 400 },
        });
        const { corpus } = await ingest(3);
        expect(publications).toHaveLength(3);
        const source = await service.getSourceContent({
            corpusId: corpus.corpusId,
            sourceId: "source-2",
        });
        expect(source.content).toBe(
            "Unabridged canonical evidence 2. ".repeat(10),
        );
    });

    test("restart reconciles committed revisions despite failed job/member acknowledgments", async () => {
        const { corpus, batch } = await ingest(2);
        await service.close();
        const file = path.join(root, "batches", `${batch.batchId}.json`);
        const stored: MemoryBatchImport = JSON.parse(
            await readFile(file, "utf8"),
        );
        stored.state = "failed";
        for (const member of stored.members) {
            member.state = "failed";
            const jobFile = path.join(root, "jobs", `${member.jobId}.json`);
            const job: IngestionJobStatus = JSON.parse(
                await readFile(jobFile, "utf8"),
            );
            job.state = "failed";
            job.error = "Shutdown raced committed publication";
            await writeFile(jobFile, JSON.stringify(job));
        }
        await writeFile(file, JSON.stringify(stored));
        publications = [];
        service = open();
        await service.initialize();
        const recovered = await service.retryBatchImport(batch.batchId);
        expect(recovered.state).toBe("complete");
        expect(
            recovered.members.every((member) => member.state === "complete"),
        ).toBe(true);
        expect(publications).toEqual([]);
        expect(
            (await service.getSource(corpus.corpusId, "source-0"))?.revisions,
        ).toHaveLength(1);
    });
});
