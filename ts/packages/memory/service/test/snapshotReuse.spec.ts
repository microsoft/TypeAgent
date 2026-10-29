// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { ViewHistory } from "../src/viewHistory.js";
import { TypedViewStore } from "../src/viewStore.js";
import { viewReadProjectionEntry } from "../src/viewReadProjection.js";
import { automaticallyConsolidatable } from "../src/wikiConsolidation.js";
import type { ViewVersion } from "../src/viewTypes.js";
import {
    ConsolidationIndex,
    changeFamily,
    ingestFixture,
    offlineConsolidationAdapter,
    settleConsolidation,
} from "./wikiConsolidationFixtures.js";

describe("operation-scoped committed view snapshots", () => {
    let root: string;
    let store: TypedViewStore;
    let reads: number;
    const operationReads = new AsyncLocalStorage<{
        count: number;
        projectionReads?: number;
    }>();
    const original = ViewHistory.prototype.read;
    const clock = (import.meta as ImportMeta & { jest: typeof jest }).jest;

    beforeEach(async () => {
        root = await mkdtemp(path.join(process.cwd(), ".snapshot-reuse-"));
        store = new TypedViewStore(root);
        reads = 0;
        ViewHistory.prototype.read = async function (...args) {
            reads++;
            const operation = operationReads.getStore();
            if (operation) operation.count++;
            return original.apply(this, args);
        };
    });

    afterEach(async () => {
        clock.restoreAllMocks();
        ViewHistory.prototype.read = original;
        await rm(root, { recursive: true, force: true });
    });

    test("parallel selectors and nested scopes hydrate once and isolate returned mutations", async () => {
        await store.saveWikiFamily("corpus", {
            enabled: true,
            dirty: false,
            cursor: 0,
            descriptors: [{ viewId: "page", query: "original", sourceIds: [] }],
        });
        reads = 0;
        await store.withReadSnapshot("corpus", async () => {
            const [family, snapshot] = await Promise.all([
                store.getWikiFamily("corpus"),
                store.listViews("corpus"),
                store.listViewBuilds("corpus"),
            ]);
            family.descriptors[0].query = "mutated";
            snapshot.views.push({} as ViewVersion);
            await store.withReadSnapshot("corpus", async () => {
                expect(
                    (await store.getWikiFamily("corpus")).descriptors[0].query,
                ).toBe("original");
                expect((await store.listViews("corpus")).views).toEqual([]);
            });
        });
        expect(reads).toBe(1);
    });

    test("new operations observe writes and writable state never aliases a read snapshot", async () => {
        await store.withReadSnapshot("corpus", async () => {
            expect((await store.getWikiFamily("corpus")).dirty).toBe(true);
        });
        await store.saveWikiFamily("corpus", {
            enabled: false,
            dirty: false,
            cursor: 3,
            descriptors: [],
        });
        reads = 0;
        await store.withReadSnapshot("corpus", async () => {
            expect((await store.getWikiFamily("corpus")).cursor).toBe(3);
        });
        expect(reads).toBe(1);
        await expect(
            store.withReadSnapshot("corpus", async () => {
                await store.saveWikiFamily("corpus", {
                    enabled: true,
                    dirty: true,
                    cursor: 4,
                    descriptors: [],
                });
                expect((await store.getWikiFamily("corpus")).cursor).toBe(4);
            }),
        ).rejects.toThrow("changed during read operation");
        expect((await store.getWikiFamily("corpus")).cursor).toBe(4);
    });

    test("operation errors and cancellation do not survive into the next operation", async () => {
        const controller = new AbortController();
        controller.abort(new Error("cancelled read"));
        await expect(
            store.withReadSnapshot("corpus", async () => {
                await store.listViews("corpus");
                controller.signal.throwIfAborted();
            }),
        ).rejects.toThrow("cancelled read");
        await expect(
            store.withReadSnapshot("corpus", async () => {
                throw new Error("selector failure");
            }),
        ).rejects.toThrow("selector failure");
        reads = 0;
        await store.withReadSnapshot("corpus", () => store.listViews("corpus"));
        expect(reads).toBe(1);
    });

    test("work retained after scope completion cannot reuse the expired snapshot", async () => {
        const entryRead = clock.spyOn(ViewHistory.prototype, "readEntry");
        let resume!: () => void;
        const gate = new Promise<void>((resolve) => {
            resume = resolve;
        });
        let late!: Promise<number>;
        await store.withReadSnapshot("corpus", async () => {
            late = gate.then(
                async () => (await store.getWikiFamily("corpus")).cursor,
            );
            expect((await store.getWikiFamily("corpus")).cursor).toBe(0);
        });
        await store.saveWikiFamily("corpus", {
            enabled: true,
            dirty: false,
            cursor: 7,
            descriptors: [],
        });
        reads = 0;
        entryRead.mockClear();
        resume();
        expect(await late).toBe(7);
        expect(reads).toBe(0);
        expect(entryRead).toHaveBeenCalledTimes(1);
        expect(entryRead).toHaveBeenCalledWith(viewReadProjectionEntry);
    });

    test("privacy writes expire reuse and the next read operation is fresh", async () => {
        await store.saveWikiFamily("corpus", {
            enabled: true,
            dirty: false,
            cursor: 5,
            descriptors: [
                { viewId: "page", query: "source", sourceIds: ["source"] },
            ],
        });
        await expect(
            store.withReadSnapshot("corpus", async () => {
                expect(
                    (await store.getWikiFamily("corpus")).descriptors,
                ).toHaveLength(1);
                await store.forgetSource("corpus", "source");
                expect(
                    (await store.getWikiFamily("corpus")).descriptors,
                ).toEqual([]);
            }),
        ).rejects.toThrow("changed during read operation");
        reads = 0;
        await store.withReadSnapshot("corpus", async () => {
            expect((await store.getWikiFamily("corpus")).descriptors).toEqual(
                [],
            );
        });
        expect(reads).toBe(1);
    });

    test("purge gate is checked before hydration, before reuse, and before returning", async () => {
        const gate = path.join(
            root,
            "corpus",
            "views",
            "view-history-purge.json",
        );
        await store.saveWikiFamily("corpus", {
            enabled: true,
            dirty: false,
            cursor: 0,
            descriptors: [],
        });
        await expect(
            store.withReadSnapshot("corpus", async () => {
                await writeFile(gate, "{}");
                await store.getWikiFamily("corpus");
            }),
        ).rejects.toThrow("quarantined");
        reads = 0;
        await expect(
            store.withReadSnapshot("corpus", () => store.listViews("corpus")),
        ).rejects.toThrow("quarantined");
        expect(reads).toBe(1);
        await rm(gate);
        await expect(
            store.withReadSnapshot("corpus", async () => {
                await store.listViews("corpus");
                await writeFile(gate, "{}");
            }),
        ).rejects.toThrow("quarantined");
        await rm(gate);
        await store.withReadSnapshot("corpus", () => store.listViews("corpus"));
    });

    test("removed repositories and failed hydration are not cached across operations", async () => {
        const gitdir = path.join(root, "corpus", "views", "view-history.git");
        await store.saveWikiFamily("corpus", {
            enabled: false,
            dirty: false,
            cursor: 9,
            descriptors: [],
        });
        await expect(
            store.withReadSnapshot("corpus", async () => {
                await rm(gitdir, { recursive: true });
                expect((await store.getWikiFamily("corpus")).cursor).toBe(9);
            }),
        ).rejects.toThrow("changed during read operation");
        await store.withReadSnapshot("corpus", async () => {
            expect((await store.getWikiFamily("corpus")).cursor).toBe(0);
        });
        const normal = ViewHistory.prototype.read;
        ViewHistory.prototype.read = async () => {
            throw new Error("hydration failed");
        };
        await expect(
            store.withReadSnapshot("corpus", () => store.listViews("corpus")),
        ).rejects.toThrow("hydration failed");
        ViewHistory.prototype.read = normal;
        await store.withReadSnapshot("corpus", () => store.listViews("corpus"));
    });

    test("actual repeated consolidation nomination reads one projection with historical guard parity", async () => {
        const readEntry = ViewHistory.prototype.readEntry;
        clock
            .spyOn(ViewHistory.prototype, "readEntry")
            .mockImplementation(function (this: ViewHistory<unknown>, ...args) {
                const operation = operationReads.getStore();
                if (operation && args[0] === viewReadProjectionEntry)
                    operation.projectionReads =
                        (operation.projectionReads ?? 0) + 1;
                return readEntry.apply(this, args);
            });
        const { adapter } = offlineConsolidationAdapter();
        const service = new FileMemoryService(root, {
            sourceSynopses: false,
            indexFactory: (_id, directory) => new ConsolidationIndex(directory),
            viewSynthesisAdapter: adapter,
        });
        try {
            const { corpusId } = await service.createCorpus(
                "Snapshot nomination",
            );
            await changeFamily(service, corpusId, "pause");
            await ingestFixture(
                service,
                corpusId,
                "initial",
                "document-020.md",
                "worksheet",
            );
            await ingestFixture(
                service,
                corpusId,
                "initial",
                "document-021.md",
                "review",
            );
            await changeFamily(service, corpusId, "resume");
            const snapshot = await settleConsolidation(service, corpusId);
            await changeFamily(service, corpusId, "pause");
            const target = snapshot.views.find(
                (view) => view.definition.wiki?.query === "lease-budget review",
            )!;
            expect(target).toBeDefined();
            const versions = await store.getViewVersions({
                corpusId,
                viewId: target.viewId,
            });
            const historicalOperation = { count: 0 };
            const historical = await operationReads.run(
                historicalOperation,
                () =>
                    store.getViewHistory({
                        corpusId,
                        viewId: target.viewId,
                    }),
            );
            const historicalReads = historicalOperation.count;
            expect(historicalReads).toBe(0);
            expect(versions).toEqual(historical.map((entry) => entry.version));
            expect(
                automaticallyConsolidatable(
                    target,
                    versions.map((version) => ({ version })),
                ),
            ).toBe(automaticallyConsolidatable(target, historical));
            const nomination = service as unknown as {
                readConsolidationPairs(
                    corpusId: string,
                    targetId: string,
                ): Promise<Array<[ViewVersion, ViewVersion]>>;
            };
            const currentVersions = TypedViewStore.prototype.getViewVersions;
            let historicalPairs: Array<[ViewVersion, ViewVersion]>;
            let historicalNominationReads: number;
            let historicalNominationMs: number;
            try {
                TypedViewStore.prototype.getViewVersions = async function (
                    request,
                ) {
                    return (await this.getViewHistory(request)).map(
                        (entry) => entry.version,
                    );
                };
                const operation = { count: 0 };
                const started = performance.now();
                historicalPairs = await operationReads.run(operation, () =>
                    nomination.readConsolidationPairs(corpusId, target.viewId),
                );
                historicalNominationMs = performance.now() - started;
                historicalNominationReads = operation.count;
            } finally {
                TypedViewStore.prototype.getViewVersions = currentVersions;
            }
            expect(historicalNominationReads).toBe(0);
            const nominationMs: number[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
                const operation = { count: 0, projectionReads: 0 };
                const started = performance.now();
                const [pairs] = await Promise.all([
                    operationReads.run(operation, () =>
                        nomination.readConsolidationPairs(
                            corpusId,
                            target.viewId,
                        ),
                    ),
                    store.listViews(corpusId),
                ]);
                nominationMs.push(performance.now() - started);
                expect(pairs).toEqual(historicalPairs);
                expect(pairs.length).toBeGreaterThan(0);
                expect(
                    pairs.some((pair) =>
                        pair.some((view) => view.viewId === target.viewId),
                    ),
                ).toBe(true);
                expect(operation.count).toBe(0);
                expect(operation.projectionReads).toBe(1);
            }
            const operation = { count: 0, projectionReads: 0 };
            await operationReads.run(operation, () =>
                service.listViews(corpusId),
            );
            expect(operation.count).toBe(0);
            expect(operation.projectionReads).toBe(1);
            console.warn(
                JSON.stringify({
                    snapshotReuse: {
                        historicalReads,
                        historicalNominationReads,
                        historicalNominationMs,
                        nominationReads: 0,
                        nominationMs,
                    },
                }),
            );
        } finally {
            await service.close();
        }
    });
});
