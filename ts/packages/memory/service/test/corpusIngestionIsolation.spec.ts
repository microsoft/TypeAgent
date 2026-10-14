// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type {
    CorpusIndex,
    IndexedDocument,
    JobProgress,
} from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

function blockedProvider() {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        entered,
        release,
        run: async (signal: AbortSignal) => {
            enter();
            signal.throwIfAborted();
            await new Promise<void>((resolve, reject) => {
                const abort = () => reject(signal.reason);
                signal.addEventListener("abort", abort, { once: true });
                void released.then(() => {
                    signal.removeEventListener("abort", abort);
                    resolve();
                });
            });
            signal.throwIfAborted();
        },
    };
}

class PreparingCorpusIndex implements CorpusIndex {
    private readonly delegate: FakeSemanticCorpusIndex;

    public constructor(
        directory: string,
        private readonly prepare: (signal: AbortSignal) => Promise<void>,
    ) {
        this.delegate = new FakeSemanticCorpusIndex(directory);
    }

    public initialize() {
        return this.delegate.initialize();
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        _onProgress: (progress: JobProgress) => Promise<void>,
    ) {
        await this.prepare(signal);
        await this.delegate.rebuild(documents);
    }

    public async append(
        documents: IndexedDocument[],
        signal: AbortSignal,
        _onProgress: (progress: JobProgress) => Promise<void>,
    ) {
        await this.prepare(signal);
        await this.delegate.append(documents);
    }

    public search(query: string, limit: number, tags?: string[]) {
        return this.delegate.search(query, limit, tags);
    }

    public getKnowledgeGraph() {
        return this.delegate.getKnowledgeGraph();
    }
}

describe("detached corpus ingestion preparation", () => {
    let root: string;
    let service: FileMemoryService;
    let nextProvider: ReturnType<typeof blockedProvider> | undefined;
    const providers: Array<ReturnType<typeof blockedProvider>> = [];

    beforeEach(async () => {
        root = await mkdtemp(path.join(process.cwd(), ".corpus-ingestion-"));
        nextProvider = undefined;
        service = new FileMemoryService(root, {
            informationalViews: false,
            sourceSynopses: false,
            indexFactory: (_id, directory) =>
                new PreparingCorpusIndex(directory, async (signal) => {
                    const provider = nextProvider;
                    nextProvider = undefined;
                    await provider?.run(signal);
                }),
            viewSynthesisAdapter: {
                identity: "offline-corpus-lock-test",
                generate: async (_input, signal) =>
                    new Promise<never>((_resolve, reject) => {
                        if (signal.aborted) reject(signal.reason);
                        else
                            signal.addEventListener(
                                "abort",
                                () => reject(signal.reason),
                                { once: true },
                            );
                    }),
                validate: async () => ({
                    supported: false,
                    missingContext: [],
                    reasons: [],
                    sections: [],
                    relationships: [],
                }),
            },
        });
    });

    afterEach(async () => {
        providers.splice(0).forEach((provider) => provider.release());
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    function blockNextPreparation() {
        const provider = blockedProvider();
        providers.push(provider);
        nextProvider = provider;
        return provider;
    }

    async function seed() {
        const { corpusId } = await service.createCorpus("Corpus isolation");
        const source = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "seed",
                sourceType: "text",
                title: "Seed",
                text: "Stable cobalt evidence.",
            },
        });
        expect((await waitForMemoryJob(service, source.jobId)).state).toBe(
            "complete",
        );
        return { corpusId, source };
    }

    function append(corpusId: string) {
        return service.ingestDocument({
            corpusId,
            source: {
                sourceId: "candidate",
                sourceType: "text",
                title: "Candidate",
                text: "Uncommitted quartz evidence.",
            },
        });
    }

    test("read snapshots, durable status and build admission progress while append provider is blocked", async () => {
        const { corpusId, source } = await seed();
        const provider = blockNextPreparation();
        const accepted = await append(corpusId);
        await provider.entered;

        expect(
            (await service.search({ corpusId, query: "cobalt" })).matches,
        ).toEqual([expect.objectContaining({ sourceId: "seed" })]);
        expect(
            (await service.search({ corpusId, query: "quartz" })).matches,
        ).toEqual([]);
        expect((await service.getJob(accepted.jobId))?.state).toBe(
            "building-indexes",
        );
        const snapshot = await service.listViews(corpusId);
        const build = await service.buildViews({
            corpusId,
            expectedHead: snapshot.head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "safe-build",
                        kind: "troubleshootingGuide",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                },
                            ],
                        },
                    },
                },
            ],
        });
        expect(await service.getViewBuild(build)).toBeDefined();
        await service.cancelViewBuild(build);
        provider.release();
        expect((await waitForMemoryJob(service, accepted.jobId)).state).toBe(
            "complete",
        );
        expect(
            (await service.search({ corpusId, query: "quartz" })).matches,
        ).toEqual([expect.objectContaining({ sourceId: "candidate" })]);
    }, 10_000);

    test("rejects a stale prepared generation without deleting it during concurrent reindex", async () => {
        const { corpusId } = await seed();
        const provider = blockNextPreparation();
        const accepted = await append(corpusId);
        await provider.entered;
        await service.reindexCorpus(corpusId);
        provider.release();

        const job = await waitForMemoryJob(service, accepted.jobId);
        expect(job.state).toBe("failed");
        expect(job.error).toContain(
            "Corpus source index changed during ingestion preparation",
        );
        expect(await service.getSource(corpusId, "candidate")).toBeUndefined();
        expect(
            (await service.search({ corpusId, query: "cobalt" })).matches,
        ).toHaveLength(1);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
        const retried = await append(corpusId);
        expect((await waitForMemoryJob(service, retried.jobId)).state).toBe(
            "complete",
        );
    }, 10_000);

    test("cancellation discards detached provider work and preserves the active snapshot", async () => {
        const { corpusId } = await seed();
        const provider = blockNextPreparation();
        const accepted = await append(corpusId);
        await provider.entered;
        await service.cancelJob(accepted.jobId);

        expect((await waitForMemoryJob(service, accepted.jobId)).state).toBe(
            "cancelled",
        );
        provider.release();
        expect(await service.getSource(corpusId, "candidate")).toBeUndefined();
        expect(
            (await service.search({ corpusId, query: "quartz" })).matches,
        ).toEqual([]);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    }, 10_000);

    test("forget can cancel a blocked replacement without restoring source or purged diagnostics", async () => {
        const { corpusId, source } = await seed();
        const provider = blockNextPreparation();
        const replacement = await service.replaceSource({
            corpusId,
            sourceId: source.sourceId,
            expectedActiveRevisionId: source.revisionId,
            source: {
                sourceType: "text",
                title: "Replacement",
                text: "Private replacement quartz evidence.",
            },
        });
        await provider.entered;
        const preview = await service.previewForgetSource(
            corpusId,
            source.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: source.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        provider.release();

        const job = await waitForMemoryJob(service, replacement.jobId);
        expect(job.state).toBe("cancelled");
        expect(job.progress.message).toBe(
            "Forgotten source; diagnostics removed",
        );
        expect(job.trace).toBeUndefined();
        expect(job.error).toBeUndefined();
        expect(
            await service.getSource(corpusId, source.sourceId),
        ).toBeUndefined();
        expect(
            (await service.search({ corpusId, query: "quartz" })).matches,
        ).toEqual([]);
        expect(
            (await service.search({ corpusId, query: "cobalt" })).matches,
        ).toEqual([]);
    }, 10_000);

    test("forget purges and cancels other prepared snapshots that contain its source", async () => {
        const { corpusId, source } = await seed();
        const provider = blockNextPreparation();
        const accepted = await append(corpusId);
        await provider.entered;
        const preview = await service.previewForgetSource(
            corpusId,
            source.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: source.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        expect((await waitForMemoryJob(service, accepted.jobId)).state).toBe(
            "cancelled",
        );
        provider.release();
        expect(await service.listSources(corpusId)).toEqual([]);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
    }, 10_000);

    test("close cancels and drains detached preparation plus queued ingestion before releasing storage", async () => {
        const { corpusId } = await seed();
        const provider = blockNextPreparation();
        const active = await append(corpusId);
        await provider.entered;
        const queued = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "queued",
                sourceType: "text",
                title: "Queued",
                text: "Queued on ingestion, not corpus access.",
            },
        });
        await service.close();
        provider.release();
        const reopened = new FileMemoryService(root, {
            informationalViews: false,
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        try {
            await reopened.initialize();
            expect((await reopened.getJob(active.jobId))?.state).toBe(
                "cancelled",
            );
            expect((await reopened.getJob(queued.jobId))?.state).toBe(
                "cancelled",
            );
            expect(
                (await reopened.listSources(corpusId)).map(
                    (item) => item.sourceId,
                ),
            ).toEqual(["seed"]);
        } finally {
            await reopened.close();
        }
    }, 10_000);
});
