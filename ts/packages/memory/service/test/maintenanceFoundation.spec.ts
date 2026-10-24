// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { TypedViewStore } from "../src/viewStore.js";
import type { IndexedDocument, IndexedFragmentRequest } from "../src/types.js";
import type {
    ViewBuildSnapshot,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const subjects = Array.from({ length: 14 }, (_, index) => `mechanism ${index}`);

class FoundationIndex extends FakeSemanticCorpusIndex {
    static failDerivative = false;
    public constructor(private readonly location: string) {
        super(location);
    }
    override async rebuild(documents: IndexedDocument[]): Promise<void> {
        if (
            FoundationIndex.failDerivative &&
            this.location.includes("view-search-index")
        )
            throw new Error("Synthetic derivative failure");
        await super.rebuild(documents);
    }
    async listSubjects(offset: number) {
        return {
            total: subjects.length,
            items: offset
                ? []
                : subjects.map((term) => ({
                      term,
                      postingCount: 1,
                      sourceIds: ["source"],
                  })),
        };
    }
    override async getKnowledgeGraph() {
        return {
            entities: [],
            relationships: [],
            topics: subjects.map((name) => ({
                name,
                sourceIds: ["source"],
                mentionCount: 1,
            })),
        };
    }
    async readFragments(_request: IndexedFragmentRequest) {
        const document = this.documents[0];
        if (!document) throw new Error("Missing synthetic indexed input");
        return {
            fragments: [
                {
                    sourceId: document.source.sourceId,
                    revisionId: document.revision.revisionId,
                    snippet: document.content,
                    locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
                    score: 1,
                },
            ],
            readChars: document.content.length,
            limited: false,
        };
    }
}

test.each(["semantic", "transient", "derivative"] as const)(
    "automatic maintenance isolates %s failure, reconciles committed effects and parks unchanged input",
    async (mode) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-foundation-"),
        );
        const calls = new Map<string, number>();
        let rejectTarget = true;
        const adapter = {
            identity: "offline-foundation-v1",
            assessWikiSubject: async (): Promise<WikiSubjectAssessment> => ({
                disposition: "distinct",
                purpose: "Independent explanation",
                reason: "Same sources do not imply equivalent scope",
                canonicalViewId: "",
                sharedFragmentIds: [],
                essentialDistinctions: [],
                ambiguousViewIds: [],
            }),
            generate: async (input: ViewBuildSnapshot) => {
                const query = input.definition.wiki!.query;
                calls.set(query, (calls.get(query) ?? 0) + 1);
                if (
                    rejectTarget &&
                    query === subjects[0] &&
                    mode === "transient"
                )
                    throw new Error("Synthetic unavailable provider");
                const output = hydrateInformational(input, {
                    title: query,
                    prose: `${query} explains an independent operational mechanism and its boundaries.`,
                    limits: "Synthetic selected evidence",
                    citationIds: ["f0"],
                });
                if (
                    rejectTarget &&
                    query === subjects[0] &&
                    mode === "semantic"
                )
                    output.content.citations[0].revisionId =
                        "invented-revision";
                return output;
            },
            validate: async () => {
                throw new Error(
                    "Informational work must not use universal support checks",
                );
            },
        };
        const open = () =>
            new FileMemoryService(root, {
                indexFactory: (_id, directory) =>
                    new FoundationIndex(directory),
                eventIndexFactory: (_id, directory) =>
                    new FakeSemanticCorpusIndex(directory),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        FoundationIndex.failDerivative = mode === "derivative";
        try {
            const { corpusId } = await service.createCorpus(
                `Foundation ${mode}`,
            );
            for (const family of ["projects", "wiki"] as const)
                await service.maintainViews({
                    corpusId,
                    family,
                    operation: "pause",
                    expectedHead: (await service.listViews(corpusId)).head,
                });
            const ingestion = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "source",
                    sourceType: "text",
                    title: "Synthetic mechanisms",
                    text: `${subjects.join(", ")} explain independent operational definitions, observations and governing qualifications.`,
                },
            });
            expect(
                (await waitForMemoryJob(service, ingestion.jobId)).state,
            ).toBe("complete");
            await service.maintainViews({
                corpusId,
                family: "wiki",
                operation: "resume",
                expectedHead: (await service.listViews(corpusId)).head,
            });
            for (let attempt = 0; attempt < 500; attempt++) {
                const status = await service.listViews(corpusId);
                if (!status.wikiFamily?.pending) break;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const settled = await service.listViews(corpusId);
            if (settled.wikiFamily?.pending)
                throw new Error(
                    JSON.stringify({
                        status: settled.wikiFamily,
                        calls: [...calls],
                        family: await new TypedViewStore(root).getWikiFamily(
                            corpusId,
                        ),
                        jobs: (await service.listViewBuilds(corpusId)).map(
                            (job) => ({
                                state: job.state,
                                results: job.results.map((result) => ({
                                    query: result.snapshot.definition.wiki
                                        ?.query,
                                    state: result.state,
                                    reason: result.reason,
                                })),
                            }),
                        ),
                    }),
                );
            expect(settled.wikiFamily?.pending).toBe(false);
            if (mode !== "derivative")
                expect(settled.wikiFamily?.error).toContain(
                    "technical targets parked",
                );
            expect(settled.views).toHaveLength(mode === "derivative" ? 14 : 13);
            expect(calls.get(subjects[13])).toBe(1);
            expect(calls.get(subjects[0])).toBe(mode === "transient" ? 2 : 1);
            const jobs = await service.listViewBuilds(corpusId);
            if (mode !== "derivative")
                expect(
                    jobs
                        .flatMap((job) => job.results)
                        .some(
                            (result) =>
                                result.state ===
                                (mode === "semantic" ? "blocked" : "failed"),
                        ),
                ).toBe(true);
            const before = [...calls];
            const versions = settled.views
                .map((view) => view.revisionId)
                .sort();
            await service.close();
            if (mode !== "derivative") {
                service = open();
                await service.initialize();
                expect((await service.listViews(corpusId)).head).toBe(
                    settled.head,
                );
                expect([...calls]).toEqual(before);
                await service.close();
                await rm(
                    path.join(root, corpusId, "views", "view-search-index"),
                    {
                        recursive: true,
                        force: true,
                    },
                );
            }
            FoundationIndex.failDerivative = false;
            if (mode === "derivative") {
                // Simulate a clean family that missed a source/index generation hint.
                const store = new TypedViewStore(root);
                const family = await store.getWikiFamily(corpusId);
                family.dirty = false;
                family.indexVersion = "missed-generation";
                await store.saveWikiFamily(corpusId, family);
            }
            service = open();
            await service.initialize();
            for (let attempt = 0; attempt < 500; attempt++) {
                if (!(await service.listViews(corpusId)).wikiFamily?.pending)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const recovered = await service.listViews(corpusId);
            expect(recovered.wikiFamily?.pending).toBe(false);
            const maintenance = await service.drainMaintenance(5000);
            expect(
                maintenance.failures.some(
                    (failure) =>
                        failure.key === `${corpusId}:wiki` &&
                        failure.error.includes("technical targets parked"),
                ),
            ).toBe(mode !== "derivative");
            if (mode !== "derivative") expect(maintenance.settled).toBe(false);
            expect(
                recovered.views.map((view) => view.revisionId).sort(),
            ).toEqual(versions);
            expect([...calls]).toEqual(before);
            for (const view of recovered.views) {
                const publication = await service.getViewPublication({
                    corpusId,
                    viewId: view.viewId,
                });
                expect(publication.indexState).toBe("ready");
                expect(publication.publishedRevisionId).toBe(view.revisionId);
            }
            if (mode !== "derivative") {
                rejectTarget = false;
                const failed = (await service.listViewBuilds(corpusId)).find(
                    (job) =>
                        job.results.some((result) =>
                            ["failed", "blocked"].includes(result.state),
                        ),
                )!;
                let retried = await service.retryViewBuild({
                    corpusId,
                    jobId: failed.jobId,
                });
                for (
                    let attempt = 0;
                    attempt < 300 && retried.state === "running";
                    attempt++
                ) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    retried = (await service.getViewBuild({
                        corpusId,
                        jobId: retried.jobId,
                    }))!;
                }
                expect(retried.state).toBe("complete");
                expect(calls.get(subjects[0])).toBe(
                    mode === "semantic" ? 2 : 3,
                );
                expect((await service.listViews(corpusId)).views).toHaveLength(
                    14,
                );
                expect(
                    (await service.getMaintenanceStatus()).failures.some(
                        (failure) => failure.key === `${corpusId}:wiki`,
                    ),
                ).toBe(false);
            }
        } finally {
            FoundationIndex.failDerivative = false;
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);
