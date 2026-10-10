// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TypedViewStore } from "../src/viewStore.js";
import { ViewHistory } from "../src/viewHistory.js";
import type { ViewSaveRequest } from "../src/viewTypes.js";

describe("derived-only View persistence", () => {
    let root: string;
    let store: TypedViewStore;
    const corpusId = "corpus";
    const request: ViewSaveRequest = {
        corpusId,
        viewId: "guide",
        expectedVersion: 0,
        expectedHead: null,
        definition: {
            viewId: "guide",
            kind: "troubleshootingGuide",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "evidence", revisionId: "original" }],
            },
        },
        content: {
            kind: "troubleshootingGuide",
            title: "Inspect evidence",
            citations: [],
            sections: [
                {
                    id: "inspect",
                    role: "diagnostic",
                    heading: "Inspect",
                    body: "Read the retained evidence.",
                },
            ],
        },
        relationships: [],
    };
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-view-store-"));
        store = new TypedViewStore(root, "owner");
    });
    afterEach(async () => rm(root, { recursive: true, force: true }));

    test("source usage excludes event identity collisions and historical-only dependencies", async () => {
        await store.saveViewDraft(request);
        const eventId = "event-only";
        await store.saveViewDraft({
            ...request,
            viewId: eventId,
            expectedHead: (await store.listViews(corpusId)).head,
            definition: {
                ...request.definition,
                viewId: eventId,
                selector: { kind: "sources", sources: [] },
            },
            content: {
                ...request.content,
                citations: [
                    {
                        sourceId: "evidence",
                        revisionId: "digest",
                        locator: "chars:0-5",
                        excerpt: "event",
                        evidence: { kind: "event", eventId: "evidence" },
                    },
                ],
            },
        });
        expect(
            (await store.sourceUsage(corpusId, "evidence")).map(
                (item) => item.viewId,
            ),
        ).toEqual(["guide"]);
        await store.saveViewDraft({
            ...request,
            expectedHead: (await store.listViews(corpusId)).head,
            expectedVersion: 1,
            definition: {
                ...request.definition,
                selector: { kind: "sources", sources: [] },
            },
        });
        expect(await store.sourceUsage(corpusId, "evidence")).toEqual([]);
        expect(
            await store.getViewHistory({ corpusId, viewId: "guide" }),
        ).toHaveLength(2);
    });

    test("persists drafts, source invalidation and exact history without procedure state", async () => {
        const first = await store.saveViewDraft(request);
        await store.markSourceRevisionStale(
            corpusId,
            "evidence",
            "replacement",
        );
        const current = await store.getView({ corpusId, viewId: "guide" });
        expect(current).toMatchObject({ version: 2, state: "stale" });
        expect(
            await store.getView({
                corpusId,
                viewId: "guide",
                revisionId: first.version.revisionId,
            }),
        ).toEqual(first.version);
        store = new TypedViewStore(root, "owner");
        expect(
            await store.getViewHistory({ corpusId, viewId: "guide" }),
        ).toHaveLength(2);
        const directory = path.join(root, corpusId, "views");
        const history = new ViewHistory<Record<string, unknown>>(
            directory,
            () => ({}),
        );
        expect((await history.read()).state).not.toHaveProperty("index");
        expect(await readdir(path.join(root, corpusId))).toEqual(["views"]);
        await store.forgetSource(corpusId, "evidence");
        expect((await store.listViews(corpusId)).views).toEqual([]);
        expect(
            await store.getViewHistory({ corpusId, viewId: "guide" }),
        ).toEqual([]);
    });

    test("clears orphan View publication state while retaining corpus policy", async () => {
        const history = new ViewHistory<Record<string, unknown>>(
            path.join(root, corpusId, "views"),
            () => ({ views: {} }),
        );
        await history.commit(
            null,
            {
                views: {},
                publicationPolicy: {
                    revision: 3,
                    autoPublish: false,
                    views: { orphan: { revision: 1, autoPublish: true } },
                },
                publications: {
                    orphan: { viewId: "orphan", indexState: "pending" },
                },
                viewIndexCleanup: ["orphan"],
            },
            {},
            "owner",
            "Seed orphan state",
        );
        await store.clearDerivedViews(corpusId);
        expect(await store.getViewPublicationPolicy(corpusId)).toEqual({
            revision: 3,
            autoPublish: false,
            views: {},
        });
        expect(await store.getViewIndexCleanup(corpusId)).toEqual([]);
        expect((await history.read()).state.publications).toEqual({});
        const head = (await history.read()).head;
        await store.clearDerivedViews(corpusId);
        expect((await history.read()).head).toBe(head);
    });
});
