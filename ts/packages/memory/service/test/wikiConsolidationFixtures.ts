// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import {
    indexedLocator,
    parseIndexedLocator,
} from "../src/indexedFragments.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { ViewBuildStaleError } from "../src/viewBuilds.js";
import type { FileMemoryService } from "../src/fileMemoryService.js";
import type {
    IndexedFragmentRequest,
    IndexedFragmentSelection,
} from "../src/types.js";
import type {
    ViewSynthesisAdapter,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";
import type { WikiConsolidationScope } from "../src/wikiConsolidation.js";

const subjects = [
    { term: "lease-budget review", sources: ["review", "worksheet"] },
    { term: "connection-hold review", sources: ["review", "worksheet"] },
    { term: "application connection pool", sources: ["review"] },
    { term: "checkout waiting", sources: ["review"] },
    { term: "overlap review", sources: ["handoff"] },
    {
        term: "Identity token rotation overlap",
        sources: ["handoff"],
        qualified: true,
    },
    {
        term: "Orders schema migration overlap",
        sources: ["handoff"],
        qualified: true,
    },
];
export class ConsolidationIndex extends FakeSemanticCorpusIndex {
    async listSubjects(offset = 0) {
        const items = subjects.flatMap((subject) => {
            const documents = this.documents.filter((document) =>
                subject.sources.includes(document.source.sourceId),
            );
            if (
                !documents.length ||
                (subject.qualified &&
                    !documents.some((document) =>
                        document.content.includes("Identity"),
                    ))
            )
                return [];
            return [
                {
                    term: subject.term,
                    sourceIds: documents.map(
                        (document) => document.source.sourceId,
                    ),
                    postingCount: 1,
                },
            ];
        });
        return { total: items.length, items: offset ? [] : items };
    }
    override async getKnowledgeGraph() {
        return {
            entities: [],
            relationships: [],
            topics: (await this.listSubjects()).items.map((item) => ({
                name: item.term,
                sourceIds: item.sourceIds,
                mentionCount: 1,
            })),
        };
    }
    async readFragments(
        request: IndexedFragmentRequest,
    ): Promise<IndexedFragmentSelection> {
        const fragments: IndexedFragmentSelection["fragments"] = [];
        let remaining = request.maxReadChars ?? 8000;
        for (const document of this.documents.filter((entry) =>
            request.sourceIds?.includes(entry.source.sourceId),
        )) {
            const tail = document.content.indexOf("Governing tail exception:");
            for (const start of [
                ...new Set([0, ...(tail >= 0 ? [tail] : [])]),
            ]) {
                if (
                    fragments.length >= (request.maxFragments ?? 8) ||
                    remaining <= 0
                )
                    break;
                const end = Math.min(
                    document.content.length,
                    start +
                        Math.min(
                            1600,
                            request.maxCharsPerFragment ?? 2000,
                            remaining,
                        ),
                );
                const block = {
                    sourceId: document.source.sourceId,
                    revisionId: document.revision.revisionId,
                    blockOrdinal: 0,
                    text: document.content,
                    score: 1,
                };
                fragments.push({
                    sourceId: block.sourceId,
                    revisionId: block.revisionId,
                    locator: indexedLocator(block, start, end),
                    snippet: document.content.slice(start, end),
                    score: 1,
                });
                remaining -= end - start;
            }
        }
        return {
            fragments,
            readChars: fragments.reduce(
                (sum, fragment) => sum + fragment.snippet.length,
                0,
            ),
            limited: true,
        };
    }
    async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ) {
        const document = this.documents.find(
            (entry) =>
                entry.source.sourceId === sourceId &&
                entry.revision.revisionId === revisionId,
        );
        if (!document)
            throw new Error("Original consolidation evidence is obsolete");
        const range = parseIndexedLocator(locator);
        const block = {
            sourceId,
            revisionId,
            blockOrdinal: 0,
            text: document.content,
            score: 1,
        };
        if (locator !== indexedLocator(block, range.start, range.end))
            throw new Error("Original consolidation evidence locator changed");
        return document.content.slice(range.start, range.end);
    }
}

export function originalFixtureRoot(): string {
    return fileURLToPath(
        new URL(
            "../../test/fixtures/memoryDemo/memory-import-second-brain-maintenance/content-only/",
            import.meta.url,
        ),
    );
}
export async function ingestFixture(
    service: FileMemoryService,
    corpusId: string,
    stage: string,
    file: string,
    sourceId: string,
) {
    const text = await readFile(
        path.join(originalFixtureRoot(), stage, file),
        "utf8",
    );
    expect(text).not.toContain("MAINTENANCE_EVALUATOR_ONLY");
    const existing = (await service.listSources(corpusId)).find(
        (source) => source.sourceId === sourceId,
    );
    const source = { sourceType: "markdown" as const, title: sourceId, text };
    const job = existing
        ? await service.replaceSource({
              corpusId,
              sourceId,
              expectedActiveRevisionId: existing.activeRevisionId,
              source,
          })
        : await service.ingestDocument({
              corpusId,
              source: { ...source, sourceId },
          });
    expect((await waitForMemoryJob(service, job.jobId)).state).toBe("complete");
}
export async function settleConsolidation(
    service: FileMemoryService,
    corpusId: string,
    allowDecision = false,
) {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const snapshot = await service.listViews(corpusId);
        const jobs = await service.listViewBuilds(corpusId);
        const decision =
            allowDecision &&
            jobs.some((job) =>
                job.results.some((result) => result.state === "conflicted"),
            );
        if (
            !jobs.some((job) => job.state === "running") &&
            (!snapshot.wikiFamily?.pending || decision) &&
            !snapshot.projectFamily?.pending
        )
            return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Offline consolidation did not settle");
}
export async function changeFamily(
    service: FileMemoryService,
    corpusId: string,
    operation: "pause" | "resume" | "update",
) {
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            return await service.maintainViews({
                corpusId,
                family: "wiki",
                operation,
                expectedHead: (await service.listViews(corpusId)).head,
            });
        } catch (error) {
            if (
                !(error instanceof Error) ||
                (!(error instanceof ViewBuildStaleError) &&
                    error.constructor.name !== "ViewBuildStaleError") ||
                error.message !== "Wiki-family history head changed"
            )
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    throw new Error("Offline consolidation family guard did not settle");
}
export function offlineConsolidationAdapter() {
    const calls = { generation: 0, purpose: 0, actual: 0 };
    const adapter: ViewSynthesisAdapter = {
        identity: "offline-actual-P0-consolidation",
        async generate(input) {
            calls.generation++;
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            return hydrateInformational(input, {
                title:
                    input.editorial?.generatedBase.content.title ??
                    input.definition.wiki!.query,
                prose: `Subject: ${input.definition.wiki!.query}\n\n${fragments.map((fragment) => fragment.excerpt).join("\n\n")}`,
                limits: "Selected original indexed evidence; no exhaustive coverage or execution authority",
                citationIds: fragments.map((_, index) => `f${index}`),
            });
        },
        async validate() {
            throw new Error(
                "Informational consolidation must not use universal model checking",
            );
        },
        async checkEditorial() {
            return { safe: true, failures: [] };
        },
        async assessWikiSubject(input): Promise<WikiSubjectAssessment> {
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            return {
                disposition: input.wikiContribution ? "covered" : "distinct",
                canonicalViewId: input.wikiContribution
                    ? input.definition.viewId
                    : "",
                purpose: "Independent scoped article",
                reason: "Offline original evidence",
                sharedFragmentIds: [],
                ambiguousViewIds: [],
                essentialDistinctions: input.wikiContribution
                    ? [
                          ...input.wikiContribution.essentialDistinctions.map(
                              (item) => ({
                                  ...item,
                                  canonicalExcerpt:
                                      fragments[
                                          Number(item.fragmentId.slice(1))
                                      ].excerpt,
                              }),
                          ),
                          ...fragments.map((fragment, index) => ({
                              fragmentId: `f${index}`,
                              statement:
                                  "Current indexed scope and qualifications remain verbatim in actual prose",
                              canonicalExcerpt: fragment.excerpt,
                          })),
                      ]
                    : [],
            };
        },
        async assessWikiConsolidation(
            input,
            survivor,
            retiring,
        ): Promise<WikiConsolidationScope> {
            calls.purpose++;
            const review = [survivor, retiring].every((view) =>
                ["lease-budget review", "connection-hold review"].includes(
                    view.definition.wiki!.query.toLowerCase(),
                ),
            );
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            const clarification = fragments.findIndex((fragment) =>
                fragment.excerpt.includes("explicit scope clarification"),
            );
            if (!review || clarification < 0)
                return {
                    relation: "distinct",
                    reason: "unqualified-purpose",
                    scope: {
                        system: "Payments or independently scoped initiatives",
                        initiative: "",
                        purpose: "Not established",
                    },
                    criticalDistinctions: [],
                };
            return {
                relation: "samePurpose",
                reason: "same-scoped-purpose",
                scope: {
                    system: "Payments API",
                    initiative: "Reliability capacity review",
                    purpose:
                        "Lease lifetime and resident memory capacity review",
                },
                criticalDistinctions: [
                    {
                        fragmentId: `f${clarification}`,
                        statement:
                            "Both review labels name one Payments capacity review; it remains open, not approved or complete, with lease lifetime and resident memory retained.",
                    },
                ],
            };
        },
        async checkWikiConsolidation(input, output) {
            calls.actual++;
            const body = output.content.sections
                .map((section) => section.body)
                .join("\n");
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            return {
                safe: fragments.every((fragment) =>
                    body.includes(fragment.excerpt),
                ),
                failures: [],
            };
        },
    };
    return { adapter, calls };
}
