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
import { ViewBuildStaleError } from "../src/viewBuilds.js";
import type { TypedViewStore, WikiFamilyState } from "../src/viewStore.js";
import type { ViewSeparationReceipt } from "../src/viewSeparation.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";
import type { IndexedFragmentRequest } from "../src/types.js";
import type {
    ViewBuildJob,
    ViewVersion,
    ViewMaintenanceResult,
} from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { controlledInformationalSupport } from "./informationalSupportTestModel.js";

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
    let allowSources: boolean;
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
                validate: async (_input, output) =>
                    controlledInformationalSupport(output),
            },
        });

    async function waitBuild(job: ViewBuildJob) {
        for (
            let attempt = 0;
            job.state === "running" && attempt < 300;
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({ corpusId, jobId: job.jobId }))!;
        }
        expect(job.state).toBe("complete");
    }

    async function editDirect(view: ViewVersion, viewId = view.viewId) {
        const store: TypedViewStore = service["viewStore"];
        const snapshot = await store.listViews(corpusId);
        const latest = snapshot.views.find((entry) => entry.viewId === viewId);
        const content = structuredClone(view.content);
        content.summary = `Retained human proposal ${randomUUID()}; approval remains unknown.`;
        return (
            await store.saveViewDraft({
                corpusId,
                viewId,
                expectedHead: snapshot.head,
                expectedVersion: latest?.version ?? 0,
                definition: { ...derivedDefinitionInput(view), viewId },
                content,
                relationships: authoredRelationships(view),
            })
        ).version;
    }

    async function maintain(automatic = false): Promise<ViewMaintenanceResult> {
        const runtime = await service["getCorpusRuntime"](corpusId);
        return service["enqueueWrite"](corpusId, async () =>
            service["maintainWikiFamily"](
                runtime,
                {
                    corpusId,
                    family: "wiki",
                    operation: "rebuild",
                    expectedHead: (
                        await service["viewStore"].listViews(corpusId)
                    ).head,
                },
                automatic,
            ),
        );
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

    test("unrelated page additions, revisions and descriptor writes preserve useful work", async () => {
        let unrelated = await editDirect(draft, "unrelated");
        const prepare = service["prepareWikiTargets"].bind(service);
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            const planningFamily = args[1] as WikiFamilyState;
            planningFamily.descriptors = planningFamily.descriptors.filter(
                (entry) => entry.viewId === "selected",
            );
            const prepared = await prepare(...args);
            expect(args[5]).toMatchObject({ targets: [{ state: "rebuild" }] });
            unrelated = await editDirect(unrelated);
            await editDirect(draft, "new-unrelated");
            const family: WikiFamilyState =
                await service["viewStore"].getWikiFamily(corpusId);
            family.descriptors.push({
                viewId: "unrelated",
                query: "separate topic",
                sourceIds: ["original"],
            });
            family.cursor = 7;
            family.reviewCursor = "unrelated-review";
            await service["viewStore"].saveWikiFamily(corpusId, family);
            return prepared;
        };
        const result = await maintain();
        expect(result.job).toBeDefined();
        await waitBuild(result.job!);
        const family: WikiFamilyState =
            await service["viewStore"].getWikiFamily(corpusId);
        expect(family.planningConflict).toBeUndefined();
        expect(family.dirty).toBe(true);
        expect(family.cursor).toBe(7);
        expect(family.reviewCursor).toBe("unrelated-review");
        expect(
            family.descriptors.some((entry) => entry.viewId === "unrelated"),
        ).toBe(true);
        expect(
            (
                await service["viewStore"].getView({
                    corpusId,
                    viewId: "unrelated",
                })
            )?.revisionId,
        ).toBe(unrelated.revisionId);
    });

    test.each([
        "target",
        "descriptor",
        "source",
        "authorization",
        "removal",
    ] as const)(
        "%s dependency changes defer without overwriting pages or advancing discovery",
        async (dependency) => {
            const prepare = service["prepareWikiTargets"].bind(service);
            service["prepareWikiTargets"] = async (
                ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
            ) => {
                const prepared = await prepare(...args);
                if (dependency === "target") draft = await editDirect(draft);
                if (dependency === "descriptor" || dependency === "removal") {
                    const family =
                        await service["viewStore"].getWikiFamily(corpusId);
                    if (dependency === "descriptor")
                        family.descriptors[0].query = "changed acquisition";
                    else family.descriptors = [];
                    await service["viewStore"].saveWikiFamily(corpusId, family);
                }
                if (dependency === "source") {
                    const runtime = await service["getCorpusRuntime"](corpusId);
                    const manifest = structuredClone(runtime.manifest);
                    manifest.sources[0].activeRevisionId = "replaced";
                    runtime.manifest = manifest;
                }
                if (dependency === "authorization") allowSources = false;
                return prepared;
            };
            const result = await maintain();
            allowSources = true;
            expect(result.job).toBeUndefined();
            expect(
                result.plan.targets.some((target) =>
                    target.reason.includes("next maintenance wave"),
                ),
            ).toBe(true);
            const family: WikiFamilyState =
                await service["viewStore"].getWikiFamily(corpusId);
            expect(family.dirty).toBe(true);
            expect(family.cursor).toBe(0);
            expect(family.candidateReadCursor).toBeUndefined();
            expect(family.planningConflict?.attempts).toBe(1);
            expect(family.error).toBeUndefined();
            expect(service.getMaintenanceStatus().settled).toBe(false);
            expect(
                (
                    await service["viewStore"].getView({
                        corpusId,
                        viewId: draft.viewId,
                    })
                )?.revisionId,
            ).toBe(draft.revisionId);
            if (dependency === "removal")
                expect(
                    family.descriptors.some(
                        (entry) => entry.viewId === "selected",
                    ),
                ).toBe(false);
        },
    );

    test("new candidates survive early stale preparation, while technical failures still fail", async () => {
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            (args[1] as WikiFamilyState).descriptors.push({
                viewId: "fresh-candidate",
                query: "new evidence topic",
                sourceIds: ["original"],
            });
            throw new ViewBuildStaleError("Source replaced");
        };
        expect((await maintain()).job).toBeUndefined();
        const family: WikiFamilyState =
            await service["viewStore"].getWikiFamily(corpusId);
        expect(
            family.descriptors.some(
                (entry) => entry.viewId === "fresh-candidate",
            ),
        ).toBe(true);
        expect(family.planningConflict?.attempts).toBe(1);
        service["prepareWikiTargets"] = async () => {
            throw new Error("Injected technical failure");
        };
        await expect(maintain()).rejects.toThrow("Injected technical failure");
    });

    test("the final admission check catches edits after saving discovered identities", async () => {
        const store: TypedViewStore = service["viewStore"];
        const save = store.saveWikiFamily.bind(store);
        let writes = 0;
        store.saveWikiFamily = async (
            ...args: Parameters<TypedViewStore["saveWikiFamily"]>
        ) => {
            await save(...args);
            if (++writes === 2) draft = await editDirect(draft);
        };
        expect((await maintain()).job).toBeUndefined();
        expect(
            (await store.getView({ corpusId, viewId: draft.viewId }))
                ?.revisionId,
        ).toBe(draft.revisionId);
        expect((await store.getWikiFamily(corpusId)).dirty).toBe(true);
    });

    test.each(["mutation", "archive", "relationship"] as const)(
        "consulted coverage witness %s defers even when no build is selected",
        async (change) => {
            let witness = await editDirect(draft, "coverage-witness");
            service["wikiAdmissionViews"] = async () => [witness];
            let separations: ViewSeparationReceipt[] = [];
            service["viewStore"].listViewSeparations = async () => separations;
            const prepare = service["prepareWikiTargets"].bind(service);
            service["prepareWikiTargets"] = async (
                ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
            ) => {
                const prepared = await prepare(...args);
                await service["retainedScopedWikiAssessment"](
                    prepared.snapshots[0],
                    {
                        viewId: "selected",
                        query: "acquisition",
                        sourceIds: ["original"],
                        admission: {
                            generation: undefined,
                            policy: "fixture",
                            reason: "retained",
                            assessmentKey: "fixture",
                        },
                    },
                    args[8],
                );
                if (change === "mutation") witness = await editDirect(witness);
                if (change === "archive") {
                    const store: TypedViewStore = service["viewStore"];
                    witness = (
                        await store.archiveView({
                            corpusId,
                            viewId: witness.viewId,
                            expectedHead: (await store.listViews(corpusId))
                                .head!,
                            expectedVersion: witness.version,
                        })
                    ).version;
                }
                if (change === "relationship")
                    separations = [
                        {
                            receiptId: "separation",
                            corpusId,
                            viewId: witness.viewId,
                            acceptedRevisionId: witness.revisionId,
                            acceptedVersion: witness.version,
                            contentHash: "fixture",
                            definitionHash: "fixture",
                            assessmentHash: "fixture",
                            confirmationToken: "fixture",
                            reason: "Review page scope",
                            overview: {
                                title: witness.content.title,
                                retainedSectionIds: [],
                                retainedHumanUnits: [],
                            },
                            destinations: [],
                            unresolved: [],
                            state: "proposed",
                            reasonForState: "Awaiting confirmation",
                            createdAt: new Date().toISOString(),
                            input: draft.generation!.input!,
                            privacySourceIds: ["original"],
                        },
                    ];
                return { targets: [], snapshots: [] };
            };
            expect((await maintain()).job).toBeUndefined();
            expect(
                (await service["viewStore"].getWikiFamily(corpusId))
                    .planningConflict?.attempts,
            ).toBe(1);
        },
    );

    test("one reconciliation wave retries once, and successful planning clears only its own failure", async () => {
        const prepare = service["prepareWikiTargets"].bind(service);
        let calls = 0;
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            if (args[6] === "wiki" && ++calls === 1)
                throw new ViewBuildStaleError("Context changed");
            return prepare(...args);
        };
        await maintain();
        expect(calls).toBe(1);
        expect(service.getMaintenanceStatus().deferred).toHaveLength(1);
        const runtime = await service["getCorpusRuntime"](corpusId);
        await service["reconcileInformationalFamily"](
            corpusId,
            "wiki",
            runtime.manifest.indexGeneration,
            (await service["viewStore"].listViews(corpusId)).views,
        );
        expect(service.getMaintenanceStatus().deferred).toEqual([]);
        await service.drainMaintenance(10_000);
        expect(calls).toBe(2);
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict,
        ).toBeUndefined();
    });

    test("restart retains conflicts, bounds repeated automatic attempts and permits explicit recovery", async () => {
        const captured = await service["viewStore"].getWikiFamily(corpusId);
        captured.indexVersion = (
            await service["getCorpusRuntime"](corpusId)
        ).manifest.indexGeneration;
        captured.cursor = 7;
        captured.candidateReadCursor = {
            generation: "retained",
            policy: "retained",
            visitedViewIds: ["done"],
        };
        await service["viewStore"].saveWikiFamily(corpusId, captured);
        const defer = () =>
            service["deferWikiPlanning"](corpusId, "wiki", captured, captured, {
                corpusId,
                expectedHead: null,
                targets: [],
            });
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
        const prepare = service["prepareWikiTargets"].bind(service);
        let automaticCalls = 0;
        service["prepareWikiTargets"] = async (
            ...args: Parameters<FileMemoryService["prepareWikiTargets"]>
        ) => {
            if (args[6] === "wiki") automaticCalls++;
            return prepare(...args);
        };
        await service.drainMaintenance(1000);
        expect(automaticCalls).toBe(0);
        service["maintenance"].reportFailure(
            corpusId,
            "wiki",
            "other-target",
            "Unrelated failure",
        );
        const result = await service.maintainViews({
            corpusId,
            family: "wiki",
            operation: "rebuild",
            expectedHead: (await service["viewStore"].listViews(corpusId)).head,
        });
        if (result.job) await waitBuild(result.job);
        expect(
            (await service["viewStore"].getWikiFamily(corpusId))
                .planningConflict,
        ).toBeUndefined();
        expect(service.getMaintenanceStatus().failures).toEqual([
            {
                key: `${corpusId}:wiki:other-target`,
                error: "Unrelated failure",
            },
        ]);
    });

    test("a changed source-index generation resets an exhausted conflict without erasing other failures", async () => {
        const store: TypedViewStore = service["viewStore"];
        const family = await store.getWikiFamily(corpusId);
        family.planningConflict = {
            attempts: 3,
            generation: "old-generation",
            reason: "Planning conflict",
        };
        family.error = "Planning conflict";
        await store.saveWikiFamily(corpusId, family);
        service["maintenance"].reportFailure(
            corpusId,
            "wiki",
            "planning-conflict",
            "Planning conflict",
        );
        service["maintenance"].reportFailure(
            corpusId,
            "wiki",
            "other",
            "Keep this failure",
        );
        const runtime = await service["getCorpusRuntime"](corpusId);
        await service["reconcileInformationalFamily"](
            corpusId,
            "wiki",
            runtime.manifest.indexGeneration,
            (await store.listViews(corpusId)).views,
        );
        expect(
            (await store.getWikiFamily(corpusId)).planningConflict,
        ).toBeUndefined();
        expect(service.getMaintenanceStatus().failures).toEqual([
            {
                key: `${corpusId}:wiki:other`,
                error: "Keep this failure",
            },
        ]);
    });
});

test("deferred resumption cannot clear a different park or target failure", () => {
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
