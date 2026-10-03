// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    createMemoryServiceRpcFacade,
    waitForMemoryJob,
} from "../src/rpcFacade.js";
import type { MemoryChangeReceipt, MemoryService } from "../src/types.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

describe("durable change receipts", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let failRebuild: boolean;

    function openService() {
        return new FileMemoryService(root, {
            indexFactory: (_id, directory) => {
                const index = new FakeProcedureCorpusIndex(directory);
                const rebuild = index.rebuild.bind(index);
                index.rebuild = async (documents) => {
                    if (failRebuild) {
                        throw new Error("Private failure secret");
                    }
                    await rebuild(documents);
                };
                return index;
            },
        });
    }

    async function seed(sourceId = "private-source-name") {
        const accepted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: "Private title",
                text: "Private initial text",
                canonicalUri: "https://private.invalid/secret",
                metadata: { secret: "Private arbitrary metadata" },
            },
        });
        expect(
            (
                await waitForMemoryJob(service, accepted.jobId, {
                    pollIntervalMs: 1,
                })
            ).state,
        ).toBe("complete");
        return accepted;
    }

    async function suppress(sourceId = "private-source-name") {
        return service.suppressSourceKnowledge({
            corpusId,
            sourceId,
            kind: "entity",
            name: "Private knowledge name",
        });
    }

    async function restore(sourceId = "private-source-name") {
        return service.restoreSourceKnowledge({
            corpusId,
            sourceId,
            kind: "entity",
            name: "Private knowledge name",
        });
    }

    async function replace(
        expectedActiveRevisionId: string,
        text = "Private replacement text",
    ) {
        const accepted = await service.replaceSource({
            corpusId,
            sourceId: "private-source-name",
            expectedActiveRevisionId,
            source: {
                sourceType: "text",
                title: "Private replacement title",
                text,
            },
        });
        return {
            accepted,
            job: await waitForMemoryJob(service, accepted.jobId, {
                pollIntervalMs: 1,
            }),
        };
    }

    beforeEach(async () => {
        root = path.resolve(".change-receipts-tests", randomUUID());
        await mkdir(root, { recursive: true });
        failRebuild = false;
        service = openService();
        corpusId = (await service.createCorpus("Changes test")).corpusId;
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
        await rm(path.dirname(root), { recursive: false }).catch(
            () => undefined,
        );
    });

    test("persists metadata-only committed operations across restart", async () => {
        const initial = await seed();
        expect((await service.listChanges({ corpusId })).items).toEqual([]);
        const replacement = await replace(initial.revisionId);
        expect(replacement.job.state).toBe("complete");
        await suppress();
        await restore();
        const before = await service.listChanges({ corpusId });
        expect(before.items.map((item) => item.operation)).toEqual([
            "replace",
            "suppress",
            "restore",
        ]);
        expect(before.items[0]).toMatchObject({
            outcome: "committed",
            counts: { sources: 1, revisions: 1, knowledge: 0 },
            sourceId: expect.stringMatching(/^[a-f0-9]{64}$/),
            revisionId: expect.stringMatching(/^[a-f0-9]{64}$/),
            previousRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(JSON.stringify(before)).not.toMatch(
            /Private|private-source-name|private.invalid|metadata/,
        );
        await service.close();
        service = openService();
        expect(await service.listChanges({ corpusId })).toEqual(before);
        expect(
            await createMemoryServiceRpcFacade(service).listChanges!({
                corpusId,
            }),
        ).toEqual(before);
    });

    test("paginates a stable snapshot and validates token scope and page size", async () => {
        await seed();
        await suppress();
        await restore();
        await suppress();
        const first = await service.listChanges({ corpusId, pageSize: 1 });
        expect(first.total).toBe(3);
        await restore();
        const second = await service.listChanges({
            corpusId,
            continuationToken: first.nextContinuationToken!,
        });
        const third = await service.listChanges({
            corpusId,
            continuationToken: second.nextContinuationToken!,
        });
        expect(second.total).toBe(3);
        expect(third.nextContinuationToken).toBeUndefined();
        expect(
            new Set(
                [...first.items, ...second.items, ...third.items].map(
                    (item) => item.changeId,
                ),
            ).size,
        ).toBe(3);
        await expect(
            service.listChanges({
                corpusId,
                pageSize: 2,
                continuationToken: first.nextContinuationToken!,
            }),
        ).rejects.toThrow("scope");
        const other = (await service.createCorpus("Other")).corpusId;
        await expect(
            service.listChanges({
                corpusId: other,
                continuationToken: first.nextContinuationToken!,
            }),
        ).rejects.toThrow("scope");
        await expect(
            service.listChanges({ corpusId, continuationToken: "bad" }),
        ).rejects.toThrow("Invalid");
        for (const pageSize of [0, -1, 201, 1.5, NaN]) {
            await expect(
                service.listChanges({ corpusId, pageSize }),
            ).rejects.toThrow("page size");
        }
        await expect(
            service.listChanges({ corpusId: "../invalid" }),
        ).rejects.toThrow();
    });

    test("forget purges earlier source receipts before its receipt and invalidates old pages", async () => {
        const initial = await seed();
        await replace(initial.revisionId);
        await suppress();
        const oldPage = await service.listChanges({ corpusId, pageSize: 1 });
        const preview = await service.previewForgetSource(
            corpusId,
            initial.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: initial.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        const receipts = await service.listChanges({ corpusId });
        expect(receipts.items).toEqual([
            expect.objectContaining({
                operation: "forget",
                counts: { sources: 1, revisions: 2, knowledge: 0 },
            }),
        ]);
        expect(receipts.items[0].revisionId).toBeUndefined();
        expect(receipts.items[0].previousRevisionId).toBeUndefined();
        expect(JSON.stringify(receipts)).not.toContain(
            preview.confirmationToken,
        );
        expect(JSON.stringify(receipts)).not.toMatch(
            /Private|private-source-name|private.invalid/,
        );
        await expect(
            service.listChanges({
                corpusId,
                continuationToken: oldPage.nextContinuationToken!,
            }),
        ).rejects.toThrow("expired");
        const manifest = await readFile(
            path.join(root, corpusId, "manifest.json"),
            "utf8",
        );
        expect(manifest).not.toMatch(
            /Private|private-source-name|private.invalid/,
        );
        await service.close();
        service = openService();
        expect(await service.listChanges({ corpusId })).toEqual(receipts);
        await service.clearCorpus(corpusId);
        expect(await service.listChanges({ corpusId })).toEqual({
            items: [],
            total: 0,
        });
    });

    test("failed and no-op operations never produce receipts", async () => {
        const initial = await seed();
        await restore();
        await suppress();
        await suppress();
        expect((await service.listChanges({ corpusId })).total).toBe(1);
        const unchanged = await replace(
            initial.revisionId,
            "Private initial text",
        );
        expect(unchanged.job.state).toBe("complete");
        const stale = await replace("wrong-revision");
        expect(stale.job.state).toBe("failed");
        const cancellation = new AbortController();
        const cancelled = await service.replaceSource(
            {
                corpusId,
                sourceId: initial.sourceId,
                expectedActiveRevisionId: initial.revisionId,
                source: {
                    sourceType: "text",
                    title: "Cancelled",
                    text: "Private cancelled text",
                },
            },
            cancellation.signal,
        );
        cancellation.abort();
        expect(
            (
                await waitForMemoryJob(service, cancelled.jobId, {
                    pollIntervalMs: 1,
                })
            ).state,
        ).toBe("cancelled");
        failRebuild = true;
        expect((await replace(initial.revisionId)).job.state).toBe("failed");
        const preview = await service.previewForgetSource(
            corpusId,
            initial.sourceId,
        );
        await expect(
            service.forgetSource({
                corpusId,
                sourceId: initial.sourceId,
                confirmationToken: preview.confirmationToken,
            }),
        ).rejects.toThrow("Private failure");
        failRebuild = false;
        await expect(
            service.forgetSource({
                corpusId,
                sourceId: initial.sourceId,
                confirmationToken: "invalid",
            }),
        ).rejects.toThrow("confirmation");
        const receipts = await service.listChanges({ corpusId });
        expect(receipts.total).toBe(1);
        expect(JSON.stringify(receipts)).not.toContain("failure");
        expect(
            (await service.getSource(corpusId, initial.sourceId))
                ?.activeRevisionId,
        ).toBe(initial.revisionId);
    });

    test("forget preserves unrelated corpus receipts", async () => {
        const first = await seed();
        await suppress();
        await seed("other-source");
        await suppress("other-source");
        const before = await service.listChanges({ corpusId });
        const preview = await service.previewForgetSource(
            corpusId,
            first.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: first.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        const after = await service.listChanges({ corpusId });
        expect(after.items.map((receipt) => receipt.operation)).toEqual([
            "suppress",
            "forget",
        ]);
        expect(after.items[0]).toEqual(before.items[1]);
        expect(after.items[1].sourceId).toBe(before.items[0].sourceId);
        expect(
            after.items.some(
                (receipt) => receipt.changeId === before.items[0].changeId,
            ),
        ).toBe(false);
    });

    test("prunes at 90 days on list and mutation without emitting synthetic changes", async () => {
        await seed();
        await suppress();
        const receipts = await service.listChanges({ corpusId });
        const originalNow = Date.now;
        try {
            Date.now = () =>
                Date.parse(receipts.items[0].createdAt) +
                90 * 24 * 60 * 60 * 1000;
            expect((await service.listChanges({ corpusId })).total).toBe(0);
        } finally {
            Date.now = originalNow;
        }
        await restore();
        try {
            Date.now = () => originalNow() + 91 * 24 * 60 * 60 * 1000;
            await restore();
            const manifest = JSON.parse(
                await readFile(
                    path.join(root, corpusId, "manifest.json"),
                    "utf8",
                ),
            ) as { changes: MemoryChangeReceipt[] };
            expect(manifest.changes).toEqual([]);
        } finally {
            Date.now = originalNow;
        }
    });

    test("prunes startup manifests and accepts pre-receipt manifests", async () => {
        await seed();
        await suppress();
        await service.close();
        const file = path.join(root, corpusId, "manifest.json");
        const manifest = JSON.parse(await readFile(file, "utf8")) as {
            changes?: MemoryChangeReceipt[];
        };
        manifest.changes![0].createdAt = "2000-01-01T00:00:00.000Z";
        await writeFile(file, JSON.stringify(manifest));
        service = openService();
        await service.initialize();
        expect(JSON.parse(await readFile(file, "utf8")).changes).toEqual([]);
        await service.close();
        delete manifest.changes;
        await writeFile(file, JSON.stringify(manifest));
        service = openService();
        expect(await service.listChanges({ corpusId })).toEqual({
            items: [],
            total: 0,
        });
        expect(await service.listSources(corpusId)).toHaveLength(1);
    });

    test("RPC explicitly rejects unsupported change history", async () => {
        const unsupported: MemoryService =
            createMemoryServiceRpcFacade(service);
        delete unsupported.listChanges;
        await expect(
            createMemoryServiceRpcFacade(unsupported).listChanges!({
                corpusId,
            }),
        ).rejects.toThrow("not supported");
    });
});
