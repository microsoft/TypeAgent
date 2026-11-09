// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";
import {
    ConsolidationIndex,
    changeFamily,
    ingestFixture,
    offlineConsolidationAdapter,
    settleConsolidation,
} from "./wikiConsolidationFixtures.js";

test("actual P0 C4 clarification consolidates generated reviews losslessly, old IDs/anchors follow current source and forget removes every route", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-p0-"),
    );
    const { adapter, calls } = offlineConsolidationAdapter();
    const open = () =>
        new FileMemoryService(root, {
            sourceSynopses: false,
            discoveryPolicy: "off",
            indexFactory: (_id, directory) => new ConsolidationIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    let service = open();
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 C4 consolidation",
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
        const initial = await settleConsolidation(service, corpusId);
        const originals = initial.views.filter((view) =>
            view.definition.wiki?.query.endsWith("review"),
        );
        expect(originals).toHaveLength(2);
        expect(calls.actual).toBe(0);
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-020.md",
            "worksheet",
        );
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        const current = await settleConsolidation(service, corpusId);
        const canonical = current.views.filter((view) =>
            view.definition.wiki?.query.endsWith("review"),
        );
        expect(canonical).toHaveLength(1);
        expect(
            current.views.filter((view) =>
                ["application connection pool", "checkout waiting"].includes(
                    view.definition.wiki!.query,
                ),
            ),
        ).toHaveLength(2);
        expect(canonical[0].content.sections).toHaveLength(2);
        expect(canonical[0].definition.wiki!.aliases).toContain(
            originals.find((view) => view.viewId !== canonical[0].viewId)!
                .definition.wiki!.query,
        );
        const retired = originals.find(
            (view) => view.viewId !== canonical[0].viewId,
        )!;
        const alias = await service.getView({
            corpusId,
            viewId: retired.viewId,
        });
        expect(alias?.redirect?.viewId).toBe(canonical[0].viewId);
        expect(alias?.redirect?.anchors).toHaveLength(1);
        for (const anchor of alias!.redirect!.anchors)
            expect(
                canonical[0].content.sections.some(
                    (section) => section.id === anchor.to,
                ),
            ).toBe(true);
        expect(alias!.content).toEqual(canonical[0].content);
        const receipt = (await service.listViewBuilds(corpusId))
            .flatMap((job) => job.results)
            .find((result) => result.wikiConsolidation)?.wikiConsolidation;
        expect(receipt?.stage).toBe("ready");
        expect(receipt?.assessment.scope.system).toBe("Payments API");
        const counts = { ...calls };
        await service.close();
        service = open();
        await service.initialize();
        await settleConsolidation(service, corpusId);
        expect(calls).toEqual(counts);
        expect(
            (await service.getView({ corpusId, viewId: retired.viewId }))
                ?.content,
        ).toEqual(canonical[0].content);
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "t2",
            "document-020.md",
            "worksheet",
        );
        await changeFamily(service, corpusId, "resume");
        const t2 = await settleConsolidation(service, corpusId);
        const updated = t2.views.find(
            (view) => view.viewId === canonical[0].viewId,
        )!;
        expect(updated).toBeDefined();
        expect(
            (await service.getView({ corpusId, viewId: retired.viewId }))
                ?.content,
        ).toEqual(updated.content);
        const preview = await service.previewForgetSource(
            corpusId,
            "worksheet",
        );
        await service.forgetSource({
            corpusId,
            sourceId: "worksheet",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: retired.viewId }),
        ).toBeUndefined();
        expect(
            await service.getView({ corpusId, viewId: canonical[0].viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: retired.viewId }),
        ).toEqual([]);
        expect(
            (await service.listViewBuilds(corpusId))
                .flatMap((job) => job.results)
                .some((result) => result.wikiConsolidation),
        ).toBe(false);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 60000);

test("actual P0 C5 scope split keeps an old navigation article and independent Identity/Orders articles without redirects", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-split-"),
    );
    const { adapter } = offlineConsolidationAdapter();
    const service = new FileMemoryService(root, {
        sourceSynopses: false,
        discoveryPolicy: "off",
        indexFactory: (_id, directory) => new ConsolidationIndex(directory),
        viewSynthesisAdapter: adapter,
    });
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 C5 scope split",
        );
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "initial",
            "document-022.md",
            "handoff",
        );
        await changeFamily(service, corpusId, "resume");
        const old = (await settleConsolidation(service, corpusId)).views.find(
            (view) => view.definition.wiki?.query === "overlap review",
        )!;
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-022.md",
            "handoff",
        );
        await changeFamily(service, corpusId, "resume");
        const current = await settleConsolidation(service, corpusId);
        expect(current.views).toHaveLength(3);
        expect(current.views.every((view) => !view.redirect)).toBe(true);
        expect(
            (await service.getView({ corpusId, viewId: old.viewId }))?.content
                .sections[0].body,
        ).toContain("Identity");
        expect(
            current.views.map((view) =>
                view.definition.wiki!.query.toLowerCase(),
            ),
        ).toEqual(
            expect.arrayContaining([
                "identity token rotation overlap",
                "orders schema migration overlap",
            ]),
        );
        const original = await service.getView({
            corpusId,
            viewId: old.viewId,
        });
        expect(original?.relatedArticles).toHaveLength(2);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 60000);

test("actual P0 C7 authenticated title/annotation and historical human edits prohibit automatic retirement", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-human-"),
    );
    const { adapter, calls } = offlineConsolidationAdapter();
    const service = new FileMemoryService(root, {
        sourceSynopses: false,
        discoveryPolicy: "off",
        indexFactory: (_id, directory) => new ConsolidationIndex(directory),
        viewSynthesisAdapter: adapter,
    });
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 C7 protected review",
        );
        await service.maintainViews({
            corpusId,
            family: "projects",
            operation: "pause",
            expectedHead: (await service.listViews(corpusId)).head,
        });
        await changeFamily(service, corpusId, "pause");
        await ingestFixture(
            service,
            corpusId,
            "initial",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        const initial = await settleConsolidation(service, corpusId);
        const target = initial.views.find(
            (view) => view.definition.wiki?.query === "lease-budget review",
        )!;
        const content = structuredClone(target.content);
        content.title = "My deliberate capacity-review title";
        if (content.kind !== "wiki") throw new Error("Expected Wiki fixture");
        content.sections[0].details.note =
            "Human annotation: retain my review context";
        await changeFamily(service, corpusId, "pause");
        await service.saveViewDraft({
            corpusId,
            viewId: target.viewId,
            expectedVersion: target.version,
            expectedHead: (await service.listViews(corpusId)).head,
            definition: derivedDefinitionInput(target),
            content,
            relationships: authoredRelationships(target),
        });
        await ingestFixture(
            service,
            corpusId,
            "t1",
            "document-021.md",
            "review",
        );
        await changeFamily(service, corpusId, "resume");
        const current = await settleConsolidation(service, corpusId);
        const protectedView = current.views.find(
            (view) => view.viewId === target.viewId,
        )!;
        expect(protectedView.content.title).toBe(content.title);
        if (protectedView.content.kind !== "wiki")
            throw new Error("Expected protected Wiki fixture");
        expect(protectedView.content.sections[0].details.note).toBe(
            content.sections[0].details.note,
        );
        expect(
            current.views.filter((view) =>
                view.definition.wiki?.query.endsWith("review"),
            ),
        ).toHaveLength(2);
        expect(calls.actual).toBe(0);
        expect(
            protectedView.edits?.some(
                (edit) => edit.actor !== "memory-view-generator",
            ),
        ).toBe(true);
        await changeFamily(service, corpusId, "pause");
        const generate = adapter.generate;
        adapter.generate = async (input, signal, inventory) => {
            const candidate = await generate(input, signal, inventory);
            if (input.definition.wiki?.query === "lease-budget review")
                candidate.content.title =
                    "Agent proposal conflicting with the deliberate human title";
            return candidate;
        };
        await ingestFixture(
            service,
            corpusId,
            "t2",
            "document-020.md",
            "worksheet",
        );
        await changeFamily(service, corpusId, "resume");
        await settleConsolidation(service, corpusId, true);
        await changeFamily(service, corpusId, "pause");
        const resolutionSnapshot = await settleConsolidation(
            service,
            corpusId,
            true,
        );
        const failed = (await service.listViewBuilds(corpusId))
            .flatMap((job) => job.results)
            .find(
                (result) =>
                    result.viewId === target.viewId && result.conflictId,
            );
        expect(failed?.state).toBe("conflicted");
        const conflict = await service.getViewConflict({
            corpusId,
            conflictId: failed!.conflictId!,
        });
        expect(conflict?.state).toBe("pending");
        const resolution = {
            corpusId,
            conflictId: conflict!.conflictId,
            expectedHead: resolutionSnapshot.head!,
            expectedVersion: conflict!.human.version,
            expectedRevisionId: conflict!.expectedRevisionId,
            inputFingerprint: conflict!.input.fingerprint,
            choice: "human" as const,
        };
        await expect(
            service.resolveViewConflict({
                ...resolution,
                inputFingerprint: "a".repeat(64),
            }),
        ).rejects.toThrow(
            "Conflict resolution head/target/input guard changed",
        );
        expect((await service.listViews(corpusId)).head).toBe(
            resolution.expectedHead,
        );
        const saved = await service.resolveViewConflict(resolution);
        expect(saved.version.content.title).toBe(content.title);
        expect(saved.version.actor).not.toBe("memory-view-generator");
        expect(saved.version.redirect).toBeUndefined();
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 60000);
