// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type {
    TimelineContent,
    ViewBuildBounds,
    ViewBuildJob,
} from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { timelineTestAnswer } from "./timelineTestModel.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { timelineTimestamp } from "../src/timeline.js";
import { hydrateInventoryConstruction } from "../src/viewInventoryCoverage.js";
import { projectSources } from "./projectBriefTestModel.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
const calls: Array<{ name: string; input: string }> = [];
let alter: (name: string, value: unknown) => unknown = (_name, value) => value;
let prose = "Retained record evidence.\n";
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
                const user = messages.find(
                    (message) => message.role === "user",
                );
                if (!user)
                    throw new Error("Timeline structured model input missing");
                calls.push({ name: schema.name, input: user.content });
                return {
                    success: true,
                    data: JSON.stringify(
                        alter(
                            schema.name,
                            timelineTestAnswer(
                                schema.name,
                                JSON.parse(user.content),
                                prose,
                            ),
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
const { viewHash } = await import("../src/viewMerge.js");
const { ViewHistory } = await import("../src/viewHistory.js");
const { TypedViewStore } = await import("../src/personalHowToStore.js");

describe("timeline configured service pipeline", () => {
    let root: string;
    let corpusId: string;
    let service: InstanceType<typeof FileMemoryService>;
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "timeline-offline-"));
        calls.length = 0;
        alter = (_name, value) => value;
        prose = "Retained record evidence.\n";
        service = open();
        corpusId = (await service.createCorpus("Timeline evidence")).corpusId;
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(text: string, sourceId = "log") {
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: "Retained investigation records",
                text,
                capturedAt: "2026-10-08T12:00:00Z",
                sourceModifiedAt: "2026-10-08T11:00:00Z",
            },
        });
        expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
            "complete",
        );
        return job;
    }
    async function event(
        content: string,
        observedAt = "2026-10-06T08:05:00Z",
        eventTime = "2026-10-05T08:45:00Z",
        metadata: Record<string, string> = { state: "confirmed" },
    ) {
        return (
            await service.appendEvent({
                corpusId,
                idempotencyKey: content,
                producer: {
                    producerId: "recorded-observer",
                    producerType: "test",
                },
                eventType: "configurationCorrection",
                sourceKind: "system",
                observedAt,
                eventTime,
                content,
                metadata,
            })
        ).event;
    }
    async function build(
        bounds?: ViewBuildBounds,
        eventIds: string[] = [],
        viewId = "incident-timeline",
        publication = false,
    ) {
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
                        kind: "timeline",
                        selector: {
                            kind: "timelineEvidence",
                            sources: sources.map((source) => ({
                                sourceId: source.sourceId,
                                revisionId: source.activeRevisionId,
                            })),
                            events: eventIds.map((eventId) => ({ eventId })),
                        },
                    },
                },
            ],
            ...(bounds ? { bounds } : {}),
        });
        for (let index = 0; index < 300 && job.state === "running"; index++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({ corpusId, jobId: job.jobId }))!;
        }
        expect(job.state).not.toBe("running");
        return job;
    }
    const log = [
        "## Record hypothesis",
        "Classification: hypothesis",
        "State: proposed",
        "Occurred at: 2026-10-05T09:00:00Z",
        "Recorded / known at: 2026-10-05T09:00:00Z",
        "An unconfirmed query explanation; SQL blocking must be checked.",
        "## Record correction",
        "Classification: correction",
        "State: rejected",
        "Corrects: hypothesis",
        "Occurred at: 2026-10-05T08:45:00Z",
        "Recorded / known at: 2026-10-06T08:05:00Z",
        "Later correction: query hypothesis rejected; scale deferred. Pool 100 -> 20 -> 100, comparison 1850ms vs 140ms. Recovery 460ms, errors 0.2%.",
    ].join("\n");

    test("canonical event-only selection copies stable IDs and three actual times, orders and publishes", async () => {
        const late = await event(
            "Canonical correction learned the following morning.",
        );
        const early = await event(
            "Initial hypothesis, not confirmed.",
            "2026-10-05T09:00:00Z",
            "2026-10-05T09:00:00Z",
        );
        const job = await build(
            undefined,
            [early.eventId, late.eventId],
            "canonical-timeline",
            true,
        );
        expect(job.results[0].state).toBe("searchable");
        const view = (await service.getView({
            corpusId,
            viewId: "canonical-timeline",
        }))!;
        expect(view.content.kind).toBe("timeline");
        const content = view.content as TimelineContent;
        const construction = calls.find(
            (call) => call.name === "memory_timeline_construction",
        );
        if (
            !construction ||
            !view.generation?.input ||
            !view.generation.inventory
        )
            throw new Error("Expected frozen configured timeline construction");
        const hydrated = hydrateInventoryConstruction(
            view.generation.input,
            view.generation.inventory,
            timelineTestAnswer(
                construction.name,
                JSON.parse(construction.input),
                prose,
            ),
        );
        expect(hydrated.coverage?.inventoryFingerprint).toBe(
            view.generation.inventory.fingerprint,
        );
        expect(hydrated.coverage?.items.map((item) => item.itemId)).toEqual(
            view.generation.inventory.items.map((item) => item.id),
        );
        expect(
            hydrated.coverage?.items.every((item) => item.state === "covered"),
        ).toBe(true);
        expect(content.sections.map((record) => record.id)).toEqual([
            late.eventId,
            early.eventId,
        ]);
        expect(content.sections[0].details).toMatchObject({
            identity: { kind: "canonicalEvent", eventId: late.eventId },
            occurredAt: "2026-10-05T08:45:00.000Z",
            learnedAt: "2026-10-06T08:05:00.000Z",
            capturedAt: late.createdAt,
            state: "confirmed",
        });
        expect(content.generatedAt).not.toBe(late.createdAt);
        const citation = content.citations.find(
            (citation) => citation.evidence?.eventId === late.eventId,
        )!;
        expect(citation.evidence).toEqual({
            kind: "event",
            eventId: late.eventId,
        });
        expect(JSON.parse(citation.excerpt)).toEqual(late);
        expect(
            await service.searchViews({
                corpusId,
                query: "correction",
                freshness: "current",
                kinds: ["timeline"],
            }),
        ).toHaveLength(1);
        const requestFile = path.join(root, "timeline-request.json");
        await writeFile(
            requestFile,
            JSON.stringify({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                publication: false,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "cli-timeline",
                            kind: "timeline",
                            selector: {
                                kind: "timelineEvidence",
                                sources: [],
                                events: [{ eventId: late.eventId }],
                            },
                        },
                    },
                ],
            }),
            "utf8",
        );
        await service.close();
        expect(
            await runMemoryViewsCli([
                "--store",
                root,
                "--enable-view-drafts",
                "read",
                corpusId,
                "canonical-timeline",
            ]),
        ).toMatchObject({ content: { kind: "timeline" } });
        expect(
            await runMemoryViewsCli([
                "--store",
                root,
                "--enable-view-drafts",
                "build",
                requestFile,
            ]),
        ).toMatchObject({ state: "complete", results: [{ state: "draft" }] });
        service = open();
    });
    test("CLI continuation discovers canonical events beyond the first 200", async () => {
        const events = await Promise.all(
            Array.from({ length: 201 }, (_, index) =>
                event(`CLI pagination observation ${index}`),
            ),
        );
        await service.close();
        const args = [
            "--store",
            root,
            "--enable-view-drafts",
            "events",
            corpusId,
        ];
        const first = await runMemoryViewsCli(args);
        expect(first).toMatchObject({
            items: expect.any(Array),
            nextContinuationToken: expect.any(String),
        });
        if (
            !first ||
            typeof first !== "object" ||
            !("items" in first) ||
            !Array.isArray(first.items) ||
            !("nextContinuationToken" in first) ||
            typeof first.nextContinuationToken !== "string"
        )
            throw new Error(
                "Expected the first CLI event page and continuation",
            );
        expect(first.items).toHaveLength(200);
        const second = await runMemoryViewsCli([
            ...args,
            first.nextContinuationToken,
        ]);
        if (
            !second ||
            typeof second !== "object" ||
            !("items" in second) ||
            !Array.isArray(second.items)
        )
            throw new Error("Expected the second CLI event page");
        expect(second.items).toHaveLength(1);
        expect(second).not.toHaveProperty("nextContinuationToken");
        expect(
            [...first.items, ...second.items]
                .map((item) => item.eventId)
                .sort(),
        ).toEqual(events.map((item) => item.eventId).sort());
        service = open();
    }, 60000);

    test.each([
        { evidence: { kind: "invalid" } },
        { sourceId: "unrelated-event" },
        { revisionId: "invalid-revision" },
        { evidence: { extra: true } },
        { evidence: null },
        { evidence: "invalid" },
    ])("rejects malformed canonical source endpoints: %j", async (change) => {
        const canonical = await event("Canonical endpoint validation");
        expect(
            (await build(undefined, [canonical.eventId])).results[0].state,
        ).toBe("draft");
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        const relationships = authoredRelationships(view);
        if (view.content.kind !== "timeline")
            throw new Error("Expected canonical timeline content");
        const target = relationships[0].to;
        if (target.kind !== "source" || !target.evidence)
            throw new Error("Expected a canonical source endpoint");
        const evidence = change.evidence;
        Object.assign(target, {
            ...change,
            ...("evidence" in change
                ? {
                      evidence:
                          evidence && typeof evidence === "object"
                              ? { ...target.evidence, ...evidence }
                              : evidence,
                  }
                : {}),
        });
        const callCount = calls.length;
        await expect(
            service.saveViewDraft({
                corpusId,
                viewId: view.viewId,
                expectedHead: snapshot.head,
                expectedVersion: view.version,
                definition: {
                    viewId: view.viewId,
                    kind: "timeline",
                    selector: view.definition.selector,
                },
                content: view.content,
                relationships,
            }),
        ).rejects.toThrow(/canonical event endpoint|event evidence/);
        expect(calls).toHaveLength(callCount);
        expect((await service.listViews(corpusId)).head).toBe(snapshot.head);
    });

    test("bulk event forgetting purges managed history and rebuilds its index once", async () => {
        const removed = [
            await event("First forgotten observation"),
            await event("Second forgotten observation"),
        ];
        const retained = await event(
            "Unrelated retained observation",
            "2026-10-06T10:00:00Z",
            "2026-10-05T10:00:00Z",
        );
        expect(
            (
                await build(
                    undefined,
                    removed.map((item) => item.eventId),
                    "removed-timeline",
                    true,
                )
            ).results[0].state,
        ).toBe("searchable");
        expect(
            (
                await build(
                    undefined,
                    [retained.eventId],
                    "retained-timeline",
                    true,
                )
            ).results[0].state,
        ).toBe("searchable");
        const purge = jest.spyOn(ViewHistory.prototype, "purge");
        const rebuild = jest.spyOn(TypedViewStore.prototype, "rebuildIndex");
        try {
            expect(
                await service.forgetEvents({
                    corpusId,
                    eventTo: "2026-10-05T09:00:00Z",
                    forgetLinkedSources: false,
                }),
            ).toMatchObject({ deletedEventCount: 2 });
            expect(purge).toHaveBeenCalledTimes(1);
            expect(rebuild).toHaveBeenCalledTimes(1);
            expect(JSON.parse(purge.mock.calls[0][0])).toEqual({
                kind: "events",
                eventIds: expect.arrayContaining(
                    removed.map((item) => item.eventId),
                ),
            });
        } finally {
            purge.mockRestore();
            rebuild.mockRestore();
        }
        expect(await service.listViews(corpusId)).toMatchObject({
            views: [{ viewId: "retained-timeline" }],
        });
        expect(
            await service.getViewHistory({
                corpusId,
                viewId: "removed-timeline",
            }),
        ).toHaveLength(0);
        await service.close();
        service = open();
        expect(
            await service.searchViews({
                corpusId,
                query: "Retained",
                freshness: "current",
                kinds: ["timeline"],
            }),
        ).toMatchObject([{ view: { viewId: "retained-timeline" } }]);
        expect(
            await service.getEvent(corpusId, removed[0].eventId),
        ).toBeUndefined();
        expect(
            await service.getEvent(corpusId, retained.eventId),
        ).toBeDefined();
    });

    test("restart recovers the complete interrupted event-batch privacy selection", async () => {
        const removed = [
            await event("First interrupted batch observation"),
            await event("Second interrupted batch observation"),
        ];
        expect(
            (
                await build(
                    undefined,
                    removed.map((item) => item.eventId),
                )
            ).results[0].state,
        ).toBe("draft");
        const retained = await event("Unrelated batch recovery evidence");
        expect(
            (await build(undefined, [retained.eventId], "retained-timeline"))
                .results[0].state,
        ).toBe("draft");
        const purge = jest.spyOn(ViewHistory.prototype, "purge");
        purge.mockImplementationOnce(
            async (marker, sanitize, entries, cleanup) => {
                purge.mockRestore();
                const interrupted = new ViewHistory<unknown>(
                    path.join(root, corpusId, "personal-how-to"),
                    () => undefined,
                    async (point) => {
                        if (point === "purge-prepared")
                            throw new Error("Batch purge interrupted");
                    },
                );
                await interrupted.purge(marker, sanitize, entries, cleanup);
            },
        );
        try {
            await expect(
                service.forgetEvents({
                    corpusId,
                    eventIds: removed.map((item) => item.eventId),
                    forgetLinkedSources: false,
                }),
            ).rejects.toThrow("Batch purge interrupted");
        } finally {
            purge.mockRestore();
        }
        await service.close();
        service = open();
        expect(await service.listViews(corpusId)).toMatchObject({
            views: [{ viewId: "retained-timeline" }],
        });
        expect(
            await service.getViewHistory({
                corpusId,
                viewId: "incident-timeline",
            }),
        ).toHaveLength(0);
        expect(
            await service.forgetEvents({
                corpusId,
                eventIds: removed.map((item) => item.eventId),
                forgetLinkedSources: false,
            }),
        ).toMatchObject({ deletedEventCount: 2 });
    });

    test("canonical corrections preserve rejected history and idempotent replays; edge removals survive repeated rebuilds", async () => {
        const original = await event(
            "Query explanation remains an unconfirmed hypothesis.",
            "2026-10-05T09:00:00Z",
            "2026-10-05T09:00:00Z",
            { state: "proposed" },
        );
        expect(
            (
                await event(
                    "Query explanation remains an unconfirmed hypothesis.",
                )
            ).eventId,
        ).toBe(original.eventId);
        const correction = await event(
            "Query explanation rejected after SQL blocking check.",
            "2026-10-06T08:05:00Z",
            "2026-10-05T08:45:00Z",
            { state: "rejected", corrects: original.eventId },
        );
        const ids = [original.eventId, correction.eventId];
        expect((await build(undefined, ids)).results[0].state).toBe("draft");
        let snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        if (view.content.kind !== "timeline")
            throw new Error("Expected canonical timeline content");
        expect(
            authoredRelationships(view).filter(
                (edge) => edge.predicate === "corrects",
            ),
        ).toHaveLength(1);
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "timeline",
                selector: view.definition.selector,
            },
            content: view.content,
            relationships: authoredRelationships(view).filter(
                (edge) => edge.predicate !== "corrects",
            ),
        });
        for (let iteration = 0; iteration < 2; iteration++) {
            expect((await build(undefined, ids)).results[0].state).toBe(
                "merged",
            );
            snapshot = await service.listViews(corpusId);
            expect(
                authoredRelationships(snapshot.views[0]).filter(
                    (edge) => edge.predicate === "corrects",
                ),
            ).toEqual([]);
            expect(
                (snapshot.views[0].content as TimelineContent).sections.map(
                    (record) => record.details.state,
                ),
            ).toEqual(["rejected", "proposed"]);
        }
    });
    test("human-added canonical evidence relationships remain selected across repeated rebuilds", async () => {
        const canonical = await event(
            "Retained canonical dependency evidence.",
        );
        expect(
            (await build(undefined, [canonical.eventId])).results[0].state,
        ).toBe("draft");
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        if (view.content.kind !== "timeline")
            throw new Error("Expected canonical timeline content");
        const support = authoredRelationships(view)[0];
        if (support.to.kind !== "source")
            throw new Error("Expected canonical source evidence endpoint");
        const dependency = {
            ...support,
            id: "human-canonical-dependency",
            predicate: "dependsOn" as const,
            to: support.to,
        };
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "timeline",
                selector: view.definition.selector,
            },
            content: view.content,
            relationships: [...authoredRelationships(view), dependency],
        });
        for (let iteration = 0; iteration < 2; iteration++) {
            expect(
                (await build(undefined, [canonical.eventId])).results[0].state,
            ).toBe("merged");
            const rebuilt = (await service.listViews(corpusId)).views[0];
            expect(
                authoredRelationships(rebuilt).find(
                    (edge) => edge.id === dependency.id,
                ),
            ).toEqual(dependency);
        }
    });
    test("fenced examples cannot create record boundaries or override grounded fields", async () => {
        await ingest(
            [
                log.split("## Record correction")[0],
                "```markdown",
                "## Record example",
                "State: rejected",
                "Occurred at: not-a-timestamp",
                "Recorded / known at: not-a-timestamp",
                "```",
            ].join("\n"),
        );
        expect((await build()).results[0].state).toBe("draft");
        const content = (await service.listViews(corpusId)).views[0]
            .content as TimelineContent;
        expect(content.sections).toHaveLength(1);
        expect(content.sections[0].details).toMatchObject({
            state: "proposed",
            occurredAt: "2026-10-05T09:00:00.000Z",
        });
        expect(content.citations[0].excerpt).toContain("## Record example");
    });
    test("bare document correction IDs cannot resolve across source boundaries", async () => {
        await ingest(log.split("## Record correction")[0], "original-log");
        await ingest(
            `## Record correction${log.split("## Record correction")[1]}`,
            "correction-log",
        );
        const job = await build();
        expect(job.results[0].state).toBe("failed");
        expect(await service.listViews(corpusId)).toMatchObject({ views: [] });
    });
    test.each(["supportedBy", "dependsOn"] as const)(
        "timeline %s citations cannot authorize another selected canonical source target",
        async (predicate) => {
            const first = await event("First canonical witness.");
            const second = await event("Second canonical witness.");
            expect(
                (await build(undefined, [first.eventId, second.eventId]))
                    .results[0].state,
            ).toBe("draft");
            const snapshot = await service.listViews(corpusId);
            const view = snapshot.views[0];
            const relationships = authoredRelationships(view);
            const firstEdge = relationships.find(
                (edge) => edge.predicate === "supportedBy",
            );
            const otherEdge = relationships.find(
                (edge) =>
                    edge.predicate === "supportedBy" &&
                    edge.to.kind === "source" &&
                    firstEdge?.to.kind === "source" &&
                    edge.to.sourceId !== firstEdge.to.sourceId,
            );
            if (
                !firstEdge ||
                firstEdge.predicate !== "supportedBy" ||
                !otherEdge ||
                otherEdge.to.kind !== "source"
            )
                throw new Error(
                    "Expected two distinct canonical source targets",
                );
            relationships.push({
                ...firstEdge,
                id: "invalid-canonical-target",
                predicate,
                to: otherEdge.to,
            });
            const callCount = calls.length;
            await expect(
                service.saveViewDraft({
                    corpusId,
                    viewId: view.viewId,
                    expectedHead: snapshot.head,
                    expectedVersion: view.version,
                    definition: {
                        viewId: view.viewId,
                        kind: "timeline",
                        selector: view.definition.selector,
                    },
                    content: view.content as TimelineContent,
                    relationships,
                }),
            ).rejects.toThrow("citations must match its exact target");
            expect(calls).toHaveLength(callCount);
            expect(await service.listViews(corpusId)).toEqual(snapshot);
        },
    );

    test("replacement, archive, disabled reopen and document forget isolate canonical-only publications", async () => {
        const canonical = await event(
            "Unrelated canonical headroom observation.",
        );
        expect(
            (
                await build(
                    undefined,
                    [canonical.eventId],
                    "canonical-only",
                    true,
                )
            ).results[0].state,
        ).toBe("searchable");
        await ingest(log);
        expect(
            (await build(undefined, [], "document-only", true)).results[0]
                .state,
        ).toBe("searchable");
        const source = (await service.listSources(corpusId))[0];
        const replacement = await service.replaceSource({
            corpusId,
            sourceId: source.sourceId,
            expectedActiveRevisionId: source.activeRevisionId,
            source: {
                sourceType: "text",
                title: "Retained records updated",
                text: log.replace("scale deferred", "scale remains deferred"),
            },
        });
        expect((await waitForMemoryJob(service, replacement.jobId)).state).toBe(
            "complete",
        );
        expect(
            (await service.getView({ corpusId, viewId: "document-only" }))
                ?.state,
        ).toBe("stale");
        expect(
            (await service.getView({ corpusId, viewId: "canonical-only" }))
                ?.state,
        ).toBe("draft");
        expect(
            (await build(undefined, [], "document-only", true)).results[0]
                .state,
        ).toBe("searchable");
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views.find(
            (view) => view.viewId === "document-only",
        )!;
        if (!snapshot.head) throw new Error("Expected committed view head");
        await service.archiveView({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
        });
        const search = () =>
            service.searchViews({
                corpusId,
                query: "headroom",
                kinds: ["timeline"],
                freshness: "current",
            });
        expect((await search()).map((match) => match.view.viewId)).toEqual([
            "canonical-only",
        ]);
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
        await expect(search()).rejects.toThrow("not supported");
        await service.close();
        service = open();
        expect(
            (await service.getView({ corpusId, viewId: "document-only" }))
                ?.state,
        ).toBe("archived");
        const preview = await service.previewForgetSource(
            corpusId,
            source.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: source.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getViewHistory({ corpusId, viewId: "document-only" }),
        ).toEqual([]);
        expect((await search()).map((match) => match.view.viewId)).toEqual([
            "canonical-only",
        ]);
        expect(
            (await service.getEvent(corpusId, canonical.eventId))?.eventId,
        ).toBe(canonical.eventId);
        await service.close();
        service = open();
        expect((await search()).map((match) => match.view.viewId)).toEqual([
            "canonical-only",
        ]);
    });
    test("host checkpoint excludes later knowledge even when full log was imported later, without altering bytes", async () => {
        await ingest(log);
        const late = await event(
            "Future canonical correction not available before October 6.",
        );
        const job = await build({ learnedBefore: "2026-10-05T12:00:00Z" }, [
            late.eventId,
        ]);
        expect(job.results[0].state).toBe("draft");
        expect(job.results[0].snapshot.inputs).toHaveLength(1);
        expect(
            calls.every(
                (call) =>
                    !call.input.includes("1850ms") &&
                    !call.input.includes("Future canonical correction") &&
                    !call.input.includes("Record correction"),
            ),
        ).toBe(true);
        const early = (await service.getView({
            corpusId,
            viewId: "incident-timeline",
        }))!.content as TimelineContent;
        expect(early.sections).toHaveLength(1);
        expect(early.sections[0].details.capturedAt).toBe(
            "2026-10-08T12:00:00.000Z",
        );
        const source = (await service.listSources(corpusId))[0];
        expect(
            (
                await service.getSourceContent({
                    corpusId,
                    sourceId: source.sourceId,
                    revisionId: source.activeRevisionId,
                })
            ).content,
        ).toBe(log);
        const full = await build(undefined, [late.eventId], "full-timeline");
        expect(full.results[0].state).toBe("draft");
        const view = (await service.getView({
            corpusId,
            viewId: "full-timeline",
        }))!;
        expect(
            authoredRelationships(view).filter(
                (edge) => edge.predicate === "corrects",
            ),
        ).toHaveLength(1);
        const timeline = view.content as TimelineContent;
        expect(
            timeline.sections.map((record) => record.details.occurredAt),
        ).toEqual([
            "2026-10-05T08:45:00.000Z",
            "2026-10-05T08:45:00.000Z",
            "2026-10-05T09:00:00.000Z",
        ]);
        expect(
            timeline.sections.map((record) => record.body).join("\n"),
        ).toContain("1850ms vs 140ms");
    });
    test("empty eligible canonical checkpoint is explicitly skipped without model calls or relabeling", async () => {
        const late = await event("Later fact");
        const job = await build({ learnedBefore: "2026-10-05T12:00:00Z" }, [
            late.eventId,
        ]);
        expect(job.results[0].state).toBe("skipped");
        expect(calls).toHaveLength(0);
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
    });
    test("event and document identities cannot collide in selection, citations, publication or forgetting", async () => {
        const canonical = await event(
            "Canonical observation independent of same-named document",
        );
        const document = await ingest(log, canonical.eventId);
        expect(
            (await build(undefined, [], "document-only", true)).results[0]
                .state,
        ).toBe("searchable");
        let job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            publication: true,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "event-only",
                        kind: "timeline",
                        selector: {
                            kind: "timelineEvidence",
                            sources: [],
                            events: [{ eventId: canonical.eventId }],
                        },
                    },
                },
            ],
        });
        for (let index = 0; job.state === "running" && index < 300; index++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({ corpusId, jobId: job.jobId }))!;
        }
        expect(job.results[0].state).toBe("searchable");
        await service.forgetEvents({
            corpusId,
            eventIds: [canonical.eventId],
            forgetLinkedSources: false,
        });
        expect(
            await service.getView({ corpusId, viewId: "event-only" }),
        ).toBeUndefined();
        expect(
            await service.getView({ corpusId, viewId: "document-only" }),
        ).toBeDefined();
        expect(
            (
                await service.getSourceContent({
                    corpusId,
                    sourceId: document.sourceId,
                })
            ).content,
        ).toBe(log);
        expect(
            await service.searchViews({
                corpusId,
                query: "hypothesis",
                freshness: "current",
                kinds: ["timeline"],
            }),
        ).toHaveLength(1);
    });
    test("duplicate canonical selectors and invented correction endpoints fail before positive audit can publish", async () => {
        const canonical = await event("Canonical observation");
        await expect(
            build(undefined, [canonical.eventId, canonical.eventId]),
        ).rejects.toThrow("Duplicate selected canonical event");
        await ingest(log);
        alter = (name, value) => {
            if (name !== "memory_timeline_construction") return value;
            const raw = value as {
                corrections: Array<{
                    from: string;
                    to: string;
                    predicate: string;
                }>;
            };
            raw.corrections[0].to = canonical.eventId;
            return raw;
        };
        const job = await build(undefined, [canonical.eventId]);
        expect(job.results[0].state).toBe("failed");
        expect(job.results[0].reason).toContain("grounded existing endpoints");
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
    });
    test("unknown log knowledge cannot enter bounded checkpoint; occurrence is never capture metadata", async () => {
        await ingest(
            "## Record undated\nClassification: observation\nAn undated observation.",
        );
        expect(
            (await build({ learnedBefore: "2026-10-05T12:00:00Z" })).results[0]
                .state,
        ).toBe("skipped");
        const job = await build(undefined, [], "unknown-timeline");
        expect(job.results[0].state).toBe("draft");
        expect(
            (
                (await service.getView({
                    corpusId,
                    viewId: "unknown-timeline",
                }))!.content as TimelineContent
            ).sections[0].details,
        ).toMatchObject({ occurredAt: null, learnedAt: null });
    });
    test.each([
        "2026-02-30T00:00:00Z",
        "2026-10-05T09:00:00",
        "invented",
        "2026-10-05",
    ])("rejects invalid timestamp %s", (value) => {
        expect(() => timelineTimestamp(value)).toThrow();
    });
    test("normalizes explicit timezone without an epoch or capture fallback", () => {
        expect(timelineTimestamp("2026-10-05T10:45+02:00")).toBe(
            "2026-10-05T08:45:00.000Z",
        );
    });
    test("rejects unstructured checkpoint documents, duplicate record IDs and invalid grounded times", async () => {
        await ingest("No explicit record boundaries.");
        await expect(
            build({ learnedBefore: "2026-10-05T12:00:00Z" }),
        ).rejects.toThrow("boundaries");
        await ingest(log + "\n## Record hypothesis\nDuplicated");
        await expect(build()).rejects.toThrow("Duplicate");
        await ingest(
            log.replace("2026-10-06T08:05:00Z", "2026-10-06T08:05:00"),
        );
        await expect(build()).rejects.toThrow("explicit-timezone");
    });
    test.each(["occurredAt", "learnedAt", "identity", "state"] as const)(
        "positive audits cannot authorize edited record %s metadata",
        async (field) => {
            await ingest(log);
            expect((await build()).results[0].state).toBe("draft");
            const snapshot = await service.listViews(corpusId);
            const view = snapshot.views[0];
            const content = structuredClone(view.content) as TimelineContent;
            Object.assign(content.sections[0].details, {
                [field]:
                    field === "identity"
                        ? { kind: "canonicalEvent", eventId: "invented" }
                        : field === "state"
                          ? "confirmed"
                          : "2026-10-05T00:00:00.000Z",
            });
            await expect(
                service.saveViewDraft({
                    corpusId,
                    viewId: view.viewId,
                    expectedHead: snapshot.head,
                    expectedVersion: view.version,
                    definition: {
                        viewId: view.viewId,
                        kind: "timeline",
                        selector: view.definition.selector,
                    },
                    content,
                    relationships: authoredRelationships(view),
                }),
            ).rejects.toThrow("metadata");
        },
    );
    test("model cannot invent metadata or reference an excluded record despite positive audits", async () => {
        await ingest(log);
        alter = (name, value) => {
            if (name !== "memory_timeline_construction") return value;
            const output = value as {
                content: {
                    records: Array<{ recordId: string; occurredAt?: string }>;
                };
            };
            output.content.records[0].occurredAt = "2026-10-05T00:00:00Z";
            return output;
        };
        expect((await build()).results[0]).toMatchObject({
            state: "failed",
            reason: expect.stringContaining("host-owned"),
        });
    });
    test("narrative edits survive clean rebuild, overlapping prose conflicts retain current content, event forget preserves unrelated sources and views across restart", async () => {
        await ingest(log);
        const canonical = await event("Retained event");
        expect(
            (await build(undefined, [], "document-timeline", true)).results[0]
                .state,
        ).toBe("searchable");
        expect(
            (
                await build(
                    undefined,
                    [canonical.eventId],
                    "combined-timeline",
                    true,
                )
            ).results[0].state,
        ).toBe("searchable");
        let snapshot = await service.listViews(corpusId);
        const view = snapshot.views.find(
            (entry) => entry.viewId === "combined-timeline",
        )!;
        const content = structuredClone(view.content) as TimelineContent;
        content.sections[0].body = `Human narrative clarification.\n${content.sections[0].body}`;
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "timeline",
                selector: view.definition.selector,
            },
            content,
            relationships: authoredRelationships(view),
        });
        expect(
            (await build(undefined, [canonical.eventId], "combined-timeline"))
                .results[0].state,
        ).toBe("merged");
        expect(
            (
                (await service.getView({ corpusId, viewId: view.viewId }))!
                    .content as TimelineContent
            ).sections[0].body,
        ).toContain("Human narrative");
        snapshot = await service.listViews(corpusId);
        const merged = snapshot.views.find(
            (entry) => entry.viewId === view.viewId,
        )!;
        const competing = structuredClone(merged.content) as TimelineContent;
        competing.sections[0].body = competing.sections[0].body.replace(
            "Retained record evidence.",
            "Human rewritten lead.",
        );
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: merged.version,
            definition: {
                viewId: view.viewId,
                kind: "timeline",
                selector: merged.definition.selector,
            },
            content: competing,
            relationships: authoredRelationships(merged),
        });
        prose = "Changed generated narrative.\n";
        const conflict = await build(
            undefined,
            [canonical.eventId],
            "combined-timeline",
        );
        expect(conflict.results[0].state).toBe("conflicted");
        expect(
            (await service.getView({ corpusId, viewId: view.viewId }))!.content
                .sections[0].body,
        ).toContain("Human rewritten lead.");
        const project = await ingest(
            `${projectSources.charter}\n\n${projectSources.baseline}`,
            "project-context",
        );
        const buildUnrelated = async (
            kind: "projectBrief" | "troubleshootingGuide",
            viewId: string,
        ) => {
            let job = await service.buildViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                publication: true,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId,
                            kind,
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: project.sourceId,
                                        revisionId: project.revisionId,
                                    },
                                ],
                            },
                        },
                    },
                ],
            });
            for (
                let index = 0;
                job.state === "running" && index < 300;
                index++
            ) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                job = (await service.getViewBuild({
                    corpusId,
                    jobId: job.jobId,
                }))!;
            }
            expect(job.results[0].state).toBe("searchable");
        };
        await buildUnrelated("projectBrief", "unrelated-brief");
        await buildUnrelated("troubleshootingGuide", "unrelated-guide");
        const forgotten = await service.forgetEvents({
            corpusId,
            eventIds: [canonical.eventId],
            forgetLinkedSources: false,
        });
        expect(forgotten.deletedEventCount).toBe(1);
        expect(await service.listSources(corpusId)).toHaveLength(2);
        expect(
            await service.getView({ corpusId, viewId: "combined-timeline" }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({
                corpusId,
                viewId: "combined-timeline",
            }),
        ).toHaveLength(0);
        expect(
            await service.searchViews({
                corpusId,
                query: "hypothesis",
                freshness: "current",
                kinds: ["timeline"],
            }),
        ).toHaveLength(1);
        await service.close();
        service = open();
        snapshot = await service.listViews(corpusId);
        expect(snapshot.views.map((entry) => entry.viewId).sort()).toEqual([
            "document-timeline",
            "unrelated-brief",
            "unrelated-guide",
        ]);
        const files = await readFile(
            path.join(
                root,
                corpusId,
                "personal-how-to",
                "view-history.git",
                "HEAD",
            ),
            "utf8",
        );
        expect(files).toContain("refs/heads");
    });
    test("synthetic retained source chronology keeps rejected/blocked/deferred history and late discovery at the correct checkpoints", async () => {
        for (const name of [
            "session-01",
            "session-02",
            "session-03",
            "session-04",
        ]) {
            const text = await readFile(
                path.join(
                    process.cwd(),
                    "test",
                    "fixtures",
                    "distillation",
                    "baseline",
                    `${name}.md`,
                ),
                "utf8",
            );
            await ingest(text, name);
        }
        const early = await build(
            { learnedBefore: "2026-10-05T11:15:00Z" },
            [],
            "early-history",
        );
        expect(early.results[0].state).toBe("draft");
        const earlyText = (await service.getView({
            corpusId,
            viewId: "early-history",
        }))!.content.sections
            .map((record) => record.body)
            .join("\n");
        expect(earlyText).toContain("hypothesis is rejected");
        expect(earlyText).toContain("scale-up was deferred, not attempted");
        expect(earlyText).toContain("blocking");
        expect(earlyText).not.toContain("1850");
        const full = await build(undefined, [], "complete-history");
        expect(full.results[0].state).toBe("draft");
        const content = (await service.getView({
            corpusId,
            viewId: "complete-history",
        }))!.content as TimelineContent;
        const discovered = content.sections.find(
            (record) =>
                record.details.identity.kind === "documentRecord" &&
                record.details.identity.sourceRecordId.endsWith(
                    "config-discovered",
                ),
        )!;
        expect(discovered.details).toMatchObject({
            occurredAt: "2026-10-05T08:45:00.000Z",
            learnedAt: "2026-10-06T08:05:00.000Z",
        });
        const text = content.sections.map((record) => record.body).join("\n");
        for (const witness of [
            "1850",
            "140",
            "460",
            "0.2",
            "20",
            "100",
            "rejected",
        ])
            expect(text).toContain(witness);
        expect(content.sections).toHaveLength(16);
    });
    test("real KnowPro text and embedding retrieval return exact published timeline records after restart", async () => {
        const canonical = await event(
            "Recorded headroom measurement and rejected query explanation.",
        );
        await service.close();
        let textOnly = false;
        const languageModel = {
            completionSettings: {},
            complete: async () => ({
                success: true as const,
                data: JSON.stringify({
                    searchExpressions: [
                        {
                            rewrittenQuery: "Find headroom",
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
                            entities: [
                                { name: "headroom", type: ["measurement"] },
                            ],
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
        const job = await build(
            undefined,
            [canonical.eventId],
            "indexed-timeline",
            true,
        );
        expect(job.results[0].state).toBe("searchable");
        const revisionId = job.results[0].revisionId!;
        const directory = path.join(
            root,
            corpusId,
            "personal-how-to",
            "view-search-index",
            viewHash("indexed-timeline"),
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
            kinds: ["timeline"],
        });
        expect(semantic.length).toBeGreaterThan(0);
        expect(
            semantic.every(
                (match) =>
                    match.view.revisionId === revisionId &&
                    match.evidence[0].evidence?.eventId === canonical.eventId,
            ),
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
            kinds: ["timeline"],
        });
        expect(text.length).toBeGreaterThan(0);
        expect(
            text.every((match) => match.view.revisionId === revisionId),
        ).toBe(true);
        expect(embeddings.length).toBe(beforeText);
    });
});
