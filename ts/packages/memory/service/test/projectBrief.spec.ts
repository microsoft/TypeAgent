// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type {
    ProjectBriefContent,
    ViewBuildJob,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import {
    projectSources,
    projectBriefTestAnswer,
} from "./projectBriefTestModel.js";
import { evidenceArray, evidenceRecord } from "../src/viewSynthesisEvidence.js";
import { authoredRelationships } from "../src/viewRelationships.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
const embeddings: string[] = [];
let alter: (name: string, value: unknown) => unknown = (_name, value) => value;
let prose = "Source-grounded project context.\n\n";
const offlineEmbedding = {
    maxBatchSize: 8,
    generateEmbedding: async (text: string) => {
        embeddings.push(text);
        return {
            success: true as const,
            data: Array.from({ length: 1536 }, (_, index) =>
                index === 0 ? 1 : 0,
            ),
        };
    },
};
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    tryCreateEmbeddingModel: () => offlineEmbedding,
    openai: {
        ...actual.openai,
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
                _usage: unknown,
                schema: StructuredOutputJsonSchema,
            ) => {
                const message = messages.find(
                    (message) => message.role === "user",
                );
                if (!message)
                    throw new Error("Configured project request lacks input");
                const input = evidenceRecord(JSON.parse(message.content));
                calls.push({ name: schema.name, input });
                return {
                    success: true,
                    data: JSON.stringify(
                        alter(
                            schema.name,
                            projectBriefTestAnswer(schema.name, input, prose),
                        ),
                    ),
                };
            },
        }),
    },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { waitForMemoryJob, createMemoryServiceRpcFacade } = await import(
    "../src/rpcFacade.js"
);
const { runMemoryViewsCli } = await import("../src/memoryViewsCli.js");
const { createKnowProCorpusIndex } = await import(
    "../src/knowProCorpusIndex.js"
);
const { createDocMemorySettings } = await import(
    "@typeagent/conversation-memory"
);
const { viewHash, mergeView } = await import("../src/viewMerge.js");
const { inventoryEvidence } = await import("../src/viewInventoryCoverage.js");

describe("project brief configured adapter, publication and lifecycle", () => {
    let root: string;
    let corpusId: string;
    let service: InstanceType<typeof FileMemoryService>;
    const open = (enabled = true) =>
        new FileMemoryService(root, {
            viewDrafts: enabled,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "project-brief-offline-"));
        calls.length = 0;
        alter = (_name, value) => value;
        prose = "Source-grounded project context.\n\n";
        service = open();
        corpusId = (await service.createCorpus("Payments reliability"))
            .corpusId;
        for (const [sourceId, text] of [
            ["charter", projectSources.charter],
            ["status", projectSources.baseline],
        ]) {
            await ingest(sourceId, text);
        }
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(sourceId: string, text: string) {
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: sourceId,
                text,
                capturedAt: "2026-10-08T10:00:00Z",
                sourceModifiedAt: "2026-10-07T10:00:00Z",
            },
        });
        expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
            "complete",
        );
        return job;
    }
    async function build(publication = false, viewId = "payments-brief") {
        const snapshot = await service.listViews(corpusId);
        const sources = await service.listSources(corpusId);
        let job: ViewBuildJob = await createMemoryServiceRpcFacade(
            service,
        ).buildViews({
            corpusId,
            expectedHead: snapshot.head,
            publication,
            targets: [
                {
                    expectedVersion:
                        snapshot.views.find((view) => view.viewId === viewId)
                            ?.version ?? 0,
                    definition: {
                        viewId,
                        kind: "projectBrief",
                        selector: {
                            kind: "sources",
                            sources: sources.map((source) => ({
                                sourceId: source.sourceId,
                                revisionId: source.activeRevisionId!,
                            })),
                        },
                    },
                },
            ],
        });
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({ corpusId, jobId: job.jobId }))!;
        }
        return job;
    }
    async function current() {
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views.find(
            (view) => view.viewId === "payments-brief",
        );
        if (!view || view.content.kind !== "projectBrief")
            throw new Error("Missing project brief");
        return { snapshot, view, content: view.content };
    }
    async function save(content: ProjectBriefContent) {
        const { snapshot, view } = await current();
        return service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "projectBrief",
                selector: view.definition.selector,
            },
            content,
            relationships: authoredRelationships(view),
        });
    }
    async function publish() {
        const { snapshot, view } = await current();
        return service.publishView({
            corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            expectedVersion: view.version,
            expectedHead: snapshot.head!,
        });
    }
    const search = (kinds?: Array<"projectBrief" | "troubleshootingGuide">) =>
        service.searchViews({
            corpusId,
            query: "Payments reliability",
            freshness: "current",
            ...(kinds ? { kinds } : {}),
        });
    test("actual stage order, typed artifact and citations preserve unknowns, blocked capacity and incident/project distinction", async () => {
        const job = await build();
        expect(job.results[0].state).toBe("draft");
        expect(calls.map((call) => call.name)).toEqual([
            "memory_source_fact_inventory",
            "memory_source_inventory_check",
            "memory_project_brief_construction",
            "memory_inventory_artifact_support",
            "memory_inventory_artifact_support",
        ]);
        expect(calls[0].input).not.toHaveProperty("output");
        expect(calls[1].input).not.toHaveProperty("output");
        const { view, content } = await current();
        expect(
            content.sections.find((section) => section.role === "status")
                ?.details,
        ).toMatchObject({
            project: "active",
            incident: "closed",
            capacity: "pendingOwnerReview",
        });
        expect(
            content.sections.find((section) => section.role === "owners")
                ?.details,
        ).toMatchObject({
            assignments: [{ state: "unknown", owner: null }],
        });
        expect(
            content.sections.find((section) => section.role === "milestones")
                ?.details,
        ).toMatchObject({
            items: [{ status: "proposed", date: null }],
        });
        expect(
            content.sections.find((section) => section.role === "context")
                ?.details,
        ).toMatchObject({ asOf: null, basis: "unknown" });
        const body = content.sections.map((section) => section.body).join("\n");
        for (const text of [
            "BLOCKED pending owner review",
            "Workload memory",
            "headroom",
            "not complete",
            "proposed",
            "rejected",
        ])
            expect(body).toContain(text);
        for (const citation of content.citations) {
            const original = await service.getSourceContent({
                corpusId,
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
            });
            const match = /^chars:(\d+)-(\d+)$/.exec(citation.locator)!;
            expect(
                original.content.slice(Number(match[1]), Number(match[2])),
            ).toBe(citation.excerpt);
        }
        expect(view.generation?.input?.pipeline).toBe("project-brief-v1");
        expect(await search()).toHaveLength(0);
        expect((await service.getCapabilities()).derivedViews?.kinds).toContain(
            "projectBrief",
        );
    });
    test.each([
        "completion",
        "capacity",
        "owner",
        "date",
        "asOf",
        "missingContext",
        "missingFact",
        "citation",
        "sourceCheck",
    ])("%s cannot publish despite a positive support stub", async (mode) => {
        alter = (name, value) => {
            const raw = evidenceRecord(value);
            if (
                mode === "sourceCheck" &&
                name === "memory_source_inventory_check"
            )
                raw.missingFacts = [
                    {
                        sourceId: "status",
                        passageIds: [],
                        description: "Headroom warning omitted",
                    },
                ];
            if (mode === "citation" && name === "memory_source_fact_inventory")
                evidenceRecord(evidenceArray(raw.items)[0]).passageIds = [
                    "not-retained",
                ];
            if (name !== "memory_project_brief_construction") return value;
            const sections = evidenceArray(
                evidenceRecord(raw.content).sections,
            ).map(evidenceRecord);
            const detail = (role: string) =>
                evidenceRecord(
                    sections.find((section) => section.role === role)!.details,
                );
            if (mode === "completion") detail("status").project = "complete";
            if (mode === "capacity") detail("status").capacity = "validated";
            if (mode === "owner") {
                const owner = evidenceRecord(
                    evidenceArray(detail("owners").assignments)[0],
                );
                owner.state = "known";
                owner.owner = "Invented Owner";
            }
            if (mode === "date")
                evidenceRecord(
                    evidenceArray(detail("milestones").items)[0],
                ).date = "2026-11-01";
            if (mode === "asOf") {
                detail("context").basis = "recordEvidence";
                detail("context").asOf = "2026-10-08T10:00:00Z";
            }
            if (mode === "missingContext")
                evidenceRecord(raw.content).sections = sections.filter(
                    (section) => section.role !== "context",
                );
            if (mode === "missingFact")
                sections.find(
                    (section) => section.role === "risks",
                )!.inventoryIds = [];
            return value;
        };
        const job = await build(true);
        expect(job.results[0].state).not.toBe("searchable");
        expect(job.results[0].state).not.toBe("published");
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
        expect(
            calls.some(
                (call) => call.name === "memory_inventory_artifact_support",
            ),
        ).toBe(false);
        expect(await search()).toHaveLength(0);
    });
    test("explicit edits survive clean source rebuild; publication, evidence, replacement, forget and restart are exact", async () => {
        await build();
        const { content } = await current();
        const edited = structuredClone(content);
        edited.sections[0].body = edited.sections[0].body.replace(
            "Source-grounded project context.",
            "Human reading note: preserve the investigation context.",
        );
        await save(edited);
        expect(
            (await current()).view.edits?.some(
                (edit) => edit.actor === os.userInfo().username,
            ),
        ).toBe(true);
        const originals = await service.getSourceContent({
            corpusId,
            sourceId: "charter",
        });
        expect(originals.content).toBe(projectSources.charter);
        expect((await build()).results[0].state).toBe("merged");
        expect((await current()).content.sections[0].body).toContain(
            "Human reading note",
        );
        const publication = await publish();
        expect(publication.indexedRevisionId).toBe(
            (await current()).view.revisionId,
        );
        expect((await search(["projectBrief"]))[0].view.revisionId).toBe(
            publication.indexedRevisionId,
        );
        expect(await search(["troubleshootingGuide"])).toHaveLength(0);
        await service.close();
        const cli = await runMemoryViewsCli([
            "--store",
            root,
            "--enable-view-drafts",
            "read",
            corpusId,
            "payments-brief",
        ]);
        expect(cli).toMatchObject({ content: { kind: "projectBrief" } });
        service = open(false);
        await expect(search()).rejects.toThrow("not supported");
        await service.close();
        service = open();
        expect((await current()).content.sections[0].body).toContain(
            "Human reading note",
        );
        await ingest("status", projectSources.replacement);
        expect((await current()).view.state).toBe("stale");
        expect(await search()).toHaveLength(0);
        expect((await build(true)).results[0].state).toBe("searchable");
        expect(
            (await current()).content.sections.find(
                (section) => section.role === "risks",
            )?.body,
        ).toContain("workload-memory warning");
        expect((await current()).content.sections[0].body).toContain(
            "Human reading note",
        );
        const preview = await service.previewForgetSource(corpusId, "status");
        await service.forgetSource({
            corpusId,
            sourceId: "status",
            confirmationToken: preview.confirmationToken,
        });
        expect(await search()).toHaveLength(0);
        expect(
            await service.getViewHistory({
                corpusId,
                viewId: "payments-brief",
            }),
        ).toHaveLength(0);
        expect(
            (await service.getSourceContent({ corpusId, sourceId: "charter" }))
                .content,
        ).toBe(projectSources.charter);
        await service.close();
        service = open();
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
        expect(await service.listViewBuilds(corpusId)).toHaveLength(0);
    });
    test("overlapping explicit narrative edits keep current content and create a durable conflict; archive survives reopening", async () => {
        await build();
        const edited = structuredClone((await current()).content);
        edited.sections[0].body = edited.sections[0].body.replace(
            "Source-grounded project context.",
            "Human project context.",
        );
        await save(edited);
        prose = "Incompatible generated project context.\n\n";
        const job = await build(true);
        expect(job.results[0].state).toBe("conflicted");
        expect((await current()).content.sections[0].body).toContain(
            "Human project context.",
        );
        await service.close();
        service = open();
        const conflict = await service.getViewConflict({
            corpusId,
            conflictId: job.results[0].conflictId!,
        });
        expect(conflict?.targets).toContain("section:goalsScope");
        const { snapshot, view } = await current();
        await service.archiveView({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head!,
            expectedVersion: view.version,
        });
        expect(await search()).toHaveLength(0);
        await service.close();
        service = open();
        expect((await current()).view.state).toBe("archived");
    });
    test("human typed fields are checked against actual final content and cannot bypass publication evidence", async () => {
        await build();
        const edited = structuredClone((await current()).content);
        const status = edited.sections.find(
            (section) => section.details.kind === "status",
        )!.details;
        if (status.kind !== "status") throw new Error("Missing status");
        status.project = "complete";
        await expect(save(edited)).rejects.toThrow(
            "incident closure is not project completion",
        );
        const owner = edited.sections.find(
            (section) => section.details.kind === "owners",
        )!.details;
        if (owner.kind !== "owners") throw new Error("Missing owners");
        status.project = "active";
        owner.assignments[0].state = "known";
        owner.assignments[0].owner = "Invented Owner";
        await expect(save(edited)).rejects.toThrow(
            "ownership is not supported",
        );
    });
    test("section and edge tombstones are not resurrected by merge; missing fixed-template context remains unpublishable", async () => {
        await build();
        const { view } = await current();
        const output: ViewSynthesisOutput = {
            content: structuredClone(view.content) as ProjectBriefContent,
            relationships: authoredRelationships(view),
            outcome: "projectSummary",
            missingEvidence: view.generation!.missingEvidence!,
            ...inventoryEvidence(view.generation!),
        };
        const { recordViewEdits } = await import("../src/viewMerge.js");
        const human = structuredClone(view);
        if (human.content.kind !== "projectBrief")
            throw new Error("Wrong kind");
        human.content.sections = human.content.sections.filter(
            (section) => section.role !== "context",
        );
        human.relationships = human.relationships.filter(
            (edge) =>
                edge.origin === "system" || edge.from.sectionId !== "context",
        );
        human.edits = recordViewEdits(
            view,
            human.content,
            authoredRelationships(human),
            "explicit-reader",
        );
        const merged = mergeView(human, output);
        expect(merged.conflicts).toEqual([]);
        expect(
            merged.output.content.sections.some(
                (section) => section.role === "context",
            ),
        ).toBe(false);
        expect(
            merged.output.relationships.some(
                (edge) => edge.from.sectionId === "context",
            ),
        ).toBe(false);
        const { validateConstructedGuide } = await import(
            "../src/viewSynthesis.js"
        );
        expect(() =>
            validateConstructedGuide(view.generation!.input!, merged.output),
        ).toThrow("fixed");
    });
    test("real KnowPro text and embedding retrieval return the exact published brief revision", async () => {
        await service.close();
        let textOnly = false;
        const languageModel = {
            completionSettings: {},
            complete: async () => ({
                success: true as const,
                data: JSON.stringify({
                    searchExpressions: [
                        {
                            rewrittenQuery: "Find capacity headroom",
                            filters: [
                                {
                                    entitySearchTerms: [
                                        {
                                            name: textOnly
                                                ? "headroom"
                                                : "capacity pressure",
                                            isNamePronoun: false,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            }),
        };
        const create = () =>
            new FileMemoryService(root, {
                viewDrafts: true,
                indexFactory: (_id, directory) =>
                    new FakeProcedureCorpusIndex(directory),
                procedureIndexFactory: (id, directory) =>
                    createKnowProCorpusIndex(id, directory, () => {
                        const settings = createDocMemorySettings(
                            64,
                            undefined,
                            languageModel,
                        );
                        if (textOnly) {
                            settings.embeddingModel = undefined;
                            const related =
                                settings.conversationSettings
                                    .relatedTermIndexSettings
                                    .embeddingIndexSettings;
                            if (related) related.embeddingModel = undefined;
                            settings.conversationSettings.threadSettings.embeddingModel =
                                undefined;
                            settings.conversationSettings.messageTextIndexSettings.embeddingIndexSettings.embeddingModel =
                                undefined;
                        }
                        const knowledge = {
                            entities: [{ name: "headroom", type: ["project"] }],
                            actions: [],
                            inverseActions: [],
                            topics: ["headroom"],
                        };
                        settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                            {
                                settings: { maxContextLength: 10000 },
                                extract: async () => knowledge,
                                extractWithRetry: async () => ({
                                    success: true as const,
                                    data: knowledge,
                                }),
                            };
                        return settings;
                    }),
            });
        service = create();
        expect((await build(true)).results[0].state).toBe("searchable");
        const revisionId = (await current()).view.revisionId;
        const directory = path.join(
            root,
            corpusId,
            "personal-how-to",
            "view-search-index",
            viewHash("payments-brief"),
            viewHash(revisionId),
        );
        expect(
            (await stat(path.join(directory, "corpus_embeddings.bin"))).size,
        ).toBeGreaterThan(0);
        await service.close();
        service = create();
        const before = embeddings.length;
        const semantic = await service.searchViews({
            corpusId,
            query: "Find capacity pressure",
            freshness: "current",
            kinds: ["projectBrief"],
        });
        expect(semantic.length).toBeGreaterThan(0);
        expect(
            semantic.every((match) => match.view.revisionId === revisionId),
        ).toBe(true);
        expect(embeddings.length).toBeGreaterThan(before);
        await service.close();
        textOnly = true;
        service = create();
        const beforeText = embeddings.length;
        const text = await service.searchViews({
            corpusId,
            query: "headroom",
            freshness: "current",
            kinds: ["projectBrief"],
        });
        expect(text.length).toBeGreaterThan(0);
        expect(
            text.every((match) => match.view.revisionId === revisionId),
        ).toBe(true);
        expect(embeddings).toHaveLength(beforeText);
    });
});
