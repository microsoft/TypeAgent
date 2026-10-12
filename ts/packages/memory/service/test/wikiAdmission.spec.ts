// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    nominateWikiPages,
    parseWikiAssessment,
    reusableWikiAssessment,
    wikiPurposeRules,
} from "../src/wikiAdmission.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IndexedFragmentRequest } from "../src/types.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewVersion,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";

function input(viewId = "candidate"): ViewBuildSnapshot {
    const citation = {
        sourceId: "source",
        revisionId: "revision",
        locator: `indexed:0:${"a".repeat(64)}:0-80`,
        excerpt:
            "Platform readiness does not prove application cache propagation. The review remains open.",
    };
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        inputs: [
            {
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
                content: citation.excerpt,
                title: "Offline source",
                contentHash: "a".repeat(64),
                passages: [citation],
            },
        ],
        definition: {
            viewId,
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "review remains open",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        pipeline: "informational-wiki-v1",
        model: "offline:wiki-source-contribution-v3",
        fingerprint: "frozen",
    };
}
function page(viewId = "canonical"): ViewVersion {
    const snapshot = input(viewId);
    return {
        viewId,
        corpusId: "corpus",
        revisionId: "page-revision",
        version: 1,
        actor: "test",
        createdAt: "2026-10-11T00:00:00Z",
        state: "draft",
        definition: {
            ...snapshot.definition,
            revisionId: "definition-revision",
        },
        content: hydrateInformational(snapshot, {
            title: "Readiness boundaries",
            prose: "The open review qualifies readiness, not a separate platform overview.",
            limits: "Selected evidence only",
            citationIds: ["f0"],
        }).content,
        relationships: [],
        provenance: "generated",
    };
}
function covered(): WikiSubjectAssessment {
    return {
        disposition: "covered",
        purpose: "Readiness qualification",
        reason: "Same scope and explanatory purpose, existing page covers the open review",
        canonicalViewId: "canonical",
        sharedFragmentIds: ["f0"],
        ambiguousViewIds: [],
        essentialDistinctions: [
            {
                fragmentId: "f0",
                statement: "The open review qualifies readiness",
                canonicalExcerpt:
                    "The open review qualifies readiness, not a separate platform overview.",
            },
        ],
    };
}

test("index-evidence nomination is bounded, preserves scope/symbol distinctions, and requires exact revision/locator/excerpt", () => {
    const candidate = input();
    const canonical = page();
    const identities = new Map([
        ["candidate", { types: ["concept"], scopes: ["project:one"] }],
        ["canonical", { types: ["platform"], scopes: ["project:one"] }],
    ]);
    expect(
        nominateWikiPages(candidate, [canonical], identities)[0]
            .sharedFragmentIds,
    ).toEqual(["f0"]);
    identities.set("canonical", {
        types: ["platform"],
        scopes: ["project:two"],
    });
    expect(nominateWikiPages(candidate, [canonical], identities)).toEqual([]);
    identities.set("canonical", { types: ["field"], scopes: ["project:one"] });
    expect(nominateWikiPages(candidate, [canonical], identities)).toEqual([]);
    identities.clear();
    const changed = structuredClone(canonical);
    changed.content.citations[0].revisionId = "changed";
    expect(nominateWikiPages(candidate, [changed], identities)).toEqual([]);
    expect(
        nominateWikiPages(
            candidate,
            Array.from({ length: 20 }, (_, i) => page(`page-${i}`)),
            identities,
        ),
    ).toHaveLength(8);
});

test("typed assessment rejects invented canonical identity/evidence, empty purpose, unknown status and extra fields", () => {
    const contexts = nominateWikiPages(input(), [page()], new Map());
    expect(parseWikiAssessment(covered(), contexts)).toEqual(covered());
    for (const invalid of [
        { ...covered(), canonicalViewId: "invented" },
        { ...covered(), sharedFragmentIds: ["f9"] },
        { ...covered(), essentialDistinctions: [] },
        { ...covered(), purpose: "" },
        { ...covered(), disposition: "success" },
        { ...covered(), merge: true },
        { ...covered(), disposition: "distinct" },
    ])
        expect(() => parseWikiAssessment(invalid, contexts)).toThrow();
    expect(wikiPurposeRules).toContain("independently useful");
    expect(wikiPurposeRules).toContain("units/statistics, cohorts");
});

test("real sequential runner records genuine covered skip without generating or merging; invalid output is blocked", async () => {
    for (const invalid of [false, true]) {
        const snapshot = input();
        const canonical = page();
        const contexts = nominateWikiPages(snapshot, [canonical], new Map());
        let generated = 0;
        const job: ViewBuildJob = {
            jobId: "job",
            corpusId: "corpus",
            fingerprint: "job",
            actor: "test",
            createdAt: "2026-10-11T00:00:00Z",
            updatedAt: "2026-10-11T00:00:00Z",
            request: {
                corpusId: "corpus",
                expectedHead: null,
                targets: [
                    { definition: snapshot.definition, expectedVersion: 0 },
                ],
            },
            state: "running",
            publication: false,
            results: [
                {
                    viewId: "candidate",
                    snapshot,
                    state: "pending",
                    reason: "Admitted",
                },
            ],
            maintenancePlan: {
                corpusId: "corpus",
                expectedHead: null,
                targets: [],
            },
        };
        const runner = new ViewBuildRunner(
            {
                identity: "offline",
                assessWikiSubject: async () =>
                    invalid
                        ? { ...covered(), canonicalViewId: "invented" }
                        : covered(),
                generate: async () => {
                    generated++;
                    throw new Error("Redundant synthesis must not run");
                },
                validate: async () => {
                    throw new Error("Legacy validation must not run");
                },
            },
            {
                current: async () => undefined,
                wikiPages: async () => contexts,
                recordWikiAssessment: async (_job, result, assessment) => {
                    result.state = "skipped";
                    result.reason = assessment.reason;
                    result.wikiAssessment = {
                        ...assessment,
                        canonicalRevisionId: canonical.revisionId,
                    };
                },
                update: async (_corpusId, _jobId, update) => {
                    update(job);
                    return job;
                },
                materialize: async () => {
                    throw new Error("No record may be materialized");
                },
            },
        );
        runner.start(job);
        for (
            let attempt = 0;
            job.state === "running" && attempt < 100;
            attempt++
        )
            await new Promise((resolve) => setImmediate(resolve));
        await runner.close();
        expect(generated).toBe(0);
        expect(job.results[0].state).toBe(invalid ? "blocked" : "skipped");
        expect(job.state).toBe(invalid ? "failed" : "complete");
        if (!invalid) {
            expect(
                reusableWikiAssessment(job.results[0], snapshot, canonical),
            ).toBe(true);
            expect(
                reusableWikiAssessment(
                    job.results[0],
                    { ...snapshot, expectedVersion: 1 },
                    canonical,
                ),
            ).toBe(false);
            expect(
                reusableWikiAssessment(job.results[0], snapshot, {
                    ...canonical,
                    revisionId: "changed",
                }),
            ).toBe(false);
            expect(
                reusableWikiAssessment(
                    job.results[0],
                    { ...snapshot, model: "new-prompt" },
                    canonical,
                ),
            ).toBe(false);
        }
    }
});

test("automatic family compares earlier same-job page, persists skip and replays zero-model on unchanged cold restart", async () => {
    class PurposeIndex extends FakeSemanticCorpusIndex {
        async listSubjects(offset: number) {
            return {
                total: 2,
                items: offset
                    ? []
                    : ["cache propagation", "review remains open"].map(
                          (term) => ({
                              term,
                              postingCount: 1,
                              sourceIds: ["source"],
                          }),
                      ),
            };
        }
        override async getKnowledgeGraph() {
            return {
                entities: [],
                relationships: [],
                topics: [
                    {
                        name: "cache propagation",
                        sourceIds: ["source"],
                        mentionCount: 1,
                    },
                    {
                        name: "review remains open",
                        sourceIds: ["source"],
                        mentionCount: 1,
                    },
                ],
            };
        }
        async readFragments(_request: IndexedFragmentRequest) {
            const document = this.documents[0];
            if (!document) throw new Error("Offline indexed document missing");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-purpose-family-"));
    let generated = 0;
    let assessed = 0;
    const adapter = {
        identity: "offline-family-purpose",
        assessWikiSubject: async (
            _input: ViewBuildSnapshot,
            pages: ReturnType<typeof nominateWikiPages>,
        ): Promise<WikiSubjectAssessment> => {
            assessed++;
            expect(pages).toHaveLength(1);
            expect(pages[0].query).toBe("cache propagation");
            expect(pages[0].prose).toContain("review remains open");
            return {
                ...covered(),
                canonicalViewId: pages[0].viewId,
                sharedFragmentIds: pages[0].sharedFragmentIds,
                essentialDistinctions: [
                    {
                        fragmentId: "f0",
                        statement: "Cache propagation and open review",
                        canonicalExcerpt: pages[0].prose,
                    },
                ],
            };
        },
        generate: async (snapshot: ViewBuildSnapshot) => {
            generated++;
            return hydrateInformational(snapshot, {
                title: "Cache propagation",
                prose: snapshot.inputs[0].content,
                limits: "Selected evidence, unknown rollout",
                citationIds: ["f0"],
            });
        },
        validate: async () => {
            throw new Error("Legacy validation must not run");
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            indexFactory: (_id, directory) => new PurposeIndex(directory),
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    let service = open();
    try {
        const { corpusId } = await service.createCorpus(
            "Offline purpose comparison",
        );
        for (const family of ["wiki", "projects"] as const) {
            await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family,
                operation: "pause",
            });
        }
        const ingestion = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Local cache",
                text: "Cache propagation describes verifier metadata refresh across replicas. The review remains open because the stale-cache counterexample limits rollout; it is a qualification of cache propagation.",
            },
        });
        expect((await waitForMemoryJob(service, ingestion.jobId)).state).toBe(
            "complete",
        );
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        expect(resumed.job?.results).toHaveLength(2);
        let current = resumed.job!;
        for (let i = 0; current.state === "running" && i < 300; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            current = (await service.getViewBuild({
                corpusId,
                jobId: current.jobId,
            }))!;
        }
        expect(
            current.results.map((result) => [result.state, result.reason]),
        ).toEqual([
            [
                "draft",
                "Validated draft saved; no publication, review or execution authority",
            ],
            [
                "skipped",
                expect.stringContaining(
                    "Standalone purpose already covered by",
                ),
            ],
        ]);
        expect(current.state).toBe("complete");
        expect((await service.listViews(corpusId)).views).toHaveLength(1);
        expect(generated).toBe(1);
        expect(assessed).toBe(1);
        await service.close();
        service = open();
        const update = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "update",
        });
        expect(update.job).toBeUndefined();
        expect(generated).toBe(1);
        expect(assessed).toBe(1);
        expect((await service.listViews(corpusId)).wikiFamily?.pending).toBe(
            false,
        );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
