// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import {
    indexedLocator,
    parseIndexedLocator,
    selectIndexedFragments,
} from "../src/indexedFragments.js";
import { MaintenanceScheduler } from "../src/maintenanceScheduler.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { TypedViewStore, type WikiFamilyState } from "../src/viewStore.js";
import { ViewBuildStaleError } from "../src/viewBuilds.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";
import type { IndexedFragmentRequest } from "../src/types.js";
import type { ViewBuildJob, ViewVersion } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

class PlanningIndex extends FakeSemanticCorpusIndex {
    public async listSubjects() {
        return {
            total: 1,
            items: [
                {
                    term: "acquisition",
                    postingCount: this.documents.length,
                    sourceIds: this.documents.map(
                        (document) => document.source.sourceId,
                    ),
                },
            ],
        };
    }

    public async readFragments(request: IndexedFragmentRequest) {
        return selectIndexedFragments(
            this.documents.map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                blockOrdinal: 0,
                text: document.content,
                score: 1,
            })),
            request,
        );
    }

    public async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ) {
        const range = parseIndexedLocator(locator);
        const document = this.documents.find(
            (entry) =>
                entry.source.sourceId === sourceId &&
                entry.revision.revisionId === revisionId,
        );
        if (
            !range ||
            !document ||
            indexedLocator(
                {
                    sourceId,
                    revisionId,
                    blockOrdinal: 0,
                    text: document.content,
                    score: 1,
                },
                range.start,
                range.end,
            ) !== locator
        )
            throw new Error("Invalid indexed anchor");
        return document.content.slice(range.start, range.end);
    }
}

describe("dependency-scoped Wiki planning recovery", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let draft: ViewVersion;
    let allowSources = true;
    const open = () =>
        new FileMemoryService(root, {
            maintenanceMode: "manual",
            discoveryPolicy: "off",
            indexFactory: (_corpusId, directory) =>
                new PlanningIndex(directory),
            sourceAuthorization: async () => allowSources,
            viewSynthesisAdapter: {
                identity: "offline-planning-test",
                checkEditorial: async () => ({ safe: true, failures: [] }),
                generate: async (input) =>
                    hydrateInformational(input, {
                        title: input.definition.wiki!.query,
                        summary: "Acquisition requires independent approval.",
                        status: "partial",
                        prose: input.inputs
                            .map((source) => source.content)
                            .join("\n\n"),
                        limits: "Owner approval is unknown.",
                        citationIds: input.inputs
                            .flatMap((source) => source.passages ?? [])
                            .map((_, index) => `f${index}`),
                    }),
                validate: async () => {
                    throw new Error("Legacy validation must not run");
                },
            },
        });

    async function waitBuild(job: ViewBuildJob) {
        for (
            let attempt = 0;
            job.state === "running" && attempt < 300;
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({
                corpusId,
                jobId: job.jobId,
            }))!;
        }
        expect(job.state).toBe("complete");
    }

    async function editDirect(view: ViewVersion, viewId = view.viewId) {
        const store: TypedViewStore = service["viewStore"];
        const snapshot = await store.listViews(corpusId);
        const latest = snapshot.views.find((entry) => entry.viewId === viewId);
        const definition = { ...derivedDefinitionInput(view), viewId };
        const content = structuredClone(view.content);
        content.summary = "Retained human proposal; approval remains unknown.";
        return (
            await store.saveViewDraft({
                corpusId,
                viewId,
                expectedHead: snapshot.head,
                expectedVersion: latest?.version ?? 0,
                definition,
                content,
                relationships: authoredRelationships(view),
            })
        ).version;
    }

    async function rebuild() {
        await service.initialize();
        for (let attempt = 0; attempt < 10; attempt++)
            try {
                return await service.maintainViews({
                    corpusId,
                    family: "wiki",
                    operation: "rebuild",
                    expectedHead: (
                        await service["viewStore"].listViews(corpusId)
                    ).head,
                });
            } catch (error) {
                if (!(error instanceof ViewBuildStaleError) || attempt === 9)
                    throw error;
            }
        throw new Error("Optimistic entry retries exhausted");
    }

    beforeEach(async () => {
        allowSources = true;
        root = path.resolve(".wiki-planning-unit-owned", randomUUID());
        await mkdir(root, { recursive: true });
        service = open();
        corpusId = (await service.createCorpus("Planning recovery")).corpusId;
        const ingestion = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "original",
                sourceType: "text",
                title: "Original",
                text: "Acquisition requires independent approval; owner approval is unknown.",
            },
        });
        expect(
            (
                await waitForMemoryJob(service, ingestion.jobId, {
                    pollIntervalMs: 10,
                })
            ).state,
        ).toBe("complete");
        const source = (await service.getSource(corpusId, "original"))!;
        await waitBuild(
            await service.buildViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                publication: false,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "selected",
                            kind: "wiki",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: "original",
                                        revisionId: source.activeRevisionId!,
                                    },
                                ],
                            },
                            wiki: {
                                construction: "informational-wiki-v1",
                                query: "acquisition",
                                aliases: [],
                                excludedSourceIds: [],
                            },
                        },
                    },
                ],
            }),
        );
        draft = (await service.listViews(corpusId)).views[0];
        const family = await service["viewStore"].getWikiFamily(corpusId);
        family.descriptors = [
            {
                viewId: draft.viewId,
                query: "acquisition",
                sourceIds: ["original"],
            },
        ];
        family.dirty = true;
        family.cursor = 0;
        await service["viewStore"].saveWikiFamily(corpusId, family);
    });

    afterEach(async () => {
        allowSources = true;
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    test("unrelated page and descriptor writes do not invalidate prepared work or erase pending work", async () => {
        const input = draft.generation!.input!;
        await waitBuild(
            await service.buildViews({
                corpusId,
                publication: false,
                expectedHead: (await service["viewStore"].listViews(corpusId))
                    .head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            ...input.definition,
                            viewId: "unrelated",
                            wiki: {
                                ...input.definition.wiki!,
                                query: "independent approval",
                            },
                        },
                    },
                ],
            }),
        );
        const prepare = service["prepareWikiTargets"].bind(service);
        let unrelated = (await service["viewStore"].getView({
            corpusId,
            viewId: "unrelated",
        }))!;
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            const planningFamily = args[1] as WikiFamilyState;
            planningFamily.descriptors = planningFamily.descriptors.filter(
                (descriptor) => descriptor.viewId === "selected",
            );
            const prepared = await prepare(...args);
            unrelated = await editDirect(unrelated);
            unrelated = await editDirect(unrelated);
            const store: TypedViewStore = service["viewStore"];
            await store.saveViewDraft({
                corpusId,
                viewId: "new-unrelated",
                expectedVersion: 0,
                expectedHead: (await store.listViews(corpusId)).head,
                definition: {
                    viewId: "new-unrelated",
                    kind: "timeline",
                    selector: { kind: "sources", sources: [] },
                },
                content: {
                    kind: "timeline",
                    title: "Independent timeline",
                    generatedAt: new Date().toISOString(),
                    sections: [],
                    citations: [],
                },
                relationships: [],
            });
            const family = await store.getWikiFamily(corpusId);
            family.descriptors.push({
                viewId: "unrelated",
                query: "unrelated topic",
                sourceIds: ["original"],
            });
            await store.saveWikiFamily(corpusId, family);
            return prepared;
        };
        const result = await rebuild();
        expect(result.job).toBeDefined();
        await waitBuild(result.job!);
        const family = await service["viewStore"].getWikiFamily(corpusId);
        expect(family.planningConflict).toBeUndefined();
        expect(family.dirty).toBe(true);
        expect(
            family.descriptors.some(
                (descriptor: { viewId: string }) =>
                    descriptor.viewId === "unrelated",
            ),
        ).toBe(true);
        expect(
            (
                await service.getView({
                    corpusId,
                    viewId: "unrelated",
                    revisionId: unrelated.revisionId,
                    includeContext: false,
                })
            )?.content,
        ).toEqual(unrelated.content);
    });

    test.each(["target", "family", "source", "authorization"] as const)(
        "%s dependency conflicts defer without overwriting drafts or advancing work",
        async (dependency) => {
            const prepare = service["prepareWikiTargets"].bind(service);
            service["prepareWikiTargets"] = async (
                ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
            ) => {
                const prepared = await prepare(...args);
                if (dependency === "target") draft = await editDirect(draft);
                if (dependency === "family") {
                    const store: TypedViewStore = service["viewStore"];
                    const family = await store.getWikiFamily(corpusId);
                    family.descriptors[0].query = "changed acquisition";
                    await store.saveWikiFamily(corpusId, family);
                }
                if (dependency === "source") {
                    const runtime = await service["getCorpusRuntime"](corpusId);
                    runtime.manifest.sources[0].activeRevisionId = "replaced";
                }
                if (dependency === "authorization") allowSources = false;
                return prepared;
            };
            const result = await rebuild();
            allowSources = true;
            expect(result.job).toBeUndefined();
            expect(
                result.plan.targets.some((target) =>
                    target.reason.includes("next maintenance wave"),
                ),
            ).toBe(true);
            const family = await service["viewStore"].getWikiFamily(corpusId);
            expect(family.dirty).toBe(true);
            expect(family.cursor).toBe(0);
            expect(family.candidateReadCursor).toBeUndefined();
            expect(family.planningConflict?.attempts).toBe(1);
            expect(family.error).toBeUndefined();
            expect(service["maintenance"].status().settled).toBe(false);
            expect(service["maintenance"].status().failures).toEqual([]);
            expect(
                (
                    await service["viewStore"].getView({
                        corpusId,
                        viewId: draft.viewId,
                    })
                )?.revisionId,
            ).toBe(draft.revisionId);
        },
    );

    test("the final admission guard rejects a target edit after the first check", async () => {
        const store = service["viewStore"];
        const saveFamily = store.saveWikiFamily.bind(store);
        let writes = 0;
        store.saveWikiFamily = async (
            ...args: Parameters<TypedViewStore["saveWikiFamily"]>
        ) => {
            await saveFamily(...args);
            if (++writes === 2) draft = await editDirect(draft);
        };
        const result = await rebuild();
        expect(result.job).toBeUndefined();
        expect(
            (
                await store.getView({
                    corpusId,
                    viewId: draft.viewId,
                })
            )?.revisionId,
        ).toBe(draft.revisionId);
        expect((await store.getWikiFamily(corpusId)).dirty).toBe(true);
    });

    test("early stale preparation is deferred, but technical failures remain failures", async () => {
        service["prepareWikiTargets"] = async () => {
            throw new ViewBuildStaleError("Selected source was replaced");
        };
        expect((await rebuild()).job).toBeUndefined();
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict?.attempts,
        ).toBe(1);
        service["prepareWikiTargets"] = async () => {
            throw new Error("Injected preparation failure");
        };
        await expect(rebuild()).rejects.toThrow("Injected preparation failure");
    });

    test("the next reconciliation wave replans once and clears a recovered conflict", async () => {
        const prepare = service["prepareWikiTargets"].bind(service);
        let calls = 0;
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            if (args[6] === "wiki" && ++calls === 1)
                throw new ViewBuildStaleError("Preparation context changed");
            return prepare(...args);
        };
        await rebuild();
        const scheduler: MaintenanceScheduler = service["maintenance"];
        expect(calls).toBe(1);
        expect(scheduler.status().deferred).toHaveLength(1);
        const runtime = await service["getCorpusRuntime"](corpusId);
        await service["reconcileInformationalFamily"](
            corpusId,
            "wiki",
            runtime.manifest.indexGeneration,
            (await service["viewStore"].listViews(corpusId)).views,
        );
        expect(scheduler.status().deferred).toEqual([]);
        await service.drainMaintenance(10_000);
        expect(calls).toBe(2);
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict,
        ).toBeUndefined();
    });

    test("conflicts survive restart, cap repeated attempts, and reset only the planning failure", async () => {
        const store = service["viewStore"];
        const captured = await store.getWikiFamily(corpusId);
        captured.indexVersion = (
            await service["getCorpusRuntime"](corpusId)
        ).manifest.indexGeneration;
        captured.cursor = 7;
        captured.candidateReadCursor = {
            generation: "retained",
            policy: "retained",
            visitedViewIds: ["already-processed"],
        };
        await store.saveWikiFamily(corpusId, captured);
        const defer = () =>
            service["deferWikiPlanning"](
                corpusId,
                "wiki",
                captured,
                captured,
                { corpusId, expectedHead: null, targets: [] },
                performance.now(),
            );
        await defer();
        await service.close();
        service = open();
        await service.initialize();
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict?.attempts,
        ).toBe(1);
        await defer();
        await defer();
        const exhausted = await service["viewStore"].getWikiFamily(corpusId);
        expect(exhausted.planningConflict?.attempts).toBe(3);
        expect(exhausted.error).toContain("explicit maintenance");
        expect(exhausted.cursor).toBe(7);
        expect(exhausted.candidateReadCursor).toEqual(
            captured.candidateReadCursor,
        );
        await service.close();
        service = open();
        await service.initialize();
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict?.attempts,
        ).toBe(3);
        expect(service.getMaintenanceStatus().settled).toBe(false);
        const scheduler: MaintenanceScheduler = service["maintenance"];
        scheduler.reportFailure(
            corpusId,
            "wiki",
            "other-target",
            "Unrelated failure",
        );
        expect(
            scheduler
                .status()
                .failures.some((failure) =>
                    failure.key.endsWith(":planning-conflict"),
                ),
        ).toBe(true);
        const result = await rebuild();
        if (result.job) await waitBuild(result.job);
        const recovered = await service["viewStore"].getWikiFamily(corpusId);
        expect(recovered.planningConflict).toBeUndefined();
        expect(scheduler.status().failures).toEqual([
            {
                key: `${corpusId}:wiki:other-target`,
                error: "Unrelated failure",
            },
        ]);
    });
});

test("deferred resumption is idempotent and cannot clear a different park or target failure", () => {
    const scheduler = new MaintenanceScheduler(() => false, "manual");
    scheduler.request("corpus", "wiki", "generation", async () => {});
    scheduler.reportFailure("corpus", "wiki", "target", "Keep this failure");
    scheduler.park("corpus", "wiki", "Pass budget exhausted");
    scheduler.resumeDeferred("corpus", "wiki", "Planning conflict");
    expect(scheduler.status().deferred).toEqual([
        { key: "corpus:wiki", reason: "Pass budget exhausted" },
    ]);
    scheduler.park("corpus", "wiki", "Planning conflict");
    scheduler.resumeDeferred("corpus", "wiki", "Planning conflict");
    scheduler.resumeDeferred("corpus", "wiki", "Planning conflict");
    expect(scheduler.status().deferred).toEqual([]);
    expect(scheduler.status().failures).toEqual([
        { key: "corpus:wiki:target", error: "Keep this failure" },
    ]);
});
