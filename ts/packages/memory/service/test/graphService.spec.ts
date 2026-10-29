// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import type { IndexedDocument, MemoryKnowledgeGraph } from "../src/types.js";
import type {
    MemoryGraphQueryRequest,
    MemoryGraphQueryResult,
} from "../src/graphTypes.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import { FakeIndexedCorpusIndex } from "./fakeIndexedCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { ViewHistory } from "../src/viewHistory.js";

let graphReads = 0;
let documentGraphReads = 0;
class GraphIndex extends FakeIndexedCorpusIndex {
    public async readKnowledgeGraph(
        sourceIds: ReadonlySet<string>,
        _kind?: string,
        exclusions?: ReadonlyMap<string, ReadonlySet<string>>,
    ) {
        graphReads++;
        if (sourceIds.has("document")) documentGraphReads++;
        const graph = await this.getKnowledgeGraph(sourceIds);
        const suppressed = (sourceId: string, kind: string, name: string) =>
            exclusions?.get(`${sourceId}\0${kind}`)?.has(name.toLowerCase());
        return {
            entities: graph.entities.filter(
                (entity) =>
                    !suppressed(entity.sourceIds[0], "entity", entity.name),
            ),
            topics: graph.topics.filter(
                (topic) => !suppressed(topic.sourceIds[0], "topic", topic.name),
            ),
            relationships: graph.relationships.filter(
                (edge) =>
                    !suppressed(edge.sourceIds[0], "entity", edge.fromEntity) &&
                    !suppressed(edge.sourceIds[0], "entity", edge.toEntity),
            ),
        };
    }
    public async initialize() {
        try {
            await super.initialize();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    public async getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph> {
        const selected = this.documents.filter(
            (document) => !sourceIds || sourceIds.has(document.source.sourceId),
        );
        return {
            entities: selected.flatMap((document) =>
                ["Zephyr", "Queue"].map((name) => ({
                    name,
                    types: ["system"],
                    mentionCount: name === "Zephyr" ? 3 : 1,
                    sourceIds: [document.source.sourceId],
                })),
            ),
            topics: selected.map((document) => ({
                name: "recovery",
                mentionCount: 2,
                sourceIds: [document.source.sourceId],
            })),
            relationships: selected.map((document) => ({
                fromEntity: "Zephyr",
                toEntity: "Queue",
                relationshipType: "uses",
                count: 2,
                sourceIds: [document.source.sourceId],
            })),
        };
    }
    public async getTopicOccurrences(sourceIds: ReadonlySet<string>) {
        return this.documents
            .filter((document) => sourceIds.has(document.source.sourceId))
            .flatMap((document) =>
                ["recovery", "queue safety"].map((label, ordinal) =>
                    indexedTopicOccurrence(
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            blockOrdinal: 0,
                            text: document.content,
                            score: 1,
                        },
                        label,
                        ordinal,
                    ),
                ),
            );
    }
}

describe("bounded corpus graph service", () => {
    let directory: string;
    let service: FileMemoryService;
    let block: Promise<void> | undefined;
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    let eventBuilds: number;
    let ignoreAbort: boolean;
    const open = () =>
        new FileMemoryService(directory, {
            understanding: true,
            indexFactory: (_id, directory) => new GraphIndex(directory),
            eventIndexFactory: (_id, directory) => {
                class EventIndex extends GraphIndex {
                    public async rebuild(
                        documents: IndexedDocument[],
                        signal?: AbortSignal,
                    ) {
                        eventBuilds++;
                        entered?.();
                        if (block && ignoreAbort) await block;
                        else if (block)
                            await Promise.race([
                                block,
                                new Promise<never>((_resolve, reject) => {
                                    if (signal?.aborted) reject(signal.reason);
                                    signal?.addEventListener(
                                        "abort",
                                        () => reject(signal.reason),
                                        { once: true },
                                    );
                                }),
                            ]);
                        signal?.throwIfAborted();
                        await super.rebuild(documents);
                    }
                }
                return new EventIndex(directory);
            },
            sourceSynopsisModel: {
                identity: "offline",
                fits: () => true,
                complete: async () => {
                    throw new Error("offline");
                },
            },
            viewSynthesisAdapter: {
                identity: "offline-graph",
                generate: async () => {
                    throw new Error("Unexpected article model");
                },
                validate: async () => {
                    throw new Error("Unexpected article validation");
                },
                generateTopics: async (input) => {
                    const snapshot = createTopicSnapshot(input, input.model);
                    for (const node of snapshot.nodes) {
                        node.summary = node.citations[0].excerpt.slice(0, 500);
                        node.summaryState = "ready";
                    }
                    if (snapshot.nodes.length > 1) {
                        snapshot.parents.push({
                            parentId: snapshot.nodes[0].id,
                            childId: snapshot.nodes[1].id,
                        });
                        snapshot.related.push({
                            fromId: snapshot.nodes[1].id,
                            toId: snapshot.nodes[0].id,
                            kind: "related",
                        });
                    }
                    return snapshot;
                },
            },
        });
    beforeEach(async () => {
        directory = path.resolve(".graph-service-tests", randomUUID());
        await mkdir(directory, { recursive: true });
        eventBuilds = 0;
        graphReads = 0;
        documentGraphReads = 0;
        ignoreAbort = false;
        block = undefined;
        release = undefined;
        entered = undefined;
        service = open();
    });
    afterEach(async () => {
        release?.();
        await service.close();
        await rm(directory, { recursive: true, force: true });
    });
    async function corpus() {
        const { corpusId } = await service.createCorpus(
            `Graph fixture ${randomUUID()}`,
        );
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        return corpusId;
    }
    async function document(corpusId: string) {
        const receipt = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "document",
                sourceType: "text",
                title: "Guide",
                text: "Zephyr uses Queue for recovery.",
            },
        });
        await waitForMemoryJob(service, receipt.jobId, { pollIntervalMs: 5 });
    }
    async function event(
        corpusId: string,
        key: string,
        authority: "user-assertion" | "evidence-only" = "user-assertion",
    ) {
        return service.appendEvent({
            corpusId,
            idempotencyKey: key,
            producer: { producerId: "fixture", producerType: "test" },
            eventType: "turn.completed",
            sourceKind: "conversation",
            conversationId: key,
            turnId: `turn-${key}`,
            sender: authority === "user-assertion" ? "user" : "assistant",
            content: `Zephyr uses Queue. PRIVATE-${key}`,
            metadata: { authority },
        });
    }
    async function ready(
        request: MemoryGraphQueryRequest,
    ): Promise<MemoryGraphQueryResult> {
        let last: MemoryGraphQueryResult | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
            const graph = await service.queryKnowledgeGraph(request);
            last = graph;
            if (graph.state === "ready") return graph;
            if (graph.state === "error")
                throw new Error(JSON.stringify(graph.coverage));
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(
            `Graph did not become ready: ${JSON.stringify(last?.coverage)}`,
        );
    }
    test("understanding validates focused graph snapshots without reusing query-bound generations for different limits", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        const graph = await ready({
            corpusId,
            kind: "entities",
            search: "Zephyr",
            maxNodes: 3,
            maxEdges: 2,
            evidenceKinds: ["document"],
        });
        const node = graph.nodes.find((node) => node.label === "Zephyr")!;
        expect(node).toBeDefined();
        const result = await service.understand({
            corpusId,
            question: "Show related systems",
            focus: { nodeId: node.id, generation: graph.generation },
            selection: {
                mode: "only",
                modules: ["relationships", "concepts"],
            },
        });
        const relationships = await service.understandingModule({
            corpusId,
            snapshotId: result.snapshotId,
            kind: "relationships",
        });
        expect(relationships.status).toBe("ready");
        expect(relationships.graph?.edges).toHaveLength(1);
        expect(relationships.graph?.generation).not.toBe(graph.generation);
        expect(relationships.support?.[0].items[0]).toMatchObject({
            kind: "document",
            sourceId: "document",
        });
        const concepts = await service.understandingModule({
            corpusId,
            snapshotId: result.snapshotId,
            kind: "concepts",
        });
        expect(concepts.status).toBe("ready");
        expect(concepts.concepts?.some((item) => item.nodeId === node.id)).toBe(
            true,
        );
    });
    test("twenty warm graph and support reads reuse projections without loading full view state and honor privacy gates", async () => {
        expect(
            (await service.getCapabilities()).features.scopedKnowledgeGraphs,
        ).toBe(true);
        const corpusId = await corpus();
        await document(corpusId);
        // Index installation schedules a delayed topic check even for a paused family.
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        expect(service.getMaintenanceStatus().pending).not.toContain(
            `${corpusId}:topics`,
        );
        const historyRead = ViewHistory.prototype.read;
        let stateReads = 0;
        ViewHistory.prototype.read = function (...args) {
            stateReads++;
            return historyRead.apply(this, args);
        };
        const request = {
            corpusId,
            kind: "entities" as const,
            maxNodes: 250,
            maxEdges: 500,
        };
        const gate = path.join(
            service["viewStore"]["viewDirectory"](corpusId),
            "view-history-purge.json",
        );
        try {
            const first = await ready(request);
            const supportRequest = {
                corpusId,
                generation: first.generation,
                nodeId: first.nodes[0].id,
            };
            first.coverage.documents.eligible = 999;
            for (let repeat = 0; repeat < 20; repeat++) {
                const graph = await service.queryKnowledgeGraph(request);
                expect(graph.generation).toBe(first.generation);
                expect(graph.coverage.documents.eligible).toBe(1);
                expect(
                    (await service.queryGraphSupport(supportRequest)).total,
                ).toBe(1);
            }
            expect(
                (
                    await service.queryKnowledgeGraph({
                        ...request,
                        search: "Zephyr",
                    })
                ).nodes.map((node) => node.label),
            ).toEqual(["Zephyr"]);
            expect(
                (
                    await service.queryKnowledgeGraph({
                        ...request,
                        pageBy: "edges",
                        maxNodes: 2,
                        maxEdges: 1,
                    })
                ).edges,
            ).toHaveLength(1);
            expect(graphReads).toBe(1);
            expect(stateReads).toBe(0);
            await writeFile(gate, "{}");
            await expect(service.queryKnowledgeGraph(request)).rejects.toThrow(
                "quarantined",
            );
            await expect(
                service.queryGraphSupport(supportRequest),
            ).rejects.toThrow("quarantined");
        } finally {
            ViewHistory.prototype.read = historyRead;
            await rm(gate, { force: true });
        }
    });
    test("warm graph and support caches invalidate on suppression, revision and physical index changes", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        const request = { corpusId, kind: "entities" as const };
        const first = await ready(request);
        await service.suppressSourceKnowledge({
            corpusId,
            sourceId: "document",
            kind: "entity",
            name: "Zephyr",
        });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: first.generation,
                nodeId: first.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        const suppressed = await ready(request);
        expect(suppressed.nodes.map((node) => node.label)).toEqual(["Queue"]);
        expect(suppressed.edges).toEqual([]);
        await service.restoreSourceKnowledge({
            corpusId,
            sourceId: "document",
            kind: "entity",
            name: "Zephyr",
        });
        const restored = await ready(request);
        expect(restored.nodes).toHaveLength(2);
        const receipt = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "document",
                sourceType: "text",
                title: "Revised guide",
                text: "Zephyr uses Queue for revised recovery.",
            },
        });
        await waitForMemoryJob(service, receipt.jobId, { pollIntervalMs: 5 });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: restored.generation,
                nodeId: restored.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        const revised = await ready(request);
        expect(revised.generation).not.toBe(restored.generation);
        const supports = await service.queryGraphSupport({
            corpusId,
            generation: revised.generation,
            nodeId: revised.nodes[0].id,
        });
        expect(supports.items[0]).toMatchObject({
            kind: "document",
            revisionId: (await service.listSources(corpusId))[0]
                .activeRevisionId,
        });
        const runtime = await service["getCorpusRuntime"](corpusId);
        await writeFile(
            path.join(
                service["indexDirectory"](
                    corpusId,
                    runtime.manifest.indexGeneration,
                ),
                "document-projection.json",
            ),
            "{}",
        );
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: revised.generation,
                nodeId: revised.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        expect((await service.queryKnowledgeGraph(request)).state).not.toBe(
            "ready",
        );
    });
    test("unrelated view commits preserve warm entity and flat-topic graphs and support generations", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        const entities = await ready({ corpusId, kind: "entities" });
        const topics = await ready({ corpusId, kind: "topics" });
        const reads = graphReads;
        const store = service["viewStore"];
        const { family } = await store.getTopicState(corpusId);
        let head = await store.getCommittedHead(corpusId);
        for (let revision = 0; revision < 4; revision++) {
            family.dirty = !family.dirty;
            await store.saveTopicFamily(corpusId, family);
            const nextHead = await store.getCommittedHead(corpusId);
            expect(nextHead).not.toBe(head);
            head = nextHead;
            for (const [kind, graph] of [
                ["entities", entities],
                ["topics", topics],
            ] as const) {
                const current = await service.queryKnowledgeGraph({
                    corpusId,
                    kind,
                });
                expect(current.generation).toBe(graph.generation);
                expect(current.nodes).toEqual(graph.nodes);
                const support = await service.queryGraphSupport({
                    corpusId,
                    generation: graph.generation,
                    nodeId: graph.nodes[0].id,
                });
                expect(support.items).toEqual([
                    expect.objectContaining({
                        kind: "document",
                        sourceId: "document",
                    }),
                ]);
            }
        }
        expect(graphReads).toBe(reads);
    });
    test("warm event projections remain filter-bound and invalidate on append and forgetting", async () => {
        const corpusId = await corpus();
        const first = await event(corpusId, "asserted");
        await event(corpusId, "observed", "evidence-only");
        const request = {
            corpusId,
            kind: "entities" as const,
            evidenceKinds: ["event" as const],
            eventFilter: { conversationIds: ["asserted"] },
        };
        const selected = await ready(request);
        const reads = graphReads;
        expect((await service.queryKnowledgeGraph(request)).generation).toBe(
            selected.generation,
        );
        expect(graphReads).toBe(reads);
        const other = await ready({
            ...request,
            eventFilter: { authorities: ["evidence-only"] },
        });
        const otherSupport = await service.queryGraphSupport({
            corpusId,
            generation: other.generation,
            nodeId: other.nodes[0].id,
        });
        expect(otherSupport.items).toEqual([
            expect.objectContaining({
                kind: "event",
                conversationId: "observed",
                authority: "evidence-only",
            }),
        ]);
        await event(corpusId, "new");
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: selected.generation,
                nodeId: selected.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        const fresh = await ready(request);
        expect(fresh.nodes[0].supportCount).toBe(1);
        expect((await service.queryKnowledgeGraph(request)).generation).toBe(
            fresh.generation,
        );
        await service.forgetEvents({
            corpusId,
            eventIds: [first.event.eventId],
        });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: fresh.generation,
                nodeId: fresh.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        expect((await ready(request)).nodes).toEqual([]);
    });
    test("mixed graph preserves counts, authority, provenance, idempotency and legacy document-only behavior", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        const first = await event(corpusId, "first");
        await event(corpusId, "other", "evidence-only");
        expect((await event(corpusId, "first")).replayed).toBe(true);
        const graph = await ready({ corpusId, kind: "entities" });
        const node = graph.nodes.find((node) => node.label === "Zephyr")!;
        expect(node.id).toContain(`graph:${corpusId}:entity:`);
        expect(node.mentionCount).toBe(9);
        expect(node.supportCount).toBe(3);
        expect(graph.edges[0].count).toBe(6);
        const page = await service.queryGraphSupport({
            corpusId,
            generation: graph.generation,
            nodeId: node.id,
            pageSize: 1,
        });
        expect(page.total).toBe(3);
        expect(page.nextContinuationToken).toBeDefined();
        expect(JSON.stringify(graph)).not.toContain("PRIVATE");
        expect(JSON.stringify(page)).not.toContain("PRIVATE");
        const filtered = await ready({
            corpusId,
            kind: "entities",
            evidenceKinds: ["event"],
            eventFilter: {
                authorities: ["user-assertion"],
                conversationIds: ["first"],
            },
        });
        expect(
            filtered.nodes.find((node) => node.label === "Zephyr")
                ?.mentionCount,
        ).toBe(3);
        const support = await service.queryGraphSupport({
            corpusId,
            generation: filtered.generation,
            nodeId: filtered.nodes[0].id,
        });
        expect(support.items).toEqual([
            expect.objectContaining({
                kind: "event",
                eventId: first.event.eventId,
                conversationId: "first",
                authority: "user-assertion",
                sender: "user",
            }),
        ]);
        expect(
            (await service.getKnowledgeGraph(corpusId)).entities[0].sourceIds,
        ).toEqual(["document"]);
        expect(await service.listSources(corpusId)).toHaveLength(1);
        const edgePage = await ready({
            corpusId,
            kind: "entities",
            pageBy: "edges",
            maxNodes: 2,
            maxEdges: 1,
        });
        expect(edgePage.edges).toHaveLength(1);
        expect(edgePage.nodes).toHaveLength(2);
        const edgeSupport = await service.queryGraphSupport({
            corpusId,
            generation: edgePage.generation,
            edgeId: edgePage.edges[0].id,
        });
        expect(edgeSupport.total).toBe(3);
        await expect(
            service.queryKnowledgeGraph({
                corpusId,
                kind: "entities",
                pageBy: "edges",
                maxNodes: 1,
            }),
        ).rejects.toThrow("two endpoint nodes");
    });
    test("mixed graph reads reuse unchanged document projections while events prepare and after append", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        await ready({
            corpusId,
            kind: "entities",
            evidenceKinds: ["document"],
        });
        const documentReads = documentGraphReads;
        await event(corpusId, "pending");
        block = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const request = { corpusId, kind: "entities" as const };
        expect((await service.queryKnowledgeGraph(request)).state).toBe(
            "building",
        );
        await started;
        for (let index = 0; index < 20; index++) {
            const graph = await service.queryKnowledgeGraph(request);
            expect(graph.coverage.documents.indexed).toBe(1);
            expect(graph.nodes.map((node) => node.label)).toEqual([
                "Zephyr",
                "Queue",
            ]);
        }
        expect(documentGraphReads).toBe(documentReads);
        release!();
        block = undefined;
        await ready(request);
        await event(corpusId, "appended");
        await ready(request);
        expect(documentGraphReads).toBe(documentReads);
        await service.suppressSourceKnowledge({
            corpusId,
            sourceId: "document",
            kind: "entity",
            name: "Zephyr",
        });
        const filtered = await ready({
            ...request,
            evidenceKinds: ["document"],
        });
        expect(filtered.nodes.map((node) => node.label)).toEqual(["Queue"]);
        expect(documentGraphReads).toBe(documentReads + 1);
    });
    test("missing and blocked event preparation never hold graph reads or ledger writes behind extraction", async () => {
        const corpusId = await corpus();
        await event(corpusId, "blocked");
        block = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        expect(
            (await service.queryKnowledgeGraph({ corpusId, kind: "entities" }))
                .state,
        ).toBe("building");
        await started;
        const responsive = await Promise.race([
            Promise.all([
                service.queryKnowledgeGraph({ corpusId, kind: "topics" }),
                service.listEvents({ corpusId }),
                event(corpusId, "new"),
            ]),
            new Promise<never>((_resolve, reject) =>
                setTimeout(
                    () => reject(new Error("Reads blocked behind extraction")),
                    1500,
                ),
            ),
        ]);
        expect(responsive[0].state).toBe("building");
        expect(responsive[1].total).toBe(1);
        await service.forgetEvents({ corpusId, conversationIds: ["blocked"] });
        release!();
        block = undefined;
        const graph = await ready({ corpusId, kind: "entities" });
        expect(graph.coverage.events.eligible).toBe(1);
    });
    test("forgetting drains an abort-ignoring stage before returning and prevents late installation", async () => {
        const corpusId = await corpus();
        await event(corpusId, "late");
        ignoreAbort = true;
        block = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        await service.queryKnowledgeGraph({ corpusId, kind: "entities" });
        await started;
        let forgotten = false;
        const forgetting = service
            .forgetEvents({ corpusId, conversationIds: ["late"] })
            .then(() => {
                forgotten = true;
            });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(forgotten).toBe(false);
        expect(
            (await service.queryKnowledgeGraph({ corpusId, kind: "entities" }))
                .state,
        ).toBe("building");
        release!();
        await forgetting;
        block = undefined;
        expect((await ready({ corpusId, kind: "entities" })).nodes).toEqual([]);
        expect(await service.listEvents({ corpusId })).toMatchObject({
            total: 0,
        });
    });
    test("restart reuses a ready event projection without another extraction and metadata-only events are excluded", async () => {
        const corpusId = await corpus();
        await event(corpusId, "retained");
        await service.appendEvent({
            corpusId,
            idempotencyKey: "activity",
            producer: { producerId: "fixture", producerType: "test" },
            eventType: "activity",
            sourceKind: "system",
            metadata: { detail: "Zephyr" },
        });
        const original = await ready({
            corpusId,
            kind: "entities",
            evidenceKinds: ["event"],
        });
        expect(original.coverage.events).toMatchObject({
            total: 2,
            eligible: 1,
            indexed: 1,
        });
        expect(original.nodes[0].supportCount).toBe(1);
        expect(eventBuilds).toBe(1);
        await service.close();
        service = open();
        const restarted = await ready({
            corpusId,
            kind: "entities",
            evidenceKinds: ["event"],
        });
        expect(restarted.nodes[0].id).toBe(original.nodes[0].id);
        expect(eventBuilds).toBe(1);
    });
    test("generation paging is bounded, rejects mismatched scope, and expires after forgetting and restart", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        const original = await event(corpusId, "gone");
        const graph = await ready({
            corpusId,
            kind: "entities",
            maxNodes: 1,
            maxEdges: 1,
        });
        expect(graph.nodes).toHaveLength(1);
        expect(graph.counts.nodes).toBe(2);
        const second = await service.queryKnowledgeGraph({
            corpusId,
            kind: "entities",
            maxNodes: 1,
            maxEdges: 1,
            continuationToken: graph.nextContinuationToken!,
        });
        expect(second.nodes[0].id).not.toBe(graph.nodes[0].id);
        const support = await service.queryGraphSupport({
            corpusId,
            generation: graph.generation,
            nodeId: graph.nodes[0].id,
            pageSize: 1,
        });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: graph.generation,
                nodeId: second.nodes[0].id,
                pageSize: 1,
                continuationToken: support.nextContinuationToken!,
            }),
        ).rejects.toThrow("continuation");
        await service.forgetEvents({
            corpusId,
            eventIds: [original.event.eventId],
        });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: graph.generation,
                nodeId: graph.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        const after = await ready({ corpusId, kind: "entities" });
        expect(after.nodes[0].supportCount).toBe(1);
        await expect(
            service.queryKnowledgeGraph({
                corpusId,
                kind: "entities",
                expectedGeneration: graph.generation,
            }),
        ).rejects.toThrow("generation");
        await service.close();
        service = open();
        const restarted = await ready({ corpusId, kind: "entities" });
        expect(restarted.nodes[0].id).toBe(after.nodes[0].id);
        expect(restarted.coverage.events.total).toBe(0);
        expect(
            (await service.listSources(corpusId)).map(
                (source) => source.sourceId,
            ),
        ).toEqual(["document"]);
    });
    test("event-backed maintained topics retain event citations, hierarchy semantics, and privacy purge", async () => {
        const corpusId = await corpus();
        const appended = await event(corpusId, "topic");
        const receipt = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "resume",
        });
        expect(receipt.job).toBeDefined();
        for (let attempt = 0; attempt < 200; attempt++) {
            const job = await service.getViewBuild({
                corpusId,
                jobId: receipt.job!.jobId,
            });
            if (job?.state !== "running") {
                expect(job?.state).toBe("complete");
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const topics = await service.queryTopics({ corpusId });
        expect(topics.nodes).toHaveLength(2);
        expect(topics.nodes[0].citations[0].evidence).toEqual({
            kind: "event",
            eventId: appended.event.eventId,
        });
        const graph = await ready({ corpusId, kind: "hierarchy" });
        for (const node of graph.nodes) {
            const topic = topics.nodes.find(
                (topic) => topic.id === node.topicId,
            );
            expect(topic).toBeDefined();
            expect(node.summaryState).toBe(topic!.summaryState);
            expect(node).not.toHaveProperty("summary");
            const detail = await service.queryTopics({
                corpusId,
                topicId: node.topicId!,
                depth: 0,
                pageSize: 1,
            });
            expect(detail.nodes[0].id).toBe(node.topicId);
            expect(detail.nodes[0].summary).toBe(topic!.summary);
        }
        expect(graph.edges.map((edge) => edge.type).sort()).toEqual([
            "parent",
            "related",
        ]);
        const topicState = await service["viewStore"].getTopicState(corpusId);
        await service["viewStore"].saveTopicFamily(corpusId, {
            ...topicState.family,
            enabled: false,
        });
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: graph.generation,
                nodeId: graph.nodes[0].id,
            }),
        ).rejects.toThrow("generation");
        const committed = await ready({ corpusId, kind: "hierarchy" });
        expect(committed.generation).not.toBe(graph.generation);
        expect(committed.nodes).toEqual(graph.nodes);
        const filtered = await service.queryKnowledgeGraph({
            corpusId,
            kind: "hierarchy",
            evidenceKinds: ["document"],
        });
        expect(filtered.nodes).toEqual([]);
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "topics",
            operation: "pause",
        });
        await event(corpusId, "next");
        expect((await service.queryTopics({ corpusId })).nodes).toEqual([]);
        expect(
            (await service.queryKnowledgeGraph({ corpusId, kind: "hierarchy" }))
                .state,
        ).toBe("stale");
        await service.forgetEvents({
            corpusId,
            eventIds: [appended.event.eventId],
        });
        expect((await service.queryTopics({ corpusId })).nodes).toEqual([]);
        expect(
            (await service.queryKnowledgeGraph({ corpusId, kind: "hierarchy" }))
                .nodes,
        ).toEqual([]);
        await service.close();
        async function contents(root: string): Promise<string> {
            let result = "";
            for (const entry of await readdir(root, { withFileTypes: true })) {
                const file = path.join(root, entry.name);
                result += entry.isDirectory()
                    ? await contents(file)
                    : await readFile(file, "utf8");
            }
            return result;
        }
        expect(await contents(path.join(directory, corpusId))).not.toContain(
            "PRIVATE-topic",
        );
        service = open();
        expect((await service.queryTopics({ corpusId })).nodes).toEqual([]);
        expect(eventBuilds).toBe(1);
    });
    test("suppressed document influence is excluded before counts and corpus IDs never collide", async () => {
        const corpusId = await corpus();
        await document(corpusId);
        await event(corpusId, "retained");
        const graph = await ready({ corpusId, kind: "entities" });
        await service.suppressSourceKnowledge({
            corpusId,
            sourceId: "document",
            kind: "entity",
            name: "Zephyr",
        });
        const suppressed = await ready({ corpusId, kind: "entities" });
        expect(
            suppressed.nodes.find((node) => node.label === "Zephyr")
                ?.mentionCount,
        ).toBe(3);
        expect(suppressed.coverage.documents.eligible).toBe(1);
        expect(
            suppressed.nodes.find((node) => node.label === "Queue")
                ?.mentionCount,
        ).toBe(2);
        const other = await corpus();
        await document(other);
        const second = await ready({ corpusId: other, kind: "entities" });
        expect(second.nodes[0].id).not.toBe(graph.nodes[0].id);
        await expect(
            service.queryKnowledgeGraph({
                corpusId,
                kind: "entities",
                maxNodes: 251,
            }),
        ).rejects.toThrow("limit");
        await expect(
            service.queryGraphSupport({
                corpusId,
                generation: graph.generation,
                nodeId: graph.nodes[0].id,
                pageSize: 51,
            }),
        ).rejects.toThrow("limit");
    });
});
