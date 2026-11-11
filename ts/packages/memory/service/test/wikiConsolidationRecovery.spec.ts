// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { TypedViewStore } from "../src/viewStore.js";
import type { ViewSynthesisAdapter } from "../src/viewTypes.js";
import { waitForTestState } from "./waitForTestState.js";
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

function openService(root: string, adapter: ViewSynthesisAdapter) {
    return new FileMemoryService(root, {
        sourceSynopses: false,
        discoveryPolicy: "off",
        indexFactory: (_id, directory) => new ConsolidationIndex(directory),
        viewSynthesisAdapter: adapter,
    });
}

let baseline: string;
let corpusId: string;
beforeAll(async () => {
    baseline = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-baseline-"),
    );
    const { adapter, calls } = offlineConsolidationAdapter();
    const service = openService(baseline, adapter);
    try {
        ({ corpusId } = await service.createCorpus(
            "Consolidation recovery baseline",
        ));
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "initial",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        const snapshot = await settleConsolidation(service, corpusId, false, {
            description: "Recovery baseline articles",
        });
        expect(
            snapshot.views.filter((view) =>
                view.definition.wiki?.query.endsWith("review"),
            ),
        ).toHaveLength(2);
        expect(calls.actual).toBe(0);
        await changeFamily(service, corpusId, "pause");
    } finally {
        await service.close();
    }
}, 60000);

afterAll(async () => {
    if (baseline) await rm(baseline, { recursive: true, force: true });
});

test.each(phases)(
    "actual P0 interrupted %s effect resumes exact canonical/redirect/index without synthesis or duplicate versions",
    async (phase) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), `memory-consolidation-${phase}-`),
        );
        const deadline = Date.now() + 45_000;
        const stage = <T>(name: string, operation: () => Promise<T>) =>
            waitForTestState(operation, () => true, `${phase}: ${name}`, {
                deadline,
            });
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
        const open = () => openService(root, adapter);
        let service = open();
        const settle = (name: string) =>
            settleConsolidation(service, corpusId, false, {
                deadline,
                description: `${phase}: ${name}`,
            });
        try {
            await stage("restore prepared articles", () =>
                cp(baseline, root, { recursive: true }),
            );
            await stage("open prepared corpus", () => service.initialize());
            await ingestFixture(
                service,
                corpusId,
                "t1",
                "document-021.md",
                "review",
                { deadline },
            );
            await stage("resume clarification", () =>
                changeFamily(service, corpusId, "resume"),
            );
            await settle("injected committed effect");
            expect(fired).toBe(true);
            const interrupted = (await service.listViewBuilds(corpusId)).find(
                (job) => job.results.some((result) => result.wikiConsolidation),
            );
            const receipt = interrupted!.results.find(
                (result) => result.wikiConsolidation,
            )!.wikiConsolidation!;
            const counts = { ...calls };
            for (const spy of spies) spy.mockRestore();
            await stage("close interrupted writer", () => service.close());
            service = open();
            await stage("reopen interrupted corpus", () =>
                service.initialize(),
            );
            await settle("recover exact receipt");
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
            await stage("close recovered writer", () => service.close());
            service = open();
            await stage("reopen recovered corpus", () => service.initialize());
            await settle("verify second restart is unchanged");
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
    const deadline = Date.now() + 45_000;
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
    const service = openService(root, adapter);
    try {
        await cp(baseline, root, { recursive: true });
        await service.initialize();
        const original = (await service.listViews(corpusId)).views;
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-021.md",
            "review",
            { deadline },
        );
        await changeFamily(service, corpusId, "resume");
        await waitForTestState(
            () => checking,
            () => true,
            "Forget race: actual-output checker entry",
            { deadline },
        );
        const preview = await service.previewForgetSource(corpusId, "review");
        await service.forgetSource({
            corpusId,
            sourceId: "review",
            confirmationToken: preview.confirmationToken,
        });
        release();
        await settleConsolidation(service, corpusId, false, {
            deadline,
            description: "Forget race: reject late canonical output",
        });
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
