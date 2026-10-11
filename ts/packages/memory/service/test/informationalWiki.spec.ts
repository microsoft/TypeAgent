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
import type { IndexedFragmentRequest } from "../src/types.js";
import type { ViewBuildJob, ViewSynthesisAdapter } from "../src/viewTypes.js";
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
    public static languageSearches = 0;
    public override async search(
        query: string,
        limit: number,
        tags?: string[],
    ) {
        MockIndexedCorpus.languageSearches++;
        return super.search(query, limit, tags);
    }
    public async listSubjects() {
        return {
            total: MockIndexedCorpus.subjects.length,
            items: MockIndexedCorpus.subjects.map((term) => ({
                term,
                postingCount: this.documents.length,
                sourceIds: this.documents.map(
                    (document) => document.source.sourceId,
                ),
            })),
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
                    title: "Indexed project",
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
        });
    beforeEach(async () => {
        MockIndexedCorpus.subjects = ["acquisition"];
        generated = 0;
        failNext = false;
        beforeGeneration = undefined;
        indexedAnswerModel = undefined;
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
        operation: "update" | "pause" = "update",
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
            "Acquisition remains conditional and awaits review.",
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

    test("normal source answer consumes exact expanded fragments and returns resolvable anchors (mock model)", async () => {
        await service.close();
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
    });

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

    test("saved exclusions refresh from remaining sources without changing the page identity", async () => {
        const corpusId = (await service.createCorpus("Exclusion mocks"))
            .corpusId;
        await update(corpusId, "pause");
        await add(corpusId, "keep", "Acquisition retained qualification.");
        await add(corpusId, "omit", "Acquisition excluded detail.");
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
        const refreshed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        await waitForViewBuild(service, refreshed.job!);
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
        const blocked = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
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
