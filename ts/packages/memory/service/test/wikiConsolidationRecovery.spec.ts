// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { TypedViewStore } from "../src/viewStore.js";
import {
    ConsolidationIndex,
    changeFamily,
    ingestFixture,
    offlineConsolidationAdapter,
    settleConsolidation,
} from "./wikiConsolidationFixtures.js";

const jestApi = import.meta.jest;
const phases = [
    "prepared",
    "accepted",
    "redirected",
    "indexed",
    "ack",
] as const;

test.each(phases)(
    "actual P0 interrupted %s effect resumes exact canonical/redirect/index without synthesis or duplicate versions",
    async (phase) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), `memory-consolidation-${phase}-`),
        );
        const { adapter, calls } = offlineConsolidationAdapter();
        let armed = false;
        let fired = false;
        const originalCheck = adapter.checkWikiConsolidation;
        if (!originalCheck)
            throw new Error("Offline actual-output checker is required");
        adapter.checkWikiConsolidation = async (...args) => {
            const assessment = await originalCheck(...args);
            armed = true;
            return assessment;
        };
        const interrupt = (effect: string) => {
            if (armed && !fired && phase === effect) {
                fired = true;
                throw new Error(
                    `Injected ${effect} committed-effect interruption`,
                );
            }
        };
        const spies: Array<{ mockRestore(): void }> = [];
        const update = TypedViewStore.prototype.updateViewBuild;
        spies.push(
            jestApi
                .spyOn(TypedViewStore.prototype, "updateViewBuild")
                .mockImplementation(async function (
                    this: TypedViewStore,
                    corpusId,
                    jobId,
                    mutation,
                ) {
                    const saved = await update.call(
                        this,
                        corpusId,
                        jobId,
                        mutation,
                    );
                    if (
                        saved.results.some(
                            (result) =>
                                result.wikiConsolidation?.stage === "prepared",
                        )
                    )
                        interrupt("prepared");
                    if (
                        saved.results.some(
                            (result) =>
                                result.wikiConsolidation?.stage === "ready",
                        )
                    )
                        interrupt("ack");
                    return saved;
                }),
        );
        const accept = TypedViewStore.prototype.acceptWikiConsolidation;
        spies.push(
            jestApi
                .spyOn(TypedViewStore.prototype, "acceptWikiConsolidation")
                .mockImplementation(async function (
                    this: TypedViewStore,
                    ...args
                ) {
                    const accepted = await accept.call(this, ...args);
                    interrupt("accepted");
                    return accepted;
                }),
        );
        const redirect = TypedViewStore.prototype.activateWikiRedirect;
        spies.push(
            jestApi
                .spyOn(TypedViewStore.prototype, "activateWikiRedirect")
                .mockImplementation(async function (
                    this: TypedViewStore,
                    ...args
                ) {
                    await redirect.call(this, ...args);
                    interrupt("redirected");
                }),
        );
        const index = TypedViewStore.prototype.updateViewIndex;
        spies.push(
            jestApi
                .spyOn(TypedViewStore.prototype, "updateViewIndex")
                .mockImplementation(async function (
                    this: TypedViewStore,
                    ...args
                ) {
                    const publication = await index.call(this, ...args);
                    if (!args[3]) interrupt("indexed");
                    return publication;
                }),
        );
        const open = () =>
            new FileMemoryService(root, {
                sourceSynopses: false,
                indexFactory: (_id, directory) =>
                    new ConsolidationIndex(directory),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        try {
            const { corpusId } = await service.createCorpus(
                `Actual P0 ${phase} interrupted consolidation`,
            );
            await changeFamily(service, corpusId, "pause");
            await ingestFixture(
                service,
                corpusId,
                "initial",
                "document-021.md",
                "review",
            );
            await changeFamily(service, corpusId, "resume");
            await settleConsolidation(service, corpusId);
            await changeFamily(service, corpusId, "pause");
            await ingestFixture(
                service,
                corpusId,
                "t1",
                "document-021.md",
                "review",
            );
            await changeFamily(service, corpusId, "resume");
            await settleConsolidation(service, corpusId);
            expect(fired).toBe(true);
            const interrupted = (await service.listViewBuilds(corpusId)).find(
                (job) => job.results.some((result) => result.wikiConsolidation),
            );
            const receipt = interrupted!.results.find(
                (result) => result.wikiConsolidation,
            )!.wikiConsolidation!;
            const counts = { ...calls };
            for (const spy of spies) spy.mockRestore();
            await service.close();
            service = open();
            await service.initialize();
            await settleConsolidation(service, corpusId);
            const recovered = await service.getViewBuild({
                corpusId,
                jobId: interrupted!.jobId,
            });
            const target = recovered!.results.find(
                (result) => result.wikiConsolidation,
            )!;
            expect({
                stage: target.wikiConsolidation!.stage,
                reason: target.reason,
            }).toEqual({
                stage: "ready",
                reason: "Qualified canonical accepted; old ID/anchors redirect; exact derivative index ready",
            });
            expect(target.state).toBe("merged");
            expect(calls).toEqual(counts);
            const canonical = (await service.getView({
                corpusId,
                viewId: receipt.survivorViewId,
            }))!;
            expect(canonical.version).toBe(receipt.input.expectedVersion + 1);
            const alias = (await service.getView({
                corpusId,
                viewId: receipt.retiringViewId,
            }))!;
            expect(alias.version).toBe(receipt.retiringVersion + 1);
            expect(alias.redirect?.viewId).toBe(canonical.viewId);
            const publication = await service.getViewPublication({
                corpusId,
                viewId: canonical.viewId,
            });
            expect(publication.indexState).toBe("ready");
            expect(publication.indexedRevisionId).toBe(canonical.revisionId);
            const head = (await service.listViews(corpusId)).head;
            await service.close();
            service = open();
            await service.initialize();
            await settleConsolidation(service, corpusId);
            expect((await service.listViews(corpusId)).head).toBe(head);
            expect(calls).toEqual(counts);
        } finally {
            for (const spy of spies) spy.mockRestore();
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    60000,
);

test("forget while actual canonical-output judgment is pending denies the late effect and every old link", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-late-"),
    );
    const { adapter } = offlineConsolidationAdapter();
    let entered: () => void = () => {
        throw new Error("Offline checker entry callback not initialized");
    };
    const checking = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let release: () => void = () => {
        throw new Error("Offline checker release callback not initialized");
    };
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const check = adapter.checkWikiConsolidation;
    if (!check) throw new Error("Offline checker required");
    adapter.checkWikiConsolidation = async (...args) => {
        entered();
        await pending;
        return check(...args);
    };
    const service = new FileMemoryService(root, {
        sourceSynopses: false,
        indexFactory: (_id, directory) => new ConsolidationIndex(directory),
        viewSynthesisAdapter: adapter,
    });
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 late consolidation privacy",
        );
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "initial",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        const original = (await settleConsolidation(service, corpusId)).views;
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        await checking;
        const preview = await service.previewForgetSource(corpusId, "review");
        await service.forgetSource({
            corpusId,
            sourceId: "review",
            confirmationToken: preview.confirmationToken,
        });
        release();
        await settleConsolidation(service, corpusId);
        for (const view of original) {
            expect(
                await service.getView({ corpusId, viewId: view.viewId }),
            ).toBeUndefined();
            expect(
                await service.getViewHistory({ corpusId, viewId: view.viewId }),
            ).toEqual([]);
        }
        expect(
            (await service.listViewBuilds(corpusId)).some((job) =>
                job.results.some((result) => result.wikiConsolidation),
            ),
        ).toBe(false);
    } finally {
        release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 60000);
