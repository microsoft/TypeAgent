// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
    AnswerCandidate,
    QuestionEdit,
    QuestionSlot,
    SchemaViewDefinition,
} from "../src/schemaViewTypes.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewDefinitionInput,
    ViewSynthesisAdapter,
    ViewVersion,
} from "../src/viewTypes.js";
import {
    candidateIdentity,
    emptySchemaView,
    independentSupport,
    mergeSchemaAnswers,
    resolveQuestion,
    validateAnswerSchema,
    validateSchemaViewDefinition,
    validateSchemaViewContent,
} from "../src/schemaView.js";
import {
    hydrateSchemaAnswers,
    parseSchemaProposal,
} from "../src/schemaViewSynthesis.js";
import {
    questionInventory,
    editSchemaQuestion,
    parseViewPageUri,
    renderViewPage,
    viewPageUri,
} from "../src/schemaViewOperations.js";
import { validateConstructedGuide } from "../src/viewSynthesis.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { ViewHistory } from "../src/viewHistory.js";
import { TypedViewStore } from "../src/viewStore.js";
import { buildSummary, questionSummary } from "../src/inventory.js";

const name: QuestionSlot = {
    id: "name",
    question: "What is the preferred name?",
    cardinality: "singleton",
    schema: { type: "string" },
    rubric: {
        version: 1,
        selection: "mostRecent",
        requireConfirmation: false,
        authoritySourceIds: [],
    },
    approval: "approved",
    discoveryCitations: [],
};
const profile: QuestionSlot = {
    ...name,
    id: "profile",
    question: "What is the profile address?",
    cardinality: "record",
    schema: {
        type: "object",
        properties: { street: { type: "string" }, city: { type: "string" } },
        required: ["street", "city"],
    },
};
const destinations: QuestionSlot = {
    ...name,
    id: "destinations",
    question: "Where have orders shipped?",
    cardinality: "collection",
    schema: {
        type: "object",
        properties: {
            addressId: { type: "string" },
            street: { type: "string" },
        },
        required: ["addressId", "street"],
    },
    itemKey: "addressId",
};

function schema(slots = [name, profile, destinations]): SchemaViewDefinition {
    return {
        construction: "schema-defined-v1",
        title: "Profile and destinations",
        slots: structuredClone(slots),
        template: "questions-v1",
        discovery: { enabled: false, maxProposals: 0 },
    };
}
function definition(
    slots = [name, profile, destinations],
): ViewDefinitionInput {
    return {
        viewId: "profile-view",
        kind: "schemaView",
        selector: { kind: "sources", sources: [] },
        schemaView: schema(slots),
    };
}
function snapshot(slots = [name]): ViewBuildSnapshot {
    const def = definition(slots);
    def.selector.sources = [{ sourceId: "source", revisionId: "revision" }];
    return {
        corpusId: "corpus",
        actor: "test",
        definition: def,
        expectedVersion: 0,
        bounds: {},
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Profile",
                content: "Preferred name is Ada.",
                contentHash: "hash",
            },
        ],
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "fingerprint",
    };
}
function raw(value: unknown, slotId = "name", time = "") {
    return {
        slotId,
        candidates: [
            {
                valueJson: JSON.stringify(value),
                effectiveAt: time,
                passageIds: ["p0-0"],
                opposingPassageIds: [],
            },
        ],
    };
}
function candidate(value: string): AnswerCandidate {
    return {
        id: candidateIdentity(value),
        value,
        origin: "source",
        review: "unreviewed",
        citations: [
            {
                sourceId: "source",
                revisionId: "revision",
                locator: "chars:0-1",
                excerpt: "x",
            },
        ],
        opposingCitations: [],
        derivedFrom: [],
        support: [],
    };
}
test("question cards do not repeat excerpts, candidate values or support lists", () => {
    const question = questionInventory({ head: null, views: [version()] })[0];
    const answer = candidate("Private answer ".repeat(10000));
    const citation = answer.citations[0];
    citation.excerpt = "Private excerpt ".repeat(10000);
    answer.support = [{ citation, derivedFrom: [] }];
    question.slot.discoveryCitations = [citation];
    question.details.candidates = [answer];
    const summary = questionSummary(question);
    expect(Buffer.byteLength(JSON.stringify(question))).toBeGreaterThan(500000);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(1000);
    expect(summary.details.candidateCount).toBe(1);
    expect(summary.details.hasUnreviewedCandidates).toBe(true);
    expect(summary.slot.discoveryCitationCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("Private");
});

function version(): ViewVersion {
    const def = definition();
    return {
        corpusId: "corpus",
        viewId: def.viewId,
        revisionId: "version",
        version: 1,
        actor: "test",
        createdAt: new Date().toISOString(),
        state: "draft",
        provenance: "human",
        definition: { ...def, revisionId: "definition" },
        content: emptySchemaView(def.schemaView!),
        relationships: [],
    };
}

test("one additive construction validates all cardinalities and honest unknowns", () => {
    const def = definition();
    validateSchemaViewDefinition(def);
    validateSchemaViewContent(def, emptySchemaView(def.schemaView!));
    expect(
        emptySchemaView(def.schemaView!).sections.map(
            (section) => section.details.answerState,
        ),
    ).toEqual(["pending", "pending", "pending"]);
});

test.each([
    { type: "array" },
    { type: "string", executable: "process.exit()" },
    {
        type: "object",
        properties: { legal: { type: "string" } },
        required: ["missing"],
    },
    {
        type: "object",
        properties: JSON.parse('{"__proto__":{"type":"string"}}'),
        required: [],
    },
])(
    "restricted schemas reject unsafe or unsupported definitions %#",
    (schema) => {
        expect(() => validateAnswerSchema(schema)).toThrow();
    },
);

test("collections require a declared required stable string key", () => {
    const def = definition([{ ...destinations, itemKey: "missing" }]);
    expect(() => validateSchemaViewDefinition(def)).toThrow(/identity/);
});

test("source mentions are not independent votes and ties stay unresolved", () => {
    const first = candidate("Ada"),
        second = candidate("Grace");
    const slot = {
        ...name,
        rubric: { ...name.rubric, selection: "independentSupport" as const },
    };
    expect(independentSupport(first)).toBeUndefined();
    const result = resolveQuestion(slot, [first, second], []);
    expect(result.answerState).toBe("conflicted");
    expect(result.selectedCandidateIds).toEqual([]);
    const support = {
        citation: first.citations[0],
        independenceKey: "original",
        derivedFrom: [],
    };
    first.support = [support, support];
    expect(independentSupport(first)).toBe(1);
    first.support = [{ ...support, derivedFrom: ["original"] }];
    expect(independentSupport(first)).toBeUndefined();
});

test("scope authority and confirmation precede scoring", () => {
    const first = candidate("Ada");
    const slot = {
        ...name,
        rubric: { ...name.rubric, requireConfirmation: true },
    };
    expect(resolveQuestion(slot, [first], []).answerState).toBe("pending");
    first.review = "confirmed";
    expect(resolveQuestion(slot, [first], []).answerState).toBe("answered");
    expect(
        resolveQuestion(
            {
                ...slot,
                rubric: { ...slot.rubric, authoritySourceIds: ["other"] },
            },
            [first],
            [],
        ).answerState,
    ).toBe("pending");
});

test("partial records and collections do not imply complete coverage", () => {
    const input = snapshot([profile, destinations]);
    const output = hydrateSchemaAnswers(input, {
        answers: [
            raw({ city: "Paris" }, "profile"),
            raw({ addressId: "home", street: "1 Example" }, "destinations"),
        ],
    });

    validateConstructedGuide(input, output);
    expect(
        output.content.sections.map(
            (section) =>
                section.details?.kind === "question" &&
                section.details.answerState,
        ),
    ).toEqual(["partial", "partial"]);
});

test("question pages distinguish evidence maintenance from present-day truth", () => {
    const view = version();
    const page = renderViewPage(view, {
        corpusId: view.corpusId,
        viewId: view.viewId,
    });
    expect(page.markdown).toContain("freshness: current");
    expect(page.markdown).toContain(
        "not whether a historical fact still holds today",
    );
    if (view.content.kind !== "schemaView")
        throw new Error("Expected schema view fixture");
    validateSchemaViewContent(view.definition, view.content);
});

test("all candidates, including rejected values and discovery evidence, stay in purge traversal", () => {
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, { answers: [raw("Ada")] });
    if (output.content.kind !== "schemaView") throw new Error("Wrong fixture");
    const view = version();
    view.definition = { ...input.definition, revisionId: "definition" };
    view.content = output.content;
    const edited = editSchemaQuestion(view, {
        corpusId: view.corpusId,
        viewId: view.viewId,
        expectedHead: null,
        expectedVersion: 1,
        slotId: "name",
        edit: {
            kind: "review",
            candidateId: output.content.sections[0].details.candidates[0].id,
            review: "rejected",
        },
    });
    expect(edited.content.citations).toHaveLength(1);
    validateSchemaViewContent(
        edited.definition,
        edited.content as typeof output.content,
    );
    const tampered = structuredClone(edited.content) as typeof output.content;
    tampered.citations = [];
    expect(() =>
        validateSchemaViewContent(edited.definition, tampered),
    ).toThrow(/provenance/);
});

test("fabricated citations and host lineage fail before publication", () => {
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, { answers: [raw("Ada")] });
    validateConstructedGuide(input, output);
    if (output.content.kind !== "schemaView") throw new Error("Wrong fixture");
    output.content.sections[0].details.candidates[0].support[0].independenceKey =
        "invented";
    expect(() => validateConstructedGuide(input, output)).toThrow(/lineage/);
    expect(() =>
        hydrateSchemaAnswers(input, {
            answers: [
                {
                    slotId: "name",
                    candidates: [
                        {
                            ...raw("Ada").candidates[0],
                            passageIds: ["invented"],
                        },
                    ],
                },
            ],
        }),
    ).toThrow(/passage/);
});

test("explicit assertions remain user-owned even when later evidence proposes the same value", () => {
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, { answers: [raw("Ada")] });
    const view = version();
    view.definition = { ...input.definition, revisionId: "definition" };
    view.content = output.content;
    const edited = editSchemaQuestion(view, {
        corpusId: view.corpusId,
        viewId: view.viewId,
        expectedHead: null,
        expectedVersion: view.version,
        slotId: "name",
        edit: { kind: "assert", value: "Ada" },
    });
    if (edited.content.kind !== "schemaView") throw new Error("Wrong fixture");
    validateSchemaViewContent(edited.definition, edited.content);
    view.content = edited.content;
    const merged = mergeSchemaAnswers(view, output);
    if (merged.output.content.kind !== "schemaView")
        throw new Error("Wrong fixture");
    const assertion = merged.output.content.sections[0].details.candidates[0];
    expect(assertion.origin).toBe("user");
    expect(assertion.citations).toEqual([]);
    expect(assertion.review).toBe("confirmed");
    validateConstructedGuide(input, merged.output);
});

test("pages are deterministic revision-addressable projections, not editable copies", () => {
    const view = version();
    const request = {
        corpusId: view.corpusId,
        viewId: view.viewId,
        revisionId: view.revisionId,
        slotId: "name",
    };
    const page = renderViewPage(view, request);
    expect(renderViewPage(view, request)).toEqual(page);
    expect(page.markdown).toContain("Unknown");
    expect(parseViewPageUri(viewPageUri(request))).toEqual(request);
    expect(() =>
        renderViewPage(view, { ...request, itemKey: "absent" }),
    ).toThrow(/absent/);
});

test("assisted examples propose contracts, never accepted facts or tool permission", () => {
    const result = parseSchemaProposal({ json: JSON.stringify(schema()) });
    expect(
        result.slots.every(
            (slot) =>
                slot.approval === "proposed" && slot.rubric.requireConfirmation,
        ),
    ).toBe(true);
    expect(result.discovery.enabled).toBe(false);
    expect(
        emptySchemaView(result).sections.every(
            (section) => !section.details.candidates.length,
        ),
    ).toBe(true);
});

describe("ordinary-source schema lifecycle", () => {
    let root: string;
    let service: FileMemoryService;
    let modelCalls = 0;
    let fetchCalls = 0;
    let discoveryCalls = 0;
    let expectedCloseFailure: string | undefined;
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-schema-views-"));
        modelCalls = 0;
        fetchCalls = 0;
        discoveryCalls = 0;
        expectedCloseFailure = undefined;
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-schema-fixture-v1",
            proposeSchema: async () => ({
                ...schema([name]),
                discovery: { enabled: true, maxProposals: 8 },
            }),
            discoverSchemaQuestions: async (input) => {
                discoveryCalls++;
                const source = input.inputs[0];
                return [
                    {
                        ...profile,
                        id: "discovered-address",
                        approval: "proposed",
                        discoveryCitations: [
                            {
                                sourceId: source.sourceId,
                                revisionId: source.revisionId,
                                locator: `chars:0-${source.content.length}`,
                                excerpt: source.content,
                            },
                        ],
                    },
                ];
            },
            generate: async (input) => {
                modelCalls++;
                return hydrateSchemaAnswers(input, {
                    answers: input.inputs.length ? [raw("Ada")] : [],
                });
            },
            validate: async (_input, output) => ({
                supported: true,
                missingContext: [],
                reasons: [],
                sections: output.content.sections.map((section) => ({
                    sectionId: section.id,
                    supported: true,
                    reason: "Controlled offline evidence fixture",
                })),
                relationships: output.relationships.map((edge) => ({
                    edgeId: edge.id,
                    supported: true,
                    reason: "Controlled offline evidence fixture",
                })),
            }),
        };
        service = new FileMemoryService(root, {
            informationalViews: false,
            sourceSynopses: false,
            viewSynthesisAdapter: adapter,
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            acquisition: {
                toolsEnabled: true,
                principalId: "owner",
                policyId: "profile-policy",
                graceMs: 0,
                authorize: (request) =>
                    request.toolId === "profile-read" &&
                    request.resourceIdentity === "profile-resource",
                tools: [
                    {
                        id: "profile-read",
                        read: async () => {
                            fetchCalls++;
                            return {
                                title: "Profile",
                                text: "Preferred name is Ada.",
                            };
                        },
                    },
                ],
            },
        });
    });
    afterEach(async () => {
        try {
            if (expectedCloseFailure)
                await expect(service.close()).rejects.toThrow(
                    expectedCloseFailure,
                );
            else await service.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    async function settled(job: ViewBuildJob) {
        for (let count = 0; count < 1000; count++) {
            const current = (await service.getViewBuild(job))!;
            if (current.state !== "running") {
                expect(
                    current.results.map((result) => result.reason).join("\n"),
                ).not.toMatch(/failed|unsupported|conflict/i);
                expect(current.state).toBe("complete");
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Schema build timed out");
    }

    async function overlappingFixture() {
        const corpus = await service.createCorpus("Overlapping questions");
        const def = definition([name]);
        def.maintenance = {
            schemaVersion: 1,
            scope: { mode: "scopedSources", tags: ["profile"] },
        };
        await settled(
            await service.buildViews({
                corpusId: corpus.corpusId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
                publication: false,
                targets: [
                    { definition: def, expectedVersion: 0 },
                    {
                        definition: { ...def, viewId: "second-view" },
                        expectedVersion: 0,
                    },
                ],
            }),
        );
        const inventory = await service.listQuestions(corpus.corpusId);
        const request = await service.requestAcquisition({
            corpusId: corpus.corpusId,
            principalId: "owner",
            policyId: "profile-policy",
            toolId: "profile-read",
            resourceIdentity: "profile-resource",
            authorizedArguments: {},
            scopeFingerprint: inventory.items[0].details.scopeFingerprint,
            consumers: inventory.items.map((item) => ({
                viewId: item.viewId,
                slotId: item.slot.id,
                definitionRevision: item.definitionRevision,
            })),
            lineage: { rootId: "explicit-user-request", maxCalls: 1 },
        });
        return { corpus, request };
    }

    test("paged inventories omit evidence and frozen inputs; detail and bulk publication remain authoritative", async () => {
        const corpus = await service.createCorpus("Inventory contracts");
        const corpusId = corpus.corpusId;
        const targets = [20, 10].map((count, group) => ({
            expectedVersion: 0,
            definition: {
                ...definition(
                    Array.from({ length: count }, (_, index) => ({
                        ...name,
                        id: `question-${index}`,
                        question: `Profile field ${index}`,
                    })),
                ),
                viewId: `profile-${group}`,
            },
        }));
        const job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            publication: false,
            targets,
        });
        await settled(job);
        const first = await service.listQuestionSummaries({ corpusId });
        expect(first.items).toHaveLength(25);
        expect(first.total).toBe(30);
        expect(first.nextContinuationToken).toBe("25");
        const second = await service.listQuestionSummaries({
            corpusId,
            continuationToken: "25",
        });
        expect(second.items).toHaveLength(5);
        expect(second.nextContinuationToken).toBeUndefined();
        expect(
            new Set(
                [...first.items, ...second.items].map(
                    (item) => `${item.viewId}/${item.slot.id}`,
                ),
            ).size,
        ).toBe(30);
        expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(20000);
        expect(first.items[0].details).not.toHaveProperty("candidates");
        expect(first.items[0].slot).not.toHaveProperty("schema");
        expect(first.items[0].slot).not.toHaveProperty("discoveryCitations");
        const selected = first.items[0];
        const detail = await service.getQuestion({
            corpusId,
            viewId: selected.viewId,
            slotId: selected.slot.id,
        });
        expect(detail).toEqual(
            (await service.listQuestions(corpusId)).items.find(
                (item) =>
                    item.viewId === selected.viewId &&
                    item.slot.id === selected.slot.id,
            ),
        );
        expect(detail?.slot.schema).toEqual(name.schema);
        expect(
            await service.getQuestion({
                corpusId,
                viewId: selected.viewId,
                slotId: "missing",
            }),
        ).toBeUndefined();
        expect(
            (
                await service.listQuestionSummaries({
                    corpusId,
                    answerFilter: "answered",
                })
            ).total,
        ).toBe(0);
        expect(
            (
                await service.listQuestionSummaries({
                    corpusId,
                    query: "field 19",
                })
            ).total,
        ).toBe(1);
        expect(
            (
                await service.listQuestionSummaries({
                    corpusId,
                    viewId: "profile-1",
                })
            ).total,
        ).toBe(10);
        const views = await service.listViewSummaries({
            corpusId,
            pageSize: 1,
        });
        expect(views.total).toBe(2);
        expect(views.items[0].content).toEqual({
            kind: "schemaView",
            title: "Profile and destinations",
        });
        expect(views.items[0]).not.toHaveProperty("definition");
        expect(
            (await service.listViewSummaries({ corpusId, kind: "wiki" })).total,
        ).toBe(0);
        const ids = targets.map((target) => target.definition.viewId);
        const expected = await Promise.all(
            ids.map((viewId) =>
                service.getViewPublication({ corpusId, viewId }),
            ),
        );
        const read = ViewHistory.prototype.read;
        const readEntry = ViewHistory.prototype.readEntry;
        let reads = 0;
        let projectionReads = 0;
        ViewHistory.prototype.read = function (
            this: ViewHistory<unknown>,
            ...args: Parameters<typeof read>
        ) {
            reads++;
            return read.apply(this, args);
        };
        ViewHistory.prototype.readEntry = function <T>(
            this: ViewHistory<unknown>,
            ...args: Parameters<typeof readEntry>
        ) {
            if (args[0] === "view-read-projection.json") projectionReads++;
            return (readEntry<T>).apply(this, args);
        };
        try {
            expect(
                await service.getViewPublications({ corpusId, viewIds: ids }),
            ).toEqual(expected);
            expect(reads).toBe(0);
            expect(projectionReads).toBe(1);
            projectionReads = 0;
            await service.listViewSummaries({ corpusId });
            expect(reads).toBe(0);
            expect(projectionReads).toBe(1);
        } finally {
            ViewHistory.prototype.read = read;
            ViewHistory.prototype.readEntry = readEntry;
        }
        await expect(
            service.getViewPublications({
                corpusId,
                viewIds: [ids[0], ids[0]],
            }),
        ).rejects.toThrow("unique");
        for (const pageSize of [0, -1, 101, 1.5]) {
            await expect(
                service.listViewSummaries({ corpusId, pageSize }),
            ).rejects.toThrow("pageSize");
            await expect(
                service.listQuestionSummaries({ corpusId, pageSize }),
            ).rejects.toThrow("pageSize");
            await expect(
                service.listViewBuildSummaries({ corpusId, pageSize }),
            ).rejects.toThrow("pageSize");
        }
        await expect(
            service.listQuestionSummaries({
                corpusId,
                continuationToken: "invalid",
            }),
        ).rejects.toThrow();
        await expect(
            service.listViewSummaries({ corpusId, continuationToken: "99" }),
        ).rejects.toThrow("out of range");
        await expect(
            service.listViewSummaries({ corpusId, query: "x".repeat(1001) }),
        ).rejects.toThrow("query");

        const full = (await service.getViewBuild(job))!;
        full.results[0].snapshot = snapshot();
        full.results[0].snapshot.inputs[0].content =
            "private source body ".repeat(10000);
        const summary = buildSummary(
            full,
            new Map(ids.map((id) => [id, "newer-job"])),
        );
        expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(2000);
        expect(summary.results[0].current).toBe(false);
        expect(summary.results[0].snapshot).not.toHaveProperty("inputs");
        expect(summary.results[0].snapshot.definition).toEqual({
            kind: "schemaView",
        });
    }, 60000);

    async function answered(corpusId: string) {
        for (let count = 0; count < 1000; count++) {
            const inventory = await service.listQuestions(corpusId);
            if (inventory.maintenanceError)
                throw new Error(inventory.maintenanceError);
            if (
                inventory.items.length &&
                inventory.items.every(
                    (item) => item.details.answerState === "answered",
                )
            )
                return inventory;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(
            "Ordinary intake did not reconcile the overlapping views",
        );
    }

    async function editCurrentQuestion(
        corpusId: string,
        slotId: string,
        edit: QuestionEdit,
    ) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const inventory = await service.listQuestions(corpusId);
            const question = inventory.items.find(
                (item) => item.slot.id === slotId,
            )!;
            try {
                return await service.editQuestion({
                    corpusId,
                    viewId: question.viewId,
                    slotId,
                    expectedHead: inventory.head,
                    expectedVersion: question.viewVersion,
                    edit,
                });
            } catch (error) {
                if (
                    !(error instanceof Error) ||
                    !/^(View history head|View version|Question edit version) conflict/.test(
                        error.message,
                    )
                )
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        throw new Error(`Question editing did not settle: ${slotId}`);
    }

    test("one acquired ordinary source contributes to two independently eligible views without refetch", async () => {
        const { corpus } = await overlappingFixture();
        const first = await service.runAcquisitions(corpus.corpusId);
        expect(fetchCalls).toBe(1);
        expect(first[0].receipt).toBeDefined();
        expect(
            (await waitForMemoryJob(service, first[0].receipt!.jobId)).state,
        ).toBe("complete");
        const inventory = await answered(corpus.corpusId);
        expect(inventory.items).toHaveLength(2);
        expect(
            new Set(
                inventory.items.flatMap((item) =>
                    item.details.candidates.flatMap((candidate) =>
                        candidate.citations.map(
                            (citation) => citation.sourceId,
                        ),
                    ),
                ),
            ).size,
        ).toBe(1);
        expect((await service.runAcquisitions(corpus.corpusId))[0].state).toBe(
            "resolved",
        );
        expect(fetchCalls).toBe(1);
        expect((await service.listSources(corpus.corpusId)).length).toBe(1);
    }, 60000);

    test("an admitted upcoming ordinary source resolves questions before enrichment: zero fetches", async () => {
        const { corpus } = await overlappingFixture();
        let jobId = "";
        await service.withIngestionGroup(async () => {
            const source = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "upcoming",
                    sourceType: "text",
                    title: "Upcoming profile",
                    text: "Preferred name is Ada.",
                    tags: ["profile"],
                },
            });
            jobId = source.jobId;
            expect(
                (await service.runAcquisitions(corpus.corpusId))[0].state,
            ).toBe("deferred");
            expect(fetchCalls).toBe(0);
        });
        await waitForMemoryJob(service, jobId);
        await answered(corpus.corpusId);
        expect((await service.runAcquisitions(corpus.corpusId))[0].state).toBe(
            "resolved",
        );
        expect(fetchCalls).toBe(0);
    }, 60000);

    test.each([
        { conflicts: 1, exhausted: false },
        { conflicts: 4, exhausted: true },
    ])(
        "automatic reconciliation replans $conflicts stale admissions with bounded retries (exhausted: $exhausted)",
        async ({ conflicts, exhausted }) => {
            const { corpus } = await overlappingFixture();
            const plan = service.planViewMaintenance.bind(service);
            let rebuildPlans = 0;
            service.planViewMaintenance = async (request) => {
                const current = await plan(request);
                if (
                    current.targets.some((target) => target.state === "rebuild")
                ) {
                    rebuildPlans++;
                    if (rebuildPlans <= conflicts)
                        await new TypedViewStore(root).recordViewMaintenance(
                            current,
                        );
                }
                return current;
            };
            const admitted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "replanning-evidence",
                    sourceType: "text",
                    title: "Fresh profile",
                    text: "Preferred name is Ada.",
                    tags: ["profile"],
                },
            });
            await waitForMemoryJob(service, admitted.jobId);
            if (!exhausted) {
                await answered(corpus.corpusId);
                expect(rebuildPlans).toBeGreaterThan(conflicts);
                return;
            }
            let failure: string | undefined;
            for (let count = 0; count < 1000; count++) {
                failure = (await service.listQuestions(corpus.corpusId))
                    .maintenanceError;
                if (failure) break;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(failure).toBe(
                "Maintenance head or target version changed; inspect a fresh plan",
            );
            expect(rebuildPlans).toBe(4);
            expect(await service.listViewBuilds(corpus.corpusId)).toHaveLength(
                1,
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            expect(rebuildPlans).toBe(4);
            expectedCloseFailure = failure;
        },
        60000,
    );

    test("assisted authoring requires approval and bounded discovered proposals retain rejection history", async () => {
        const corpus = await service.createCorpus("Assisted contracts");
        await service.proposeSchemaView({
            corpusId: corpus.corpusId,
            viewId: "assisted",
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            expectedVersion: 0,
            specification: "An example profile form with preferred name",
            maintenance: {
                schemaVersion: 1,
                scope: { mode: "scopedSources", tags: ["profile"] },
            },
        });
        let inventory = await service.listQuestions(corpus.corpusId);
        expect(inventory.items[0].slot.approval).toBe("proposed");
        expect(inventory.items[0].details.candidates).toEqual([]);
        expect(
            (
                await service.getView({
                    corpusId: corpus.corpusId,
                    viewId: "assisted",
                })
            )?.definition.schemaView?.discovery,
        ).toEqual({ enabled: false, maxProposals: 0 });
        await editCurrentQuestion(corpus.corpusId, "name", {
            kind: "approval",
            approval: "approved",
        });
        const source = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "profile",
                sourceType: "text",
                title: "Profile",
                text: "Preferred name is Ada.",
                tags: ["profile"],
            },
        });
        await waitForMemoryJob(service, source.jobId);
        for (let count = 0; count < 1000; count++) {
            inventory = await service.listQuestions(corpus.corpusId);
            if (inventory.maintenanceError)
                throw new Error(inventory.maintenanceError);
            if (inventory.items[0].details.candidates.length) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(inventory.items[0].details.answerState).toBe("pending");
        await editCurrentQuestion(corpus.corpusId, "name", {
            kind: "discovery",
            enabled: true,
            maxProposals: 1,
        });
        for (let count = 0; count < 1000; count++) {
            inventory = await service.listQuestions(corpus.corpusId);
            if (inventory.maintenanceError)
                throw new Error(inventory.maintenanceError);
            if (inventory.items.length === 2) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const proposal = inventory.items.find(
            (item) => item.slot.id === "discovered-address",
        )!;
        expect(proposal.slot.approval).toBe("proposed");
        await editCurrentQuestion(corpus.corpusId, proposal.slot.id, {
            kind: "approval",
            approval: "rejected",
        });
        await expect(
            editCurrentQuestion(corpus.corpusId, "name", {
                kind: "discovery",
                enabled: true,
                maxProposals: 0,
            }),
        ).rejects.toThrow(/already admitted/);
        expect(
            (await service.listQuestions(corpus.corpusId)).items.find(
                (item) => item.slot.id === proposal.slot.id,
            )?.slot.approval,
        ).toBe("rejected");
        const later = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "later",
                sourceType: "text",
                title: "Later profile",
                text: "Preferred name remains Ada.",
                tags: ["profile"],
            },
        });
        await waitForMemoryJob(service, later.jobId);
        for (let count = 0; count < 1000; count++) {
            inventory = await service.listQuestions(corpus.corpusId);
            if (inventory.maintenanceError)
                throw new Error(inventory.maintenanceError);
            if (
                inventory.items
                    .find((item) => item.slot.id === "name")
                    ?.details.evaluatedSources.some(
                        (source) => source.sourceId === "later",
                    )
            )
                break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(
            inventory.items
                .find((item) => item.slot.id === "name")
                ?.details.evaluatedSources.some(
                    (source) => source.sourceId === "later",
                ),
        ).toBe(true);
        expect(
            inventory.items.find((item) => item.slot.id === proposal.slot.id)
                ?.slot.approval,
        ).toBe("rejected");
        expect(discoveryCalls).toBe(1);
        expect(fetchCalls).toBe(0);
    }, 60000);

    test("pending views reconcile later matching input, direct reads are free, and forget purges history", async () => {
        const corpus = await service.createCorpus("Schema lifecycle");
        const def = definition([name]);
        def.maintenance = {
            schemaVersion: 1,
            scope: { mode: "scopedSources", tags: ["profile"] },
        };
        await settled(
            await service.buildViews({
                corpusId: corpus.corpusId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
                publication: false,
                targets: [{ definition: def, expectedVersion: 0 }],
            }),
        );
        expect(
            (await service.listQuestions(corpus.corpusId)).items[0].details
                .answerState,
        ).toBe("pending");
        const unrelated = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "other",
                sourceType: "text",
                title: "Unrelated",
                text: "Unrelated data",
                tags: ["other"],
            },
        });
        await waitForMemoryJob(service, unrelated.jobId);
        const source = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "profile",
                sourceType: "text",
                title: "Profile",
                text: "Preferred name is Ada.",
                tags: ["profile"],
            },
        });
        await waitForMemoryJob(service, source.jobId);
        for (let count = 0; count < 1000; count++) {
            const questions = await service.listQuestions(corpus.corpusId);
            if (questions.maintenanceError)
                throw new Error(questions.maintenanceError);
            if (questions.items[0].details.answerState === "answered") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const questions = await service.listQuestions(corpus.corpusId);
        expect(questions.items[0].details.answerState).toBe("answered");
        expect(
            questions.items[0].details.evaluatedSources.map(
                (source) => source.sourceId,
            ),
        ).toEqual(["profile"]);
        const calls = modelCalls;
        const page = await service.getViewPage({
            corpusId: corpus.corpusId,
            viewId: def.viewId,
        });
        expect(page.markdown).toContain("Ada");
        await service.getView({
            corpusId: corpus.corpusId,
            viewId: def.viewId,
        });
        await service.listQuestions(corpus.corpusId);
        expect(modelCalls).toBe(calls);
        const publishSnapshot = await service.listViews(corpus.corpusId);
        const current = publishSnapshot.views.find(
            (view) => view.viewId === def.viewId,
        )!;
        await service.publishView({
            corpusId: corpus.corpusId,
            viewId: def.viewId,
            revisionId: current.revisionId,
            expectedHead: publishSnapshot.head!,
            expectedVersion: current.version,
        });
        expect(
            (
                await service.searchViews({
                    corpusId: corpus.corpusId,
                    query: "Ada",
                    freshness: "current",
                    kinds: ["schemaView"],
                })
            ).map((match) => match.view.viewId),
        ).toContain(def.viewId);
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            source.sourceId,
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: source.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        expect((await service.listQuestions(corpus.corpusId)).items).toEqual(
            [],
        );
        expect(
            await service.getViewHistory({
                corpusId: corpus.corpusId,
                viewId: def.viewId,
            }),
        ).toEqual([]);
        await expect(
            service.getViewPage({
                corpusId: corpus.corpusId,
                viewId: def.viewId,
            }),
        ).rejects.toThrow(/unavailable/);
    }, 60000);
});
