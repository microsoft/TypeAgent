// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createKnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { parseIndexedLocator } from "../src/indexedFragments.js";
import { viewContentToText } from "../src/viewText.js";
import type { ViewBuildJob, ViewSynthesisAdapter } from "../src/viewTypes.js";
import {
    compatibleSubjectIdentity,
    discoverInformationalDescriptors,
    usefulWikiSubject,
} from "../src/wikiGrouping.js";
import type { CorpusIndex } from "../src/types.js";
import type { WikiFamilyState } from "../src/viewStore.js";
import { TypedViewStore } from "../src/viewStore.js";

async function finishBuild(service: FileMemoryService, admitted: ViewBuildJob) {
    let job = admitted;
    for (let attempt = 0; job.state === "running" && attempt < 300; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Offline build receipt disappeared");
        job = current;
    }
    if (job.state !== "complete")
        throw new Error(
            `Offline build ${job.state}: ${job.results.map((result) => result.reason).join("; ")}`,
        );
    return job;
}

describe("conservative indexed grouping", () => {
    test("usefulness preserves a one-source definition, rejects metadata and unsupported shells", () => {
        expect(
            usefulWikiSubject(
                "accountable_role",
                "The accountable_role means the person responsible for the service outcome, rather than a review owner.",
            ),
        ).toBe(true);
        expect(
            usefulWikiSubject(
                "2026-10-08T13:22:00Z",
                "2026-10-08T13:22:00Z is the recorded ingestion timestamp for this observation.",
            ),
        ).toBe(false);
        expect(
            usefulWikiSubject(
                "42 ms",
                "42 ms was observed in the limited workload; no p95 was recorded.",
            ),
        ).toBe(false);
        expect(
            usefulWikiSubject(
                "status",
                "status: unknown; owner review has not established whether rollout is complete.",
            ),
        ).toBe(false);
        expect(
            usefulWikiSubject(
                "status",
                "Status means the explicitly recorded state of the initiative; unknown does not mean blocked.",
            ),
        ).toBe(true);
        expect(usefulWikiSubject("Verifier", "# Verifier")).toBe(false);
        expect(
            usefulWikiSubject(
                "Verifier",
                "Verifier validates the issuer for the local rehearsal; rollout remains unvalidated.",
            ),
        ).toBe(true);
        expect(
            usefulWikiSubject("Verifier", "Verifier validates issuers."),
        ).toBe(true);
    });
    test("explicit scope/type distinctions and absent evidence are not semantic equivalence", () => {
        expect(
            compatibleSubjectIdentity(
                { types: ["concept"], scopes: ["project:payments"] },
                { types: ["concept"], scopes: ["project:identity"] },
            ),
        ).toBe(false);
        expect(
            compatibleSubjectIdentity(
                { types: ["concept"], scopes: ["project:payments"] },
                { types: [], scopes: [] },
            ),
        ).toBe(true);
        expect(
            compatibleSubjectIdentity(
                { types: ["concept"], scopes: [] },
                { types: ["field"], scopes: [] },
            ),
        ).toBe(false);
        const family: WikiFamilyState = {
            enabled: true,
            dirty: true,
            cursor: 0,
            descriptors: [
                {
                    viewId: "existing",
                    query: "Accountable_role",
                    sourceIds: ["first"],
                },
            ],
        };
        discoverInformationalDescriptors(
            family,
            [
                {
                    term: "accountable role",
                    postingCount: 1,
                    sourceIds: ["unrelated"],
                },
            ],
            [],
            "wiki",
        );
        expect(
            family.descriptors.map((descriptor) => descriptor.viewId),
        ).toEqual(["existing"]);
        expect(family.error).toContain("lacks shared indexed subject evidence");
        const symbols: WikiFamilyState = {
            enabled: true,
            dirty: true,
            cursor: 0,
            descriptors: [],
        };
        discoverInformationalDescriptors(
            symbols,
            ["accountable_role", "accountable role"].map((term) => ({
                term,
                postingCount: 1,
                sourceIds: ["same"],
                identity: { types: ["field"], scopes: [] },
            })),
            [],
            "wiki",
        );
        expect(symbols.descriptors).toHaveLength(2);
    });
    test("real KnowPro discovery and repeated family passes preserve useful one-source lexical identity across cold restart", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "wiki-grouping-index-"),
        );
        let index: CorpusIndex | undefined;
        const previousEmbeddingProvider =
            process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        let generated = 0;
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-indexed-grouping",
            generate: async (input) => {
                generated++;
                return hydrateInformational(input, {
                    summary: "Grounded reference summary.",
                    status: "partial",
                    title: "Human-readable accountability",
                    prose: input.inputs
                        .map((source) => source.content)
                        .join("\n\n"),
                    limits: "Selected indexed evidence only; model semantics unqualified",
                    citationIds: input.inputs
                        .flatMap((source) => source.passages ?? [])
                        .map((_, position) => `f${position}`),
                });
            },
            validate: async () => {
                throw new Error("Legacy validation must not run");
            },
        };
        const open = () =>
            new FileMemoryService(root, {
                viewSynthesisAdapter: adapter,
                eventIndexFactory: (_corpusId, directory) =>
                    new FakeSemanticCorpusIndex(directory),
                indexFactory: (corpusId, directory) => {
                    index = createKnowProCorpusIndex(
                        corpusId,
                        directory,
                        () => {
                            const settings = createDocMemorySettings(
                                64,
                                undefined,
                                {
                                    completionSettings: {},
                                    complete: async () => {
                                        throw new Error(
                                            "Unexpected model call in offline index test",
                                        );
                                    },
                                },
                            );
                            settings.embeddingSize = 0;
                            const extract = (text: string) => ({
                                entities: [
                                    ...text.matchAll(
                                        /^Subject: (.+?)(?: \| Type: (.+))?$/gm,
                                    ),
                                ].map((match) => ({
                                    name: match[1],
                                    type: [match[2] ?? "concept"],
                                    facets: [
                                        {
                                            name: "project",
                                            value: "Local charter",
                                        },
                                    ],
                                })),
                                actions: [],
                                inverseActions: [],
                                topics: [],
                            });
                            settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                                {
                                    settings: { maxContextLength: 1000 },
                                    extract: async (text: string) =>
                                        extract(text),
                                    extractWithRetry: async (text: string) => ({
                                        success: true,
                                        data: extract(text),
                                    }),
                                };
                            return settings;
                        },
                    );
                    return index;
                },
            });
        let service = open();
        try {
            const { corpusId } = await service.createCorpus(
                "Real indexed usefulness",
            );
            for (const family of ["wiki", "projects", "topics"] as const) {
                await service.maintainViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    family,
                    operation: "pause",
                });
            }
            const receipt = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "charter",
                    sourceType: "text",
                    title: "Local charter",
                    text: "Subject: accountable_role\nSubject: accountable role\nSubject: 2026-10-08T13:22:00Z\nSubject: 42 ms\nSubject: status\nSubject: unsupported shell\n\nThe accountable_role, also written accountable role, means the person responsible for the service outcome rather than a review owner.\n\n2026-10-08T13:22:00Z is a recorded timestamp. 42 ms is the local median, not a rollout p95. status: unknown.\n\n# unsupported shell",
                },
            });
            const job = await waitForMemoryJob(service, receipt.jobId);
            expect(job.error).toBeUndefined();
            expect(job.state).toBe("complete");
            const page = await index!.listSubjects!(
                0,
                48,
                new Set(["charter"]),
            );
            expect(page.items.map((subject) => subject.term).sort()).toEqual([
                "accountable role",
                "accountable_role",
            ]);
            expect(
                page.items.every(
                    (subject) =>
                        subject.sourceIds.length === 1 &&
                        subject.postingCount === 1,
                ),
            ).toBe(true);
            expect(page.items[0].identity).toEqual({
                types: ["concept"],
                scopes: ["project:Local charter"],
            });
            const family: WikiFamilyState = {
                enabled: true,
                dirty: true,
                cursor: 0,
                descriptors: [],
            };
            discoverInformationalDescriptors(family, page.items, [], "wiki");
            expect(family.descriptors).toHaveLength(1);
            const store = new TypedViewStore(root);
            const legacy = await store.getWikiFamily(corpusId);
            legacy.descriptors = [
                {
                    viewId: "legacy-date",
                    query: "2026-10-08t13:22:00z",
                    sourceIds: ["charter"],
                },
                {
                    viewId: "legacy-quantity",
                    query: "42 ms",
                    sourceIds: ["charter"],
                },
                {
                    viewId: "legacy-shell",
                    query: "unsupported shell",
                    sourceIds: ["charter"],
                },
            ];
            await store.saveWikiFamily(corpusId, legacy);
            const resumed = await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "resume",
            });
            expect(resumed.job?.request.targets).toHaveLength(1);
            expect(
                resumed.plan.targets
                    .filter((target) => target.state === "blocked")
                    .map((target) => target.viewId)
                    .sort(),
            ).toEqual(["legacy-date", "legacy-quantity", "legacy-shell"]);
            expect(
                resumed.plan.targets
                    .filter((target) => target.state === "blocked")
                    .every((target) =>
                        target.reason.startsWith(
                            "Candidate usefulness filter:",
                        ),
                    ),
            ).toBe(true);
            await finishBuild(service, resumed.job!);
            const first = (await service.listViews(corpusId)).views;
            expect(first).toHaveLength(1);
            expect(first[0].content.title).toBe(
                "Human-readable accountability",
            );
            expect(first[0].definition.wiki?.query).not.toBe(
                first[0].content.title,
            );
            expect(first[0].content.citations.length).toBeGreaterThan(0);
            for (const citation of first[0].content.citations) {
                const range = parseIndexedLocator(citation.locator);
                expect(range.end - range.start).toBeLessThanOrEqual(2000);
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
            }
            expect(viewContentToText(first[0].content)).toContain(
                "Coverage limits:",
            );
            const calls = generated;
            const refresh = await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "update",
            });
            expect(refresh.job).toBeUndefined();
            await service.close();
            service = open();
            const restarted = await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family: "wiki",
                operation: "update",
            });
            expect(restarted.job).toBeUndefined();
            expect(generated).toBe(calls);
            expect(
                (await service.listViews(corpusId)).views.map(
                    (view) => view.viewId,
                ),
            ).toEqual([first[0].viewId]);
            const symbolsCorpus = (
                await service.createCorpus("Exact symbol identity")
            ).corpusId;
            for (const family of ["wiki", "projects", "topics"] as const)
                await service.maintainViews({
                    corpusId: symbolsCorpus,
                    expectedHead: (await service.listViews(symbolsCorpus)).head,
                    family,
                    operation: "pause",
                });
            const symbolsReceipt = await service.ingestDocument({
                corpusId: symbolsCorpus,
                source: {
                    sourceId: "symbols",
                    sourceType: "text",
                    title: "Symbol and concept",
                    text: "Subject: Accountable_Field | Type: field\nSubject: accountable field | Type: concept\n\nAccountable_Field is a case-sensitive field identifier. The accountable field concept describes review responsibility, not the field symbol.",
                },
            });
            const symbolsJob = await waitForMemoryJob(
                service,
                symbolsReceipt.jobId,
            );
            expect(symbolsJob.error).toBeUndefined();
            expect(symbolsJob.state).toBe("complete");
            const symbolSubjects = await index!.listSubjects!(
                0,
                48,
                new Set(["symbols"]),
            );
            expect(
                symbolSubjects.items.map((subject) => subject.term).sort(),
            ).toEqual(["Accountable_Field", "accountable field"]);
            expect(
                symbolSubjects.items.find(
                    (subject) => subject.term === "Accountable_Field",
                )!.identity?.symbols,
            ).toEqual(["Accountable_Field"]);
            const symbolPages = await service.maintainViews({
                corpusId: symbolsCorpus,
                expectedHead: (await service.listViews(symbolsCorpus)).head,
                family: "wiki",
                operation: "resume",
            });
            expect(symbolPages.job?.request.targets).toHaveLength(2);
            await finishBuild(service, symbolPages.job!);
            const distinctSymbols = (await service.listViews(symbolsCorpus))
                .views;
            expect(
                distinctSymbols
                    .map((view) => view.definition.wiki?.query)
                    .sort(),
            ).toEqual(["Accountable_Field", "accountable field"]);
            const ambiguousCorpus = (
                await service.createCorpus("Folded symbol ambiguity")
            ).corpusId;
            for (const family of ["wiki", "projects", "topics"] as const)
                await service.maintainViews({
                    corpusId: ambiguousCorpus,
                    expectedHead: (await service.listViews(ambiguousCorpus))
                        .head,
                    family,
                    operation: "pause",
                });
            const ambiguousReceipt = await service.ingestDocument({
                corpusId: ambiguousCorpus,
                source: {
                    sourceId: "ambiguous-symbols",
                    sourceType: "text",
                    title: "Two exact symbols",
                    text: "Subject: Control | Type: variable\nSubject: control | Type: variable\n\nControl is a case-sensitive C++ variable. control is a distinct JavaScript identifier; neither spelling aliases the other.",
                },
            });
            expect(
                (await waitForMemoryJob(service, ambiguousReceipt.jobId)).state,
            ).toBe("complete");
            const ambiguous = await service.maintainViews({
                corpusId: ambiguousCorpus,
                expectedHead: (await service.listViews(ambiguousCorpus)).head,
                family: "wiki",
                operation: "resume",
            });
            expect(ambiguous.job).toBeUndefined();
            const ambiguousViews = await service.listViews(ambiguousCorpus);
            expect(ambiguousViews.views).toHaveLength(0);
            expect(ambiguousViews.wikiFamily?.error).toContain(
                "multiple exact spellings share one folded index term",
            );
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
            if (previousEmbeddingProvider === undefined)
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            else
                process.env.TYPEAGENT_EMBEDDING_PROVIDER =
                    previousEmbeddingProvider;
        }
    });
});
