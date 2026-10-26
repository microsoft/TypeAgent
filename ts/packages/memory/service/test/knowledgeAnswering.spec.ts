// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    indexedLocator,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "../src/indexedFragments.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { hydrateSchemaAnswers } from "../src/schemaViewSynthesis.js";
import type { AnswerEvidence, IndexedFragmentRequest } from "../src/types.js";
import type { ViewBuildJob, ViewSynthesisAdapter } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

class AnsweringIndexedCorpus extends FakeSemanticCorpusIndex {
    public async readFragments(request: IndexedFragmentRequest) {
        const terms = request.terms.flatMap(
            (term) => term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [],
        );
        return selectIndexedFragments(
            this.documents
                .filter((document) =>
                    terms.some((term) =>
                        document.content.toLocaleLowerCase().includes(term),
                    ),
                )
                .map(
                    (document): IndexedBlock => ({
                        sourceId: document.source.sourceId,
                        revisionId: document.revision.revisionId,
                        blockOrdinal: 0,
                        text: document.content,
                        score: 1,
                    }),
                ),
            request,
        );
    }

    public async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ) {
        const range = parseIndexedLocator(locator);
        const document = this.documents.find(
            (item) =>
                item.source.sourceId === sourceId &&
                item.revision.revisionId === revisionId,
        );
        if (
            !document ||
            locator !==
                indexedLocator(
                    {
                        sourceId,
                        revisionId,
                        blockOrdinal: 0,
                        text: document.content,
                        score: 1,
                    },
                    range.start,
                    range.end,
                )
        )
            throw new Error("Exact original indexed passage is unavailable");
        return document.content.slice(range.start, range.end);
    }
}

describe("service source-plus-view answer integration", () => {
    let root: string;
    let service: FileMemoryService;
    let readerInputs: AnswerEvidence[][];
    let discoveryGate: Promise<void> | undefined;
    let discoveryStarted: (() => void) | undefined;

    beforeEach(async () => {
        root = path.resolve(".knowledge-answer-unit-owned", randomUUID());
        await mkdir(root, { recursive: true });
        readerInputs = [];
        discoveryGate = undefined;
        discoveryStarted = undefined;
        const model: ChatModel = {
            completionSettings: {},
            complete: async (prompt) => {
                if (typeof prompt === "string")
                    throw new Error("Reader must receive structured messages");
                const content = prompt[prompt.length - 1].content;
                if (typeof content !== "string")
                    throw new Error("Reader must receive serialized evidence");
                const input = JSON.parse(content) as {
                    evidence: AnswerEvidence[];
                };
                readerInputs.push(input.evidence);
                return {
                    success: true,
                    data: JSON.stringify({
                        status: "answered",
                        answer: "Morgan leads the Harbor rollout; owner approval remains pending.",
                        evidenceIds: input.evidence.map((item) => item.id),
                    }),
                };
            },
        };
        const adapter: ViewSynthesisAdapter = {
            identity: "offline-integrated-answer-fixture-v1",
            discoverCorpusQuestions: async () => {
                discoveryStarted?.();
                await discoveryGate;
                return [];
            },
            generate: async (input) =>
                hydrateSchemaAnswers(input, {
                    answers: input.definition.schemaView!.slots.map((slot) => ({
                        slotId: slot.id,
                        candidates: [
                            {
                                valueJson: JSON.stringify("Morgan"),
                                effectiveAt: "",
                                passageIds: ["p0-0"],
                                opposingPassageIds: [],
                            },
                        ],
                    })),
                }),
            validate: async (_input, output) => ({
                supported: true,
                missingContext: [],
                reasons: [],
                sections: output.content.sections.map((section) => ({
                    sectionId: section.id,
                    supported: true,
                    reason: "Offline original-source evidence fixture",
                })),
                relationships: output.relationships.map((edge) => ({
                    edgeId: edge.id,
                    supported: true,
                    reason: "Offline exact-source citation fixture",
                })),
            }),
        };
        service = new FileMemoryService(root, {
            discoveryPolicy: "off",
            informationalViews: false,
            sourceSynopses: false,
            indexedAnswerModel: model,
            viewSynthesisAdapter: adapter,
            indexFactory: (_corpusId, directory) =>
                new AnsweringIndexedCorpus(directory),
        });
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function ingest(corpusId: string, sourceId: string, text: string) {
        const receipt = await service.ingestDocument({
            corpusId,
            source: { sourceId, sourceType: "text", title: sourceId, text },
        });
        expect((await waitForMemoryJob(service, receipt.jobId)).state).toBe(
            "complete",
        );
        return receipt;
    }

    async function settleBuild(job: ViewBuildJob) {
        for (let attempt = 0; attempt < 300; attempt++) {
            const current = (await service.getViewBuild({
                corpusId: job.corpusId,
                jobId: job.jobId,
            }))!;
            if (current.state !== "running") {
                expect(current.results.map((result) => result.reason)).toEqual(
                    expect.not.arrayContaining([
                        expect.stringMatching(/failed|unsupported|conflict/i),
                    ]),
                );
                expect(current.state).toBe("complete");
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Offline schema build did not finish");
    }

    test("published derived state and exact original support reach the real service reader", async () => {
        const { corpusId } = await service.createCorpus(
            "Published Harbor question",
        );
        const text =
            "Morgan leads the Harbor rollout. Owner approval remains pending.";
        const receipt = await ingest(corpusId, "captured", text);
        await settleBuild(
            await service.buildViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                publication: false,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "harbor-lead",
                            kind: "schemaView",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: receipt.sourceId,
                                        revisionId: receipt.revisionId,
                                    },
                                ],
                            },
                            schemaView: {
                                construction: "schema-defined-v1",
                                title: "Harbor rollout leader",
                                template: "questions-v1",
                                discovery: { enabled: false, maxProposals: 0 },
                                slots: [
                                    {
                                        id: "lead",
                                        question:
                                            "Who leads the Harbor rollout?",
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
                                    },
                                ],
                            },
                        },
                    },
                ],
            }),
        );
        const inventory = await service.listViews(corpusId);
        const current = inventory.views.find(
            (view) => view.viewId === "harbor-lead",
        )!;
        await service.publishView({
            corpusId,
            viewId: current.viewId,
            revisionId: current.revisionId,
            expectedVersion: current.version,
            expectedHead: inventory.head!,
        });
        expect(
            (
                await service.getViewPublication({
                    corpusId,
                    viewId: current.viewId,
                })
            )?.indexState,
        ).toBe("ready");

        const result = await service.answer({
            corpusId,
            question: "Harbor",
            retrievalPolicy: "sourcesAndViews",
            includeDiagnostics: true,
        });
        expect(readerInputs).toHaveLength(1);
        const derived = readerInputs[0].find((item) => item.kind === "derived");
        expect(derived).toMatchObject({
            kind: "derived",
            selectedValue: "Morgan",
            reference: {
                viewId: current.viewId,
                revisionId: current.revisionId,
                sectionId: "lead",
                state: "selected",
            },
        });
        if (!derived || derived.kind !== "derived")
            throw new Error(
                "Published derived evidence did not reach the reader",
            );
        expect(derived.supportingEvidenceIds.length).toBeGreaterThan(0);
        for (const id of derived.supportingEvidenceIds) {
            const original = readerInputs[0].find((item) => item.id === id);
            expect(original).toMatchObject({
                kind: "source",
                source: {
                    sourceId: "captured",
                    revisionId: receipt.revisionId,
                    snippet: text,
                },
            });
            if (original?.kind !== "source")
                throw new Error("Original support missing");
            expect(original.source.locator).toMatch(/^(chars:|indexed:)/);
            expect(result.citations).toContainEqual(original.source);
        }
        expect(result.derivedReferences).toContainEqual(derived.reference);
        expect(
            result.readerContext?.integratedAnswer?.suppliedEvidence,
        ).toEqual(readerInputs[0]);
        expect(result.warnings).toEqual([]);
    }, 30000);

    test("a required checkpoint rejects answering while captured discovery is still running", async () => {
        const { corpusId } = await service.createCorpus(
            "Pending Harbor checkpoint",
        );
        await ingest(corpusId, "captured", "Morgan leads the Harbor rollout.");
        let release!: () => void;
        let markStarted!: () => void;
        discoveryGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        discoveryStarted = markStarted;
        try {
            await service.updateKnowledgeDiscovery({
                corpusId,
                policy: "sourceObserved",
            });
            const checkpoint = await service.createKnowledgeCheckpoint({
                corpusId,
                sourceIds: ["captured"],
                families: ["questions"],
                producerComplete: true,
            });
            await started;
            expect(
                (
                    await service.getKnowledgeCheckpoint({
                        corpusId,
                        checkpointId: checkpoint.checkpointId,
                    })
                ).state,
            ).toBe("running");
            await expect(
                service.answer({
                    corpusId,
                    question: "Harbor",
                    knowledgeCheckpointId: checkpoint.checkpointId,
                }),
            ).rejects.toThrow("Knowledge checkpoint is not ready: running");
            expect(readerInputs).toEqual([]);
            release();
            expect(
                (
                    await service.waitForKnowledgeCheckpoint({
                        corpusId,
                        checkpointId: checkpoint.checkpointId,
                        timeoutMs: 15000,
                    })
                ).state,
            ).toBe("ready");
        } finally {
            release();
        }
    }, 30000);

    test("a ready checkpoint scopes reader evidence to its captured sources and rejects widening", async () => {
        const { corpusId } = await service.createCorpus(
            "Captured Harbor scope",
        );
        await ingest(corpusId, "captured", "Morgan leads the Harbor rollout.");
        await service.updateKnowledgeDiscovery({
            corpusId,
            policy: "sourceObserved",
        });
        const admitted = await service.createKnowledgeCheckpoint({
            corpusId,
            sourceIds: ["captured"],
            families: ["questions"],
            producerComplete: true,
        });
        const checkpoint = await service.waitForKnowledgeCheckpoint({
            corpusId,
            checkpointId: admitted.checkpointId,
            timeoutMs: 15000,
        });
        expect(checkpoint.state).toBe("ready");
        expect(checkpoint.sources.map((source) => source.sourceId)).toEqual([
            "captured",
        ]);
        await service.updateKnowledgeDiscovery({ corpusId, policy: "off" });
        await ingest(
            corpusId,
            "later",
            "Harbor later-only confidential qualification.",
        );

        const result = await service.answer({
            corpusId,
            question: "Harbor",
            retrievalPolicy: "sourcesAndViews",
            knowledgeCheckpointId: checkpoint.checkpointId,
            includeDiagnostics: true,
        });
        expect(readerInputs).toHaveLength(1);
        expect(
            readerInputs[0].flatMap((item) =>
                item.kind === "source" ? [item.source.sourceId] : [],
            ),
        ).toEqual(["captured"]);
        expect(JSON.stringify(readerInputs[0])).not.toContain("later-only");
        expect(result.citations.map((source) => source.sourceId)).toEqual([
            "captured",
        ]);
        expect(
            result.readerContext?.integratedAnswer?.sourceSelection
                ?.eligibleSourceIds,
        ).toEqual(["captured"]);
        await expect(
            service.answer({
                corpusId,
                question: "Harbor",
                knowledgeCheckpointId: checkpoint.checkpointId,
                sourceIds: ["later"],
            }),
        ).rejects.toThrow(
            "Answer source scope exceeds its knowledge checkpoint",
        );
        expect(readerInputs).toHaveLength(1);
    }, 30000);
});
