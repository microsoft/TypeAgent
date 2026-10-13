// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { hydrateProjectSummary } from "../src/informationalProject.js";
import {
    indexedLocator,
    parseIndexedLocator,
    selectIndexedFragments,
} from "../src/indexedFragments.js";
import { validateViewDraft } from "../src/viewValidation.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import type { IndexedFragmentRequest, IndexedSubject } from "../src/types.js";
import type {
    ViewBuildJob,
    ViewBuildRequest,
    ViewSynthesisAdapter,
} from "../src/viewTypes.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { wikiIndex } from "../src/viewContent.js";
import { reserveSerializedRequest, type ChatModel } from "@typeagent/aiclient";
import { TypedViewStore } from "../src/viewStore.js";
import { ViewBuildStaleError } from "../src/viewBuilds.js";

async function waitForViewBuild(
    service: FileMemoryService,
    admitted: ViewBuildJob,
): Promise<ViewBuildJob> {
    let job = admitted;
    for (let attempt = 0; job.state === "running" && attempt < 300; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Build receipt disappeared");
        job = current;
    }
    if (job.state === "running") throw new Error("Mock wiki build timed out");
    return job;
}

class MockIndexedCorpus extends FakeSemanticCorpusIndex {
    public static subjects = ["acquisition"];
    public static initiatives: string[] = [];
    public static subjectDetails: Record<string, Partial<IndexedSubject>> = {};
    public static languageSearches = 0;
    public override async search(
        query: string,
        limit: number,
        tags?: string[],
    ) {
        MockIndexedCorpus.languageSearches++;
        return super.search(query, limit, tags);
    }
    public async listSubjects(offset = 0, limit = 48) {
        const next = offset + limit;
        return {
            total: MockIndexedCorpus.subjects.length,
            items: MockIndexedCorpus.subjects
                .slice(offset, next)
                .map((term) => ({
                    term,
                    initiative: MockIndexedCorpus.initiatives.includes(term),
                    postingCount: this.documents.length,
                    sourceIds: this.documents.map(
                        (document) => document.source.sourceId,
                    ),
                    ...MockIndexedCorpus.subjectDetails[term],
                })),
            ...(next < MockIndexedCorpus.subjects.length
                ? { nextContinuationToken: String(next) }
                : {}),
        };
    }
    public async readFragments(request: IndexedFragmentRequest) {
        const terms = request.terms
            .flatMap(
                (term) =>
                    term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [],
            )
            .filter((term) => term.length > 2);
        return selectIndexedFragments(
            this.documents
                .filter((document) =>
                    terms.some((term) =>
                        document.content.toLocaleLowerCase().includes(term),
                    ),
                )
                .map((document) => ({
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
            !document ||
            locator !==
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
                )
        )
            throw new Error("Indexed-text anchor unavailable");
        return document.content.slice(range.start, range.end);
    }
}

describe("informational wiki lifecycle (mock extraction and synthesis)", () => {
    let root: string;
    let service: FileMemoryService;
    let generated = 0;
    let failNext = false;
    let beforeGeneration: (() => Promise<void>) | undefined;
    let indexedAnswerModel: ChatModel | undefined;
    let rehearsalBudget = true;
    const adapter: ViewSynthesisAdapter = {
        identity: "mock-informational",
        inventory: async () => {
            throw new Error("Legacy inventory must not run");
        },
        checkInventory: async () => {
            throw new Error("Legacy audit must not run");
        },
        generate: async (input) => {
            generated++;
            if (failNext) {
                failNext = false;
                throw new Error("Injected synthesis failure");
            }
            await beforeGeneration?.();
            if (input.pipeline === "informational-project-summary-v1") {
                return hydrateProjectSummary(input, {
                    title:
                        input.definition.projectSummary?.query ??
                        "Indexed project",
                    goalsScope: input.inputs
                        .map((source) => source.content)
                        .join("\n\n"),
                    owners: "Owner unknown",
                    status: "Project active, incident unknown, capacity review pending",
                    milestones: "Milestone unknown",
                    decisions: "Review pending",
                    risks: "Remaining qualification",
                    context: "Bounded indexed context",
                    limits: "Only selected evidence",
                    projectState: "active",
                    incidentState: "unknown",
                    capacityState: "pendingOwnerReview",
                    citationIds: input.inputs
                        .flatMap((source) => source.passages ?? [])
                        .map((_, i) => `f${i}`),
                });
            }
            return hydrateInformational(input, {
                title: "Acquisition",
                prose: input.inputs
                    .map((source) => source.content)
                    .join("\n\n"),
                limits: "Only selected indexed evidence; owner approval unknown",
                citationIds: input.inputs
                    .flatMap((source) => source.passages ?? [])
                    .map((_, i) => `f${i}`),
            });
        },
        validate: async () => {
            throw new Error("Legacy support audit must not run");
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            ...(indexedAnswerModel ? { indexedAnswerModel } : {}),
            viewSynthesisAdapter: adapter,
            indexFactory: (_corpusId, directory) =>
                new MockIndexedCorpus(directory),
            ...(rehearsalBudget
                ? {
                      informationalBudget: {
                          contextTokens: 21000,
                          inputTokens: 16000,
                          outputTokens: 4000,
                          safetyTokens: 1000,
                          chatAttempts: 24,
                          reservedTokens: 160000,
                          embeddingAttempts: 128,
                          elapsedMs: 600000,
                          tokenizer: "mock",
                          countTokens: (text) => text.length,
                      },
                  }
                : {}),
        });
    beforeEach(async () => {
        MockIndexedCorpus.subjects = ["acquisition"];
        MockIndexedCorpus.initiatives = [];
        MockIndexedCorpus.subjectDetails = {};
        generated = 0;
        failNext = false;
        beforeGeneration = undefined;
        indexedAnswerModel = undefined;
        rehearsalBudget = true;
        root = path.resolve(".wiki-unit-owned", randomUUID());
        await mkdir(root, { recursive: true });
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function update(
        corpusId: string,
        operation: "update" | "pause" | "resume" = "update",
    ) {
        const maintain = async () => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const snapshot = await service.listViews(corpusId);
                try {
                    return await service.maintainViews({
                        corpusId,
                        expectedHead: snapshot.head,
                        family: "wiki",
                        operation,
                    });
                } catch (error) {
                    if (
                        !(error instanceof ViewBuildStaleError) ||
                        attempt === 9
                    )
                        throw error;
                }
            }
            throw new Error("Mock family optimistic head retries exhausted");
        };
        const result = await maintain();
        if (result.job) {
            const job = await waitForViewBuild(service, result.job);
            expect(job.state).toBe("complete");
        }
        if (operation === "pause") await projects(corpusId, "pause");
        return result;
    }
    async function add(corpusId: string, sourceId: string, text: string) {
        const receipt = await service.ingestDocument({
            corpusId,
            source: { sourceId, sourceType: "text", title: sourceId, text },
        });
        expect((await waitForMemoryJob(service, receipt.jobId)).state).toBe(
            "complete",
        );
    }

    async function admitFreshBuild(request: ViewBuildRequest) {
        for (let attempt = 0; attempt < 10; attempt++) {
            request.expectedHead = (
                await service.listViews(request.corpusId)
            ).head;
            try {
                return await service.buildViews(request);
            } catch (error) {
                const stale =
                    error instanceof ViewBuildStaleError ||
                    (error instanceof Error &&
                        error.message ===
                            "View history head conflict at build admission");
                if (!stale || attempt === 9) throw error;
            }
        }
        throw new Error("Mock build optimistic head retries exhausted");
    }

    async function projects(
        corpusId: string,
        operation: "update" | "pause" | "resume" | "rebuild" = "update",
    ) {
        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                const result = await service.maintainViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    family: "projects",
                    operation,
                });
                if (result.job) await waitForViewBuild(service, result.job);
                return result;
            } catch (error) {
                if (!(error instanceof ViewBuildStaleError) || attempt === 9)
                    throw error;
            }
        }
        throw new Error("Mock Projects head retries exhausted");
    }

    test("automatic projects admit distinct initiatives, new uncited correction and zero-synthesis no-op", async () => {
        rehearsalBudget = false;
        await service.close();
        service = open();
        const { corpusId } = await service.createCorpus(
            "Automatic initiatives",
        );
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects = [
            "Atlas rollout",
            "Beacon migration",
            "shared gateway",
        ];
        MockIndexedCorpus.initiatives = ["Atlas rollout", "Beacon migration"];
        await add(
            corpusId,
            "mixed",
            "Atlas rollout goals: reduce latency; owner unknown.\n\nBeacon migration scope: token checks; capacity unknown.\n\nShared gateway service mention.",
        );
        await projects(corpusId, "resume");
        await projects(corpusId, "pause");
        const first = (await service.listViews(corpusId)).views;
        expect(first).toHaveLength(2);
        expect(
            first.map((view) => view.definition.projectSummary?.query).sort(),
        ).toEqual(["atlas rollout", "beacon migration"]);
        expect(
            first.every((view) =>
                view.content.citations.some(
                    (citation) => citation.sourceId === "mixed",
                ),
            ),
        ).toBe(true);
        const atlas = first.find(
            (view) => view.definition.projectSummary?.query === "atlas rollout",
        )!;
        await add(
            corpusId,
            "correction",
            "Atlas rollout correction: latency success is local only; capacity remains unvalidated.",
        );
        await projects(corpusId, "resume");
        await projects(corpusId, "pause");
        const refreshed = (await service.getView({
            corpusId,
            viewId: atlas.viewId,
        }))!;
        expect(
            refreshed.content.citations.some(
                (citation) => citation.sourceId === "correction",
            ),
        ).toBe(true);
        expect(refreshed.content.sections[0].body).toContain("local only");
        const calls = generated;
        await projects(corpusId, "resume");
        await projects(corpusId);
        expect(generated).toBe(calls);
        expect(
            (await service.listViews(corpusId)).views
                .map((view) => view.viewId)
                .sort(),
        ).toEqual(first.map((view) => view.viewId).sort());
    });

    test("project aliases, exclusions and editorial title survive restart without duplicate nomination", async () => {
        const { corpusId } = await service.createCorpus("Edited initiatives");
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects = ["Atlas rollout"];
        MockIndexedCorpus.initiatives = ["Atlas rollout"];
        await add(
            corpusId,
            "charter",
            "Atlas rollout goals: delivery; owner unknown.",
        );
        await add(
            corpusId,
            "excluded",
            "Atlas rollout correction: excluded synthetic note.",
        );
        await projects(corpusId, "resume");
        await projects(corpusId, "pause");
        const view = (await service.listViews(corpusId)).views[0];
        const content = structuredClone(view.content);
        content.title = "Editorial initiative title";
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "projectBrief",
                selector: view.definition.selector,
                projectSummary: {
                    construction: "informational-project-summary-v1",
                    query: "Atlas delivery",
                    aliases: ["Atlas_rollout"],
                    excludedSourceIds: ["excluded"],
                },
            },
            content,
            relationships: authoredRelationships(view),
        });
        await service.close();
        service = open();
        expect((await service.listViews(corpusId)).projectFamily?.enabled).toBe(
            false,
        );
        await projects(corpusId, "resume");
        await projects(corpusId, "pause");
        const after = (await service.listViews(corpusId)).views;
        expect(after).toHaveLength(1);
        expect(after[0].viewId).toBe(view.viewId);
        expect(after[0].content.title).toBe("Editorial initiative title");
        expect(
            after[0].content.citations.some(
                (citation) => citation.sourceId === "excluded",
            ),
        ).toBe(false);
        expect(after[0].definition.projectSummary?.aliases).toEqual([
            "Atlas_rollout",
        ]);
        expect(after[0].edits?.length).toBeGreaterThan(0);
    });

    test("projects discover beyond one page and retrieve from beyond 32 collection sources", async () => {
        const { corpusId } = await service.createCorpus(
            "Fair project coverage",
        );
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects = [
            ...Array.from({ length: 49 }, (_, i) => `service ${i}`),
            "Distant migration",
        ];
        MockIndexedCorpus.initiatives = ["Distant migration"];
        for (let i = 0; i < 33; i++)
            await add(
                corpusId,
                `source-${i}`,
                i === 32
                    ? "Distant migration goals: preserve correctness."
                    : "Unrelated service reference.",
            );
        await projects(corpusId, "resume");
        for (
            let attempt = 0;
            (await service.listViews(corpusId)).projectFamily?.pending &&
            attempt < 10;
            attempt++
        )
            await projects(corpusId);
        await projects(corpusId, "pause");
        const views = (await service.listViews(corpusId)).views;
        expect(views).toHaveLength(1);
        expect(views[0].definition.projectSummary?.query).toBe(
            "distant migration",
        );
        expect(
            views[0].content.citations.some(
                (citation) => citation.sourceId === "source-32",
            ),
        ).toBe(true);
    }, 60000);

    test("project failure is durable across restart, explicit retry reuses identity, and new initiatives/removal reconcile", async () => {
        const { corpusId } = await service.createCorpus("Project recovery");
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects = ["Atlas rollout"];
        MockIndexedCorpus.initiatives = ["Atlas rollout"];
        await add(corpusId, "charter", "Atlas rollout goals: reduce latency.");
        failNext = true;
        const failedReceipt = await projects(corpusId, "resume");
        const failed = (await service.getViewBuild({
            corpusId,
            jobId: failedReceipt.job!.jobId,
        }))!;
        expect(failed.state).toBe("failed");
        expect(
            (await service.listViews(corpusId)).projectFamily?.error,
        ).toContain("did not complete");
        const calls = generated;
        await service.close();
        service = open();
        await service.initialize();
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(generated).toBe(calls);
        const recovered = await projects(corpusId);
        expect(recovered.job?.results[0].viewId).toBe(failed.results[0].viewId);
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects.push("Beacon migration");
        MockIndexedCorpus.initiatives.push("Beacon migration");
        await add(
            corpusId,
            "new-charter",
            "Beacon migration scope: token checks.",
        );
        await projects(corpusId, "resume");
        await projects(corpusId, "pause");
        expect((await service.listViews(corpusId)).views).toHaveLength(2);
        const oldId = failed.results[0].viewId;
        const preview = await service.previewForgetSource(corpusId, "charter");
        await service.forgetSource({
            corpusId,
            sourceId: "charter",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: oldId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: oldId }),
        ).toEqual([]);
        expect(
            (await service.listViews(corpusId)).views.every((view) =>
                view.content.citations.every(
                    (citation) => citation.sourceId !== "charter",
                ),
            ),
        ).toBe(true);
    });

    test("replacement during project synthesis coalesces into an automatic current-revision refresh", async () => {
        const { corpusId } = await service.createCorpus(
            "Coalesced project changes",
        );
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        MockIndexedCorpus.subjects = ["Atlas rollout"];
        MockIndexedCorpus.initiatives = ["Atlas rollout"];
        await add(
            corpusId,
            "charter",
            "Atlas rollout goals: bounded delivery.",
        );
        let entered!: () => void;
        let release!: () => void;
        const generating = new Promise<void>((resolve) => (entered = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        beforeGeneration = async () => {
            entered();
            await gate;
        };
        const admitted = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "projects",
            operation: "resume",
        });
        await generating;
        try {
            await add(
                corpusId,
                "charter",
                "Atlas rollout goals: bounded delivery. Correction: success is local only.",
            );
        } finally {
            release();
        }
        await waitForViewBuild(service, admitted.job!);
        for (
            let attempt = 0;
            (await service.listViews(corpusId)).views.length === 0 &&
            attempt < 200;
            attempt++
        )
            await new Promise((resolve) => setTimeout(resolve, 20));
        await projects(corpusId, "pause");
        const current = (await service.listViews(corpusId)).views[0];
        expect(current).toBeDefined();
        expect(current.viewId).toBe(admitted.job!.results[0].viewId);
        expect(current.content.sections[0].body).toContain("local only");
        expect(
            (await service.listViews(corpusId)).projectFamily?.error,
        ).toBeUndefined();
    });

    test.each(["wiki", "projects"] as const)(
        "repeated %s builds reuse the versioned-model receipt before and after completion",
        async (family) => {
            const corpusId = (
                await service.createCorpus("Idempotent model identity")
            ).corpusId;
            await update(corpusId, "pause");
            await projects(corpusId, "pause");
            await add(
                corpusId,
                "source",
                "Acquisition rollout goals: retain conditional ownership and review scope. The acquisition concept names a scoped admission mechanism.",
            );
            const source = (await service.listSources(corpusId))[0];
            const request: ViewBuildRequest = {
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "idempotent-page",
                            kind: family === "wiki" ? "wiki" : "projectBrief",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: source.sourceId,
                                        revisionId: source.activeRevisionId,
                                    },
                                ],
                            },
                            ...(family === "wiki"
                                ? {
                                      wiki: {
                                          construction:
                                              "informational-wiki-v1" as const,
                                          query: "acquisition",
                                          aliases: [],
                                          excludedSourceIds: [],
                                      },
                                  }
                                : {
                                      projectSummary: {
                                          construction:
                                              "informational-project-summary-v1" as const,
                                          query: "Acquisition rollout",
                                          aliases: [],
                                          excludedSourceIds: [],
                                      },
                                  }),
                        },
                    },
                ],
            };
            const admitted = await admitFreshBuild(request);
            expect(admitted.results[0].snapshot.model).toBe(
                family === "wiki"
                    ? "mock-informational:wiki-source-contribution-v3"
                    : "mock-informational:project-attribution-v3",
            );
            expect((await service.buildViews(request)).jobId).toBe(
                admitted.jobId,
            );
            expect((await waitForViewBuild(service, admitted)).state).toBe(
                "complete",
            );
            const calls = generated;
            expect((await service.buildViews(request)).jobId).toBe(
                admitted.jobId,
            );
            expect(generated).toBe(calls);
        },
    );

    test("failed candidates wait behind undispatched discovery work without changing identities", async () => {
        const corpusId = (await service.createCorpus("Fair backlog")).corpusId;
        await update(corpusId, "pause");
        MockIndexedCorpus.subjects = Array.from(
            { length: 13 },
            (_, i) => `acquisition candidate ${i}`,
        );
        await add(
            corpusId,
            "source",
            MockIndexedCorpus.subjects
                .map(
                    (subject) =>
                        `${subject} is a distinct acquisition condition and awaits its own review.`,
                )
                .join("\n\n"),
        );
        failNext = true;
        const first = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        const initial = await waitForViewBuild(service, first.job!);
        expect(initial.state).toBe("partial");
        const failed = initial.results.find(
            (result) => result.state === "failed",
        );
        expect(failed).toBeDefined();
        const next = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "update",
        });
        expect(next.job?.request.targets[0].definition.wiki?.query).toBe(
            "acquisition candidate 12",
        );
        expect(next.job?.request.targets[1].definition.viewId).toBe(
            failed?.viewId,
        );
        await waitForViewBuild(service, next.job!);
    });

    test("published informational search uses one current snapshot and indexed postings without per-page language inference", async () => {
        const corpusId = (await service.createCorpus("Published search"))
            .corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "source", "Acquisition remains conditional.");
        const admitted = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        await waitForViewBuild(service, admitted.job!);
        await update(corpusId, "pause");
        const before = MockIndexedCorpus.languageSearches;
        const matches = await service.searchViews({
            corpusId,
            query: "Acquisition",
            freshness: "current",
            kinds: ["wiki"],
        });
        expect(matches).toHaveLength(1);
        expect(matches[0].evidence).toHaveLength(1);
        expect(MockIndexedCorpus.languageSearches).toBe(before);
    });

    test("project-summary API shares bounded retrieval without legacy inventory and ignores irrelevant sources", async () => {
        const corpusId = (await service.createCorpus("Project summary"))
            .corpusId;
        await update(corpusId, "pause");
        await add(
            corpusId,
            "relevant",
            "Acquisition project goals with pending review.",
        );
        await add(corpusId, "irrelevant", "Unrelated gardening notes.");
        const sources = (await service.listSources(corpusId)).map((source) => ({
            sourceId: source.sourceId,
            revisionId: source.activeRevisionId,
        }));
        const obsolete = {
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "obsolete-project",
                        kind: "projectBrief" as const,
                        selector: { kind: "sources" as const, sources },
                    },
                },
            ],
        };
        await expect(service.buildViews(obsolete)).rejects.toThrow(
            "Project construction requires informational-project-summary-v1",
        );
        const unsupported = {
            ...obsolete,
            targets: [
                {
                    ...obsolete.targets[0],
                    definition: {
                        ...obsolete.targets[0].definition,
                        projectSummary: {
                            construction:
                                "informational-project-summary-v1" as const,
                            query: "Acquisition",
                            aliases: [],
                            excludedSourceIds: [],
                        },
                    },
                },
            ],
        };
        Object.assign(unsupported.targets[0].definition.projectSummary, {
            construction: "project-brief-v1",
        });
        await expect(service.buildViews(unsupported)).rejects.toThrow(
            "Invalid informational project-summary selector",
        );
        await update(corpusId, "pause");
        const job = await waitForViewBuild(
            service,
            await service.buildViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "project-summary",
                            kind: "projectBrief",
                            selector: { kind: "sources", sources },
                            projectSummary: {
                                construction:
                                    "informational-project-summary-v1",
                                query: "Acquisition",
                                aliases: [],
                                excludedSourceIds: [],
                            },
                        },
                    },
                ],
            }),
        );
        expect(job.state).toBe("complete");
        const view = (await service.getView({
            corpusId,
            viewId: "project-summary",
        }))!;
        expect(view.content).toMatchObject({
            kind: "projectBrief",
            construction: "informational-project-summary-v1",
        });
        expect(job.results[0].snapshot.pipeline).toBe(
            "informational-project-summary-v1",
        );
        expect(job.results[0].inventory).toBeUndefined();
        expect(job.results[0].coverage).toBeUndefined();
        for (const citation of view.content.citations)
            expect(
                (
                    await service.getSourceContent({
                        corpusId,
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                        indexedLocator: citation.locator,
                    })
                ).content,
            ).toBe(citation.excerpt);
        expect(
            view.content.citations.every(
                (citation) => citation.sourceId === "relevant",
            ),
        ).toBe(true);
        expect(
            view.content.sections.map((section) => section.body).join(" "),
        ).not.toContain("gardening");
        expect(
            (
                await service.getViewPublication({
                    corpusId,
                    viewId: view.viewId,
                })
            )?.indexState,
        ).toBe("ready");
        const editedContent = structuredClone(view.content);
        editedContent.title = "Human project title";
        const status = editedContent.sections.find(
            (section) => section.role === "status",
        )?.details;
        if (status?.kind !== "status")
            throw new Error("Project status missing");
        status.project = "blocked";
        await service.close();
        service = open();
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: (await service.listViews(corpusId)).head,
            definition: {
                viewId: view.viewId,
                kind: view.definition.kind,
                selector: view.definition.selector,
                projectSummary: {
                    ...view.definition.projectSummary!,
                    excludedSourceIds: ["irrelevant"],
                },
            },
            content: editedContent,
            relationships: authoredRelationships(view),
        });
        const edited = (await service.getView({
            corpusId,
            viewId: view.viewId,
        }))!;
        await service.close();
        service = open();
        expect(
            (await service.getView({ corpusId, viewId: view.viewId }))?.content,
        ).toEqual(editedContent);
        expect(
            (await service.getView({ corpusId, viewId: view.viewId }))
                ?.definition.projectSummary?.excludedSourceIds,
        ).toEqual(["irrelevant"]);
        expect(edited.edits?.length).toBeGreaterThan(0);
    });

    test.each([false, true])(
        "normal source answer consumes exact expanded fragments with rehearsal envelope=%s (mock model)",
        async (budgetEnabled) => {
            await service.close();
            rehearsalBudget = budgetEnabled;
            let prompt = "";
            indexedAnswerModel = {
                completionSettings: {},
                complete: async (input) => {
                    prompt = JSON.stringify(input);
                    return {
                        success: true,
                        data: JSON.stringify({
                            status: "answered",
                            answer: "Mock source-only answer",
                            citationIds: ["f0"],
                        }),
                    };
                },
            };
            service = open();
            const corpusId = (await service.createCorpus("Source answer mocks"))
                .corpusId;
            await update(corpusId, "pause");
            await add(
                corpusId,
                "source",
                `${"Acquisition context ".repeat(65)}governing qualification`,
            );
            const result = await service.answer({
                corpusId,
                question: "Acquisition",
                answerMode: "synthesized",
            });

            expect(prompt).toContain("governing qualification");
            expect(result.mode).toBe("synthesized");
            expect(result.citations[0].locator).toMatch(/^indexed:/);
            expect(
                (
                    await service.getSourceContent({
                        corpusId,
                        sourceId: result.citations[0].sourceId,
                        revisionId: result.citations[0].revisionId,
                        indexedLocator: result.citations[0].locator!,
                    })
                ).content,
            ).toBe(result.citations[0].snippet);
        },
    );

    test("automatic wiki builds without rehearsal variables and family pause survives reopen", async () => {
        await service.close();
        rehearsalBudget = false;
        service = open();
        expect(
            (await service.getCapabilities()).derivedViews?.informationalWiki,
        ).toBe(true);
        const { corpusId } = await service.createCorpus(
            "Default informational views",
        );
        await add(
            corpusId,
            "source",
            "Acquisition has governing qualifications.",
        );
        for (let attempt = 0; generated === 0 && attempt < 100; attempt++)
            await new Promise((resolve) => setTimeout(resolve, 20));
        expect(generated).toBeGreaterThan(0);
        const builds = await service.listViewBuilds(corpusId);
        expect(builds).toHaveLength(1);
        expect((await waitForViewBuild(service, builds[0])).state).toBe(
            "complete",
        );
        expect((await service.listViews(corpusId)).views).toHaveLength(1);
        await service.close();
        service = open();
        await update(corpusId, "pause");
        const calls = generated;
        await service.close();
        service = open();
        expect((await service.listViews(corpusId)).wikiFamily?.enabled).toBe(
            false,
        );
        await add(
            corpusId,
            "second",
            "Acquisition next source remains conditional.",
        );
        const pausedHead = (await service.listViews(corpusId)).head;
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(generated).toBe(calls);
        expect((await service.listViews(corpusId)).head).toBe(pausedHead);
    });

    test("close drains active family admission before cancelling its newly admitted build", async () => {
        await service.close();
        let discovered!: () => void;
        let releaseDiscovery!: () => void;
        let releaseSynthesis!: () => void;
        const discoveryStarted = new Promise<void>((resolve) => {
            discovered = resolve;
        });
        const discoveryGate = new Promise<void>((resolve) => {
            releaseDiscovery = resolve;
        });
        const synthesisGate = new Promise<void>((resolve) => {
            releaseSynthesis = resolve;
        });
        beforeGeneration = () => synthesisGate;
        service = new FileMemoryService(root, {
            viewSynthesisAdapter: adapter,
            indexFactory: (_corpusId, directory) => {
                const index = new MockIndexedCorpus(directory);
                const listSubjects = index.listSubjects.bind(index);
                index.listSubjects = async () => {
                    discovered();
                    await discoveryGate;
                    return listSubjects();
                };
                return index;
            },
        });
        const { corpusId } = await service.createCorpus("Closing admission");
        await add(
            corpusId,
            "source",
            "Acquisition has governing qualifications.",
        );
        await discoveryStarted;
        const closing = service.close();
        releaseDiscovery();
        try {
            await closing;
            const jobs = await new TypedViewStore(root).listViewBuilds(
                corpusId,
            );
            expect(jobs.map((job) => job.state)).toEqual(["cancelled"]);
        } finally {
            releaseDiscovery();
            releaseSynthesis();
        }
    }, 10000);

    test("failed synthesis retries the same identity and completed retry does not rerun", async () => {
        const corpusId = (await service.createCorpus("Retry mocks")).corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "source", "Acquisition condition remains unknown.");
        failNext = true;
        const result = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });

        const failed = await waitForViewBuild(service, result.job!);
        expect(failed.state).toBe("failed");
        const retried = await waitForViewBuild(
            service,
            await service.retryViewBuild({ corpusId, jobId: failed.jobId }),
        );
        expect(retried.state).toBe("complete");
        expect(retried.results[0].viewId).toBe(failed.results[0].viewId);
        const calls = generated;
        await expect(
            service.retryViewBuild({ corpusId, jobId: retried.jobId }),
        ).rejects.toThrow("no retryable targets");
        expect(generated).toBe(calls);
    });

    test("lexical descriptors reconcile before builds and survive alias edits and cold restart without duplicate IDs", async () => {
        MockIndexedCorpus.subjects = ["accountable_role", "Accountable  role"];
        const corpusId = (await service.createCorpus("Lexical identities"))
            .corpusId;
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        await add(
            corpusId,
            "role",
            "The accountable_role is the service role responsible for approval; accountable role does not mean review owner.",
        );
        const store = new TypedViewStore(root);
        const family = await store.getWikiFamily(corpusId);
        family.descriptors = [
            {
                viewId: "prior-a",
                query: "accountable_role",
                sourceIds: ["role"],
            },
            {
                viewId: "prior-b",
                query: "accountable role",
                sourceIds: ["role"],
            },
        ];
        await store.saveWikiFamily(corpusId, family);
        const resumed = await update(corpusId, "resume");
        expect(resumed.job?.request.targets).toHaveLength(1);
        await update(corpusId, "pause");
        const snapshot = await service.listViews(corpusId);
        expect(snapshot.views).toHaveLength(1);
        expect(snapshot.wikiFamily!.pending).toBe(false);
        const page = snapshot.views[0];
        expect(page.viewId).toBe("prior-a");
        if (page.content.kind !== "wiki" || !page.definition.wiki)
            throw new Error("Expected indexed Wiki");
        const content = structuredClone(page.content);
        content.title = "Accountability, not review ownership";
        content.sections[0].heading = content.title;
        content.sections[0].details = {
            kind: "page",
            construction: "informational-wiki-v1",
            taxonomy: "system",
            note: "Keep my editorial distinction.",
            mergedPageIds: [],
        };
        content.index = wikiIndex(content.sections);
        await service.saveViewDraft({
            corpusId,
            viewId: page.viewId,
            expectedHead: snapshot.head,
            expectedVersion: page.version,
            definition: {
                viewId: page.viewId,
                kind: "wiki",
                selector: page.definition.selector,
                wiki: {
                    ...page.definition.wiki,
                    aliases: ["service accountability"],
                    excludedSourceIds: ["excluded"],
                },
            },
            content,
            relationships: authoredRelationships(page),
        });
        MockIndexedCorpus.subjects = [
            "ACCOUNTABLE ROLE",
            "service accountability",
        ];
        await service.close();
        service = open();
        const before = generated;
        await update(corpusId, "resume");
        const afterEdit = await service.listViews(corpusId);
        expect(afterEdit.views).toHaveLength(1);
        expect(afterEdit.views[0].viewId).toBe(page.viewId);
        expect(afterEdit.views[0].content.title).toBe(content.title);
        expect(afterEdit.views[0].content.sections[0].details).toEqual(
            content.sections[0].details,
        );
        expect(afterEdit.views[0].definition.wiki?.aliases).toEqual([
            "service accountability",
        ]);
        expect(afterEdit.views[0].definition.wiki?.excludedSourceIds).toEqual([
            "excluded",
        ]);
        expect(afterEdit.views[0].content.citations).toEqual(
            page.content.citations,
        );
        expect(afterEdit.views[0].content.sections[0].body).toContain(
            "Coverage limits:",
        );
        expect(generated - before).toBe(1);
        const calls = generated;
        expect((await update(corpusId)).job).toBeUndefined();
        expect(generated).toBe(calls);
        await service.close();
        service = open();
        expect((await update(corpusId)).job).toBeUndefined();
        expect(
            (await service.listViews(corpusId)).views.map(
                (view) => view.viewId,
            ),
        ).toEqual([page.viewId]);
        expect(generated).toBe(calls);
    });

    test("lexical names with explicit incompatible project scopes or symbol types retain distinct IDs", async () => {
        MockIndexedCorpus.subjects = [
            "accountable_role",
            "accountable role",
            "accountableRole",
        ];
        MockIndexedCorpus.subjectDetails = {
            accountable_role: {
                identity: { types: ["concept"], scopes: ["project:payments"] },
            },
            "accountable role": {
                identity: { types: ["concept"], scopes: ["project:identity"] },
            },
            accountableRole: {
                identity: { types: ["field"], scopes: ["project:identity"] },
            },
        };
        const corpusId = (await service.createCorpus("Scoped lexical names"))
            .corpusId;
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        await add(
            corpusId,
            "mixed",
            "accountable_role names the payments approval role. accountable role in identity means delegated reviewer. accountableRole is a field, not equivalent to either role.",
        );
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        expect((await waitForViewBuild(service, resumed.job!)).state).toBe(
            "complete",
        );
        const snapshot = await service.listViews(corpusId);
        expect(snapshot.views).toHaveLength(3);
        expect(new Set(snapshot.views.map((view) => view.viewId)).size).toBe(3);
        const ids = snapshot.views.map((view) => view.viewId).sort();
        await service.close();
        service = open();
        expect((await update(corpusId)).job).toBeUndefined();
        expect(
            (await service.listViews(corpusId)).views
                .map((view) => view.viewId)
                .sort(),
        ).toEqual(ids);
    });

    test("historical duplicate saved pages stay intact and report ambiguity rather than auto merging", async () => {
        MockIndexedCorpus.subjects = ["accountable_role"];
        const corpusId = (
            await service.createCorpus("Historical lexical ambiguity")
        ).corpusId;
        await update(corpusId, "pause");
        await projects(corpusId, "pause");
        await add(
            corpusId,
            "source",
            "accountable_role is the accountable service owner, not the approval review owner.",
        );
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        await waitForViewBuild(service, resumed.job!);
        await update(corpusId, "pause");
        const snapshot = await service.listViews(corpusId);
        const original = snapshot.views[0];
        if (original.content.kind !== "wiki" || !original.definition.wiki)
            throw new Error("Expected Wiki");
        const content = structuredClone(original.content);
        content.sections[0].id = "edited-duplicate";
        content.title = "My distinct editorial label";
        content.sections[0].heading = content.title;
        content.index = wikiIndex(content.sections);
        const builtDuplicate = await waitForViewBuild(
            service,
            await service.buildViews({
                corpusId,
                expectedHead: snapshot.head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "edited-duplicate",
                            kind: "wiki",
                            selector: original.definition.selector,
                            wiki: {
                                ...original.definition.wiki,
                                query: "accountable role",
                            },
                        },
                    },
                ],
            }),
        );
        expect(builtDuplicate.state).toBe("complete");
        const duplicate = await service.getView({
            corpusId,
            viewId: "edited-duplicate",
        });
        await service.saveViewDraft({
            corpusId,
            viewId: "edited-duplicate",
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: duplicate!.version,
            definition: {
                viewId: "edited-duplicate",
                kind: "wiki",
                selector: original.definition.selector,
                wiki: {
                    ...original.definition.wiki,
                    query: "accountable role",
                },
            },
            content,
            relationships: authoredRelationships(original).map((edge) => ({
                ...edge,
                from: {
                    kind: "section",
                    viewId: "edited-duplicate",
                    sectionId: "edited-duplicate",
                },
            })),
        });
        const result = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        if (result.job) await waitForViewBuild(service, result.job);
        const final = await service.listViews(corpusId);
        expect(final.views).toHaveLength(2);
        expect(
            final.views.find((view) => view.viewId === "edited-duplicate")
                ?.content.title,
        ).toBe(content.title);
        expect(final.wikiFamily?.error).toContain("No pages were merged");
    });

    test("saved exclusions refresh from remaining sources without changing the page identity", async () => {
        const corpusId = (await service.createCorpus("Exclusion mocks"))
            .corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "keep", "Acquisition retained qualification.");
        await add(corpusId, "omit", "Acquisition excluded detail.");
        const resumed = await update(corpusId, "resume");
        expect(resumed.job).toBeDefined();
        await update(corpusId, "pause");
        const snapshot = await service.listViews(corpusId);
        const page = snapshot.views[0];
        if (!page.definition.wiki)
            throw new Error("Missing informational retrieval selector");
        await service.saveViewDraft({
            corpusId,
            viewId: page.viewId,
            expectedVersion: page.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: page.viewId,
                kind: "wiki",
                selector: page.definition.selector,
                wiki: {
                    ...page.definition.wiki,
                    excludedSourceIds: ["omit"],
                },
            },
            content: page.content,
            relationships: authoredRelationships(page),
        });
        const refreshed = await update(corpusId, "resume");
        expect(refreshed.job).toBeDefined();
        const current = (await service.getView({
            corpusId,
            viewId: page.viewId,
        }))!;
        expect(current.content.sections[0].body).toContain(
            "retained qualification",
        );
        expect(current.content.sections[0].body).not.toContain(
            "excluded detail",
        );
        expect(
            current.content.citations.every(
                (citation) => citation.sourceId !== "omit",
            ),
        ).toBe(true);
        expect(current.definition.wiki!.excludedSourceIds).toEqual(["omit"]);
        await update(corpusId, "pause");
        await service.saveViewDraft({
            corpusId,
            viewId: current.viewId,
            expectedVersion: current.version,
            expectedHead: (await service.listViews(corpusId)).head,
            definition: {
                viewId: current.viewId,
                kind: "wiki",
                selector: current.definition.selector,
                wiki: {
                    ...current.definition.wiki!,
                    excludedSourceIds: ["keep", "omit"],
                },
            },
            content: current.content,
            relationships: authoredRelationships(current),
        });
        const blocked = await update(corpusId, "resume");
        expect(blocked.job).toBeUndefined();
        expect(blocked.plan.targets[0].state).toBe("blocked");
        expect((await service.listViews(corpusId)).wikiFamily!.error).toContain(
            "all matching sources are excluded",
        );
    });

    test("overlapping prose keeps the human version and exposes a resolvable proposal", async () => {
        const corpusId = (await service.createCorpus("Conflict mocks"))
            .corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "source", "Acquisition original condition.");
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        await waitForViewBuild(service, resumed.job!);
        await update(corpusId, "pause");
        const snapshot = await service.listViews(corpusId);
        const page = snapshot.views[0];
        const content = structuredClone(page.content);
        content.sections[0].body = "My protected human interpretation.";
        await service.saveViewDraft({
            corpusId,
            viewId: page.viewId,
            expectedVersion: page.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: page.viewId,
                kind: "wiki",
                selector: page.definition.selector,
                ...(page.definition.wiki ? { wiki: page.definition.wiki } : {}),
            },
            content,
            relationships: authoredRelationships(page),
        });
        await add(
            corpusId,
            "correction",
            "Acquisition corrected condition; recovery is not universal.",
        );
        const changed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        const job = await waitForViewBuild(service, changed.job!);
        const conflictId = job.results[0].conflictId;
        expect(conflictId).toBeDefined();
        const conflict = await service.getViewConflict({
            corpusId,
            conflictId: conflictId!,
        });
        expect(conflict!.candidate.content.sections[0].body).toContain(
            "corrected condition",
        );
        const human = (await service.getView({
            corpusId,
            viewId: page.viewId,
        }))!;
        expect(human.content.sections[0].body).toBe(
            "My protected human interpretation.",
        );
        const calls = generated;
        await service.close();
        service = open();
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "update",
        });
        expect(generated).toBe(calls);
        await service.resolveViewConflict({
            corpusId,
            conflictId: conflictId!,
            expectedHead: (await service.listViews(corpusId)).head!,
            expectedVersion: human.version,
            expectedRevisionId: human.revisionId,
            inputFingerprint: conflict!.input.fingerprint,
            choice: "human",
        });
        expect(
            (await service.getViewConflict({
                corpusId,
                conflictId: conflictId!,
            }))!.state,
        ).toBe("resolved");
    });

    test("forget during pending synthesis prevents late content, history and retry recreation", async () => {
        const corpusId = (await service.createCorpus("Removal race mocks"))
            .corpusId;
        await update(corpusId, "pause");
        await add(
            corpusId,
            "source",
            "Acquisition forgotten synthetic content.",
        );
        let release!: () => void;
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
            started = resolve;
        });
        beforeGeneration = () =>
            new Promise<void>((resolve) => {
                release = resolve;
                started();
            });
        const result = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        await ready;
        const viewId = result.job!.results[0].viewId;
        const preview = await service.previewForgetSource(corpusId, "source");
        await service.forgetSource({
            corpusId,
            sourceId: "source",
            confirmationToken: preview.confirmationToken,
        });
        release();
        beforeGeneration = undefined;
        await service.close();
        service = open();
        expect(await service.getView({ corpusId, viewId })).toBeUndefined();
        expect(await service.getViewHistory({ corpusId, viewId })).toEqual([]);
        await expect(
            service.retryViewBuild({ corpusId, jobId: result.job!.jobId }),
        ).rejects.toThrow("existing terminal");
        expect(
            (await service.search({ corpusId, query: "Acquisition" })).matches,
        ).toEqual([]);
    });

    test("independently stores automatically visible pages, resolves anchors, preserves edits, no-ops and purges", async () => {
        const corpusId = (await service.createCorpus("Synthetic wiki"))
            .corpusId;
        await update(corpusId, "pause");
        await add(
            corpusId,
            "first",
            "Acquisition recovered locally; headroom review remains open.",
        );
        const initial = await service.listViews(corpusId);
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: initial.head,
            family: "wiki",
            operation: "resume",
        });
        expect(resumed.job).toBeDefined();
        await waitForViewBuild(service, resumed.job!);
        let snapshot = await service.listViews(corpusId);
        expect(snapshot.views).toHaveLength(1);
        const page = snapshot.views[0];
        expect(page.content.kind).toBe("wiki");
        expect(page.content).not.toHaveProperty("inventory");
        const citation = page.content.citations[0];
        expect(
            (
                await service.getSourceContent({
                    corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    indexedLocator: citation.locator,
                })
            ).content,
        ).toBe(citation.excerpt);
        const content = structuredClone(page.content);
        if (content.kind !== "wiki") throw new Error("Expected wiki");
        content.title = "My acquisition note";
        const details = content.sections[0].details;
        if (!("construction" in details))
            throw new Error("Expected informational details");
        details.note = "Personal synthesis note";
        details.taxonomy = "system";
        content.index = wikiIndex(content.sections);
        await service.saveViewDraft({
            corpusId,
            viewId: page.viewId,
            expectedVersion: page.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: page.viewId,
                kind: page.definition.kind,
                selector: page.definition.selector,
                ...(page.definition.wiki ? { wiki: page.definition.wiki } : {}),
            },
            content,
            relationships: authoredRelationships(page),
        });
        const calls = generated;
        await update(corpusId);
        expect(generated).toBe(calls);
        await service.close();
        service = open();
        await update(corpusId);
        expect(generated).toBe(calls);
        snapshot = await service.listViews(corpusId);
        expect(snapshot.views[0].viewId).toBe(page.viewId);
        expect(snapshot.views[0].content.title).toBe("My acquisition note");
        const priorJobs = (await service.listViewBuilds(corpusId)).length;
        await add(
            corpusId,
            "correction",
            "Acquisition recovery still stands; resident-memory qualification has no new numeric pool target.",
        );
        for (let attempt = 0; attempt < 300; attempt++) {
            const jobs = await service.listViewBuilds(corpusId);
            if (
                jobs.length > priorJobs &&
                jobs.every((job) => job.state !== "running")
            )
                break;
            if (attempt === 299)
                throw new Error(
                    "Automatic correction maintenance did not complete",
                );
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await update(corpusId);
        const refreshed = (await service.listViews(corpusId)).views[0];
        expect(refreshed.viewId).toBe(page.viewId);
        expect(refreshed.content.title).toBe("My acquisition note");
        expect(refreshed.content.sections[0].details).toMatchObject({
            note: "Personal synthesis note",
            taxonomy: "system",
        });
        expect(refreshed.content.sections[0].body).toContain("resident-memory");
        const preview = await service.previewForgetSource(
            corpusId,
            "correction",
        );
        await service.forgetSource({
            corpusId,
            sourceId: "correction",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: page.viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: page.viewId }),
        ).toEqual([]);
    });

    test.each([false, true])(
        "admission persistence failure retains stable retryable targets after reopen (postcommit=%s)",
        async (postcommit) => {
            const corpusId = (await service.createCorpus("Admission fault"))
                .corpusId;
            await update(corpusId, "pause");
            await add(corpusId, "source", "Acquisition fault test evidence.");
            const original = TypedViewStore.prototype.admitViewBuild;
            TypedViewStore.prototype.admitViewBuild = async function (
                this: TypedViewStore,
                ...args: Parameters<typeof original>
            ) {
                TypedViewStore.prototype.admitViewBuild = original;
                if (postcommit) await original.apply(this, args);
                throw new Error("Injected admission persistence fault");
            };
            await expect(
                service.maintainViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    family: "wiki",
                    operation: "resume",
                }),
            ).rejects.toThrow("admission persistence fault");
            TypedViewStore.prototype.admitViewBuild = original;
            const store = new TypedViewStore(root, "fault-reader");
            const ids = (await store.getWikiFamily(corpusId)).descriptors.map(
                (item) => item.viewId,
            );
            await service.close();
            service = open();
            const result = await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "update",
            });
            expect(result.job).toBeDefined();
            await waitForViewBuild(service, result.job!);
            expect(
                (await service.listViews(corpusId)).views.map(
                    (view) => view.viewId,
                ),
            ).toEqual(ids);
            expect(generated).toBe(1);
            expect(
                (await service.listViews(corpusId)).wikiFamily?.pending,
            ).toBe(false);
        },
    );

    test("a cold reopened reader loads the index without graph or search warming", async () => {
        const corpusId = (await service.createCorpus("Cold reader")).corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "source", "Acquisition exact excerpt.");
        await service
            .maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "resume",
            })
            .then(async (result) => waitForViewBuild(service, result.job!));
        const citation = (await service.listViews(corpusId)).views[0].content
            .citations[0];
        await service.close();
        service = open();
        expect(
            (
                await service.getSourceContent({
                    corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    indexedLocator: citation.locator,
                })
            ).content,
        ).toBe(citation.excerpt);
    });
    test("configured normal ingestion rejects oversized inference before provider access", async () => {
        const corpusId = (await service.createCorpus("Configured ingestion"))
            .corpusId;
        await update(corpusId, "pause");
        const original = MockIndexedCorpus.prototype.rebuild;
        MockIndexedCorpus.prototype.rebuild = async () => {
            MockIndexedCorpus.prototype.rebuild = original;
            reserveSerializedRequest({
                body: JSON.stringify({
                    messages: ["x".repeat(31200)],
                    max_completion_tokens: 900000,
                }),
            });
        };
        const result = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Admission",
                text: "Synthetic admission probe",
            },
        });
        const job = await waitForMemoryJob(service, result.jobId);
        MockIndexedCorpus.prototype.rebuild = original;
        expect(job.state).toBe("failed");
        expect(job.error).toContain("exceeds configured");
        expect(await service.listSources(corpusId)).toHaveLength(0);
    });

    test("multiple indexed passages share one supportedBy relationship with all exact citations", async () => {
        const corpusId = (await service.createCorpus("Multi-fragment support"))
            .corpusId;
        await update(corpusId, "pause");
        await add(
            corpusId,
            "source",
            "Acquisition qualified evidence. ".repeat(160),
        );
        await service
            .maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "resume",
            })
            .then(async (result) => waitForViewBuild(service, result.job!));
        const view = (await service.listViews(corpusId)).views[0];
        expect(view.content.citations.length).toBeGreaterThan(1);
        const edges = authoredRelationships(view);
        expect(edges).toHaveLength(1);
        expect(edges[0].citations).toEqual(view.content.citations);
    });

    test("legacy drafts reject informational indexed citations", async () => {
        const block = {
            sourceId: "s",
            revisionId: "r",
            blockOrdinal: 0,
            text: "acquisition",
            score: 1,
        };
        expect(() =>
            validateViewDraft({
                corpusId: "c",
                viewId: "v",
                expectedVersion: 0,
                expectedHead: null,
                definition: {
                    viewId: "v",
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
                        sources: [{ sourceId: "s", revisionId: "r" }],
                    },
                },
                content: {
                    kind: "troubleshootingGuide",
                    title: "Legacy",
                    sections: [
                        {
                            id: "context",
                            role: "context",
                            heading: "Context",
                            body: "acquisition",
                        },
                    ],
                    citations: [
                        {
                            sourceId: "s",
                            revisionId: "r",
                            locator: indexedLocator(block, 0, 11),
                            excerpt: "acquisition",
                        },
                    ],
                },
                relationships: [],
            }),
        ).toThrow("Exact UTF-16 citation offsets");
    });
});

describe("bounded indexed fragment selection", () => {
    test("distant contextual measurements and counterexamples do not need to repeat the selector", () => {
        const block = {
            sourceId: "qualified",
            revisionId: "r",
            blockOrdinal: 0,
            score: 1,
            text: `# Atlas rollout\n\n${"Background context. ".repeat(1500)}\n\n## Measurements\nMedian 42 ms for cohort A, workload W, as of 2026-08-01; p95 unknown.\n\n## Counterexample\nIssuer checks failed outside the rehearsal cohort. Local success does not establish rollout.`,
        };
        const selected = selectIndexedFragments([block], {
            terms: ["Atlas rollout"],
            sourceIds: ["qualified"],
        });
        expect(
            selected.fragments.some((fragment) =>
                fragment.snippet.includes(
                    "Median 42 ms for cohort A, workload W, as of 2026-08-01; p95 unknown.",
                ),
            ),
        ).toBe(true);
        expect(
            selected.fragments.some((fragment) =>
                fragment.snippet.includes(
                    "Issuer checks failed outside the rehearsal cohort",
                ),
            ),
        ).toBe(true);
        expect(selected.readChars).toBeLessThanOrEqual(32000);
        expect(selected.fragments.length).toBeLessThanOrEqual(12);
        for (const fragment of selected.fragments) {
            const range = parseIndexedLocator(fragment.locator);
            expect(fragment.snippet).toBe(
                block.text.slice(range.start, range.end),
            );
        }
    });
    test("selection diversifies beyond newest three and preserves exact qualified measurements and corrections", () => {
        const blocks = [
            ...[6, 5, 4, 3].map((version) => ({
                sourceId: `recent-${version}`,
                revisionId: "r",
                blockOrdinal: 0,
                score: 10,
                text: `Atlas rollout current meeting ${version}: prepared; approval unknown. Shared infrastructure is not project completion.`,
            })),
            {
                sourceId: "correction",
                revisionId: "r",
                blockOrdinal: 0,
                score: 9,
                text: "Atlas rollout correction: prior rollout assertion retracted. Capacity blocked pending accountable owner review, not just review ownership.",
            },
            {
                sourceId: "counterexample",
                revisionId: "r",
                blockOrdinal: 0,
                score: 8,
                text: "Atlas rollout counterexample: issuer validation failed in the production cohort; not reproduced in rehearsal.",
            },
            {
                sourceId: "older-success",
                revisionId: "r",
                blockOrdinal: 0,
                score: 7,
                text: "Atlas rollout local success: observed median 42 ms for cohort A on workload W as of 2026-08-01. Only the rehearsal passed; p95 and rollout remain unknown.",
            },
        ];
        const result = selectIndexedFragments(blocks, {
            terms: ["Atlas rollout"],
            sourceIds: blocks.map((block) => block.sourceId),
        });
        expect(
            new Set(result.fragments.map((fragment) => fragment.sourceId)),
        ).toEqual(
            new Set([
                "recent-6",
                "correction",
                "counterexample",
                "older-success",
            ]),
        );
        expect(result.readChars).toBeLessThanOrEqual(32000);
        expect(result.fragments.length).toBeLessThanOrEqual(12);
        expect(result.limited).toBe(true);
        for (const fragment of result.fragments) {
            const block = blocks.find(
                (block) => block.sourceId === fragment.sourceId,
            )!;
            const range = parseIndexedLocator(fragment.locator);
            expect(fragment.snippet).toBe(
                block.text.slice(range.start, range.end),
            );
        }
        expect(
            result.fragments.find(
                (fragment) => fragment.sourceId === "older-success",
            )!.snippet,
        ).toContain("median 42 ms for cohort A on workload W as of 2026-08-01");
    });
    test("short project vocabulary matches reordered indexed headings without requiring a literal phrase", () => {
        const result = selectIndexedFragments(
            [
                {
                    sourceId: "project",
                    revisionId: "r",
                    blockOrdinal: 0,
                    score: 1,
                    text: "# Gateway and identity migration\n\nThe verifier review remains open.",
                },
            ],
            { terms: ["identity gateway migration"], sourceIds: ["project"] },
        );
        expect(result.fragments).toHaveLength(1);
        expect(result.fragments[0].snippet).toContain("review remains open");
    });
    test("balanced bounded windows include distant qualification in aggregated long blocks", () => {
        const result = selectIndexedFragments(
            ["payments", "identity"].map((sourceId) => ({
                sourceId,
                revisionId: "r",
                blockOrdinal: 0,
                score: 1,
                text: `overlap definition ${"padding ".repeat(4000)} overlap production qualification unknown`,
            })),
            { terms: ["overlap"], sourceIds: ["payments", "identity"] },
        );
        expect(
            result.fragments.filter((fragment) =>
                fragment.snippet.includes("production qualification"),
            ),
        ).toHaveLength(2);
        expect(result.readChars).toBeLessThanOrEqual(32000);
        expect(result.limited).toBe(true);
    });
    test("a new uncited correction gets a read before an earlier long source exhausts the bound", () => {
        const result = selectIndexedFragments(
            [
                {
                    sourceId: "old",
                    revisionId: "r",
                    blockOrdinal: 0,
                    score: 1,
                    text: "acquisition ".repeat(3000),
                },
                {
                    sourceId: "new",
                    revisionId: "r",
                    blockOrdinal: 0,
                    score: 1,
                    text: "acquisition resident-memory warning; no new numeric target",
                },
            ],
            { terms: ["acquisition"], sourceIds: ["old", "new"] },
        );
        expect(
            result.fragments.some((fragment) => fragment.sourceId === "new"),
        ).toBe(true);
        expect(result.readChars).toBeLessThanOrEqual(32000);
        expect(result.fragments).toHaveLength(12);
        expect(result.limited).toBe(true);
    });
    test("reads non-prefix windows honestly and rejects malformed anchors", () => {
        const text = `${"a".repeat(2100)} acquisition qualification`;
        const result = selectIndexedFragments(
            [
                {
                    sourceId: "s",
                    revisionId: "r",
                    blockOrdinal: 0,
                    text,
                    score: 1,
                },
            ],
            { terms: ["acquisition"], sourceIds: ["s"] },
        );
        expect(result.fragments[0].locator).toContain(":2000-");
        expect(result.fragments[0].snippet).toContain("qualification");
        expect(result.readChars).toBe(text.length + 1000);
        expect(() => parseIndexedLocator("indexed:0:bad:0-20")).toThrow(
            "Invalid indexed-text locator",
        );
        expect(() =>
            parseIndexedLocator(`indexed:0:${"a".repeat(64)}:0-2001`),
        ).toThrow("exceeds bounded");
    });
});
