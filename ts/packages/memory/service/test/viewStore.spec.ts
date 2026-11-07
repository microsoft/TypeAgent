// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TypedViewStore } from "../src/viewStore.js";
import { ViewHistory } from "../src/viewHistory.js";
import { runWithSearchTiming } from "@typeagent/knowpro";
import type { KnowledgeStatus } from "../src/knowledgeTypes.js";
import type {
    ViewBuildSnapshot,
    ViewBuildJob,
    ViewSaveRequest,
    ViewVersion,
} from "../src/viewTypes.js";

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

    test("metadata polling selects real retained history fields and preserves committed snapshots", async () => {
        const job: ViewBuildJob = {
            jobId: "current",
            corpusId,
            fingerprint: "current",
            request: { corpusId, expectedHead: null, targets: [] },
            actor: "owner",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
            state: "running",
            results: [],
            publication: false,
        };
        const knowledge: KnowledgeStatus = {
            discovery: {
                version: 1,
                policy: "off",
                policyVersion: 1,
                receipts: [],
                routes: [],
                callTimes: [],
            },
            checkpoints: [],
        };
        const state = {
            views: {},
            knowledge,
            builds: {
                current: job,
                retained: {
                    ...job,
                    jobId: "retained",
                    state: "failed" as const,
                    results: [
                        {
                            viewId: "guide",
                            state: "blocked" as const,
                            reason: "Synthetic evidence rejection",
                            snapshot: {
                                corpusId,
                                actor: "owner",
                                definition: request.definition,
                                expectedVersion: 0,
                                bounds: {},
                                pipeline: "troubleshooting-v1",
                                model: "offline",
                                fingerprint: "retained",
                                inputs: [
                                    {
                                        sourceId: "evidence",
                                        revisionId: "r1",
                                        title: "Synthetic history",
                                        content:
                                            "Synthetic retained evidence. ".repeat(
                                                60000,
                                            ),
                                        contentHash: "synthetic",
                                    },
                                ],
                            },
                        },
                    ],
                } satisfies ViewBuildJob,
            },
        };
        const history = new ViewHistory(
            path.join(root, corpusId, "views"),
            () => state,
        );
        const first = await history.commit(
            null,
            state,
            {},
            "owner",
            "Retained history",
        );
        const trace = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const output = import.meta.jest
            .spyOn(console, "warn")
            .mockImplementation();
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        try {
            for (let count = 0; count < 3; count++) {
                await runWithSearchTiming(
                    "metadata-test",
                    "metadata-test",
                    async () => {
                        expect(await store.getKnowledgeState(corpusId)).toEqual(
                            knowledge,
                        );
                        expect(
                            await store.getViewBuild(corpusId, "current"),
                        ).toEqual(job);
                    },
                );
            }
            const reads = output.mock.calls
                .map(([text]) =>
                    JSON.parse(
                        String(text).slice("[memory-search-timing] ".length),
                    ),
                )
                .filter((entry) => entry.stage === "view.history.payload.read");
            expect(reads).toHaveLength(6);
            for (const read of reads) {
                expect(read.metadata.selected).toBe(true);
                expect(read.metadata.payloadBytesRead).toBeLessThan(
                    read.metadata.stateBytes * 0.01,
                );
            }
            console.log(
                JSON.stringify({
                    boundary:
                        "six TypedViewStore metadata reads; uncompressed payload blobs, excluding manifests and trees",
                    logicalStateBytes: reads[0].metadata.stateBytes,
                    selectedPayloadBytesRead: reads.reduce(
                        (sum, read) => sum + read.metadata.payloadBytesRead,
                        0,
                    ),
                    reads: reads.length,
                }),
            );
            await store.updateKnowledgeState(corpusId, (current) => {
                current.discovery.policy = "suggest";
            });
            const fullJob = import.meta.jest.spyOn(store, "getViewBuild");
            try {
                const diagnostics = await store.getKnowledgeBuildDiagnostics(
                    corpusId,
                    ["retained", "missing"],
                );
                expect(diagnostics.map(({ code }) => code)).toEqual([
                    "target-blocked",
                    "job-unavailable",
                ]);
                expect(fullJob.mock.calls.map((call) => call[1])).toEqual([
                    "missing",
                ]);
                expect(diagnostics[1].state).toBe("unavailable");
            } finally {
                fullJob.mockRestore();
            }
            expect(
                (await store.getKnowledgeState(corpusId)).discovery.policy,
            ).toBe("suggest");
            await store.withCommittedSnapshot(corpusId, first, async () => {
                expect(
                    (await store.getKnowledgeState(corpusId)).discovery.policy,
                ).toBe("off");
                expect(await store.getViewBuild(corpusId, "current")).toEqual(
                    job,
                );
            });
            const concurrent = new TypedViewStore(root);
            try {
                expect(
                    await concurrent.getViewBuild(corpusId, "current"),
                ).toEqual(job);
                await store.withInventorySnapshot(
                    corpusId,
                    async () => {
                        await concurrent.updateKnowledgeState(
                            corpusId,
                            (current) => {
                                current.discovery.policy = "off";
                            },
                        );
                        expect(
                            (await store.getKnowledgeState(corpusId)).discovery
                                .policy,
                        ).toBe("suggest");
                    },
                    false,
                );
                expect(
                    (await store.getKnowledgeState(corpusId)).discovery.policy,
                ).toBe("off");
            } finally {
                concurrent.closeReadCaches();
            }
            const mutable = await store.getViewBuild(corpusId, "current");
            mutable!.state = "failed";
            expect((await store.getViewBuild(corpusId, "current"))?.state).toBe(
                "running",
            );
        } finally {
            if (trace === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = trace;
            output.mockRestore();
        }
    });

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

    test("privacy removal purges protected human text influenced by read-but-not-cited evidence", async () => {
        const saved = await store.saveViewDraft({
            ...request,
            definition: {
                ...request.definition,
                selector: { kind: "sources", sources: [] },
            },
        });
        expect(saved.version.provenance).toBe("human");
        const history = new ViewHistory<{
            views: Record<string, ViewVersion[]>;
        }>(path.join(root, corpusId, "views"), () => ({ views: {} }));
        const { head, state } = await history.read();
        const snapshot: ViewBuildSnapshot = {
            corpusId,
            actor: "memory-view-generator",
            definition: request.definition,
            expectedVersion: 0,
            bounds: {},
            inputs: [],
            influenceSources: [
                { sourceId: "not-cited", revisionId: "read-revision" },
            ],
            pipeline: "troubleshooting-v1",
            model: "offline",
            fingerprint: "captured",
        };
        state.views.guide[0].generation = {
            candidateId: "synthetic-candidate",
            fingerprint: snapshot.fingerprint,
            input: snapshot,
            content: saved.version.content,
            relationships: [],
        };
        await history.commit(
            head,
            state,
            {},
            "owner",
            "Capture non-citation influence",
        );
        await store.forgetSource(corpusId, "not-cited");
        expect((await store.listViews(corpusId)).views).toEqual([]);
        expect(
            await store.getViewHistory({ corpusId, viewId: "guide" }),
        ).toEqual([]);
    });
});
