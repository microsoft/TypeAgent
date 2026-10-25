// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import {
    contributingSources,
    nominateWikiPages,
    parseWikiAssessment,
    wikiPageContext,
} from "../src/wikiAdmission.js";
import {
    refreshWikiContributionInput,
    wikiContributionInput,
} from "../src/wikiContribution.js";
import { viewSourceKey } from "../src/viewContent.js";
import { derivedDefinitionInput } from "../src/viewRelationships.js";
import { mergeView, recordViewEdits, viewHash } from "../src/viewMerge.js";
import { ViewBuildStaleError } from "../src/viewBuilds.js";
import { TypedViewStore } from "../src/viewStore.js";
import type { IndexedFragmentRequest, IndexedDocument } from "../src/types.js";
import type {
    ViewBuildSnapshot,
    ViewVersion,
    WikiSubjectAssessment,
    ViewBuildJob,
} from "../src/viewTypes.js";

const oldFact =
    "Connection lease acquisition is separate from SQL execution. Median 1850 ms is not p95, and a recorded pool maximum 100 is not a deployment default.";
const contrast =
    "Command execution can be short while a connection lease is long. Application work, transaction scope and delayed disposal can occupy pool slots; this is a proposed diagnostic distinction, not proof of a leak.";
const text = `${oldFact}\n\n${contrast}`;

class ContributionIndex extends FakeSemanticCorpusIndex {
    static includeCommand = false;
    static failDerived = false;
    static derivedBuilds = 0;
    override async rebuild(documents: IndexedDocument[]) {
        if (documents[0]?.source.sourceId !== "source")
            ContributionIndex.derivedBuilds++;
        if (
            ContributionIndex.failDerived &&
            documents[0]?.source.sourceId !== "source"
        )
            throw new Error("Controlled derivative indexing failure");
        await super.rebuild(documents);
    }
    async listSubjects(offset: number) {
        const terms = ContributionIndex.includeCommand
            ? ["connection lease", "command execution"]
            : ["connection lease"];
        return {
            total: terms.length,
            items: offset
                ? []
                : terms.map((term) => ({
                      term,
                      postingCount: 1,
                      sourceIds: ["source"],
                  })),
        };
    }
    override async getKnowledgeGraph() {
        const subjects = await this.listSubjects(0);
        return {
            entities: [],
            relationships: [],
            topics: subjects.items.map((subject) => ({
                name: subject.term,
                sourceIds: subject.sourceIds,
                mentionCount: 1,
            })),
        };
    }
    async readFragments(request: IndexedFragmentRequest) {
        const document = this.documents.find(
            (entry) => entry.source.sourceId === "source",
        );
        if (!document) throw new Error("Offline source index missing");
        const parts = request.terms.includes("connection lease")
            ? [oldFact]
            : [];
        if (request.terms.includes("command execution")) parts.push(contrast);
        const fragments = parts.map((snippet) => {
            const start = document.content.indexOf(snippet);
            if (start < 0) throw new Error("Offline fragment no longer exists");
            return {
                sourceId: "source",
                revisionId: document.revision.revisionId,
                snippet,
                score: 1,
                locator: `indexed:0:${document.revision.contentHash}:${start}-${start + snippet.length}`,
            };
        });
        return { fragments, readChars: parts.join("").length, limited: false };
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
        const match = /^indexed:0:([a-f0-9]{64}):(\d+)-(\d+)$/.exec(locator);
        if (!document || match?.[1] !== document.revision.contentHash)
            throw new Error("Offline indexed locator is unavailable");
        return document.content.slice(Number(match[2]), Number(match[3]));
    }
}

function assessment(
    input: ViewBuildSnapshot,
    context: ReturnType<typeof wikiPageContext>,
    disposition: WikiSubjectAssessment["disposition"],
): WikiSubjectAssessment {
    return {
        disposition,
        purpose: "Same scoped connection lease explanation",
        reason: "Preserve acquisition/SQL and short-command/long-lease distinctions",
        canonicalViewId: disposition === "distinct" ? "" : context.viewId,
        sharedFragmentIds:
            disposition === "distinct" ? [] : context.sharedFragmentIds,
        ambiguousViewIds: [],
        essentialDistinctions:
            disposition === "distinct"
                ? []
                : input.inputs
                      .flatMap((source) => source.passages ?? [])
                      .map((fragment, index) => ({
                          fragmentId: `f${index}`,
                          statement: fragment.excerpt,
                          canonicalExcerpt: context.prose.includes(
                              fragment.excerpt,
                          )
                              ? fragment.excerpt
                              : "",
                      })),
    };
}

function snapshot(): ViewBuildSnapshot {
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "offline:wiki-source-contribution-v3",
        fingerprint: "input",
        definition: {
            viewId: "new",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "command execution",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Source",
                content: contrast,
                contentHash: "a".repeat(64),
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "revision",
                        locator: `indexed:0:${"a".repeat(64)}:200-400`,
                        excerpt: contrast,
                    },
                ],
            },
        ],
    };
}
function canonical(): ViewVersion {
    const input = snapshot();
    input.definition.viewId = "canonical";
    input.definition.wiki!.query = "connection lease";
    input.inputs[0].content = oldFact;
    input.inputs[0].passages![0] = {
        ...input.inputs[0].passages![0],
        locator: `indexed:0:${"a".repeat(64)}:0-150`,
        excerpt: oldFact,
    };
    const output = hydrateInformational(input, {
        summary: "Grounded reference summary.",
        status: "partial",
        title: "Connection lease",
        prose: oldFact,
        limits: "Selected indexed evidence",
        citationIds: ["f0"],
    });
    return {
        viewId: "canonical",
        corpusId: "corpus",
        revisionId: "page-revision",
        version: 1,
        state: "draft",
        provenance: "generated",
        actor: "test",
        createdAt: "2026-10-11T00:00:00Z",
        definition: { ...input.definition, revisionId: "definition" },
        content: output.content,
        relationships: [],
        generation: {
            candidateId: "generated",
            content: structuredClone(output.content),
            fingerprint: viewHash(output.content),
            relationships: [],
            input,
        },
    };
}

test("same/subset contributing revisions nominate different locators; empty and cross-revision sets do not", () => {
    const input = snapshot(),
        page = canonical();
    input.definition.selector.sources.push({
        sourceId: "queried-but-not-selected",
        revisionId: "unused",
    });
    expect(
        contributingSources([
            ...page.content.citations,
            ...page.content.citations,
        ]),
    ).toEqual([{ sourceId: "source", revisionId: "revision" }]);
    let pages = nominateWikiPages(input, [page], new Map());
    expect(pages[0].sharedFragmentIds).toEqual([]);
    expect(pages[0].sourceOverlap).toEqual({
        shared: 1,
        union: 1,
        subset: true,
    });
    for (const change of [
        { locator: input.inputs[0].passages![0].locator },
        { excerpt: input.inputs[0].passages![0].excerpt },
    ]) {
        const changed = structuredClone(page);
        Object.assign(changed.content.citations[0], change);
        const context = nominateWikiPages(input, [changed], new Map())[0];
        expect(context.sourceOverlap.shared).toBe(1);
        expect(context.sharedFragmentIds).toEqual([]);
        expect(() =>
            parseWikiAssessment(
                {
                    ...assessment(input, context, "contribute"),
                    sharedFragmentIds: ["f0"],
                },
                [context],
            ),
        ).toThrow("unsupported-shared-fragments");
    }
    const broader = structuredClone(page);
    broader.content.citations.push({
        ...broader.content.citations[0],
        sourceId: "other",
    });
    pages = nominateWikiPages(input, [broader], new Map());
    expect(pages[0].sourceOverlap).toEqual({
        shared: 1,
        union: 2,
        subset: true,
    });
    const replaced = structuredClone(page);
    replaced.content.citations[0].revisionId = "replacement";
    expect(nominateWikiPages(input, [replaced], new Map())).toEqual([]);
    expect(
        nominateWikiPages({ ...input, inputs: [] }, [page], new Map()),
    ).toEqual([]);
    expect(
        nominateWikiPages(
            input,
            [{ ...page, content: { ...page.content, citations: [] } }],
            new Map(),
        ),
    ).toEqual([]);
});

test.each([
    ["project:a", "project:b"],
    ["episode:a", "episode:b"],
    ["unit:ms", "unit:bytes"],
    ["cohort:peak", "cohort:idle"],
])(
    "same source does not override explicit different scope %s / %s",
    (left, right) => {
        expect(
            nominateWikiPages(
                snapshot(),
                [canonical()],
                new Map([
                    ["new", { types: [], scopes: [left] }],
                    ["canonical", { types: [], scopes: [right] }],
                ]),
            ),
        ).toEqual([]);
    },
);

test("covered requires explicit actual prose for every fragment; contribution requires a missing essential distinction", () => {
    const input = snapshot(),
        page = canonical();
    const context = wikiPageContext(input, page);
    expect(() =>
        parseWikiAssessment(assessment(input, context, "covered"), [context]),
    ).toThrow("incomplete-prose-coverage");
    const contribution = assessment(input, context, "contribute");
    expect(parseWikiAssessment(contribution, [context]).disposition).toBe(
        "contribute",
    );
    expect(() =>
        parseWikiAssessment({ ...contribution, essentialDistinctions: [] }, [
            context,
        ]),
    ).toThrow("incomplete-prose-coverage");
    expect(() =>
        parseWikiAssessment(
            {
                ...contribution,
                essentialDistinctions: [
                    {
                        fragmentId: "f0",
                        statement: "novel contrast",
                        canonicalExcerpt: "invented prose",
                    },
                ],
            },
            [context],
        ),
    ).toThrow("invalid-distinction-evidence");
    const independent = assessment(input, context, "distinct");
    expect(parseWikiAssessment(independent, [context]).disposition).toBe(
        "distinct",
    );
});

test("canonical contribution preserves editorial title, taxonomy, note and exclusions through the real merge helper", () => {
    const input = snapshot(),
        page = canonical();
    const context = wikiPageContext(input, page);
    const combined = wikiContributionInput(
        input,
        page,
        assessment(input, context, "contribute"),
    );
    const candidate = hydrateInformational(combined, {
        summary: "Grounded reference summary.",
        status: "partial",
        title: "Generated title",
        prose: `${oldFact}\n\n${contrast}`,
        limits: "Bounded",
        citationIds: ["f0", "f1"],
    });
    const edited = structuredClone(page);
    edited.content.title = "Human canonical title";
    const details = edited.content.sections[0].details;
    if (details?.kind !== "page" || !("construction" in details))
        throw new Error("Expected informational page details");
    details.note = "Human personal note";
    details.taxonomy = "system";
    edited.definition.wiki!.excludedSourceIds = ["not-cited"];
    edited.edits = recordViewEdits(page, edited.content, [], "human");
    const merged = mergeView(edited, candidate, combined.inputs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.output.content.title).toBe("Human canonical title");
    expect(merged.output.content.sections[0].details).toMatchObject({
        taxonomy: "system",
        note: "Human personal note",
    });
    expect(edited.definition.wiki!.excludedSourceIds).toEqual(["not-cited"]);
    expect(merged.output.content.sections[0].body).toContain(oldFact);
    expect(merged.output.content.sections[0].body).toContain(contrast);
});

test("synthetic host coverage rejects truncated prose even when every claimed witness is visible", () => {
    const input = snapshot();
    const page = canonical();
    page.content.sections[0].body = `${contrast}\n${"Bounded context. ".repeat(400)}`;
    const context = wikiPageContext(input, page);
    expect(context.prose).toHaveLength(6000);
    expect(context.proseTruncated).toBe(true);
    expect(context.prose).toContain(contrast);
    expect(() =>
        parseWikiAssessment(assessment(input, context, "covered"), [context]),
    ).toThrow("incomplete-prose-coverage");
    const complete = wikiPageContext(input, page, undefined, false);
    expect(complete.proseTruncated).toBe(false);
    const accepted = parseWikiAssessment(
        assessment(input, complete, "covered"),
        [complete],
    );
    expect(accepted.disposition).toBe("covered");
});

test.each(["old", "incoming"])(
    "synthetic merged-prose coverage rejects a missing %s explanation despite retained exact citations",
    (missing) => {
        const input = snapshot();
        const page = canonical();
        const initial = wikiPageContext(input, page);
        const combined = wikiContributionInput(
            input,
            page,
            assessment(input, initial, "contribute"),
        );
        const output = hydrateInformational(combined, {
            summary: "Grounded reference summary.",
            status: "partial",
            title: "Connection lease",
            prose: `${oldFact}\n\n${contrast}`,
            limits: "Selected evidence",
            citationIds: ["f0", "f1"],
        });
        const merged = mergeView(page, output, combined.inputs);
        expect(merged.conflicts).toEqual([]);
        const requirements = combined.wikiContribution!.essentialDistinctions;
        const complete = wikiPageContext(
            combined,
            { ...page, content: merged.output.content },
            undefined,
            false,
        );
        const verified = assessment(combined, complete, "covered");
        expect(
            parseWikiAssessment(verified, [complete], requirements).disposition,
        ).toBe("covered");
        const omitted = structuredClone(merged.output.content);
        omitted.sections[0].body = missing === "old" ? contrast : oldFact;
        expect(omitted.citations).toEqual(merged.output.content.citations);
        const incomplete = wikiPageContext(
            combined,
            { ...page, content: omitted },
            undefined,
            false,
        );
        expect(incomplete.sharedFragmentIds).toEqual(["f0", "f1"]);
        expect(() =>
            parseWikiAssessment(verified, [incomplete], requirements),
        ).toThrow("invalid-distinction-evidence");
        expect(() =>
            parseWikiAssessment(
                assessment(combined, incomplete, "covered"),
                [incomplete],
                requirements,
            ),
        ).toThrow("incomplete-prose-coverage");
    },
);

test("multiple historical candidates remain an explicit typed ambiguity, never a canonical merge", () => {
    const input = snapshot();
    const first = canonical(),
        second = {
            ...canonical(),
            viewId: "second",
            revisionId: "second-revision",
        };
    const pages = [
        wikiPageContext(input, first),
        wikiPageContext(input, second),
    ];
    const ambiguous = {
        ...assessment(input, pages[0], "distinct"),
        disposition: "ambiguous",
        ambiguousViewIds: ["canonical", "second"],
    };
    expect(parseWikiAssessment(ambiguous, pages).disposition).toBe("ambiguous");
    expect(() =>
        parseWikiAssessment(
            { ...ambiguous, ambiguousViewIds: ["canonical", "invented"] },
            pages,
        ),
    ).toThrow();
    expect(() =>
        parseWikiAssessment(
            { ...ambiguous, canonicalViewId: "canonical" },
            pages,
        ),
    ).toThrow();
});

test("contribution union retains original exact evidence, metadata, stable ID and aliases without treating prose as a source", () => {
    const input = snapshot(),
        page = canonical();
    page.definition.wiki!.aliases = ["existing alias"];
    const context = wikiPageContext(input, page);
    const combined = wikiContributionInput(
        input,
        page,
        assessment(input, context, "contribute"),
    );
    expect(combined.definition.viewId).toBe("canonical");
    expect(combined.expectedVersion).toBe(1);
    expect(combined.targetRevisionId).toBe(page.revisionId);
    expect(combined.definition.wiki!.aliases).toEqual([
        "existing alias",
        "command execution",
    ]);
    expect(
        combined.inputs[0].passages!.map((fragment) => fragment.excerpt),
    ).toEqual([oldFact, contrast]);
    expect(combined.inputs[0].content).not.toContain("Coverage limits:");
    expect(combined.wikiContribution!.essentialDistinctions[0].fragmentId).toBe(
        "f1",
    );
    const output = hydrateInformational(combined, {
        summary: "Grounded reference summary.",
        status: "partial",
        title: "Connection lease",
        prose: `${oldFact}\n\n${contrast}`,
        limits: "Selected evidence",
        citationIds: ["f0", "f1"],
    });
    const next = {
        ...page,
        content: output.content,
        definition: { ...page.definition, ...combined.definition },
        generation: { ...page.generation!, input: combined },
    };
    const contextAfter = wikiPageContext(combined, next, undefined, false);
    const verified = assessment(combined, contextAfter, "covered");
    expect(
        parseWikiAssessment(
            verified,
            [contextAfter],
            combined.wikiContribution!.essentialDistinctions,
        ).disposition,
    ).toBe("covered");
    expect(() =>
        parseWikiAssessment(
            {
                ...verified,
                essentialDistinctions: verified.essentialDistinctions.map(
                    (item) =>
                        item.fragmentId === "f1"
                            ? {
                                  ...item,
                                  statement: "less specific distinction",
                              }
                            : item,
                ),
            },
            [contextAfter],
            combined.wikiContribution!.essentialDistinctions,
        ),
    ).toThrow("required-distinction-omitted");
    const refreshed = refreshWikiContributionInput(
        { ...combined, inputs: [snapshot().inputs[0]] },
        next,
        new Set([
            viewSourceKey({ sourceId: "source", revisionId: "revision" }),
        ]),
    );
    expect(
        refreshed.inputs[0].passages!.map((fragment) => fragment.excerpt),
    ).toEqual([oldFact, contrast]);
    expect(
        refreshed.wikiContribution!.essentialDistinctions[0].fragmentId,
    ).toBe("f1");
    page.definition.wiki!.excludedSourceIds = ["source"];
    expect(() =>
        wikiContributionInput(
            input,
            page,
            assessment(input, context, "contribute"),
        ),
    ).toThrow("excluded");
    page.definition.wiki!.excludedSourceIds = [];
    input.inputs[0].revisionId = "replacement";
    input.inputs[0].passages![0].revisionId = "replacement";
    expect(() =>
        wikiContributionInput(
            input,
            page,
            assessment(input, context, "contribute"),
        ),
    ).toThrow("mixes revisions");
});

async function terminal(
    service: FileMemoryService,
    job: ViewBuildJob | undefined,
): Promise<ViewBuildJob> {
    if (!job) throw new Error("Expected actual offline build job");
    for (let attempt = 0; job.state === "running" && attempt < 500; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        job = (await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        }))!;
    }
    expect(job.state).not.toBe("running");
    return job;
}

async function maintainFamily(
    service: FileMemoryService,
    corpusId: string,
    family: "wiki" | "projects",
    operation: "update" | "pause" | "resume" | "rebuild",
) {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            return await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family,
                operation,
            });
        } catch (error) {
            if (!(error instanceof ViewBuildStaleError) || attempt === 9)
                throw error;
        }
    }
    throw new Error("Contribution family optimistic head retries exhausted");
}

async function rehearsal(
    mode:
        | "success"
        | "missing"
        | "provider"
        | "conflict"
        | "stale"
        | "index"
        | "forget"
        | "binding-replay"
        | "replacement",
) {
    ContributionIndex.includeCommand = false;
    ContributionIndex.failDerived = false;
    ContributionIndex.derivedBuilds = 0;
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-contribution-"));
    let generated = 0,
        assessed = 0;
    let service: FileMemoryService;
    let corpusId = "";
    let forgetting: Promise<unknown> | undefined;
    const adapter = {
        identity: "offline-contribution",
        assessWikiSubject: async (
            input: ViewBuildSnapshot,
            pages: ReturnType<typeof nominateWikiPages>,
        ) => {
            if (!pages.length)
                return {
                    disposition: "distinct" as const,
                    purpose: "Useful reference explanation",
                    reason: "Concrete facts explain the scoped connection lease",
                    canonicalViewId: "",
                    sharedFragmentIds: [],
                    essentialDistinctions: [],
                    ambiguousViewIds: [],
                };
            assessed++;
            expect(pages).toHaveLength(1);
            return assessment(
                input,
                pages[0],
                input.wikiContribution ? "covered" : "contribute",
            );
        },
        generate: async (input: ViewBuildSnapshot) => {
            generated++;
            let prose = input.inputs
                .flatMap((source) => source.passages ?? [])
                .map((fragment) => fragment.excerpt)
                .join("\n\n");
            if (input.wikiContribution) {
                expect(input.expectedVersion).toBe(mode === "conflict" ? 2 : 1);
                expect(prose).toContain(oldFact);
                expect(prose).toContain(contrast);
                if (mode === "provider")
                    throw new Error("Controlled contribution provider failure");
                if (mode === "missing") prose = oldFact;
                if (mode === "conflict")
                    prose = prose.replace(
                        "Connection lease acquisition",
                        "Generated incompatible lease explanation",
                    );
                if (mode === "stale") {
                    await maintainFamily(service, corpusId, "wiki", "pause");
                    const page = (await service.listViews(corpusId)).views[0];
                    const content = structuredClone(page.content);
                    content.title = "Human retained title";
                    await service.saveViewDraft({
                        corpusId,
                        viewId: page.viewId,
                        expectedHead: (await service.listViews(corpusId)).head,
                        expectedVersion: page.version,
                        definition: derivedDefinitionInput(page),
                        content,
                        relationships: [],
                    });
                }
                if (mode === "forget") {
                    const preview = await service.previewForgetSource(
                        corpusId,
                        "source",
                    );
                    forgetting = service.forgetSource({
                        corpusId,
                        sourceId: "source",
                        confirmationToken: preview.confirmationToken,
                    });
                    await forgetting;
                }
                if (mode === "replacement") {
                    await maintainFamily(service, corpusId, "wiki", "pause");
                    const replacement = await service.ingestDocument({
                        corpusId,
                        source: {
                            sourceId: "source",
                            sourceType: "text",
                            title: "Lease source",
                            text: `${text}\nA current correction with a new source revision.`,
                        },
                    });
                    expect(
                        (await waitForMemoryJob(service, replacement.jobId))
                            .state,
                    ).toBe("complete");
                }
            }
            return hydrateInformational(input, {
                summary: "Grounded reference summary.",
                status: "partial",
                title: "Connection lease",
                prose,
                limits: "Selected evidence; no universal default or leak proof",
                citationIds: input.inputs
                    .flatMap((source) => source.passages ?? [])
                    .map((_, index) => `f${index}`),
            });
        },
        validate: async () => {
            throw new Error("Legacy validation must not run");
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            discoveryPolicy: "off",
            indexFactory: (_id, directory) => new ContributionIndex(directory),
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    service = open();
    try {
        ({ corpusId } = await service.createCorpus(
            "Offline canonical contribution",
        ));
        for (const family of ["wiki", "projects"] as const)
            await maintainFamily(service, corpusId, family, "pause");
        const ingestion = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Lease source",
                text,
            },
        });
        expect((await waitForMemoryJob(service, ingestion.jobId)).state).toBe(
            "complete",
        );
        const first = await maintainFamily(service, corpusId, "wiki", "resume");
        expect((await terminal(service, first.job)).state).toBe("complete");
        await maintainFamily(service, corpusId, "wiki", "pause");
        const original = (await service.listViews(corpusId)).views[0];
        if (mode === "conflict") {
            const content = structuredClone(original.content);
            content.sections[0].body = content.sections[0].body.replace(
                "Connection lease acquisition",
                "Human incompatible lease explanation",
            );
            await service.saveViewDraft({
                corpusId,
                viewId: original.viewId,
                expectedHead: (await service.listViews(corpusId)).head,
                expectedVersion: original.version,
                definition: derivedDefinitionInput(original),
                content,
                relationships: [],
            });
        }
        ContributionIndex.includeCommand = true;
        ContributionIndex.failDerived = mode === "index";
        const second = await maintainFamily(
            service,
            corpusId,
            "wiki",
            "resume",
        );
        if (mode === "forget") {
            const jobId = second.job!.jobId;
            for (let attempt = 0; !forgetting && attempt < 500; attempt++)
                await new Promise((resolve) => setTimeout(resolve, 10));
            expect(forgetting).toBeDefined();
            await forgetting;
            let remaining = await service.getViewBuild({ corpusId, jobId });
            for (let attempt = 0; remaining && attempt < 500; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                remaining = await service.getViewBuild({ corpusId, jobId });
            }
            expect(remaining).toBeUndefined();
            expect((await service.listViews(corpusId)).views).toHaveLength(0);
            expect(await service.listViewBuilds(corpusId)).toHaveLength(0);
            return;
        }
        const job = await terminal(service, second.job);
        const result = job.results.find(
            (entry) =>
                entry.snapshot.definition.wiki?.query === "command execution",
        )!;
        if (mode === "replacement") {
            expect(result.state).toBe("stale");
            expect(result.wikiContribution).toBeUndefined();
            expect((await service.listViews(corpusId)).views).toHaveLength(0);
            const raw = await new TypedViewStore(root).listViews(corpusId);
            expect(raw.views).toHaveLength(1);
            expect(raw.views[0].state).toBe("stale");
            expect(
                raw.views[0].generation?.input?.wikiContribution,
            ).toBeUndefined();
            expect(raw.views[0].content.sections[0].body).toContain(oldFact);
            expect(raw.views[0].definition.wiki?.aliases).not.toContain(
                "command execution",
            );
            return;
        }
        if (mode === "binding-replay") {
            expect(result.wikiContribution?.state).toBe("bound");
            await maintainFamily(service, corpusId, "wiki", "pause");
            await new TypedViewStore(root).updateViewBuild(
                corpusId,
                job.jobId,
                (saved) => {
                    saved.state = "interrupted";
                    const target = saved.results.find(
                        (entry) => entry.viewId === result.viewId,
                    )!;
                    target.state = "interrupted";
                    target.wikiContribution!.state = "committed";
                },
            );
            const before = [
                generated,
                assessed,
                ContributionIndex.derivedBuilds,
            ];
            const retried = await terminal(
                service,
                await service.retryViewBuild({ corpusId, jobId: job.jobId }),
            );
            expect(retried.results[0].state).toBe("skipped");
            expect(retried.results[0].wikiContribution!.revisionId).toBe(
                result.wikiContribution!.revisionId,
            );
            expect([
                generated,
                assessed,
                ContributionIndex.derivedBuilds,
            ]).toEqual(before);
            return;
        }
        if (mode === "index") {
            expect(result.state).not.toBe("skipped");
            expect(result.wikiContribution?.state).toBe("committed");
            const revision = result.wikiContribution!.revisionId;
            ContributionIndex.failDerived = false;
            const calls = [generated, assessed];
            const retried = await terminal(
                service,
                await service.retryViewBuild({ corpusId, jobId: job.jobId }),
            );
            expect(retried.results[0].wikiContribution?.state).toBe("bound");
            expect(retried.results[0].state).toBe("skipped");
            expect(retried.results[0].wikiContribution!.revisionId).toBe(
                revision,
            );
            expect([generated, assessed]).toEqual(calls);
        } else if (mode !== "success") {
            expect(result.state).toBe(
                mode === "stale"
                    ? "stale"
                    : mode === "conflict"
                      ? "conflicted"
                      : "blocked",
            );
            expect(result.wikiContribution).toBeUndefined();
            expect((await service.listViews(corpusId)).views).toHaveLength(1);
            expect(
                (await service.listViews(corpusId)).wikiFamily?.pending,
            ).toBe(true);
            if (mode === "conflict") {
                const conflict = await service.getViewConflict({
                    corpusId,
                    conflictId: result.conflictId!,
                });
                expect(conflict?.viewId).toBe(original.viewId);
                expect(
                    (await service.listViews(corpusId)).views[0].content
                        .sections[0].body,
                ).toContain("Human incompatible");
                const before = [generated, assessed];
                const blocked = await maintainFamily(
                    service,
                    corpusId,
                    "wiki",
                    "update",
                );
                expect(blocked.job).toBeUndefined();
                expect(
                    blocked.plan.targets.some(
                        (target) => target.state === "blocked",
                    ),
                ).toBe(true);
                expect(
                    (await service.listViews(corpusId)).wikiFamily?.pending,
                ).toBe(true);
                expect([generated, assessed]).toEqual(before);
                await expect(
                    service.retryViewBuild({ corpusId, jobId: job.jobId }),
                ).rejects.toThrow("Resolve canonical Wiki edit conflict");
            }
            return;
        } else {
            expect(result.state).toBe("skipped");
            expect(result.wikiContribution?.state).toBe("bound");
            expect(result.wikiAssessment?.disposition).toBe("contribute");
            const current = (await service.listViews(corpusId)).views;
            expect(current).toHaveLength(1);
            expect(current[0].viewId).toBe(original.viewId);
            expect(current[0].version).toBe(2);
            expect(current[0].content.sections[0].body).toContain(oldFact);
            expect(current[0].content.sections[0].body).toContain(contrast);
            expect(current[0].content.citations).toHaveLength(2);
        }
        const before = [generated, assessed];
        await service.close();
        service = open();
        const update = await maintainFamily(
            service,
            corpusId,
            "wiki",
            "update",
        );
        expect(update.job).toBeUndefined();
        expect([generated, assessed]).toEqual(before);
        expect((await service.listViews(corpusId)).views).toHaveLength(1);
        expect((await service.listViews(corpusId)).wikiFamily?.pending).toBe(
            false,
        );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}

test.each([
    "success",
    "missing",
    "provider",
    "conflict",
    "stale",
    "index",
    "forget",
    "binding-replay",
    "replacement",
] as const)(
    "actual isolated service contribution: %s",
    async (mode) => rehearsal(mode),
    30000,
);
