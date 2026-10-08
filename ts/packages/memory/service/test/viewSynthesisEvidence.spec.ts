// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type { ViewBuildJob, ViewSynthesisOutput } from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import { evidenceArray, evidenceRecord } from "../src/viewSynthesisEvidence.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { inventoryEvidence } from "../src/viewInventoryCoverage.js";

// Jest 29 exposes this ESM API, but @types/jest does not declare it.
const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
let alter: (name: string, response: unknown) => unknown = (_name, value) =>
    value;
let pausedStage: string | undefined;
let pause: Promise<void> | undefined;
const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
const embeddings: string[] = [];
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
const complete = jest.fn(
    async (
        messages: Array<{ role: string; content: string }>,
        _usage: unknown,
        schema: StructuredOutputJsonSchema,
    ) => {
        const message = messages.find((entry) => entry.role === "user");
        if (!message) throw new Error("Missing configured-adapter input");
        const input = evidenceRecord(JSON.parse(message.content));
        calls.push({ name: schema.name, input });
        if (schema.name === pausedStage) await pause;
        return {
            success: true,
            data: JSON.stringify(
                alter(schema.name, inventoryTestAnswer(schema.name, input)),
            ),
        };
    },
);
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    tryCreateEmbeddingModel: () => offlineEmbedding,
    openai: { ...actual.openai, createChatModel: () => ({ complete }) },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { waitForMemoryJob } = await import("../src/rpcFacade.js");
const { validateConstructedGuide } = await import("../src/viewSynthesis.js");
const { renderInventoryItem } = await import("../src/viewInventory.js");
const { createKnowProCorpusIndex } = await import(
    "../src/knowProCorpusIndex.js"
);
const { createDocMemorySettings } = await import(
    "@typeagent/conversation-memory"
);
const { viewHash } = await import("../src/viewMerge.js");
const { effectiveViewPublicationPolicy } = await import(
    "../src/viewPublication.js"
);

test("all boolean and inherited publication precedence combinations retain false", () => {
    for (const corpus of [false, true])
        for (const view of [null, false, true])
            for (const build of [undefined, false, true]) {
                const policy = effectiveViewPublicationPolicy(
                    {
                        revision: 7,
                        autoPublish: corpus,
                        views: { guide: { revision: 4, autoPublish: view } },
                    },
                    "guide",
                    build,
                );
                expect(policy.autoPublish).toBe(build ?? view ?? corpus);
                expect(policy.origin).toBe(
                    build !== undefined
                        ? "build"
                        : view !== null
                          ? "view"
                          : "corpus",
                );
                expect([policy.corpusRevision, policy.viewRevision]).toEqual([
                    7, 4,
                ]);
            }
});

describe("actual configured evidence-first adapter and durable service", () => {
    let root: string;
    let service: InstanceType<typeof FileMemoryService>;
    let corpusId: string;
    let indexFailure: boolean;
    let publicationFault: "intent" | "index" | undefined;
    class ControlledIndex extends FakeProcedureCorpusIndex {
        public async rebuild(
            documents: Parameters<FakeProcedureCorpusIndex["rebuild"]>[0],
        ): Promise<void> {
            if (
                indexFailure &&
                documents.some(
                    (document) => document.source.sourceId === "guide",
                )
            )
                throw new Error("Controlled view indexing failure");
            await super.rebuild(documents);
        }
    }
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id: string, directory: string) =>
                new ControlledIndex(directory),
            viewPublicationCheckpoint: async (point) => {
                if (point === publicationFault)
                    throw new Error(
                        `Controlled publication interruption after ${point}`,
                    );
            },
        });
    beforeEach(async () => {
        calls.length = 0;
        alter = (_name, value) => value;
        pausedStage = undefined;
        indexFailure = false;
        publicationFault = undefined;
        pause = undefined;
        root = await mkdtemp(
            path.join(os.tmpdir(), "inventory-configured-offline-"),
        );
        service = open();
        corpusId = (await service.createCorpus("Controlled inventory fixture"))
            .corpusId;
        for (const [sourceId, text] of [
            [
                "phase",
                "Acquisition 37 milliseconds versus SQL execution 4 milliseconds.\n\nQuery hypothesis rejected.\n\nScale deferred, not attempted.",
            ],
            [
                "limits",
                "Approval applies to this simulated incident only; no future execution authority.\n\nCapacity blocked pending owner review; measured headroom is required.\n\nRecovery is unknown.",
            ],
        ]) {
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text,
                    capturedAt: "2026-10-02T10:00:00Z",
                    sourceModifiedAt: "2026-10-01T10:00:00Z",
                },
            });
            expect(
                (await waitForMemoryJob(service, admitted.jobId)).state,
            ).toBe("complete");
        }
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function admit(): Promise<ViewBuildJob> {
        const sources = await service.listSources(corpusId);
        const current = await service.listViews(corpusId);
        return service.buildViews({
            corpusId,
            expectedHead: current.head,
            targets: [
                {
                    expectedVersion: current.views[0]?.version ?? 0,
                    definition: {
                        viewId: "guide",
                        kind: "troubleshootingGuide",
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
    }
    async function wait(job: ViewBuildJob): Promise<ViewBuildJob> {
        for (let tries = 0; tries < 1000; tries++) {
            if (job.state !== "running") return job;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            const current = await service.getViewBuild({
                corpusId,
                jobId: job.jobId,
            });
            if (!current)
                throw new Error("Expected durable inventory build receipt");
            job = current;
        }
        throw new Error("Inventory build did not terminate");
    }
    async function build(): Promise<ViewBuildJob> {
        return wait(await admit());
    }
    async function awaitPausedStage(): Promise<void> {
        for (let tries = 0; tries < 1000; tries++) {
            if (calls.some((call) => call.name === pausedStage)) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Configured adapter did not reach paused stage");
    }
    async function guardedPublication(retry = false) {
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        if (!view || !snapshot.head)
            throw new Error("Missing exact publication target");
        const published = await service.getViewPublication({
            corpusId,
            viewId: view.viewId,
        });
        const request = {
            corpusId,
            viewId: view.viewId,
            revisionId: retry
                ? published.publishedRevisionId!
                : view.revisionId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
        };
        return retry
            ? service.retryViewIndex(request)
            : service.publishView(request);
    }
    const search = () =>
        service.searchViews({
            corpusId,
            query: "Inspect pressure",
            freshness: "current",
        });
    test("default-on publishes exact validated artifact, survives restart, and disabled capability never retrieves stored publication", async () => {
        const job = await build();
        expect(job.results[0].state).toBe("searchable");
        const result = job.results[0].publication!;
        expect(result.publishedRevisionId).toBe(job.results[0].revisionId);
        expect(result.indexedRevisionId).toBe(result.publishedRevisionId);
        const matches = await search();
        expect(matches).toHaveLength(1);
        expect(matches[0].view.revisionId).toBe(result.indexedRevisionId);
        expect(matches[0]).toMatchObject({
            review: "unreviewed",
            freshness: "current",
            corroboration: "derived",
        });
        const before = (await service.listViews(corpusId)).head;
        expect(await guardedPublication()).toEqual(result);
        expect((await service.listViews(corpusId)).head).toBe(before);
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
        await expect(search()).rejects.toThrow("not supported");
        await service.close();
        service = open();
        expect((await search())[0].view.revisionId).toBe(
            result.indexedRevisionId,
        );
    });
    test("view off, one-run build on, explicit build false and inherited corpus policy never mutate saved settings", async () => {
        await service.updateViewPublicationPolicy({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedRevision: 0,
            viewId: "guide",
            autoPublish: false,
        });
        const draft = await build();
        expect(draft.results[0].state).toBe("draft");
        expect(await search()).toEqual([]);
        const snapshot = await service.listViews(corpusId);
        const overridden = await wait(
            await service.buildViews({
                ...draft.request,
                expectedHead: snapshot.head,
                targets: [
                    {
                        ...draft.request.targets[0],
                        expectedVersion: snapshot.views[0].version,
                    },
                ],
                publication: true,
            }),
        );
        expect(overridden.results[0].snapshot.publicationPolicy).toMatchObject({
            autoPublish: true,
            origin: "build",
        });
        expect(overridden.results[0].state).toBe("searchable");
        expect(
            (await service.getViewPublicationPolicy(corpusId)).views.guide
                .autoPublish,
        ).toBe(false);
        const offSnapshot = await service.listViews(corpusId);
        const off = await wait(
            await service.buildViews({
                ...draft.request,
                expectedHead: offSnapshot.head,
                targets: [
                    {
                        ...draft.request.targets[0],
                        expectedVersion: offSnapshot.views[0].version,
                    },
                ],
                publication: false,
            }),
        );
        expect(off.results[0].state).toBe("draft");
        expect((await search())[0].view.revisionId).toBe(
            overridden.results[0].revisionId,
        );
        expect((await guardedPublication()).indexState).toBe("ready");
    });
    test("policy changes during inventory pause publication and preserve an actionable stale receipt", async () => {
        pausedStage = "memory_source_fact_inventory";
        let release: (() => void) | undefined;
        pause = new Promise<void>((resolve) => {
            release = resolve;
        });
        const job = await admit();
        await awaitPausedStage();
        await service.updateViewPublicationPolicy({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedRevision: 0,
            autoPublish: false,
        });
        release!();
        expect((await wait(job)).results[0].state).toBe("stale");
        expect(await search()).toEqual([]);
    });
    test("index failure reports published but not searchable, and explicit retry does not rebuild or republish", async () => {
        indexFailure = true;
        const job = await build();
        expect(job.results[0].state).toBe("published");
        const failed = await service.getViewPublication({
            corpusId,
            viewId: "guide",
        });
        expect(failed.indexState).toBe("failed");
        expect(failed.reason).toContain("Controlled view indexing failure");
        expect(failed.indexedRevisionId).toBeUndefined();
        expect(await search()).toEqual([]);
        const callCount = calls.length;
        indexFailure = false;
        await service.close();
        service = open();
        const indexed = await guardedPublication(true);
        expect(indexed.publishedRevisionId).toBe(failed.publishedRevisionId);
        expect(indexed.indexedRevisionId).toBe(failed.publishedRevisionId);
        expect(indexed.intent).toEqual(failed.intent);
        expect(calls).toHaveLength(callCount);
        expect(await search()).toHaveLength(1);
    });
    test.each(["intent", "index"] as const)(
        "restart after durable %s boundary keeps exact publication pending until explicit index retry",
        async (point) => {
            publicationFault = point;
            const job = await build();
            expect(job.results[0].state).toBe("failed");
            const pending = await service.getViewPublication({
                corpusId,
                viewId: "guide",
            });
            expect(pending.indexState).toBe("pending");
            expect(await search()).toEqual([]);
            const callCount = calls.length;
            await service.close();
            publicationFault = undefined;
            service = open();
            const indexed = await guardedPublication(true);
            expect(indexed.intent).toEqual(pending.intent);
            expect(indexed.indexedRevisionId).toBe(pending.publishedRevisionId);
            expect(calls).toHaveLength(callCount);
        },
    );
    test("archive removes publication and indexes without touching canonical source content or unrelated runbooks", async () => {
        await build();
        const sources = await service.listSources(corpusId);
        const before = await service.listViews(corpusId);
        const view = before.views[0];
        await service.archiveView({
            corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: before.head!,
        });
        expect(await search()).toEqual([]);
        expect(
            (
                await service.getViewPublication({
                    corpusId,
                    viewId: view.viewId,
                })
            ).publishedRevisionId,
        ).toBeUndefined();
        expect(await service.listSources(corpusId)).toEqual(sources);
        await expect(
            stat(
                path.join(
                    root,
                    corpusId,
                    "personal-how-to",
                    "view-search-index",
                    viewHash(view.viewId),
                ),
            ),
        ).rejects.toThrow();
    });
    test("a mismatched index never labels old content as current and explicit retry repairs only the published revision", async () => {
        await build();
        const publication = await service.getViewPublication({
            corpusId,
            viewId: "guide",
        });
        const ready = path.join(
            root,
            corpusId,
            "personal-how-to",
            "view-search-index",
            viewHash("guide"),
            viewHash(publication.publishedRevisionId!),
            "ready",
        );
        await writeFile(ready, "different-revision", "utf8");
        await expect(search()).rejects.toThrow(
            "does not match the exact revision",
        );
        const callCount = calls.length;
        await guardedPublication(true);
        expect(calls).toHaveLength(callCount);
        expect((await search())[0].view.revisionId).toBe(
            publication.publishedRevisionId,
        );
    });
    test("validated human edits publish explicitly with exact head and version guards while source replacement excludes stale publication", async () => {
        await build();
        const first = await service.listViews(corpusId);
        const view = first.views[0];
        const content = structuredClone(
            view.content,
        ) as ViewSynthesisOutput["content"];
        content.sections[0].body = content.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        const saved = await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: first.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "troubleshootingGuide",
                selector: view.definition.selector,
            },
            content,
            relationships: authoredRelationships(view),
        });
        expect((await search())[0].view.revisionId).toBe(view.revisionId);
        await expect(
            service.publishView({
                corpusId,
                viewId: view.viewId,
                revisionId: saved.version.revisionId,
                expectedHead: first.head!,
                expectedVersion: saved.version.version,
            }),
        ).rejects.toThrow("head or target revision conflict");
        const published = await guardedPublication();
        expect(published.publishedRevisionId).toBe(saved.version.revisionId);
        expect((await search())[0].view.content.sections[0].body).toContain(
            "carefully",
        );
        const replacement = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "phase",
                sourceType: "text",
                title: "phase",
                text: "Changed phase evidence.",
            },
        });
        expect((await waitForMemoryJob(service, replacement.jobId)).state).toBe(
            "complete",
        );
        expect(await search()).toEqual([]);
        await expect(guardedPublication()).rejects.toThrow(
            "Archived or stale view cannot be published",
        );
    });
    test("new agent paragraph and clean human edit are searchable as the exact merged revision without a review stamp", async () => {
        await build();
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        if (view.content.kind !== "troubleshootingGuide")
            throw new Error("Expected guide");
        const content = structuredClone(view.content);
        content.sections[0].body = content.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: view.viewId,
                kind: "troubleshootingGuide",
                selector: view.definition.selector,
            },
            content,
            relationships: authoredRelationships(view),
        });
        alter = (name, answer) => {
            if (name === "memory_inventory_guide_construction") {
                const content = evidenceRecord(evidenceRecord(answer).content);
                const section = evidenceRecord(
                    evidenceArray(content.sections)[1],
                );
                section.prose =
                    "Inspect pressure.\n\nPreserve approval boundaries.\n\nNew independent agent paragraph.\n";
            }
            return answer;
        };
        const job = await build();
        expect(job.results[0].state).toBe("searchable");
        const matches = await service.searchViews({
            corpusId,
            query: "New independent agent paragraph",
            freshness: "current",
        });
        expect(matches).toHaveLength(1);
        expect(matches[0].view.provenance).toBe("merged");
        expect(matches[0].view.content.sections[0].body).toContain("carefully");
        expect(matches[0].review).toBe("unreviewed");
    });
    test("real KnowPro persisted embeddings retrieve an exact published revision through a paraphrased query", async () => {
        await service.close();
        let queryTerm = "bottleneck";
        let textOnly = false;
        const languageModel = {
            completionSettings: {},
            complete: async () => ({
                success: true as const,
                data: JSON.stringify({
                    searchExpressions: [
                        {
                            rewrittenQuery: "Investigate bottlenecks",
                            filters: [
                                {
                                    entitySearchTerms: [
                                        {
                                            name: queryTerm,
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
                            entities: [
                                { name: "pressure", type: ["diagnostic"] },
                            ],
                            actions: [],
                            inverseActions: [],
                            topics: ["pressure"],
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
        const job = await build();
        expect(job.results[0].state).toBe("searchable");
        const revisionId = job.results[0].revisionId!;
        const directory = path.join(
            root,
            corpusId,
            "personal-how-to",
            "view-search-index",
            viewHash("guide"),
            viewHash(revisionId),
        );
        expect(
            (await stat(path.join(directory, "corpus_embeddings.bin"))).size,
        ).toBeGreaterThan(0);
        await service.close();
        service = create();
        const before = embeddings.length;
        const matches = await service.searchViews({
            corpusId,
            query: "Investigate bottlenecks",
            freshness: "current",
        });
        expect(matches.length).toBeGreaterThan(0);
        expect(
            matches.every((match) => match.view.revisionId === revisionId),
        ).toBe(true);
        expect(embeddings.length).toBeGreaterThan(before);
        await service.close();
        textOnly = true;
        queryTerm = "pressure";
        service = create();
        const beforeText = embeddings.length;
        const exact = await service.searchViews({
            corpusId,
            query: "pressure",
            freshness: "current",
        });
        expect(exact.length).toBeGreaterThan(0);
        expect(
            exact.every((match) => match.view.revisionId === revisionId),
        ).toBe(true);
        expect(embeddings).toHaveLength(beforeText);
    });
    test("source inventory and independent source check precede any candidate; coverage survives receipt/protocol shape", async () => {
        const job = await build();
        expect(job.state).toBe("complete");
        expect(calls.map((call) => call.name)).toEqual([
            "memory_source_fact_inventory",
            "memory_source_inventory_check",
            "memory_inventory_guide_construction",
            "memory_inventory_artifact_support",
            "memory_inventory_artifact_support",
        ]);
        expect(calls[0].input).not.toHaveProperty("output");
        expect(calls[0].input).not.toHaveProperty("inventory");
        expect(calls[1].input).not.toHaveProperty("output");
        expect(JSON.stringify(calls.slice(0, 2))).not.toContain(
            "Controlled conditional guide",
        );
        const result = job.results[0];
        expect(result.inventory!.items).toHaveLength(6);
        expect(result.inventoryAudit!.supported).toBe(true);
        expect(result.coverage!.reuseEligibility).toBe("diagnosticOnly");
        expect(
            result.coverage!.items.every((item) => item.state === "covered"),
        ).toBe(true);
        const view = (await service.listViews(corpusId)).views[0];
        for (const item of result.inventory!.items)
            expect(
                view.content.sections.some((section) =>
                    section.body.includes(renderInventoryItem(item)),
                ),
            ).toBe(true);
        for (const edge of view.relationships) {
            if (edge.origin === "system" || edge.to.kind !== "source") continue;
            const target = edge.to;
            expect(
                edge.citations.every(
                    (citation) =>
                        citation.sourceId === target.sourceId &&
                        citation.revisionId === target.revisionId,
                ),
            ).toBe(true);
        }
        expect(view.generation!.inventory!.fingerprint).toBe(
            result.inventory!.fingerprint,
        );
    });
    test("typed quantity/unit/comparison, decision state and distinct timing render in actual body", async () => {
        alter = (name, value) => {
            if (name !== "memory_source_fact_inventory") return value;
            for (const item of evidenceArray(evidenceRecord(value).items).map(
                evidenceRecord,
            )) {
                if (String(item.statement).startsWith("Acquisition")) {
                    item.kind = "measurement";
                    item.status = "observed";
                    item.measurements = [
                        {
                            quantity: "37",
                            unit: "milliseconds",
                            context:
                                "connection acquisition compared with 4 milliseconds SQL execution",
                        },
                    ];
                    item.occurredAt = "2026-10-01T10:00:00Z";
                    item.learnedAt = "2026-10-02T10:00:00Z";
                } else if (String(item.statement).startsWith("Query")) {
                    item.kind = "approach";
                    item.status = "rejected";
                } else if (String(item.statement).startsWith("Scale")) {
                    item.kind = "approach";
                    item.status = "deferred";
                } else if (String(item.statement).startsWith("Capacity")) {
                    item.kind = "unresolved";
                    item.status = "blocked";
                } else if (String(item.statement).startsWith("Approval")) {
                    item.kind = "authority";
                    item.status = "observed";
                }
            }
            return value;
        };
        expect((await build()).state).toBe("complete");
        const body = (
            await service.listViews(corpusId)
        ).views[0].content.sections
            .map((section) => section.body)
            .join("\n");
        for (const literal of [
            "37 milliseconds",
            "4 milliseconds",
            "status: rejected",
            "status: deferred",
            "status: blocked",
            "no future execution authority",
            "Occurred: 2026-10-01",
            "Known/recorded: 2026-10-02",
        ])
            expect(body).toContain(literal);
    });
    test("a plausible incomplete draft fails coverage before a rubber-stamped support audit", async () => {
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                for (const section of evidenceArray(
                    evidenceRecord(evidenceRecord(value).content).sections,
                ).map(evidenceRecord))
                    section.inventoryIds = evidenceArray(
                        section.inventoryIds,
                    ).slice(0, 1);
            }
            return value;
        };
        const job = await build();
        expect(job.state).toBe("failed");
        expect(job.results[0].reason).toContain(
            "Required inventory content is absent",
        );
        expect(
            calls.some(
                (call) => call.name === "memory_inventory_artifact_support",
            ),
        ).toBe(false);
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
        expect(job.results[0].inventory).toBeDefined();
    });
    test("missing source-to-inventory facts block construction and persist independent assessment", async () => {
        alter = (name, value) => {
            if (name === "memory_source_inventory_check") {
                const raw = evidenceRecord(value);
                raw.supported = false;
                raw.reasons = ["Workload headroom warning omitted"];
            }
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("blocked");
        expect(job.results[0].inventoryAudit!.supported).toBe(false);
        expect(calls.map((call) => call.name)).toHaveLength(2);
    });
    test("unresolved early inventory cannot authorize verified/reusable recovery", async () => {
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction")
                evidenceRecord(value).outcome = "verifiedRecovery";
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("blocked");
        expect(job.results[0].reason).toContain(
            "diagnosticOnly cannot become reusable",
        );
    });
    test("complete final body, not coverage metadata, gates human saves and preserves legitimate narrative edits", async () => {
        await build();
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        const content = structuredClone(
            view.content,
        ) as ViewSynthesisOutput["content"];
        content.sections[0].body = content.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        const relationships = authoredRelationships(view).filter(
            (edge) =>
                !(
                    edge.from.kind === "section" &&
                    edge.from.sectionId === "diagnostic" &&
                    edge.to.kind === "source" &&
                    edge.to.sourceId === "phase"
                ),
        );
        const originalSupport = relationships.find(
            (edge) =>
                edge.from.kind === "section" &&
                edge.from.sectionId === "description" &&
                edge.to.kind === "source" &&
                edge.to.sourceId === "phase",
        )!;
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: view.viewId,
                kind: "troubleshootingGuide",
                selector: view.definition.selector,
            },
            content,
            relationships,
        });
        const replacement = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "phase",
                sourceType: "text",
                title: "phase",
                text: "Acquisition 38 milliseconds versus SQL execution 4 milliseconds.\n\nQuery hypothesis rejected.\n\nScale deferred, not attempted.",
                capturedAt: "2026-10-03T10:00:00Z",
            },
        });
        expect((await waitForMemoryJob(service, replacement.jobId)).state).toBe(
            "complete",
        );
        expect((await build()).state).toBe("complete");
        expect((await build()).state).toBe("complete");
        const current = await service.listViews(corpusId);
        expect(current.views[0].content.sections[0].body).toContain(
            "carefully",
        );
        expect(current.views[0].content.sections[0].body).toContain(
            "Acquisition 38 milliseconds",
        );
        const refreshedSupport = authoredRelationships(current.views[0]).find(
            (edge) =>
                edge.from.kind === "section" &&
                edge.from.sectionId === "description" &&
                edge.to.kind === "source" &&
                edge.to.sourceId === "phase",
        )!;
        expect(refreshedSupport.id).not.toBe(originalSupport.id);
        expect(refreshedSupport.to).toEqual({
            kind: "source",
            sourceId: "phase",
            revisionId: replacement.revisionId,
        });
        expect(
            current.views[0].relationships.some(
                (edge) =>
                    edge.origin !== "system" &&
                    edge.from.kind === "section" &&
                    edge.from.sectionId === "diagnostic" &&
                    edge.to.kind === "source" &&
                    edge.to.sourceId === "phase",
            ),
        ).toBe(false);
        expect(
            current.views[0].edits!.some(
                (edit) =>
                    edit.operation === "delete" &&
                    edit.status === "merged" &&
                    edit.actor === os.userInfo().username,
            ),
        ).toBe(true);
        const incomplete = structuredClone(
            current.views[0].content,
        ) as ViewSynthesisOutput["content"];
        const fact = current.views[0].generation!.inventory!.items[0];
        for (const section of incomplete.sections)
            section.body = section.body.replace(
                renderInventoryItem(fact),
                "A generic investigation is necessary.",
            );
        await expect(
            service.saveViewDraft({
                corpusId,
                viewId: view.viewId,
                expectedVersion: current.views[0].version,
                expectedHead: current.head,
                definition: {
                    viewId: view.viewId,
                    kind: "troubleshootingGuide",
                    selector: current.views[0].definition.selector,
                },
                content: incomplete,
                relationships: authoredRelationships(current.views[0]),
            }),
        ).rejects.toThrow("Required inventory content is absent");
        expect((await service.listViews(corpusId)).head).toBe(current.head);
    });
    test("unknown source grounding and blanket required-fact exclusions cannot be repaired", async () => {
        alter = (name, value) => {
            if (name === "memory_source_fact_inventory")
                evidenceRecord(
                    evidenceArray(evidenceRecord(value).items)[0],
                ).passageIds = ["not-retained"];
            return value;
        };
        expect((await build()).results[0].reason).toContain(
            "Unknown retained passage",
        );
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                const raw = evidenceRecord(value);
                const itemId = evidenceArray(
                    evidenceRecord(raw.content).sections,
                ).map(evidenceRecord)[0].inventoryIds;
                raw.exclusions = [
                    {
                        itemId: evidenceArray(itemId)[0],
                        reason: "outsideScope",
                        duplicateOf: "",
                        justification: "irrelevant",
                    },
                ];
            }
            return value;
        };
        expect((await build()).results[0].reason).toContain(
            "Only independently classified background",
        );
    });
    test("forget removes inventory, coverage, candidate and durable history payload eligibility", async () => {
        const job = await build();
        const before = await service.listViews(corpusId);
        const sources = await service.listSources(corpusId);
        const limits = sources.find((source) => source.sourceId === "limits")!;
        const unrelated = await wait(
            await service.buildViews({
                corpusId,
                expectedHead: before.head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "limits-guide",
                            kind: "troubleshootingGuide",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: limits.sourceId,
                                        revisionId: limits.activeRevisionId!,
                                    },
                                ],
                            },
                        },
                    },
                ],
            }),
        );
        expect(unrelated.results[0].state).toBe("searchable");
        const preview = await service.previewForgetSource(corpusId, "phase");
        await service.forgetSource({
            corpusId,
            sourceId: "phase",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getViewBuild({ corpusId, jobId: job.jobId }),
        ).toBeUndefined();
        expect(
            (await service.listViews(corpusId)).views.map(
                (view) => view.viewId,
            ),
        ).toEqual(["limits-guide"]);
        expect(
            await service.getViewHistory({ corpusId, viewId: "guide" }),
        ).toHaveLength(0);
        expect((await search()).map((match) => match.view.viewId)).toEqual([
            "limits-guide",
        ]);
        expect(
            (await service.getViewPublication({ corpusId, viewId: "guide" }))
                .publishedRevisionId,
        ).toBeUndefined();
        await expect(
            stat(
                path.join(
                    root,
                    corpusId,
                    "personal-how-to",
                    "view-search-index",
                    viewHash("guide"),
                ),
            ),
        ).rejects.toThrow();
        await service.close();
        service = open();
        expect((await search()).map((match) => match.view.viewId)).toEqual([
            "limits-guide",
        ]);
        expect(
            (
                await service.getViewPublication({
                    corpusId,
                    viewId: "limits-guide",
                })
            ).indexedRevisionId,
        ).toBe(unrelated.results[0].revisionId);
    });
    test("forged coverage cannot stand in for actual inventory content", async () => {
        await build();
        const view = (await service.listViews(corpusId)).views[0];
        const output: ViewSynthesisOutput = {
            content: structuredClone(
                view.content,
            ) as ViewSynthesisOutput["content"],
            relationships: authoredRelationships(view),
            outcome: "diagnosticOnly",
            missingEvidence: ["unknown"],
            ...inventoryEvidence(view.generation!),
        };
        for (const section of output.content.sections)
            section.body = "Generic plausible prose.";
        expect(() =>
            validateConstructedGuide(view.generation!.input!, output),
        ).toThrow("Required inventory content is absent");
    });
    test.each(["metadata", "wrongWitness"])(
        "source ledger rejects %s escape before checking or constructing prose",
        async (mode) => {
            alter = (name, value) => {
                if (name !== "memory_source_fact_inventory") return value;
                const raw = evidenceRecord(value);
                const decision = evidenceRecord(
                    evidenceArray(raw.sourceDecisions)[0],
                );
                if (mode === "metadata") {
                    decision.disposition = "metadata";
                    decision.itemKeys = [];
                } else
                    decision.itemKeys = [
                        evidenceRecord(evidenceArray(raw.items)[3]).key,
                    ];
                return value;
            };
            const job = await build();
            expect(job.results[0].reason).toContain(
                mode === "metadata"
                    ? "Metadata exclusions"
                    : "Source decision witnesses",
            );
            expect(calls.map((call) => call.name)).toEqual([
                "memory_source_fact_inventory",
            ]);
        },
    );
    test.each([
        "memory_source_fact_inventory",
        "memory_source_inventory_check",
    ])(
        "forget during %s prevents late inventory/prose persistence and survives reopening",
        async (stage) => {
            pausedStage = stage;
            let release!: () => void;
            pause = new Promise<void>((resolve) => {
                release = resolve;
            });
            try {
                const job = await admit();
                await awaitPausedStage();
                const preview = await service.previewForgetSource(
                    corpusId,
                    "phase",
                );
                await service.forgetSource({
                    corpusId,
                    sourceId: "phase",
                    confirmationToken: preview.confirmationToken,
                });
                release();
                await service.close();
                service = open();
                expect(
                    await service.getViewBuild({ corpusId, jobId: job.jobId }),
                ).toBeUndefined();
                expect((await service.listViews(corpusId)).views).toHaveLength(
                    0,
                );
                expect(
                    await service.getViewHistory({ corpusId, viewId: "guide" }),
                ).toHaveLength(0);
                expect(
                    calls.some(
                        (call) =>
                            call.name === "memory_inventory_guide_construction",
                    ),
                ).toBe(false);
            } finally {
                release();
            }
        },
    );
    test("source replacement during independent inventory checking cannot materialize obsolete evidence", async () => {
        pausedStage = "memory_source_inventory_check";
        let release!: () => void;
        pause = new Promise<void>((resolve) => {
            release = resolve;
        });
        try {
            const job = await admit();
            await awaitPausedStage();
            const replacement = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "phase",
                    sourceType: "text",
                    title: "phase",
                    text: "New workload warning: old acquisition observations cannot qualify capacity.",
                    capturedAt: "2026-10-03T10:00:00Z",
                },
            });
            await waitForMemoryJob(service, replacement.jobId);
            release();
            const completed = await wait(job);
            expect(completed.results[0].state).toBe("stale");
            expect(completed.results[0].inventory).toBeDefined();
            expect((await service.listViews(corpusId)).views).toHaveLength(0);
        } finally {
            release();
        }
    });
    test("conflict resolution inherits checked inventory, rejects forged omissions and retains authenticated edits after rebuilding", async () => {
        await build();
        const first = await service.listViews(corpusId);
        const human = structuredClone(
            first.views[0].content,
        ) as ViewSynthesisOutput["content"];
        human.sections[0].body = human.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        const saved = await service.saveViewDraft({
            corpusId,
            viewId: "guide",
            expectedHead: first.head,
            expectedVersion: first.views[0].version,
            definition: {
                viewId: "guide",
                kind: "troubleshootingGuide",
                selector: first.views[0].definition.selector,
            },
            content: human,
            relationships: authoredRelationships(first.views[0]),
        });
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                const section = evidenceRecord(
                    evidenceArray(
                        evidenceRecord(evidenceRecord(value).content).sections,
                    )[0],
                );
                section.prose =
                    "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n";
            }
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("conflicted");
        expect(await search()).toEqual([]);
        expect(
            (await service.getViewPublication({ corpusId, viewId: "guide" }))
                .blockedReason,
        ).toContain("pending merge conflict");
        await expect(guardedPublication()).rejects.toThrow(
            "pending merge conflict",
        );
        await expect(guardedPublication(true)).rejects.toThrow(
            "pending merge conflict",
        );
        const conflict = (await service.getViewConflict({
            corpusId,
            conflictId: job.results[0].conflictId!,
        }))!;
        expect(conflict.candidate.inventoryAudit!.supported).toBe(true);
        expect((await build()).results[0].conflictId).toBe(conflict.conflictId);
        const current = await service.listViews(corpusId);
        const request = {
            corpusId,
            conflictId: conflict.conflictId,
            expectedHead: current.head!,
            expectedVersion: saved.version.version,
            expectedRevisionId: saved.version.revisionId,
            inputFingerprint: conflict.input.fingerprint,
        };
        const forged = structuredClone(conflict.candidate);
        for (const section of forged.content.sections)
            section.body = "Plausible but incomplete.";
        forged.inventory!.items = [];
        await expect(
            service.resolveViewConflict({
                ...request,
                choice: "combined",
                combined: forged,
            }),
        ).rejects.toThrow("Required inventory content is absent");
        expect((await service.listViews(corpusId)).head).toBe(current.head);
        const resolved = await service.resolveViewConflict({
            ...request,
            choice: "human",
        });
        expect(resolved.version.actor).toBe(os.userInfo().username);
        expect((await build()).state).toBe("complete");
        expect(
            (await service.listViews(corpusId)).views[0].content.sections[0]
                .body,
        ).toContain("carefully");
    });
});
