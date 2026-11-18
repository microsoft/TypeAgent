// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    openai,
    reserveSerializedRequestForDispatch,
    type ChatModel,
    type StructuredOutputJsonSchema,
    type DecisionModel,
} from "@typeagent/aiclient";
import {
    createConfiguredViewSynthesisAdapter,
    assertSupportReport,
    validateSupport,
} from "../src/viewSynthesis.js";
import { createWikiDecisionFirstAdapter } from "../src/wikiDecisionFirst.js";
import { wikiPageContext, parseWikiAssessment } from "../src/wikiAdmission.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { TypedViewStore } from "../src/viewStore.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { indexedLocator } from "../src/indexedFragments.js";
import { viewHash } from "../src/viewMerge.js";
import { supportQuality } from "../src/viewSupport.js";
import {
    preservedCanonicalOutput,
    consolidationInput,
} from "../src/wikiConsolidation.js";
import {
    parseWikiAmbiguity,
    verifyAmbiguityCombination,
    ambiguityInput,
    ambiguityParticipantVersion,
    wikiAmbiguityKey,
    type WikiAmbiguityReview,
    type WikiAmbiguityParticipant,
    WikiAmbiguityDecisionError,
    type WikiAmbiguityResolution,
    type WikiAmbiguityGroup,
    type WikiAmbiguityReviewAction,
} from "../src/wikiAmbiguity.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisAdapter,
    ViewBuildJob,
    ViewBuildTargetResult,
    WikiSubjectAssessment,
    WikiPagePurposeContext,
    ViewVersion,
} from "../src/viewTypes.js";

function input(id: string): ViewBuildSnapshot {
    const body = `${id}: independent product identity and original scope.`;
    const sourceId = `source-${id}`;
    const block = {
        sourceId,
        revisionId: "r1",
        blockOrdinal: 0,
        text: body,
        score: 1,
    };
    return {
        corpusId: "corpus",
        actor: "test",
        pipeline: "informational-wiki-v1",
        model: "offline",
        fingerprint: viewHash(id),
        expectedVersion: 0,
        bounds: {},
        definition: {
            viewId: id,
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId, revisionId: "r1" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: id,
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId,
                revisionId: "r1",
                title: id,
                content: body,
                contentHash: viewHash(body),
                passages: [
                    {
                        sourceId,
                        revisionId: "r1",
                        locator: indexedLocator(block, 0, body.length),
                        excerpt: body,
                    },
                ],
            },
        ],
    };
}
function output(snapshot: ViewBuildSnapshot) {
    return hydrateInformational(snapshot, {
        summary: "Source-bound reference.",
        status: "partial",
        title: snapshot.definition.viewId,
        prose: `${snapshot.inputs[0].content} [f0]`,
        limits: "Selected original indexed evidence only.",
        citationIds: ["f0"],
    });
}
const assessment: WikiSubjectAssessment = {
    disposition: "ambiguous",
    purpose: "candidate",
    reason: "Multiple duplicate nominations",
    canonicalViewId: "",
    sharedFragmentIds: [],
    ambiguousViewIds: ["first", "second"],
    essentialDistinctions: [],
};
function separate(
    participants: WikiAmbiguityParticipant[],
): WikiAmbiguityResolution {
    return {
        status: "resolved",
        reason: "Distinct scoped products remain separate",
        groups: participants.map((entry) => ({
            action: "keep_separate",
            ids: [entry.id],
            survivorId: null,
            combined: null,
            sections: [],
        })),
    };
}

async function fixture() {
    const root = path.resolve(".wiki-ambiguity-tests", randomUUID());
    await mkdir(root, { recursive: true });
    const store = new TypedViewStore(root);
    const inputs = ["first", "second"].map(input);
    const admitted = await store.admitViewBuild(
        {
            corpusId: "corpus",
            expectedHead: null,
            targets: inputs.map((snapshot) => ({
                definition: snapshot.definition,
                expectedVersion: 0,
            })),
        },
        inputs,
    );
    for (const snapshot of inputs) {
        const draft = output(snapshot);
        await store.materializeViewBuild(
            "corpus",
            admitted.job.jobId,
            snapshot.definition.viewId,
            draft,
            draft,
            [],
        );
    }
    const pages = (await store.listViews("corpus")).views;
    const candidate = input("candidate");
    const job = (
        await store.admitViewBuild(
            {
                corpusId: "corpus",
                expectedHead: (await store.listViews("corpus")).head,
                targets: [
                    { definition: candidate.definition, expectedVersion: 0 },
                ],
            },
            [candidate],
        )
    ).job;
    const participants: WikiAmbiguityParticipant[] = [
        {
            id: "candidate",
            revisionId: null,
            input: candidate,
            draft: output(candidate),
        },
        ...pages.map((page) => ({
            id: page.viewId,
            revisionId: page.revisionId,
            input: page.generation!.input!,
            page,
        })),
    ];
    const now = new Date().toISOString();
    const review: WikiAmbiguityReview = {
        id: wikiAmbiguityKey(candidate, assessment, participants),
        corpusId: "corpus",
        jobId: job.jobId,
        candidateId: "candidate",
        version: 1,
        createdAt: now,
        updatedAt: now,
        state: "resolving",
        reason: assessment.reason,
        assessment,
        participants,
        request: {
            model: "GPT_6_1_SOL",
            logicalRequests: 1,
            state: "reserved",
        },
    };
    return { root, store, job, review };
}

test("strict grouping rejects omitted, duplicate, invented and malformed combinations", () => {
    const participants = ["a", "b"].map((id) => ({
        id,
        revisionId: null,
        input: input(id),
    }));
    const value = separate(participants);
    expect(parseWikiAmbiguity(value, participants)).toEqual(value);
    expect(() =>
        parseWikiAmbiguity(
            { ...value, groups: value.groups.slice(0, 1) },
            participants,
        ),
    ).toThrow("omitted");
    expect(() =>
        parseWikiAmbiguity(
            { ...value, groups: [value.groups[0], value.groups[0]] },
            participants,
        ),
    ).toThrow("duplicate");
    expect(() =>
        parseWikiAmbiguity(
            { ...value, groups: [{ ...value.groups[0], ids: ["invented"] }] },
            participants,
        ),
    ).toThrow("Invented");
    expect(() =>
        parseWikiAmbiguity(
            {
                ...value,
                groups: [
                    {
                        action: "combine",
                        ids: ["a", "b"],
                        survivorId: "a",
                        combined: null,
                        sections: [],
                    },
                ],
            },
            participants,
        ),
    ).toThrow("complete");
});

test("frozen arbitration key ignores assessment reason/model drift, but binds changed original evidence", () => {
    const snapshot = input("candidate");
    const participants = [
        { id: "candidate", revisionId: null, input: snapshot },
    ];
    const key = wikiAmbiguityKey(snapshot, assessment, participants);
    expect(
        wikiAmbiguityKey(
            { ...snapshot, model: "another-writer" },
            { ...assessment, reason: "Reworded reason" },
            participants,
        ),
    ).toBe(key);
    const changed = structuredClone(snapshot);
    changed.inputs[0].content += " Changed source content.";
    expect(wikiAmbiguityKey(changed, assessment, participants)).not.toBe(key);
});

test("one nominated-page and consolidation uncertainty retain complete native decision receipts without inventing IDs", async () => {
    const { root, review } = await fixture();
    try {
        const model: DecisionModel = {
            provider: "azure",
            model: "decision-1",
            configGeneration: 1,
            providerSource: "factory",
            decide: async (request) => ({
                success: true,
                data: {
                    provider: "azure",
                    requestedModel: "decision-1",
                    answers: Object.fromEntries(
                        Object.keys(request.questions).map((id) => {
                            const answer =
                                id === "admission" ? "useful" : "uncertain";
                            return [
                                id,
                                {
                                    type: "choice",
                                    choice: answer,
                                    probabilities: { [answer]: 1 },
                                },
                            ];
                        }),
                    ),
                },
            }),
        };
        const base: ViewSynthesisAdapter = {
            identity: "offline",
            generate: async (snapshot) => output(snapshot),
            validate: async () => {
                throw new Error("Unexpected validation");
            },
        };
        const adapter = createWikiDecisionFirstAdapter(
            base,
            model,
            async () => {
                throw new Error("No prose repair allowed");
            },
            { arm: "D1" },
        );
        const candidate = review.participants[0].input;
        const page = review.participants[1].page!;
        const contexts = [wikiPageContext(candidate, page)];
        try {
            await adapter.assessWikiSubject!(
                candidate,
                contexts,
                new AbortController().signal,
            );
            throw new Error("Expected explicit uncertainty");
        } catch (error) {
            expect(error).toBeInstanceOf(WikiAmbiguityDecisionError);
            const native = error as WikiAmbiguityDecisionError;
            expect(native.nativeChoices[0].response?.answers.p0).toMatchObject({
                choice: "uncertain",
            });
            const pending = parseWikiAssessment(
                {
                    ...assessment,
                    ambiguityBasis: "uncertain",
                    ambiguousViewIds: [page.viewId],
                    nativeChoices: native.nativeChoices,
                },
                contexts,
            );
            expect(pending.ambiguousViewIds).toEqual([page.viewId]);
            expect(pending.nativeChoices?.[0].request.state).toContain(
                page.content.title,
            );
        }
        await expect(
            adapter.assessWikiConsolidation!(
                candidate,
                page,
                review.participants[2].page!,
                new AbortController().signal,
            ),
        ).rejects.toBeInstanceOf(WikiAmbiguityDecisionError);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("configured arbitration sends complete context once and durably accounts two transport attempts without a model repair", async () => {
    const { root, review, store } = await fixture();
    try {
        review.participants[0].input.inputs[0].content +=
            " Full retained evidence.".repeat(5000);
        await store.reserveWikiAmbiguityReview(review);
        const calls: unknown[] = [];
        const inspectionModel = openai.createChatModel(
            {
                provider: "azure",
                modelType: openai.ModelType.Chat,
                apiKey: "synthetic-key",
                endpoint: "https://synthetic.invalid/offline-inspection",
                supportsResponseFormat: true,
                requestConstraints: {
                    inputTokens: 2000000,
                    contextTokens: 2200000,
                    outputTokens: 16000,
                },
            },
            { response_format: { type: "json_object" } },
        );
        const arbitration: ChatModel = {
            completionSettings: {},
            inspectRequest: inspectionModel.inspectRequest!,
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected full messages");
                expect((schema as StructuredOutputJsonSchema).name).toBe(
                    "wiki_ambiguity_resolution",
                );
                expect(String(messages[0].content)).toContain(
                    "array-like literals unchanged",
                );
                calls.push(JSON.parse(String(messages[1].content)));
                const inspection = inspectionModel.inspectRequest!(
                    messages,
                    schema,
                );
                for (const state of ["failed", "returned"] as const) {
                    const finish = await reserveSerializedRequestForDispatch(
                        {
                            body: inspection.serializedRequest!,
                        },
                        16000,
                    );
                    await finish!({
                        state,
                        at: new Date().toISOString(),
                        elapsedMs: 1,
                        status: state === "failed" ? 429 : 200,
                    });
                }
                return {
                    success: true,
                    data: "not JSON: original malformed response",
                };
            },
        };
        const writer: ChatModel = {
            completionSettings: {},
            complete: async () => {
                throw new Error("Ordinary writer must not arbitrate");
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            writer,
            undefined,
            undefined,
            arbitration,
        );
        const response = await adapter.resolveWikiAmbiguity!(
            review,
            new AbortController().signal,
            async () => {
                Object.assign(
                    review,
                    await store.updateWikiAmbiguityReview(
                        review,
                        review.version,
                    ),
                );
            },
        );
        expect(calls).toHaveLength(1);
        expect(JSON.stringify(calls[0])).toContain(
            review.participants[0].input.inputs[0].content,
        );
        for (const participant of review.participants)
            expect(JSON.stringify(calls[0])).toContain(participant.id);
        expect(response).toMatchObject({
            output: "not JSON: original malformed response",
        });
        expect(review.request.budget).toBeDefined();
        expect(review.request.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
        const restored = (
            await new TypedViewStore(root).listWikiAmbiguityReviews("corpus")
        )[0];
        expect(
            restored.request.transportAttempts?.map((entry) => entry.state),
        ).toEqual(["failed", "returned"]);
        expect(restored.request.transportRetries).toBe(1);
        await store.recoverViewBuilds("corpus");
        expect((await store.listWikiAmbiguityReviews("corpus"))[0].state).toBe(
            "needsReview",
        );
        expect((await store.reserveWikiAmbiguityReview(review)).reserved).toBe(
            false,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("durable reservation is restart-safe; safe keep-separate materializes candidate without changing existing revisions", async () => {
    const { root, store, review } = await fixture();
    try {
        expect((await store.reserveWikiAmbiguityReview(review)).reserved).toBe(
            true,
        );
        const reopened = new TypedViewStore(root);
        expect(
            (await reopened.reserveWikiAmbiguityReview(review)).reserved,
        ).toBe(false);
        const before = (await store.listViews("corpus")).views;
        const resolution = {
            ...review,
            resolution: separate(review.participants),
        };
        const saved = await store.updateWikiAmbiguityReview(
            resolution,
            1,
            true,
        );
        expect(saved.state).toBe("resolved");
        expect(
            (await reopened.listWikiAmbiguityReviews("corpus"))[0]
                .appliedRevisions?.candidate,
        ).toBeDefined();
        const after = (await reopened.listViews("corpus")).views;
        for (const original of before)
            expect(
                after.find((page) => page.viewId === original.viewId)
                    ?.revisionId,
            ).toBe(original.revisionId);
        expect(after.find((page) => page.viewId === "candidate")?.state).toBe(
            "draft",
        );
        await expect(
            store.updateWikiAmbiguityReview(resolution, 1, true),
        ).rejects.toThrow("version conflict");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("combinations preserve exact original citations and rebind independent inline evidence labels", async () => {
    const { root, review } = await fixture();
    try {
        const members = review.participants.filter((entry) => entry.page);
        const first = members[0].page!;
        const second = members[1].page!;
        const combined = preservedCanonicalOutput(first, second);
        for (const anchor of combined.anchors)
            combined.output.content.sections.find(
                (section) => section.id === anchor.to,
            )!.body = second.content.sections.find(
                (section) => section.id === anchor.from,
            )!.body;
        const group: WikiAmbiguityGroup = {
            action: "combine",
            ids: [first.viewId, second.viewId],
            survivorId: first.viewId,
            combined: JSON.stringify(combined.output),
            sections: [
                ...first.content.sections.map((section) => ({
                    id: first.viewId,
                    sectionId: section.id,
                    combinedSectionId: section.id,
                })),
                ...combined.anchors.map((anchor) => ({
                    id: second.viewId,
                    sectionId: anchor.from,
                    combinedSectionId: anchor.to,
                })),
            ],
        };
        expect(ambiguityInput(group, members).inputs[0].sourceId).toBe(
            first.generation!.input!.inputs[0].sourceId,
        );
        expect(() => verifyAmbiguityCombination(group, members)).toThrow(
            "rewrote",
        );
        for (const anchor of combined.anchors)
            combined.output.content.sections.find(
                (section) => section.id === anchor.to,
            )!.body = second.content.sections
                .find((section) => section.id === anchor.from)!
                .body.replace("[f0]", "[f1]");
        group.combined = JSON.stringify(combined.output);
        expect(
            verifyAmbiguityCombination(group, members).content.citations,
        ).toHaveLength(2);
        combined.output.content.citations.pop();
        group.combined = JSON.stringify(combined.output);
        expect(() => verifyAmbiguityCombination(group, members)).toThrow(
            /source references|citation provenance/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

function combinePageParticipants(
    members: WikiAmbiguityParticipant[],
): WikiAmbiguityGroup {
    const first = members[0].page!;
    const second = members[1].page!;
    const group: WikiAmbiguityGroup = {
        action: "combine",
        ids: members.map((entry) => entry.id),
        survivorId: first.viewId,
        combined: null,
        sections: [],
    };
    const combined = preservedCanonicalOutput(
        first,
        second,
        ambiguityInput(group, members),
    );
    return {
        ...group,
        combined: JSON.stringify(combined.output),
        sections: [
            ...first.content.sections.map((section) => ({
                id: first.viewId,
                sectionId: section.id,
                combinedSectionId: section.id,
            })),
            ...combined.anchors.map((anchor) => ({
                id: second.viewId,
                sectionId: anchor.from,
                combinedSectionId: anchor.to,
            })),
        ],
    };
}

const aliasLiterals =
    "`[f42]` ``[f00]`` [f42](https://example.invalid/link) \\[f42] values[f42] [f0,f42]\n```ts\n[f42]\n```\n";

test("resolver preserves code/link/escaped/array literals beside real aliases throughout complete forms", async () => {
    const { root, review } = await fixture();
    try {
        const members = review.participants.filter((entry) => entry.page);
        const second = members[1].page!;
        if (second.content.kind !== "wiki") throw new Error("Expected Wiki");
        second.content.sections[0].body =
            aliasLiterals + second.content.sections[0].body;
        second.content.sections[0].heading += " `[f42]` reference [f0]";
        second.content.summary += " `[f42]` reference [f0]";
        second.content.coverageNote += " \\[f42] reference [f0]";
        const group = combinePageParticipants(members);
        const verified = verifyAmbiguityCombination(group, members);
        const binding = group.sections.find(
            (entry) => entry.id === second.viewId,
        )!;
        const section = verified.content.sections.find(
            (entry) => entry.id === binding.combinedSectionId,
        )!;
        expect(section.body).toBe(
            aliasLiterals +
                second.content.sections[0].body
                    .slice(aliasLiterals.length)
                    .replace("[f0]", "[f1]"),
        );
        expect(section.heading).toContain("`[f42]` reference [f1]");
        expect(verified.content.summary).toContain("`[f42]` reference [f1]");
        if (verified.content.kind !== "wiki") throw new Error("Expected Wiki");
        expect(verified.content.coverageNote).toContain(
            "\\[f42] reference [f1]",
        );
        const rebased = ambiguityParticipantVersion(
            members[1],
            members,
            ambiguityInput(group, members),
        );
        expect(rebased.content.sections[0].body).toBe(section.body);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.each(["f00", "f9007199254740992", "f42"])(
    "resolver rejects malformed or missing real reference %s without treating literals as evidence",
    async (label) => {
        const { root, review } = await fixture();
        try {
            const members = review.participants.filter((entry) => entry.page);
            const group = combinePageParticipants(members);
            const combined = JSON.parse(group.combined!) as ReturnType<
                typeof output
            >;
            combined.content.sections[0].body += `${aliasLiterals} Real reference [${label}]`;
            group.combined = JSON.stringify(combined);
            expect(() => verifyAmbiguityCombination(group, members)).toThrow(
                "structured citation provenance",
            );
            members[1].page!.content.sections[0].body += ` Real reference [${label}]`;
            expect(() =>
                ambiguityParticipantVersion(
                    members[1],
                    members,
                    ambiguityInput(group, members),
                ),
            ).toThrow(
                /Noncanonical original|exact source\/revision passage binding/,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    },
);

test("resolver carries exact intermediate combined generation inputs and rejects missing provenance", async () => {
    const { root, review } = await fixture();
    try {
        const originals = review.participants.filter((entry) => entry.page);
        const second = originals[1].page!;
        second.content.sections[0].body =
            aliasLiterals + second.content.sections[0].body;
        const pair = combinePageParticipants(originals);
        const pairInput = ambiguityInput(pair, originals);
        const pairOutput = verifyAmbiguityCombination(pair, originals);
        const first = originals[0].page!;
        const intermediate: WikiAmbiguityParticipant = {
            ...originals[0],
            input: pairInput,
            page: {
                ...first,
                content: pairOutput.content,
                generation: {
                    ...first.generation!,
                    content: pairOutput.content,
                    input: pairInput,
                },
            },
        };
        const candidate = review.participants.find((entry) => !entry.page)!;
        const candidatePage = ambiguityParticipantVersion(
            candidate,
            review.participants,
        );
        const finalMembers = [
            intermediate,
            {
                ...candidate,
                page: candidatePage,
                revisionId: candidatePage.revisionId,
            },
        ];
        const triple = combinePageParticipants(finalMembers);
        const finalInput = ambiguityInput(triple, finalMembers);
        const tripleOutput = JSON.parse(triple.combined!) as ReturnType<
            typeof output
        >;
        for (const section of intermediate.page!.content.sections) {
            const actual = tripleOutput.content.sections.find(
                (entry) => entry.id === section.id,
            )!;
            expect({
                ...actual,
                details: { ...actual.details, mergedPageIds: [] },
            }).toEqual({
                ...section,
                details: { ...section.details, mergedPageIds: [] },
            });
        }
        const verified = verifyAmbiguityCombination(triple, finalMembers);
        expect(
            verified.content.sections.some(
                (section) =>
                    section.body.startsWith(aliasLiterals) &&
                    section.body.endsWith("[f1]"),
            ),
        ).toBe(true);
        expect(
            verified.content.sections.some((section) =>
                section.body.endsWith("[f2]"),
            ),
        ).toBe(true);
        expect(
            ambiguityParticipantVersion(intermediate, finalMembers, finalInput)
                .generation?.input,
        ).toEqual(finalInput);
        const missingMerged = structuredClone(finalInput);
        missingMerged.inputs[1].passages = [];
        expect(() =>
            ambiguityParticipantVersion(
                intermediate,
                finalMembers,
                missingMerged,
            ),
        ).toThrow("exact source/revision passage binding");
        const stale = { ...intermediate, input: first.generation!.input! };
        expect(() =>
            ambiguityParticipantVersion(stale, finalMembers, finalInput),
        ).toThrow("exact source/revision passage binding");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

interface ServiceHarness {
    viewStore: TypedViewStore;
    viewAdapter: ViewSynthesisAdapter;
    enqueueWrite<T>(corpusId: string, task: () => Promise<T>): Promise<T>;
    assertInfluenceEligible(): Promise<void>;
    recheckViewInput(): Promise<void>;
    checkWikiContributionInput(): Promise<void>;
    assertWikiAmbiguitySources(): Promise<void>;
    requireViews(): Promise<{
        access: { read<T>(work: () => Promise<T>): Promise<T> };
    }>;
    getCorpusRuntime(): Promise<{
        manifest: {
            sources: Array<{
                sourceId: string;
                revisions: Array<{ revisionId: string }>;
            }>;
        };
    }>;
    sourceAllowed(
        source: { sourceId: string },
        revision: { revisionId: string },
        operation: "read" | "build",
    ): Promise<boolean>;
    listWikiAmbiguityReviews(corpusId: string): Promise<WikiAmbiguityReview[]>;
    resolveWikiAmbiguityReview(
        request: WikiAmbiguityReviewAction,
    ): Promise<WikiAmbiguityReview>;
    resolveWikiAmbiguity(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        assessment: WikiSubjectAssessment,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<void>;
}

function arbitrationHarness(
    store: TypedViewStore,
    review: WikiAmbiguityReview,
): ServiceHarness {
    const harness = Object.create(
        FileMemoryService.prototype,
    ) as ServiceHarness;
    harness.viewStore = store;
    harness.enqueueWrite = async (_corpusId, task) => task();
    harness.assertInfluenceEligible = async () => {};
    harness.recheckViewInput = async () => {};
    harness.checkWikiContributionInput = async () => {};
    harness.requireViews = async () => ({
        access: { read: async (work) => work() },
    });
    harness.getCorpusRuntime = async () => ({
        manifest: {
            sources: review.participants.flatMap((participant) =>
                participant.input.inputs.map((source) => ({
                    sourceId: source.sourceId,
                    revisions: [{ revisionId: source.revisionId }],
                })),
            ),
        },
    });
    harness.sourceAllowed = async () => true;
    harness.viewAdapter = {
        identity: "offline",
        generate: async (snapshot) => output(snapshot),
        validate: async (_snapshot, candidate) => ({
            supported: true,
            missingContext: [],
            reasons: [],
            sections: candidate.content.sections.map((section) => ({
                sectionId: section.id,
                supported: true,
                reason: "original evidence",
            })),
            relationships: candidate.relationships.map((edge) => ({
                edgeId: edge.id,
                supported: true,
                reason: "original evidence",
            })),
        }),
        resolveWikiAmbiguity: async (record) => separate(record.participants),
    };
    return harness;
}

async function applySeparateResolution(
    harness: ServiceHarness,
    mode: "automatic" | "human",
    { store, job, review }: Awaited<ReturnType<typeof fixture>>,
): Promise<WikiAmbiguityReview> {
    if (mode === "human") {
        const reserved = await store.reserveWikiAmbiguityReview(review);
        return harness.resolveWikiAmbiguityReview({
            corpusId: "corpus",
            reviewId: reserved.review.id,
            expectedVersion: reserved.review.version,
            action: "keep_separate",
        });
    }
    await harness.resolveWikiAmbiguity(
        job,
        job.results[0],
        assessment,
        review.participants.flatMap((participant) =>
            participant.page
                ? [wikiPageContext(job.results[0].snapshot, participant.page)]
                : [],
        ),
        new AbortController().signal,
    );
    return (await store.listWikiAmbiguityReviews("corpus"))[0];
}

describe.each(["automatic", "human"] as const)("%s arbitration", (mode) => {
    test.each(["candidate", "second"])(
        "rechecks %s construction authorization revoked during verification",
        async (revokedId) => {
            const data = await fixture();
            const { root, store, review } = data;
            try {
                const harness = arbitrationHarness(store, review);
                let revoked = false;
                harness.sourceAllowed = async (source, _revision, operation) =>
                    operation !== "build" ||
                    !revoked ||
                    source.sourceId !== `source-${revokedId}`;
                const validate = harness.viewAdapter.validate;
                harness.viewAdapter.validate = async (...args) => {
                    const report = await validate(...args);
                    revoked = true;
                    return report;
                };
                const result = await applySeparateResolution(
                    harness,
                    mode,
                    data,
                );
                expect(revoked).toBe(true);
                expect(result.state).toBe("conflict");
                expect(result.reason).toContain("authorization changed");
                const saved = (
                    await new TypedViewStore(root).listWikiAmbiguityReviews(
                        "corpus",
                    )
                )[0];
                expect(saved.state).toBe("conflict");
                expect(saved.participants[0].draft?.content).toEqual(
                    review.participants[0].draft?.content,
                );
                expect((await store.listViews("corpus")).views).toHaveLength(2);
                for (const participant of review.participants.filter(
                    (entry) => entry.page,
                ))
                    expect(
                        (
                            await store.getView({
                                corpusId: "corpus",
                                viewId: participant.id,
                            })
                        )?.revisionId,
                    ).toBe(participant.revisionId);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        },
    );

    test.each(["partiallySupported", "unsupported", "uncertain"] as const)(
        "retains native %s output with the correct draft policy",
        async (status) => {
            const data = await fixture();
            const { root, store, review } = data;
            try {
                const harness = arbitrationHarness(store, review);
                const model: DecisionModel = {
                    provider: "azure",
                    model: "decision-1",
                    configGeneration: 1,
                    providerSource: "factory",
                    decide: async (request) => ({
                        success: true,
                        data: {
                            provider: "azure",
                            requestedModel: "decision-1",
                            answers: Object.fromEntries(
                                Object.keys(request.questions).map((id) => [
                                    id,
                                    {
                                        type: "choice",
                                        choice: status,
                                        probabilities: { [status]: 1 },
                                    },
                                ]),
                            ),
                        },
                    }),
                };
                const native = createWikiDecisionFirstAdapter(
                    harness.viewAdapter,
                    model,
                    async () => {
                        throw new Error("No prose repair allowed");
                    },
                    { arm: "D1" },
                );
                harness.viewAdapter.validate = native.validate;
                const result = await applySeparateResolution(
                    harness,
                    mode,
                    data,
                );
                expect(result.state).toBe(
                    status === "partiallySupported"
                        ? "resolved"
                        : "needsReview",
                );
                const saved = (
                    await new TypedViewStore(root).listWikiAmbiguityReviews(
                        "corpus",
                    )
                )[0];
                const report = saved.verification?.find(
                    (entry): entry is { support: unknown } =>
                        typeof entry === "object" &&
                        entry !== null &&
                        "support" in entry,
                )?.support;
                assertSupportReport(report);
                expect(report.quality?.status).toBe(status);
                const draft = saved.participants[0].draft!;
                expect(() => validateSupport(draft, report)).toThrow(
                    "Unsupported evidence",
                );
                expect(() =>
                    validateSupport(draft, {
                        ...report,
                        supported: true,
                        sections: report.sections.map((section) => ({
                            ...section,
                            supported: true,
                        })),
                        relationships: report.relationships.map((edge) => ({
                            ...edge,
                            supported: true,
                        })),
                    }),
                ).toThrow("Unsupported evidence");
                const retained = await store.getView({
                    corpusId: "corpus",
                    viewId: "candidate",
                });
                if (status === "partiallySupported") {
                    expect(retained?.state).toBe("draft");
                    expect(retained?.quality?.status).toBe(
                        "partiallySupported",
                    );
                    expect(retained?.quality?.confidence).toBe(0.5);
                    expect(
                        (await store.getViewBuild("corpus", data.job.jobId))
                            ?.results[0].quality,
                    ).toEqual(retained?.quality);
                    expect(
                        (
                            await new TypedViewStore(root).getView({
                                corpusId: "corpus",
                                viewId: "candidate",
                            })
                        )?.quality,
                    ).toEqual(retained?.quality);
                } else expect(retained).toBeUndefined();
                for (const participant of review.participants.filter(
                    (entry) => entry.page,
                ))
                    expect(
                        (
                            await store.getView({
                                corpusId: "corpus",
                                viewId: participant.id,
                            })
                        )?.revisionId,
                    ).toBe(participant.revisionId);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        },
    );
});

test("revoked source authorization withholds complete review evidence without erasing retained work or leaking it through approval failure", async () => {
    const { root, store, review } = await fixture();
    try {
        review.request.raw = "Confidential original Sol response";
        review.resolution = separate(review.participants);
        await store.reserveWikiAmbiguityReview(review);
        const harness = Object.create(
            FileMemoryService.prototype,
        ) as ServiceHarness;
        harness.viewStore = store;
        harness.enqueueWrite = async (_corpusId, work) => work();
        harness.requireViews = async () => ({
            access: { read: async (work) => work() },
        });
        harness.getCorpusRuntime = async () => ({
            manifest: {
                sources: review.participants.flatMap((participant) =>
                    participant.input.inputs.map((source) => ({
                        sourceId: source.sourceId,
                        revisions: [{ revisionId: source.revisionId }],
                    })),
                ),
            },
        });
        harness.sourceAllowed = async () => false;
        const redacted = (await harness.listWikiAmbiguityReviews("corpus"))[0];
        expect(redacted.state).toBe("conflict");
        expect(redacted.request.raw).toBeUndefined();
        expect(redacted.resolution).toBeUndefined();
        expect(
            redacted.participants.every(
                (entry) =>
                    !entry.page && !entry.draft && !entry.input.inputs.length,
            ),
        ).toBe(true);
        const response = await harness.resolveWikiAmbiguityReview({
            corpusId: "corpus",
            reviewId: review.id,
            expectedVersion: 1,
            action: "approve",
        });
        expect(response.request.raw).toBeUndefined();
        expect(JSON.stringify(response)).not.toContain("Confidential");
        expect(
            (await store.listWikiAmbiguityReviews("corpus"))[0].request.raw,
        ).toBe("Confidential original Sol response");
        expect((await store.listViews("corpus")).views).toHaveLength(2);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

function completeCombination(
    record: WikiAmbiguityReview,
): WikiAmbiguityResolution {
    const candidate = record.participants.find((entry) => !entry.page)!;
    const pages = record.participants.filter((entry) => entry.page);
    const first = pages[0].page!;
    const second = pages[1].page!;
    const pair = preservedCanonicalOutput(first, second);
    const candidatePage: ViewVersion = {
        ...first,
        viewId: candidate.id,
        content: candidate.draft!.content,
        generation: { ...first.generation!, input: candidate.input },
        relationships: candidate.draft!.relationships.map((edge) => ({
            ...edge,
            schemaVersion: 1 as const,
            family: "evidence" as const,
            origin: "generator" as const,
            reviewState: "unreviewed" as const,
        })),
    };
    const triple = preservedCanonicalOutput(
        {
            ...first,
            content: pair.output.content,
            generation: {
                ...first.generation!,
                input: consolidationInput(first, second),
            },
            relationships: pair.output.relationships.map((edge) => ({
                ...edge,
                schemaVersion: 1 as const,
                family: "evidence" as const,
                origin: "generator" as const,
                reviewState: "unreviewed" as const,
            })),
        },
        candidatePage,
    );
    const bindings = [
        ...first.content.sections.map((section) => ({
            id: first.viewId,
            sectionId: section.id,
            combinedSectionId: section.id,
        })),
        ...pair.anchors.map((anchor) => ({
            id: second.viewId,
            sectionId: anchor.from,
            combinedSectionId: anchor.to,
        })),
        ...triple.anchors.map((anchor) => ({
            id: candidate.id,
            sectionId: anchor.from,
            combinedSectionId: anchor.to,
        })),
    ];
    for (const binding of bindings) {
        const section = triple.output.content.sections.find(
            (entry) => entry.id === binding.combinedSectionId,
        )!;
        const original = record.participants.find(
            (entry) => entry.id === binding.id,
        )!;
        section.body = (
            original.page?.content ?? original.draft!.content
        ).sections.find((entry) => entry.id === binding.sectionId)!.body;
        if (binding.id === candidate.id)
            section.body = section.body.replace("[f0]", "[f1]");
        if (binding.id === second.viewId)
            section.body = section.body.replace("[f0]", "[f2]");
    }
    if (triple.output.content.kind === "wiki")
        triple.output.content.status = "partial";
    return {
        status: "resolved",
        reason: "Same scoped article identity verified",
        groups: [
            {
                action: "combine",
                ids: record.participants.map((entry) => entry.id),
                survivorId: first.viewId,
                combined: JSON.stringify(triple.output),
                sections: bindings,
            },
        ],
    };
}

test.each([
    "needs_review",
    "malformed",
    "failed",
    "unavailable",
    "resolved",
    "combine",
    "scope_uncertain",
    "partial_preservation",
] as const)(
    "service retains or verifies %s, with one logical Sol call across restart",
    async (scenario) => {
        const { root, store, job, review } = await fixture();
        try {
            let calls = 0;
            const harness = Object.create(
                FileMemoryService.prototype,
            ) as ServiceHarness;
            harness.viewStore = store;
            harness.enqueueWrite = async (_corpusId, task) => task();
            harness.assertInfluenceEligible = async () => {};
            harness.recheckViewInput = async () => {};
            harness.checkWikiContributionInput = async () => {};
            harness.assertWikiAmbiguitySources = async () => {};
            harness.viewAdapter = {
                identity: "offline",
                generate: async (snapshot) => output(snapshot),
                validate: async (_snapshot, candidate) => ({
                    supported: true,
                    missingContext: [],
                    reasons: [],
                    sections: candidate.content.sections.map((section) => ({
                        sectionId: section.id,
                        supported: true,
                        reason: "original evidence",
                    })),
                    relationships: candidate.relationships.map((edge) => ({
                        edgeId: edge.id,
                        supported: true,
                        reason: "original evidence",
                    })),
                }),
                checkEditorial: async (snapshot) => {
                    expect(snapshot.editorial?.targetRevisionId).toBeDefined();
                    return {
                        safe: true,
                        failures: [],
                        quality: supportQuality([
                            {
                                category: "preservation",
                                status:
                                    scenario === "partial_preservation"
                                        ? "partiallySupported"
                                        : "supported",
                            },
                        ]),
                    };
                },
                assessWikiConsolidation: async (
                    snapshot,
                    survivor,
                    retiring,
                ) => {
                    expect(survivor.generation?.input).toEqual(snapshot);
                    expect(retiring.generation?.input).toEqual(snapshot);
                    expect(retiring.content.sections[0].body).not.toContain(
                        "[f0]",
                    );
                    if (scenario === "scope_uncertain")
                        throw new WikiAmbiguityDecisionError(
                            "Compatibility uncertain; complete evidence retained",
                            [],
                        );
                    return {
                        relation: "samePurpose",
                        reason: "same-scoped-purpose",
                        scope: {
                            system: "same",
                            initiative: "",
                            purpose: "same scoped identity",
                        },
                        criticalDistinctions: [],
                    };
                },
                resolveWikiAmbiguity: async (record) => {
                    calls++;
                    if (scenario === "failed")
                        throw new Error("offline Sol transport failure");
                    if (scenario === "unavailable")
                        throw new Error(
                            "GPT_6_1_SOL is unavailable; no writer-model fallback",
                        );
                    if (scenario === "malformed") return { status: "resolved" };
                    if (scenario === "resolved")
                        return separate(record.participants);
                    if (
                        scenario === "combine" ||
                        scenario === "scope_uncertain" ||
                        scenario === "partial_preservation"
                    )
                        return completeCombination(record);
                    return {
                        ...separate(record.participants),
                        status: "needs_review",
                        reason: "Identity remains uncertain",
                    };
                },
            };
            const contexts = review.participants
                .filter((entry) => entry.page)
                .map((entry) => ({
                    viewId: entry.id,
                    revisionId: entry.revisionId!,
                })) as WikiPagePurposeContext[];
            await harness.resolveWikiAmbiguity(
                job,
                job.results[0],
                assessment,
                contexts,
                new AbortController().signal,
            );
            const pending = (await store.listWikiAmbiguityReviews("corpus"))[0];
            if (
                (scenario === "combine" || scenario === "resolved") &&
                pending.state !== "resolved"
            )
                throw new Error(
                    `Verified resolution stayed ${pending.state}: ${pending.reason}`,
                );
            expect(pending.state).toBe(
                scenario === "resolved" || scenario === "combine"
                    ? "resolved"
                    : "needsReview",
            );
            expect(pending.participants[0].draft?.content).toEqual(
                output(job.results[0].snapshot).content,
            );
            expect((await store.listViews("corpus")).views).toHaveLength(
                scenario === "resolved" ? 3 : 2,
            );
            if (scenario === "resolved" || scenario === "combine") return;
            for (const participant of review.participants.filter(
                (entry) => entry.page,
            ))
                expect(
                    (
                        await store.getView({
                            corpusId: "corpus",
                            viewId: participant.id,
                        })
                    )?.revisionId,
                ).toBe(participant.revisionId);
            if (scenario === "partial_preservation")
                expect(JSON.stringify(pending.verification)).toContain(
                    "partiallySupported",
                );
            if (scenario === "scope_uncertain")
                expect(JSON.stringify(pending.verification)).toContain(
                    "Compatibility uncertain",
                );
            harness.viewStore = new TypedViewStore(root);
            await harness.resolveWikiAmbiguity(
                job,
                job.results[0],
                assessment,
                contexts,
                new AbortController().signal,
            );
            expect(calls).toBe(1);
            expect(
                (await harness.viewStore.listWikiAmbiguityReviews("corpus"))[0]
                    .reason,
            ).toBe(pending.reason);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    },
);
