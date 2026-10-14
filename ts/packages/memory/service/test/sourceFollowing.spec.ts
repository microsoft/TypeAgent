// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    sourceFollowingHost,
    sourceFollowingStage,
    changeFamily,
    settleConsolidation,
    replaceOriginal,
} from "./sourceFollowingFixtures.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";
import { createMemoryServiceRpcFacade } from "../src/rpcFacade.js";
import type { ViewVersion, ViewBuildJob } from "../src/viewTypes.js";

let priorProvider: string | undefined;
beforeEach(() => {
    priorProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
});
afterEach(() => {
    if (priorProvider === undefined)
        delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    else process.env.TYPEAGENT_EMBEDDING_PROVIDER = priorProvider;
});

async function initial(root: string) {
    const host = sourceFollowingHost(root);
    const service = host.open();
    const { corpusId } = await service.createCorpus("Real KnowPro C5");
    await changeFamily(service, corpusId, "pause");
    await sourceFollowingStage(service, corpusId, "initial");
    await changeFamily(service, corpusId, "resume");
    const old = (await settleConsolidation(service, corpusId)).views.find(
        (view) => view.definition.wiki?.query === "overlap review",
    );
    if (!old) throw new Error("Actual original overlap view is required");
    return { host, service, corpusId, old };
}

test("DEFAULT real KnowPro C5 refreshes old navigation from current indexed originals when extraction renames labels and embeddings are absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "source-following-c5-"));
    const context = await initial(root);
    let { service } = context;
    const { host, corpusId, old } = context;
    try {
        const initialCalls = { ...host.calls };
        await changeFamily(service, corpusId, "update");
        await settleConsolidation(service, corpusId);
        expect(host.calls).toEqual(initialCalls);
        await changeFamily(service, corpusId, "pause");
        await sourceFollowingStage(service, corpusId, "t1");
        const index = host.indexes.get(corpusId)!;
        const lexical = await index.readFragments({
            terms: ["overlap review"],
            sourceIds: ["handoff"],
        });
        expect(lexical.fragments).toHaveLength(0);
        const oldInput = old.generation?.input;
        if (!oldInput) throw new Error("Accepted original input is required");
        const obsolete = await index.readFragments({
            terms: ["overlap review"],
            sourceIds: ["handoff"],
            followSources: oldInput.inputs.map(({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            })),
        });
        expect(obsolete.fragments).toHaveLength(0);
        const foreign = await index.readFragments({
            terms: ["overlap review"],
            sourceIds: ["unassociated-source"],
            followSources: [
                {
                    sourceId: "handoff",
                    revisionId: (await service.getSource(corpusId, "handoff"))!
                        .activeRevisionId,
                },
            ],
        });
        expect(foreign.fragments).toHaveLength(0);
        await changeFamily(service, corpusId, "resume");
        const current = await settleConsolidation(service, corpusId);
        const refreshed = await service.getView({
            corpusId,
            viewId: old.viewId,
        });
        expect(refreshed).toBeDefined();
        expect(refreshed!.revisionId).not.toBe(old.revisionId);
        expect(refreshed!.content.sections[0].body).toContain(
            "Preserve navigable context",
        );
        expect(refreshed!.content.sections[0].body).toContain(
            "Identity token rotation",
        );
        expect(refreshed!.content.sections[0].body).toContain(
            "Orders schema migration",
        );
        expect(refreshed!.redirect).toBeUndefined();
        expect(current.views.every((view) => !view.redirect)).toBe(true);
        expect(
            current.views.map((view) =>
                view.definition.wiki?.query.toLowerCase(),
            ),
        ).toEqual(
            expect.arrayContaining([
                "identity token rotation",
                "orders schema migration",
            ]),
        );
        const source = (await service.getSource(corpusId, "handoff"))!;
        const protocol: {
            viewVersionSchema: { parse(value: unknown): ViewVersion };
            viewBuildJobSchema: { parse(value: unknown): ViewBuildJob };
        } = await import(
            new URL("../../../client/dist/viewProtocol.js", import.meta.url)
                .href
        );
        const rpc = createMemoryServiceRpcFacade(service);
        const parsed = protocol.viewVersionSchema.parse(
            await rpc.getView({ corpusId, viewId: old.viewId }),
        );
        expect(parsed.revisionId).toBe(refreshed!.revisionId);
        for (const job of await rpc.listViewBuilds(corpusId))
            protocol.viewBuildJobSchema.parse(job);
        for (const citation of refreshed!.content.citations) {
            expect(citation.revisionId).toBe(source.activeRevisionId);
            expect(
                await index.resolveIndexedLocator(
                    citation.sourceId,
                    citation.revisionId,
                    citation.locator,
                ),
            ).toBe(citation.excerpt);
        }
        const followed = await index.readFragments({
            terms: ["overlap review"],
            sourceIds: ["handoff"],
            followSources: [
                { sourceId: "handoff", revisionId: source.activeRevisionId },
            ],
        });
        expect(followed.readChars).toBeLessThanOrEqual(32000);
        expect(followed.fragments.length).toBeLessThanOrEqual(12);
        const calls = { ...host.calls };
        await changeFamily(service, corpusId, "update");
        await settleConsolidation(service, corpusId);
        expect(host.calls).toEqual(calls);
        await service.close();
        service = host.open();
        await service.initialize();
        await changeFamily(service, corpusId, "update");
        await settleConsolidation(service, corpusId);
        expect(host.calls).toEqual(calls);
        expect(
            (await service.getView({ corpusId, viewId: old.viewId }))
                ?.revisionId,
        ).toBe(refreshed!.revisionId);
        expect(host.unexpectedModelCalls()).toBe(0);
        if (process.env.TYPEAGENT_SOURCE_FOLLOWING_RECEIPT)
            await writeFile(
                process.env.TYPEAGENT_SOURCE_FOLLOWING_RECEIPT,
                JSON.stringify(
                    {
                        corpusId,
                        oldViewId: old.viewId,
                        priorRevisionId: old.revisionId,
                        currentRevisionId: refreshed!.revisionId,
                        sourceId: source.sourceId,
                        currentSourceRevisionId: source.activeRevisionId,
                        defaultLexicalFragments: lexical.fragments.length,
                        obsoleteFollowingFragments: obsolete.fragments.length,
                        scopedViews: current.views.map((view) => ({
                            viewId: view.viewId,
                            query: view.definition.wiki?.query,
                            redirect: view.redirect,
                        })),
                        citations: refreshed!.content.citations,
                        boundedReadChars: followed.readChars,
                        boundedFragments: followed.fragments.length,
                        publicReadRevisionId: parsed.revisionId,
                        settledRestartCalls: host.calls,
                        unexpectedModelCalls: host.unexpectedModelCalls(),
                    },
                    null,
                    2,
                ) + "\n",
                "utf8",
            );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);

test("source following preserves authenticated human title/note units during actual current-original refresh", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "source-following-human-"),
    );
    const { service, corpusId, old } = await initial(root);
    try {
        await changeFamily(service, corpusId, "pause");
        const content = structuredClone(old.content);
        if (content.kind !== "wiki")
            throw new Error("Expected actual Wiki content");
        content.title = "My overlap navigation";
        content.sections[0].details.note = "Keep my scope annotation";
        await service.saveViewDraft({
            corpusId,
            viewId: old.viewId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: old.version,
            definition: derivedDefinitionInput(old),
            content,
            relationships: authoredRelationships(old),
        });
        await sourceFollowingStage(service, corpusId, "t1");
        await changeFamily(service, corpusId, "resume");
        await settleConsolidation(service, corpusId);
        const view = await service.getView({ corpusId, viewId: old.viewId });
        if (!view || view.content.kind !== "wiki")
            throw new Error("Expected refreshed Wiki content");
        expect(view?.content.title).toBe("My overlap navigation");
        expect(view?.content.sections[0].details.note).toBe(
            "Keep my scope annotation",
        );
        expect(view?.content.sections[0].body).toContain(
            "Preserve navigable context",
        );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);

test("unrelated replacement is explicit and parked, cannot force old purpose or resurrect a removed original", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "source-following-unrelated-"),
    );
    const { host, service, corpusId, old } = await initial(root);
    try {
        await changeFamily(service, corpusId, "pause");
        await replaceOriginal(
            service,
            corpusId,
            "# Unrelated review\n\nCorrection: overlap is withdrawn. This unrelated scope is not the earlier handoff. Do not preserve its former claims. Identity token rotation and Orders schema migration now have distinct independent contexts.",
        );
        await changeFamily(service, corpusId, "resume");
        await settleConsolidation(service, corpusId);
        expect(
            await service.getView({ corpusId, viewId: old.viewId }),
        ).toBeUndefined();
        const jobs = await service.listViewBuilds(corpusId);
        expect(
            jobs
                .flatMap((job) => job.results)
                .some(
                    (result) =>
                        result.viewId === old.viewId &&
                        result.state === "blocked" &&
                        result.reason.includes("scope-state"),
                ),
        ).toBe(true);
        expect(
            (await service.listViews(corpusId)).views.map((view) =>
                view.definition.wiki?.query.toLowerCase(),
            ),
        ).toEqual(
            expect.arrayContaining([
                "identity token rotation",
                "orders schema migration",
            ]),
        );
        const calls = { ...host.calls };
        await changeFamily(service, corpusId, "update");
        await settleConsolidation(service, corpusId);
        expect(host.calls).toEqual(calls);
        const preview = await service.previewForgetSource(corpusId, "handoff");
        await service.forgetSource({
            corpusId,
            sourceId: "handoff",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: old.viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: old.viewId }),
        ).toHaveLength(0);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);

test("current-source reanchoring stays within four indexed blocks and the shared read budget on a large original", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "source-following-bounds-"),
    );
    const { host, service, corpusId, old } = await initial(root);
    try {
        await changeFamily(service, corpusId, "pause");
        await sourceFollowingStage(service, corpusId, "t1");
        const text = (
            await service.getSourceContent({
                corpusId,
                sourceId: "handoff",
            })
        ).content;
        if (typeof text !== "string")
            throw new Error("Current original text is required");
        await replaceOriginal(service, corpusId, text.repeat(80));
        const source = (await service.getSource(corpusId, "handoff"))!;
        const index = host.indexes.get(corpusId)!;
        const selection = await index.readFragments({
            terms: ["overlap review"],
            sourceIds: ["handoff"],
            followSources: [
                { sourceId: "handoff", revisionId: source.activeRevisionId },
            ],
        });
        expect(text.length * 80).toBeGreaterThan(32000);
        expect(selection.fragments.length).toBeGreaterThan(0);
        expect(selection.fragments.length).toBeLessThanOrEqual(12);
        expect(selection.readChars).toBeLessThanOrEqual(32000);
        expect(
            new Set(
                selection.fragments.map(
                    (fragment) => fragment.locator.split(":")[1],
                ),
            ).size,
        ).toBeLessThanOrEqual(4);
        expect(selection.limited).toBe(true);
        await changeFamily(service, corpusId, "resume");
        await settleConsolidation(service, corpusId);
        expect(
            (await service.getView({ corpusId, viewId: old.viewId }))?.content
                .sections[0].body,
        ).toContain("Preserve navigable context");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);

test("authorized removal outranks a held current-original following result and cold restart", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "source-following-forget-"),
    );
    const context = await initial(root);
    let { service } = context;
    const { host, corpusId, old } = context;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let entered!: () => void;
    const checking = new Promise<void>((resolve) => {
        entered = resolve;
    });
    try {
        await changeFamily(service, corpusId, "pause");
        await sourceFollowingStage(service, corpusId, "t1");
        host.holdCheck(entered, held);
        await changeFamily(service, corpusId, "resume");
        await Promise.race([
            checking,
            new Promise<never>((_, reject) => {
                const timer = setTimeout(
                    () => reject(new Error("Following checker not reached")),
                    15000,
                );
                timer.unref();
            }),
        ]);
        const preview = await service.previewForgetSource(corpusId, "handoff");
        await service.forgetSource({
            corpusId,
            sourceId: "handoff",
            confirmationToken: preview.confirmationToken,
        });
        release();
        await settleConsolidation(service, corpusId);
        expect(
            await service.getView({ corpusId, viewId: old.viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: old.viewId }),
        ).toHaveLength(0);
        await service.close();
        service = host.open();
        await service.initialize();
        expect(
            await service.getView({ corpusId, viewId: old.viewId }),
        ).toBeUndefined();
        expect(await service.listViewBuilds(corpusId)).toHaveLength(0);
    } finally {
        release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);
