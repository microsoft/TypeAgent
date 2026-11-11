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
    wikiAssessmentKey,
} from "../src/wikiAdmission.js";
import {
    canonicalizeWikiEvidence,
    refreshWikiContributionInput,
    wikiContributionInput,
    wikiContributionGroupInput,
    wikiContributionTargets,
    WikiContributionCapacityError,
} from "../src/wikiContribution.js";
import { viewSourceKey } from "../src/viewContent.js";
import { derivedDefinitionInput } from "../src/viewRelationships.js";
import {
    mergeView,
    recordViewEdits,
    viewHash,
    viewBuildEvidenceFingerprint,
} from "../src/viewMerge.js";
import { mergeEditorialView } from "../src/viewEditorial.js";
import { ViewBuildStaleError, abortable } from "../src/viewBuilds.js";
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
const disposal =
    "Prompt connection disposal releases the lease after application work finishes. Cancellation alone does not establish that disposal occurred.";

class ContributionIndex extends FakeSemanticCorpusIndex {
    static includeCommand = false;
    static failDerived = false;
    static derivedBuilds = 0;
    static reverseRead = false;
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
        return {
            fragments: ContributionIndex.reverseRead
                ? fragments.reverse()
                : fragments,
            readChars: parts.join("").length,
            limited: false,
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
        const match = /^indexed:0:([a-f0-9]{64}):(\d+)-(\d+)$/.exec(locator);
        if (!document || match?.[1] !== document.revision.contentHash)
            throw new Error("Offline indexed locator is unavailable");
        return document.content.slice(Number(match[2]), Number(match[3]));
    }
}

class GroupedContributionIndex extends ContributionIndex {
    override async listSubjects(offset: number) {
        const page = await super.listSubjects(offset);
        if (!offset && ContributionIndex.includeCommand) {
            page.items.push({
                term: "connection disposal",
                postingCount: 1,
                sourceIds: ["source"],
            });
            page.total++;
        }
        return page;
    }
    override async readFragments(request: IndexedFragmentRequest) {
        const selection = await super.readFragments(request);
        if (request.terms.includes("connection disposal")) {
            const document = this.documents.find(
                (entry) => entry.source.sourceId === "source",
            );
            if (!document) throw new Error("Original grouped source missing");
            const start = document.content.indexOf(disposal);
            if (start < 0) throw new Error("Grouped disposal evidence missing");
            selection.fragments.push({
                sourceId: "source",
                revisionId: document.revision.revisionId,
                snippet: disposal,
                score: 1,
                locator: `indexed:0:${document.revision.contentHash}:${start}-${start + disposal.length}`,
            });
            selection.readChars += disposal.length;
        }
        return selection;
    }
}

test.each([2, 3, 4])(
    "group receipts for %s candidates bind independent evidence and remapped distinctions",
    (groupSize) => {
        const current = canonical();
        const first = snapshot();
        const second = snapshot();
        second.definition.viewId = "second";
        second.definition.wiki!.query = "connection disposal";
        second.inputs[0].passages![0].excerpt = disposal;
        second.inputs[0].passages![0].locator += "-disposal";
        second.inputs[0].content = disposal;
        const inputs = [
            first,
            ...Array.from({ length: groupSize - 1 }, (_, index) => {
                const input = structuredClone(second);
                input.definition.viewId = `second-${index}`;
                return input;
            }),
        ];
        const candidates = inputs.map((input) => {
            const pages = [wikiPageContext(input, current, undefined, false)];
            return {
                input,
                assessment: assessment(input, pages[0], "contribute"),
                assessmentKey: wikiAssessmentKey(
                    input,
                    pages,
                    "offline-group-policy",
                ),
            };
        });
        const input = canonicalizeWikiEvidence(
            wikiContributionGroupInput(candidates, current),
        );
        const targets = candidates.map((candidate) => ({
            viewId: candidate.input.definition.viewId,
            snapshot: candidate.input,
            state: "pending" as const,
            reason: "Admitted",
            wikiAssessmentKey: candidate.assessmentKey,
            wikiAssessment: {
                ...candidate.assessment,
                canonicalRevisionId: current.revisionId,
            },
        }));
        const verification = {
            ...candidates[0].assessment,
            disposition: "covered" as const,
        };
        const contribution = { input, verification };
        expect(
            wikiContributionTargets(targets, targets[0], contribution, false),
        ).toEqual(targets);
        expect(input.wikiContribution!.members).toHaveLength(groupSize);
        expect(
            input.inputs.flatMap((source) => source.passages ?? []),
        ).toHaveLength(3);
        const forged = structuredClone(targets);
        forged[1].wikiAssessment.reason =
            "Not the recorded independent assessment";
        expect(() =>
            wikiContributionTargets(forged, forged[0], contribution, false),
        ).toThrow("unsupported");
        const omitted = structuredClone(contribution);
        omitted.input.wikiContribution!.essentialDistinctions =
            omitted.input.wikiContribution!.essentialDistinctions.filter(
                (entry) => entry.statement !== disposal,
            );
        expect(() =>
            wikiContributionTargets(targets, targets[0], omitted, false),
        ).toThrow("omitted a member distinction");
        const changed = structuredClone(targets);
        changed[1].snapshot.inputs[0].passages![0].excerpt +=
            " Changed source.";
        expect(() =>
            wikiContributionTargets(changed, changed[0], contribution, false),
        ).toThrow();
        expect(() =>
            wikiContributionGroupInput([candidates[0], candidates[0]], current),
        ).toThrow("two to four");
        const dense = candidates.slice(0, 2).map((candidate) => {
            const value = structuredClone(candidate);
            const passage = value.input.inputs[0].passages![0];
            value.input.inputs[0].passages = Array.from(
                { length: 12 },
                (_, index) => ({
                    ...passage,
                    locator: `${passage.locator}-dense-${index}`,
                    excerpt: `${passage.excerpt} Retained excerpt ${index}.`,
                }),
            );
            return value;
        });
        expect(() => wikiContributionGroupInput(dense, current)).toThrow(
            WikiContributionCapacityError,
        );
    },
);

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

test("Wiki evidence ordering is stable and remaps exact contribution fragment identities", () => {
    const incoming = snapshot();
    const current = canonical();
    const original = wikiContributionInput(
        incoming,
        current,
        assessment(
            incoming,
            wikiPageContext(incoming, current, undefined, false),
            "contribute",
        ),
    );
    const frozen = structuredClone(original);
    const permuted = structuredClone(original);
    const previous = original.inputs.flatMap((source) => source.passages ?? []);
    permuted.inputs.reverse();
    for (const source of permuted.inputs) source.passages!.reverse();
    const reordered = permuted.inputs.flatMap(
        (source) => source.passages ?? [],
    );
    permuted.wikiContribution!.essentialDistinctions =
        original.wikiContribution!.essentialDistinctions.map((distinction) => ({
            ...distinction,
            fragmentId: `f${reordered.findIndex(
                (fragment) =>
                    viewHash(fragment) ===
                    viewHash(previous[Number(distinction.fragmentId.slice(1))]),
            )}`,
        }));
    const left = canonicalizeWikiEvidence(original);
    const right = canonicalizeWikiEvidence(permuted);
    expect(left).toEqual(right);
    expect(viewBuildEvidenceFingerprint(left)).toBe(
        viewBuildEvidenceFingerprint(right),
    );
    expect(canonicalizeWikiEvidence(left)).toEqual(left);
    expect(original).toEqual(frozen);
    const changed = structuredClone(left);
    changed.inputs[0].passages![0].excerpt += " Changed evidence.";
    expect(
        viewBuildEvidenceFingerprint(canonicalizeWikiEvidence(changed)),
    ).not.toBe(viewBuildEvidenceFingerprint(left));
    const invalid = structuredClone(original);
    invalid.wikiContribution!.essentialDistinctions[0].fragmentId = "f99";
    expect(() => canonicalizeWikiEvidence(invalid)).toThrow(
        "lost a required fragment",
    );
});
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

test("canonical contribution preserves protected title, taxonomy, note and exclusions through the shared editorial merge", () => {
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
        title: page.content.title,
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
    const merged = mergeEditorialView(edited, candidate, combined.inputs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.output.content.title).toBe("Human canonical title");
    expect(merged.output.content.sections[0].details).toMatchObject({
        taxonomy: "system",
        note: "Human personal note",
    });
    expect(edited.definition.wiki!.excludedSourceIds).toEqual(["not-cited"]);
    expect(merged.output.content.sections[0].body).toContain(oldFact);
    expect(merged.output.content.sections[0].body).toContain(contrast);
    const retitled = structuredClone(candidate);
    retitled.content.title = "Incompatible generated title";
    const conflict = mergeEditorialView(edited, retitled, combined.inputs);
    expect(conflict.conflicts).toContain("title");
    expect(conflict.output.content.title).toBe("Human canonical title");
    expect(edited.content.title).toBe("Human canonical title");
});

test("canonical contribution still rejects an untracked title change", () => {
    const page = canonical();
    page.content.title = "Untracked title";
    const candidate = {
        content: structuredClone(page.generation!.content),
        relationships: [],
        outcome: "knowledgePages" as const,
        missingEvidence: [],
    };
    const merged = mergeEditorialView(page, candidate, page.content.citations);
    expect(merged.conflicts).toContain("untracked:title");
    expect(page.edits).toBeUndefined();
    expect(page.content.title).toBe("Untracked title");
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
        | "title-refresh"
        | "missing"
        | "provider"
        | "conflict"
        | "stale"
        | "index"
        | "forget"
        | "binding-replay"
        | "replacement",
    experimental = false,
) {
    ContributionIndex.includeCommand = false;
    ContributionIndex.failDerived = false;
    ContributionIndex.derivedBuilds = 0;
    ContributionIndex.reverseRead = false;
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
                input.wikiContribution ||
                    (mode === "title-refresh" && generated >= 3)
                    ? "covered"
                    : "contribute",
            );
        },
        generate: async (input: ViewBuildSnapshot) => {
            generated++;
            let prose = input.inputs
                .flatMap((source) => source.passages ?? [])
                .map((fragment) => fragment.excerpt)
                .join("\n\n");
            if (input.wikiContribution) {
                expect(input.expectedVersion).toBe(
                    mode === "title-refresh"
                        ? generated - 1
                        : mode === "conflict"
                          ? 2
                          : 1,
                );
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
                title:
                    mode === "title-refresh" && generated > 1
                        ? `Connection lease and command execution ${generated}`
                        : "Connection lease",
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
            ...(experimental
                ? {
                      performanceExperiments:
                          "wiki-full-context,wiki-stable-evidence,wiki-utility-first,wiki-coalesced-discovery",
                      wikiAssessmentConcurrency: 2,
                  }
                : {}),
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
            await service["enqueueWrite"](corpusId, () =>
                new TypedViewStore(root).updateViewBuild(
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
                ),
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
        } else if (mode !== "success" && mode !== "title-refresh") {
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
            if (mode === "title-refresh") {
                expect(current[0].content.title).toBe(
                    "Connection lease and command execution 2",
                );
                expect(current[0].generation!.content.title).toBe(
                    current[0].content.title,
                );
                expect(current[0].edits).toEqual([]);
                adapter.identity = "offline-contribution-title-refresh";
                const refresh = await maintainFamily(
                    service,
                    corpusId,
                    "wiki",
                    "rebuild",
                );
                const rebuilt = await terminal(service, refresh.job);
                expect(rebuilt.state).toBe("complete");
                expect(rebuilt.results[0].conflictId).toBeUndefined();
                expect(generated).toBe(3);
                const refreshed = (await service.listViews(corpusId)).views[0];
                expect(refreshed.version).toBe(3);
                expect(refreshed.content.title).toBe(
                    "Connection lease and command execution 3",
                );
                expect(refreshed.generation!.content.title).toBe(
                    refreshed.content.title,
                );
                expect(refreshed.edits).toEqual([]);
                expect(refreshed.actor).toBe("memory-view-generator");
            }
        }
        const before = [generated, assessed];
        const indexedBefore = ContributionIndex.derivedBuilds;
        if (experimental && mode === "success")
            ContributionIndex.reverseRead = true;
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
        expect(ContributionIndex.derivedBuilds).toBe(indexedBefore);
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
    "title-refresh",
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

test.each([
    "success",
    "missing",
    "provider",
    "stale",
    "index",
    "replacement",
    "forget",
    "conflict",
    "competing",
    "cancelled",
] as const)(
    "grouped canonical installation and recovery: %s",
    async (mode) => {
        ContributionIndex.includeCommand = false;
        ContributionIndex.reverseRead = false;
        ContributionIndex.failDerived = false;
        ContributionIndex.derivedBuilds = 0;
        const root = await mkdtemp(
            path.join(os.tmpdir(), "wiki-grouped-contribution-"),
        );
        let generated = 0;
        let release!: () => void, groupStarted!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            groupStarted = resolve;
        });
        const adapter = {
            identity: "offline-grouped-contribution",
            assessWikiSubject: async (
                input: ViewBuildSnapshot,
                pages: ReturnType<typeof nominateWikiPages>,
            ) => {
                if (!pages.length)
                    return {
                        disposition: "distinct" as const,
                        purpose: "Useful scoped reference",
                        reason: "Original evidence supports a substantive explanation",
                        canonicalViewId: "",
                        sharedFragmentIds: [],
                        ambiguousViewIds: [],
                        essentialDistinctions: [],
                    };
                expect(pages).toHaveLength(1);
                return assessment(
                    input,
                    pages[0],
                    input.wikiContribution ? "covered" : "contribute",
                );
            },
            generate: async (input: ViewBuildSnapshot, signal: AbortSignal) => {
                generated++;
                if (input.wikiContribution?.members) {
                    expect(input.wikiContribution.members).toHaveLength(2);
                    groupStarted();
                    await held;
                    signal.throwIfAborted();
                    if (mode === "provider")
                        throw new Error("Controlled grouped provider failure");
                }
                const fragments = input.inputs.flatMap(
                    (source) => source.passages ?? [],
                );
                return hydrateInformational(input, {
                    title: "Connection lease",
                    summary: "Grounded reference summary",
                    status: "partial",
                    limits: "Selected original evidence",
                    prose:
                        mode === "missing" && input.wikiContribution
                            ? oldFact
                            : mode === "conflict" && input.wikiContribution
                              ? `${oldFact.replace("Connection lease acquisition", "Incompatible generated lease explanation")}\n\n${contrast}\n\n${disposal}`
                              : fragments
                                    .map((fragment) => fragment.excerpt)
                                    .join("\n\n"),
                    citationIds: fragments.map((_, index) => `f${index}`),
                });
            },
            validate: async () => {
                throw new Error("Unexpected generic support path");
            },
        };
        const open = () =>
            new FileMemoryService(root, {
                maintenanceMode: "manual",
                sourceSynopses: false,
                performanceExperiments:
                    "wiki-full-context,wiki-stable-evidence,wiki-utility-first,wiki-coalesced-discovery,wiki-grouped-contributions",
                wikiAssessmentConcurrency: 2,
                indexFactory: (_id, directory) =>
                    new GroupedContributionIndex(directory),
                viewSynthesisAdapter: adapter,
            });
        let service = open();
        try {
            const { corpusId } = await service.createCorpus(
                "Grouped canonical contributions",
            );
            for (const family of ["wiki", "projects"] as const)
                await maintainFamily(service, corpusId, family, "pause");
            const ingestion = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "source",
                    sourceType: "text",
                    title: "Lease source",
                    text: `${text}\n\n${disposal}`,
                },
            });
            expect(
                (await waitForMemoryJob(service, ingestion.jobId)).state,
            ).toBe("complete");
            const seed = await maintainFamily(
                service,
                corpusId,
                "wiki",
                "resume",
            );
            expect((await terminal(service, seed.job)).state).toBe("complete");
            await maintainFamily(service, corpusId, "wiki", "pause");
            const original = (await service.listViews(corpusId)).views[0];
            let competing: ViewVersion | undefined;
            if (mode === "competing") {
                const definition = derivedDefinitionInput(original);
                definition.viewId = "competing-context";
                const build = await service.buildViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    publication: false,
                    targets: [{ definition, expectedVersion: 0 }],
                });
                expect((await terminal(service, build)).state).toBe("complete");
                competing = (await service.listViews(corpusId)).views.find(
                    (view) => view.viewId === definition.viewId,
                );
                if (!competing)
                    throw new Error("Expected grounded competing page");
                expect(
                    (
                        await service.getViewPublication({
                            corpusId,
                            viewId: competing.viewId,
                        })
                    ).publishedRevisionId,
                ).toBeUndefined();
            }
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
            const indexedBefore = ContributionIndex.derivedBuilds;
            ContributionIndex.includeCommand = true;
            const admitted = await maintainFamily(
                service,
                corpusId,
                "wiki",
                "resume",
            );
            try {
                await abortable(started, AbortSignal.timeout(10000));
            } catch (error) {
                const builds = await service.listViewBuilds(corpusId);
                throw new Error(
                    JSON.stringify(
                        builds.map((build) => ({
                            state: build.state,
                            results: build.results.map((target) => ({
                                viewId: target.viewId,
                                state: target.state,
                                reason: target.reason,
                                assessment: target.wikiAssessment,
                            })),
                        })),
                    ) + `; ${String(error)}`,
                );
            }
            if (mode === "stale") {
                const content = structuredClone(original.content);
                content.title = "Human protected canonical title";
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
            if (mode === "index") ContributionIndex.failDerived = true;
            if (mode === "cancelled")
                await service.cancelViewBuild({
                    corpusId,
                    jobId: admitted.job!.jobId,
                });
            if (mode === "competing") {
                if (!competing)
                    throw new Error("Expected frozen competing page");
                const head = (await service.listViews(corpusId)).head;
                if (!head) throw new Error("Expected persisted competing page");
                const publication = await service.publishView({
                    corpusId,
                    viewId: competing.viewId,
                    revisionId: competing.revisionId,
                    expectedVersion: competing.version,
                    expectedHead: head,
                });
                expect(publication.indexState).toBe("ready");
            }
            if (mode === "replacement") {
                const replacement = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId: "source",
                        sourceType: "text",
                        title: "Lease source",
                        text: `${text}\n\n${disposal}\nA correction changes the exact source revision.`,
                    },
                });
                release();
                expect(
                    (await waitForMemoryJob(service, replacement.jobId)).state,
                ).toBe("complete");
            } else if (mode === "forget") {
                const preview = await service.previewForgetSource(
                    corpusId,
                    "source",
                );
                const forgotten = service.forgetSource({
                    corpusId,
                    sourceId: "source",
                    confirmationToken: preview.confirmationToken,
                });
                release();
                await forgotten;
                expect((await service.listViews(corpusId)).views).toEqual([]);
                expect(await service.listViewBuilds(corpusId)).toHaveLength(0);
                return;
            } else release();
            const done = await terminal(service, admitted.job);
            expect(done.results).toHaveLength(2);
            expect(generated).toBe(mode === "competing" ? 3 : 2);
            if (mode === "success" || mode === "index") {
                const receipts = done.results.map(
                    (target) => target.wikiContribution,
                );
                expect(
                    receipts.every(
                        (receipt) =>
                            receipt?.input.wikiContribution?.members?.length ===
                            2,
                    ),
                ).toBe(true);
                expect(
                    new Set(receipts.map((receipt) => receipt!.revisionId))
                        .size,
                ).toBe(1);
                const current = (await service.listViews(corpusId)).views[0];
                expect(current.version).toBe(2);
                expect(
                    current.content.sections
                        .map((section) => section.body)
                        .join("\n\n"),
                ).toContain(disposal);
                if (mode === "index") {
                    expect(done.state).not.toBe("complete");
                    expect(
                        receipts.every(
                            (receipt) => receipt?.state === "committed",
                        ),
                    ).toBe(true);
                    ContributionIndex.failDerived = false;
                    await service.close();
                    service = open();
                    const recovered = await terminal(
                        service,
                        await service.retryViewBuild({
                            corpusId,
                            jobId: done.jobId,
                        }),
                    );
                    expect(recovered.state).toBe("complete");
                    expect(
                        recovered.results.every(
                            (target) =>
                                target.wikiContribution?.state === "bound",
                        ),
                    ).toBe(true);
                    expect(generated).toBe(2);
                } else {
                    expect(done.state).toBe("complete");
                    expect(
                        receipts.every((receipt) => receipt?.state === "bound"),
                    ).toBe(true);
                    expect(
                        ContributionIndex.derivedBuilds - indexedBefore,
                    ).toBe(1);
                }
                const beforeReopen = ContributionIndex.derivedBuilds;
                await service.close();
                service = open();
                const stable = await maintainFamily(
                    service,
                    corpusId,
                    "wiki",
                    "update",
                );
                expect(stable.job).toBeUndefined();
                expect(generated).toBe(2);
                expect(ContributionIndex.derivedBuilds).toBe(beforeReopen);
            } else {
                expect(done.state).not.toBe("complete");
                expect(
                    done.results.every(
                        (target) => target.wikiContribution?.state !== "bound",
                    ),
                ).toBe(true);
                if (mode === "stale" || mode === "competing") {
                    expect(
                        done.results.every(
                            (target) => target.state === "stale",
                        ),
                    ).toBe(true);
                    if (mode === "stale")
                        expect(
                            (await service.listViews(corpusId)).views[0].content
                                .title,
                        ).toBe("Human protected canonical title");
                } else if (mode === "conflict") {
                    expect(
                        done.results.every(
                            (target) => target.state === "conflicted",
                        ),
                    ).toBe(true);
                    expect(
                        (await service.listViews(corpusId)).views[0].content
                            .sections[0].body,
                    ).toContain("Human incompatible lease explanation");
                    expect(ContributionIndex.derivedBuilds).toBe(indexedBefore);
                } else if (mode !== "replacement") {
                    expect(
                        (await service.listViews(corpusId)).views[0].revisionId,
                    ).toBe(original.revisionId);
                    expect(ContributionIndex.derivedBuilds).toBe(indexedBefore);
                }
            }
        } finally {
            release();
            ContributionIndex.failDerived = false;
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    30000,
);

test.each([
    "success",
    "title-refresh",
    "missing",
    "provider",
    "conflict",
    "stale",
    "index",
    "forget",
    "binding-replay",
    "replacement",
] as const)(
    "experimental isolated service contribution and cold reopen: %s",
    async (mode) => rehearsal(mode, true),
    30000,
);
