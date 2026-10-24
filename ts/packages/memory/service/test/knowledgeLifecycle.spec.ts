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

describe("source-only knowledge bootstrap lifecycle", () => {
    let root: string;
    let service: FileMemoryService;
    let discoveryCalls: number;
    let adapter: ViewSynthesisAdapter;
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-knowledge-"));
        discoveryCalls = 0;
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
            indexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
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
