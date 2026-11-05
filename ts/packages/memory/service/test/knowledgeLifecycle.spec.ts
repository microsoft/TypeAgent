// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { hydrateSchemaAnswers } from "../src/schemaViewSynthesis.js";
import type { ViewSynthesisAdapter } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";

test.each([
    { producerComplete: false, candidateCount: 45 },
    { producerComplete: true, candidateCount: 45 },
    { producerComplete: false, candidateCount: 49 },
    { producerComplete: true, candidateCount: 49 },
])(
    "producerComplete=$producerComplete controls $candidateCount subjects beyond three bounded passes",
    async ({ producerComplete, candidateCount }) => {
        class PagedPurposeIndex extends FakeSemanticCorpusIndex {
            async listSubjects(offset: number, limit = 100) {
                return {
                    total: candidateCount,
                    items: Array.from({ length: candidateCount }, (_, i) => ({
                        term: `Reference ${i}`,
                        postingCount: 1,
                        sourceIds: ["source"],
                    })).slice(offset, offset + limit),
                    ...(offset + limit < candidateCount
                        ? { nextContinuationToken: String(offset + limit) }
                        : {}),
                };
            }
            override async getKnowledgeGraph() {
                const { items } = await this.listSubjects(0);
                return {
                    entities: [],
                    relationships: [],
                    topics: items.map((subject) => ({
                        name: subject.term,
                        sourceIds: subject.sourceIds,
                        mentionCount: 1,
                    })),
                };
            }
            async readFragments() {
                const document = this.documents[0];
                return {
                    fragments: [
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            snippet: document.content,
                            locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
                            score: 1,
                        },
                    ],
                    readChars: document.content.length,
                    limited: false,
                };
            }
        }
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-checkpoint-pages-"),
        );
        const assessed: string[] = [];
        const service = new FileMemoryService(root, {
            maintenanceMode: "manual",
            sourceSynopses: false,
            indexFactory: (_corpusId, directory) =>
                new PagedPurposeIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-deferred-pages",
                generate: async () => {
                    throw new Error(
                        "Low-utility candidates must not generate prose",
                    );
                },
                validate: async () => {
                    throw new Error(
                        "Low-utility candidates must not validate generated prose",
                    );
                },
                assessWikiSubject: async (input) => {
                    assessed.push(input.definition.wiki!.query);
                    return {
                        disposition: "defer",
                        purpose: "Passing reference",
                        reason: "A passing mention cannot support a substantive article.",
                        canonicalViewId: "",
                        sharedFragmentIds: [],
                        essentialDistinctions: [],
                        ambiguousViewIds: [],
                    };
                },
            },
        });
        try {
            const { corpusId } = await service.createCorpus(
                "Bounded page continuation",
            );
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "source",
                    sourceType: "text",
                    title: "References",
                    text: `Passing mentions only: ${Array.from(
                        { length: candidateCount },
                        (_, i) => `Reference ${i}`,
                    ).join(", ")}.`,
                },
            });
            expect(
                (await waitForMemoryJob(service, admitted.jobId)).state,
            ).toBe("complete");
            const checkpoint = await service.createKnowledgeCheckpoint({
                corpusId,
                families: ["wiki"],
                producerComplete,
                timeoutMs: 60000,
            });
            const done = await service.waitForKnowledgeCheckpoint({
                corpusId,
                checkpointId: checkpoint.checkpointId,
                timeoutMs: 60000,
            });
            expect(done.state).toBe(producerComplete ? "ready" : "partial");
            expect(done.jobIds).toHaveLength(
                producerComplete ? Math.ceil(candidateCount / 12) : 3,
            );
            expect(done.viewIds).toEqual([]);
            expect((await service.listViews(corpusId)).views).toEqual([]);
            expect(assessed).toHaveLength(
                producerComplete ? candidateCount : 36,
            );
            expect(new Set(assessed).size).toBe(assessed.length);
            if (producerComplete && candidateCount === 45) {
                const unchanged = await service.maintainViews({
                    corpusId,
                    expectedHead: (await service.listViews(corpusId)).head,
                    family: "wiki",
                    operation: "update",
                });
                expect(unchanged.job).toBeUndefined();
                expect(assessed).toHaveLength(candidateCount);
                const changed = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId: "source",
                        sourceType: "text",
                        title: "Updated references",
                        text: `Updated passing mentions: ${assessed.join(", ")}.`,
                    },
                });
                expect(
                    (await waitForMemoryJob(service, changed.jobId)).state,
                ).toBe("complete");
                const refreshed = await service.createKnowledgeCheckpoint({
                    corpusId,
                    families: ["wiki"],
                    producerComplete: true,
                    timeoutMs: 60000,
                });
                expect(
                    (
                        await service.waitForKnowledgeCheckpoint({
                            corpusId,
                            checkpointId: refreshed.checkpointId,
                            timeoutMs: 60000,
                        })
                    ).state,
                ).toBe("ready");
                expect(assessed).toHaveLength(candidateCount * 2);
                expect(new Set(assessed.slice(candidateCount)).size).toBe(
                    candidateCount,
                );
            }
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    90000,
);

test.each([
    { builds: 1, topicFailure: false, changeSource: false },
    { builds: 2, topicFailure: false, changeSource: false },
    { builds: 2, topicFailure: true, changeSource: false },
    { builds: 2, topicFailure: false, changeSource: true },
])(
    "checkpoint topic/page overlap builds=$builds failure=$topicFailure sourceChange=$changeSource",
    async ({ builds, topicFailure, changeSource }) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-checkpoint-overlap-"),
        );
        const latch = () => {
            let release!: () => void;
            const promise = new Promise<void>((resolve) => {
                release = resolve;
            });
            return { promise, release };
        };
        const wikiStarted = latch();
        const topicStarted = latch();
        const wikiGate = latch();
        const topicGate = latch();
        let topicEntered = false;
        class OverlapIndex extends FakeSemanticCorpusIndex {
            async listSubjects() {
                return {
                    total: 1,
                    items: [
                        {
                            term: "Harbor rollout",
                            postingCount: 1,
                            sourceIds: ["source"],
                        },
                    ],
                };
            }
            override async getKnowledgeGraph() {
                return {
                    entities: [],
                    relationships: [],
                    topics: [
                        {
                            name: "Harbor rollout",
                            sourceIds: ["source"],
                            mentionCount: 1,
                        },
                    ],
                };
            }
            async readFragments() {
                const document = this.documents[0];
                return {
                    fragments: [
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            snippet: document.content,
                            locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
                            score: 1,
                        },
                    ],
                    readChars: document.content.length,
                    limited: false,
                };
            }
            async getTopicOccurrences() {
                return this.documents.map((document) =>
                    indexedTopicOccurrence(
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            blockOrdinal: 0,
                            text: document.content,
                            score: 1,
                        },
                        "Harbor rollout",
                        0,
                    ),
                );
            }
        }
        const service = new FileMemoryService(root, {
            maintenanceMode: "manual",
            sourceSynopses: false,
            maintenanceConcurrency: { builds },
            indexFactory: (_corpusId, directory) => new OverlapIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-independent-topics",
                generate: async () => {
                    throw new Error("Sparse evidence must not generate prose");
                },
                validate: async () => {
                    throw new Error("Sparse evidence must not validate prose");
                },
                assessWikiSubject: async (_input, _pages, signal) => {
                    wikiStarted.release();
                    await wikiGate.promise;
                    signal.throwIfAborted();
                    return {
                        disposition: "defer",
                        deferBasis: "evidence",
                        purpose: "Passing reference",
                        reason: "Insufficient standalone utility",
                        canonicalViewId: "",
                        sharedFragmentIds: [],
                        essentialDistinctions: [],
                        ambiguousViewIds: [],
                    };
                },
                generateTopics: async (input, signal) => {
                    topicEntered = true;
                    topicStarted.release();
                    await topicGate.promise;
                    signal.throwIfAborted();
                    if (topicFailure)
                        throw new Error("TOPIC_ORGANIZATION_FAILED");
                    return createTopicSnapshot(input, input.model);
                },
            },
        });
        try {
            const { corpusId } = await service.createCorpus("Overlap");
            const source = {
                sourceId: "source",
                sourceType: "text" as const,
                title: "Harbor rollout",
                text: "Harbor rollout is mentioned in passing.",
            };
            const ingest = await service.ingestDocument({ corpusId, source });
            await waitForMemoryJob(service, ingest.jobId);
            const checkpoint = await service.createKnowledgeCheckpoint({
                corpusId,
                families: ["wiki", "topics"],
                producerComplete: true,
                timeoutMs: 20000,
            });
            await wikiStarted.promise;
            if (builds === 1) {
                expect(topicEntered).toBe(false);
                wikiGate.release();
            }
            await topicStarted.promise;
            if (builds === 2) {
                const jobs = await service.listViewBuilds(corpusId);
                expect(
                    jobs.filter((job) => job.state === "running"),
                ).toHaveLength(2);
            }
            if (changeSource) {
                const changed = await service.ingestDocument({
                    corpusId,
                    source: {
                        ...source,
                        text: "Harbor rollout now has a new scope.",
                    },
                });
                await waitForMemoryJob(service, changed.jobId);
            }
            wikiGate.release();
            topicGate.release();
            const done = await service.waitForKnowledgeCheckpoint({
                corpusId,
                checkpointId: checkpoint.checkpointId,
                timeoutMs: 20000,
            });
            expect(done.state).toBe(
                changeSource ? "superseded" : topicFailure ? "failed" : "ready",
            );
            if (topicFailure)
                expect(
                    done.requiredFailures?.some(
                        (failure) =>
                            failure.family === "topics" &&
                            failure.reasons.some((reason) =>
                                reason.includes("TOPIC_ORGANIZATION_FAILED"),
                            ),
                    ),
                ).toBe(true);
            if (!changeSource && !topicFailure)
                expect(done.jobIds).toHaveLength(2);
            expect((await service.listViews(corpusId)).views).toEqual([]);
        } finally {
            wikiGate.release();
            topicGate.release();
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
    30000,
);

describe("source-only knowledge bootstrap lifecycle", () => {
    let root: string;
    let service: FileMemoryService;
    let discoveryCalls: number;
    let adapter: ViewSynthesisAdapter;
    let beforeRebuild: (() => Promise<void>) | undefined;
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-knowledge-"));
        discoveryCalls = 0;
        beforeRebuild = undefined;
        adapter = {
            identity: "offline-knowledge-v1",
            discoverCorpusQuestions: async (input) => {
                discoveryCalls++;
                if (input.passages.every((p) => p.excerpt === "Hello."))
                    return [];
                const passage = input.passages[0];
                return [
                    {
                        subject: "Harbor rollout",
                        reason: "A named project has an explicitly reported leader",
                        slot: {
                            id: "lead",
                            question: "Who leads the Harbor rollout?",
                            cardinality: "singleton",
                            schema: { type: "string" },
                            rubric: {
                                version: 1,
                                selection: "mostRecent",
                                requireConfirmation: true,
                                authoritySourceIds: [],
                            },
                            approval: "proposed",
                            discoveryCitations: [
                                {
                                    sourceId: passage.sourceId,
                                    revisionId: passage.revisionId,
                                    locator: passage.locator,
                                    excerpt: passage.excerpt,
                                },
                            ],
                        },
                    },
                ];
            },
            generate: async (input) =>
                hydrateSchemaAnswers(input, {
                    answers:
                        input.definition.schemaView?.slots
                            .filter((slot) => slot.approval === "approved")
                            .map((slot) => ({
                                slotId: slot.id,
                                candidates: [
                                    {
                                        valueJson: JSON.stringify("Morgan"),
                                        effectiveAt: "",
                                        passageIds: ["p0-0"],
                                        opposingPassageIds: [],
                                    },
                                ],
                            })) ?? [],
                }),
            validate: async (_input, output) => ({
                supported: true,
                missingContext: [],
                reasons: [],
                sections: output.content.sections.map((section) => ({
                    sectionId: section.id,
                    supported: true,
                    reason: "Offline original-source fixture",
                })),
                relationships: output.relationships.map((edge) => ({
                    edgeId: edge.id,
                    supported: true,
                    reason: "Offline exact citation fixture",
                })),
            }),
        };
        service = makeService();
    });
    function makeService() {
        return new FileMemoryService(root, {
            sourceSynopses: false,
            informationalViews: false,
            viewSynthesisAdapter: adapter,
            indexFactory: (_corpusId, directory) => {
                const index = new FakeSemanticCorpusIndex(directory);
                const rebuild = index.rebuild.bind(index);
                index.rebuild = async (documents) => {
                    await beforeRebuild?.();
                    await rebuild(documents);
                };
                return index;
            },
        });
    }
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(text = "Morgan leads the Harbor rollout.") {
        const corpus = await service.createCorpus("Content-only fixture");
        const admitted = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Project discussion",
                text,
            },
        });
        await waitForMemoryJob(service, admitted.jobId);
        return corpus;
    }
    async function prepare(corpusId: string) {
        const checkpoint = await service.createKnowledgeCheckpoint({
            corpusId,
            families: ["questions"],
            producerComplete: true,
        });
        return service.waitForKnowledgeCheckpoint({
            corpusId,
            checkpointId: checkpoint.checkpointId,
            timeoutMs: 15000,
        });
    }

    test("failed required questions are actionable while independent topic work and ordinary waits continue", async () => {
        await service.close();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let topicCompleted = false;
        class TopicIndex extends FakeSemanticCorpusIndex {
            async getTopicOccurrences(sourceIds: ReadonlySet<string>) {
                return this.documents
                    .filter((document) =>
                        sourceIds.has(document.source.sourceId),
                    )
                    .map((document) =>
                        indexedTopicOccurrence(
                            {
                                sourceId: document.source.sourceId,
                                revisionId: document.revision.revisionId,
                                blockOrdinal: 0,
                                text: document.content,
                                score: 1,
                            },
                            "Harbor rollout",
                            0,
                        ),
                    );
            }
        }
        service = new FileMemoryService(root, {
            maintenanceMode: "manual",
            sourceSynopses: false,
            viewSynthesisAdapter: {
                ...adapter,
                generate: async () => {
                    throw new Error("QUESTION_SELECTION_FAILED");
                },
                generateTopics: async (input, signal) => {
                    entered();
                    await gate;
                    signal.throwIfAborted();
                    const snapshot = createTopicSnapshot(input, input.model);
                    for (const node of snapshot.nodes) {
                        node.summary = node.citations[0].excerpt;
                        node.citations = node.citations.slice(0, 1);
                        node.summaryState = "ready";
                    }
                    topicCompleted = true;
                    return snapshot;
                },
            },
            indexFactory: (_corpusId, directory) => new TopicIndex(directory),
        });
        try {
            const { corpusId } = await ingest();
            const checkpoint = await service.createKnowledgeCheckpoint({
                corpusId,
                families: ["questions", "topics"],
                producerComplete: true,
                timeoutMs: 15000,
            });
            const request = {
                corpusId,
                checkpointId: checkpoint.checkpointId,
                timeoutMs: 15000,
            };
            const early = await service.waitForKnowledgeCheckpoint({
                ...request,
                failOnRequiredFailure: true,
            });
            expect(early.state).toBe("running");
            expect(early.requiredFailures?.[0].family).toBe("questions");
            expect(early.requiredFailures?.[0].reasons.join("; ")).toContain(
                "QUESTION_SELECTION_FAILED",
            );
            await started;
            let ordinaryReturned = false;
            const ordinary = service
                .waitForKnowledgeCheckpoint(request)
                .then((value) => {
                    ordinaryReturned = true;
                    return value;
                });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(ordinaryReturned).toBe(false);
            expect(topicCompleted).toBe(false);
            release();
            const done = await ordinary;
            expect(topicCompleted).toBe(true);
            expect(done.state).toBe("failed");
            expect(done.reasons.join("; ")).toContain(
                "QUESTION_SELECTION_FAILED",
            );
            expect(done.requiredFailures?.[0].jobIds).toHaveLength(1);
        } finally {
            release();
        }
    });

    test("standalone ingestion defers discovery until the ingestion queue becomes idle", async () => {
        const corpus = await ingest("Hello.");
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        beforeRebuild = async () => {
            entered();
            await gate;
        };
        try {
            const admitted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "second",
                    sourceType: "text",
                    title: "Another greeting",
                    text: "Hello.",
                },
            });
            await started;
            await new Promise((resolve) => setTimeout(resolve, 2200));
            expect(discoveryCalls).toBe(0);
            release();
            expect(
                (await waitForMemoryJob(service, admitted.jobId)).state,
            ).toBe("complete");
            const deadline = Date.now() + 10000;
            while (!discoveryCalls && Date.now() < deadline)
                await new Promise((resolve) => setTimeout(resolve, 20));
            expect(discoveryCalls).toBeGreaterThan(0);
        } finally {
            release();
        }
    }, 30000);

    test("first source yields a maintained unreviewed answer and published view without an artifact", async () => {
        const corpus = await ingest();
        expect(
            (await service.getKnowledgeStatus(corpus.corpusId)).discovery
                .policy,
        ).toBe("sourceObserved");
        const checkpoint = await prepare(corpus.corpusId);
        expect(checkpoint.reasons).toEqual([]);
        expect(checkpoint.state).toBe("ready");
        const inventory = await service.listQuestions(corpus.corpusId);
        expect(inventory.items).toHaveLength(1);
        expect(inventory.items[0].slot.question).toBe(
            "Who leads the Harbor rollout?",
        );
        expect(inventory.items[0].slot.approval).toBe("approved");
        expect(inventory.items[0].details.reviewState).toBe("unreviewed");
        expect(inventory.items[0].details.answerState).toBe("answered");
        expect(
            inventory.items[0].details.candidates[0].citations[0].sourceId,
        ).toBe("source");
        expect(
            (
                await service.searchViews({
                    corpusId: corpus.corpusId,
                    query: "Morgan",
                    freshness: "current",
                })
            ).length,
        ).toBeGreaterThan(0);
    }, 30000);

    test("running checkpoints persist admitted build IDs before generation finishes", async () => {
        const generate = adapter.generate;
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        adapter.generate = async (...args) => {
            enter();
            await gate;
            return generate(...args);
        };
        try {
            const corpus = await ingest();
            const checkpoint = await service.createKnowledgeCheckpoint({
                corpusId: corpus.corpusId,
                families: ["questions"],
                producerComplete: true,
            });
            await entered;
            let running = await service.getKnowledgeCheckpoint({
                corpusId: corpus.corpusId,
                checkpointId: checkpoint.checkpointId,
            });
            const deadline = Date.now() + 5000;
            while (!running.jobIds.length && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                running = await service.getKnowledgeCheckpoint({
                    corpusId: corpus.corpusId,
                    checkpointId: checkpoint.checkpointId,
                });
            }
            expect(running.state).toBe("running");
            expect(running.jobIds).toHaveLength(1);
            expect(running.viewIds).toHaveLength(1);
            release();
            const ready = await service.waitForKnowledgeCheckpoint({
                corpusId: corpus.corpusId,
                checkpointId: checkpoint.checkpointId,
                timeoutMs: 15000,
            });
            expect(ready.state).toBe("ready");
            expect(ready.jobIds).toEqual(running.jobIds);
        } finally {
            release();
        }
    }, 30000);

    test("question-only checkpoints do not include an overlapping excluded-family build", async () => {
        const corpus = await ingest();
        await prepare(corpus.corpusId);
        const unrelated = structuredClone(
            (await service.listViewBuilds(corpus.corpusId))[0],
        );
        unrelated.state = "running";
        unrelated.results[0].snapshot.pipeline = "topics-v1";
        service.listViewBuilds = async () => [unrelated];
        const checkpoint = await prepare(corpus.corpusId);
        expect(checkpoint.state).toBe("ready");
        expect(checkpoint.excludedFamilies).toContain("topics");
        expect(checkpoint.jobIds).not.toContain(unrelated.jobId);
    }, 30000);

    test("a stale joined build cannot poison current successfully maintained questions", async () => {
        const corpus = await ingest();
        await prepare(corpus.corpusId);
        const joined = structuredClone(
            (await service.listViewBuilds(corpus.corpusId))[0],
        );
        joined.jobId = "superseded-prior-job";
        joined.state = "running";
        const finished = structuredClone(joined);
        finished.state = "failed";
        finished.results = finished.results.map((result) => ({
            ...result,
            state: "stale",
            reason: "A newer question build superseded this job",
        }));
        service.listViewBuilds = async () => [joined];
        const getViewBuild = service.getViewBuild.bind(service);
        service.getViewBuild = async (request) =>
            request.jobId === joined.jobId ? finished : getViewBuild(request);
        const checkpoint = await prepare(corpus.corpusId);
        expect(checkpoint.state).toBe("ready");
        expect(checkpoint.requiredFailures).toBeUndefined();
        expect(checkpoint.reasons).toEqual([]);
    }, 30000);

    test("checkpoint status pins maintained revisions and expires after a question edit", async () => {
        const corpus = await ingest();
        const checkpoint = await prepare(corpus.corpusId);
        const inventory = await service.listQuestions(corpus.corpusId);
        const question = inventory.items[0];
        expect(checkpoint.viewRevisions?.map((view) => view.viewId)).toContain(
            question.viewId,
        );
        await service.editQuestion({
            corpusId: corpus.corpusId,
            viewId: question.viewId,
            slotId: question.slot.id,
            expectedHead: inventory.head,
            expectedVersion: question.viewVersion,
            edit: { kind: "approval", approval: "proposed" },
        });
        expect(
            (await service.getKnowledgeStatus(corpus.corpusId)).checkpoints[0]
                .state,
        ).toBe("superseded");
    }, 30000);

    test("a persisted zero-proposal result survives restart without another inference", async () => {
        const corpus = await ingest("Hello.");
        expect((await prepare(corpus.corpusId)).state).toBe("ready");
        expect((await service.listQuestions(corpus.corpusId)).items).toEqual(
            [],
        );
        expect(discoveryCalls).toBe(1);
        await service.close();
        service = makeService();
        expect((await prepare(corpus.corpusId)).state).toBe("ready");
        expect(discoveryCalls).toBe(1);
    }, 30000);

    test("suggest policy preserves proposed contracts rather than confirming facts", async () => {
        const corpus = await service.createCorpus("Content-only fixture");
        await service.updateKnowledgeDiscovery({
            corpusId: corpus.corpusId,
            policy: "suggest",
        });
        await ingest();
        await prepare(corpus.corpusId);
        const inventory = await service.listQuestions(corpus.corpusId);
        expect(inventory.items).toHaveLength(1);
        expect(inventory.items[0].slot.approval).toBe("proposed");
        expect(inventory.items[0].details.selectedCandidateIds).toEqual([]);
        expect(inventory.items[0].details.reviewState).not.toBe("confirmed");
    }, 30000);

    test("forget purges discovery influence and supersedes the captured checkpoint", async () => {
        const corpus = await ingest();
        const checkpoint = await prepare(corpus.corpusId);
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "source",
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: "source",
            confirmationToken: preview.confirmationToken,
        });
        const status = await service.getKnowledgeStatus(corpus.corpusId);
        expect(status.discovery.receipts).toEqual([]);
        expect(status.discovery.routes).toEqual([]);
        const captured = await service.getKnowledgeCheckpoint({
            corpusId: corpus.corpusId,
            checkpointId: checkpoint.checkpointId,
        });
        expect(captured.state).toBe("superseded");
        expect(captured.sources).toEqual([]);
        expect((await service.listQuestions(corpus.corpusId)).items).toEqual(
            [],
        );
    }, 30000);
});
