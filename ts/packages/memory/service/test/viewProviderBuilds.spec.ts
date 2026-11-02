// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import {
    viewProviderOutput,
    type HostViewProvider,
    type ViewProviderDocument,
} from "../src/viewProviders.js";
import type { ViewBuildJob, ViewBuildRequest } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("managed host-defined views", () => {
    let root: string;
    let service: FileMemoryService;
    let allowed: boolean;
    let approved: boolean;
    let completions: number;
    let authorizedOperations: string[];
    let modelFailure: boolean;
    let constructCalls: number;
    let modelGate: Promise<void> | undefined;
    let modelStarted: (() => void) | undefined;
    let deniedObserved: (() => void) | undefined;
    let failAfterCheckpoint: boolean;
    let reuseCheckpoint: boolean;

    function installed(): HostViewProvider {
        return {
            identity: {
                id: "fixture.explanation",
                version: "1",
                implementationSha256: "a".repeat(64),
                schemaSha256: "b".repeat(64),
            },
            validateInput(input) {
                if (input.inputs.length !== 1)
                    throw new Error("The fixture requires one exact source");
            },
            validateDocument(document) {
                if (document.title !== "Lookup assessment")
                    throw new Error("Unexpected fixture content");
            },
            async construct(context) {
                constructCalls++;
                expect(context.modelIdentity).toBe("offline-model-v1");
                const saved = context.previous.explanation;
                const response =
                    saved &&
                    typeof saved === "object" &&
                    !Array.isArray(saved) &&
                    typeof saved.response === "string"
                        ? saved.response
                        : undefined;
                const completion =
                    reuseCheckpoint && response
                        ? { success: true as const, data: response }
                        : await context.complete(
                              "explanation",
                              "Explain the committed lookup result.",
                          );
                if (!completion.success) throw new Error(completion.message);
                const source = context.input.inputs[0];
                const document: ViewProviderDocument = {
                    title: "Lookup assessment",
                    data: {
                        schemaVersion: 1,
                        questionTitle: "What did the failed lookup establish?",
                        statement: completion.data,
                    },
                    missingEvidence: [
                        "A successful lookup result is unavailable.",
                    ],
                    statements: [
                        {
                            id: "lookup",
                            text: completion.data,
                            citations: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                    locator: `chars:0-${source.content.length}`,
                                    excerpt: source.content,
                                },
                            ],
                        },
                    ],
                };
                await context.recordCandidate("explanation", {
                    statement: completion.data,
                });
                await context.checkpoint("explanation", {
                    constructed: true,
                    response: completion.data,
                });
                if (failAfterCheckpoint)
                    throw new Error("Controlled interruption after checkpoint");
                const output = viewProviderOutput(context.input, document);
                return {
                    state: "accepted",
                    document,
                    support: {
                        supported: approved,
                        reasons: [
                            "Controlled offline assessment, not a real-data fidelity qualification.",
                        ],
                        missingContext: approved
                            ? []
                            : ["Unsupported assessment"],
                        sections: output.content.sections.map((section) => ({
                            sectionId: section.id,
                            supported: approved,
                            reason: "Controlled fixture assessment",
                        })),
                        relationships: output.relationships.map((edge) => ({
                            edgeId: edge.id,
                            supported: approved,
                            reason: "Controlled fixture assessment",
                        })),
                    },
                };
            },
        };
    }

    function open(): FileMemoryService {
        return new FileMemoryService(root, {
            discoveryPolicy: "off",
            informationalViews: false,
            sourceSynopses: false,
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-baseline",
                async generate() {
                    throw new Error(
                        "Legacy generation must not handle extension views",
                    );
                },
                async validate() {
                    throw new Error(
                        "Legacy validation must not handle extension views",
                    );
                },
            },
            viewProviders: [installed()],
            viewProviderModel: {
                identity: "offline-model-v1",
                model: {
                    completionSettings: {},
                    async complete() {
                        completions++;
                        modelStarted?.();
                        await modelGate;
                        return modelFailure
                            ? {
                                  success: false,
                                  message: "Controlled model failure",
                              }
                            : {
                                  success: true,
                                  data: "The lookup failed; it does not establish an empty result.",
                              };
                    },
                },
            },
            viewProviderAuthorization: {
                async assertAuthorized(request) {
                    authorizedOperations.push(request.operation);
                    if (!allowed) {
                        deniedObserved?.();
                        throw new Error("Original-source access revoked");
                    }
                },
            },
        });
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-provider-build-"));
        allowed = approved = true;
        modelFailure = false;
        completions = constructCalls = 0;
        authorizedOperations = [];
        modelGate = undefined;
        modelStarted = deniedObserved = undefined;
        failAfterCheckpoint = reuseCheckpoint = false;
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function request(): Promise<ViewBuildRequest> {
        const corpus = await service.createCorpus("Offline provider fixture");
        const source = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "lookup-source",
                sourceType: "text",
                title: "Lookup",
                text: "The lookup query failed. No successful result was returned.",
            },
        });
        expect((await waitForMemoryJob(service, source.jobId)).state).toBe(
            "complete",
        );
        return {
            corpusId: corpus.corpusId,
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "lookup-workspace",
                        kind: "extension",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                },
                            ],
                        },
                        extension: {
                            provider: installed().identity,
                            configuration: { mode: "committed-source" },
                        },
                    },
                },
            ],
        };
    }

    async function finish(job: ViewBuildJob): Promise<ViewBuildJob> {
        for (let i = 0; i < 1000; i++) {
            const current = await service.getViewBuild(job);
            if (!current) throw new Error("Durable provider job is missing");
            if (current.state !== "running") return current;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Provider build did not terminate");
    }

    test("approved data, source proof and stage receipts persist across reopen without model calls", async () => {
        const build = await request();
        const job = await finish(await service.buildViews(build));
        expect(job.state).toBe("complete");
        expect(job.results[0].state).toBe("draft");
        const stage = job.results[0].providerStages?.[0];
        expect(stage?.candidates).toHaveLength(1);
        expect(stage?.checkpoints).toHaveLength(1);
        expect(stage?.inputFingerprint).toBe(
            job.results[0].snapshot.fingerprint,
        );
        expect(stage?.completions[0]).toMatchObject({ state: "succeeded" });
        expect(stage?.completions[0].queuedAt).toBeDefined();
        expect(stage?.completions[0].admittedAt).toBeDefined();
        expect(stage?.completions[0].finishedAt).toBeDefined();
        const read = { corpusId: build.corpusId, viewId: "lookup-workspace" };
        const view = await service.getView(read);
        expect(view?.content).toMatchObject({
            kind: "extension",
            data: { questionTitle: "What did the failed lookup establish?" },
        });
        expect(view?.validation?.support.supported).toBe(true);
        expect(authorizedOperations).toContain("model");
        await service.close();
        service = open();
        expect((await service.getView(read))?.content).toEqual(view?.content);
        expect(
            (await service.getViewBuild(job))?.results[0].providerStages,
        ).toEqual(job.results[0].providerStages);
        expect(completions).toBe(1);
        expect(constructCalls).toBe(1);
    });

    test("a negative independent assessment cannot create an accepted view", async () => {
        const build = await request();
        approved = false;
        const job = await finish(await service.buildViews(build));
        expect(job.state).toBe("failed");
        expect(job.results[0].reason).toContain("Unsupported assessment");
        expect(
            await service.getView({
                corpusId: build.corpusId,
                viewId: "lookup-workspace",
            }),
        ).toBeUndefined();
        expect(job.results[0].providerStages?.[0].candidates).toHaveLength(1);
    });

    test("logical completion failure is retained and never converted into content", async () => {
        const build = await request();
        modelFailure = true;
        const job = await finish(await service.buildViews(build));
        expect(job.state).toBe("failed");
        expect(job.results[0].reason).toContain("Controlled model failure");
        expect(job.results[0].providerStages?.[0].completions[0]).toMatchObject(
            {
                state: "failed",
                error: "Controlled model failure",
            },
        );
        expect(
            await service.getView({
                corpusId: build.corpusId,
                viewId: "lookup-workspace",
            }),
        ).toBeUndefined();
    });

    test("revocation withdraws warmed content, source-bearing jobs, history and publication", async () => {
        const build = await request();
        const job = await finish(await service.buildViews(build));
        const read = { corpusId: build.corpusId, viewId: "lookup-workspace" };
        const view = await service.getView(read);
        if (!view) throw new Error("Fixture view is missing");
        const head = (await service.listViews(build.corpusId)).head;
        if (!head) throw new Error("Fixture history head is missing");
        allowed = false;
        await expect(service.getView(read)).rejects.toThrow(
            "Original-source access revoked",
        );
        await expect(service.listViews(build.corpusId)).rejects.toThrow(
            "Original-source access revoked",
        );
        await expect(service.getViewBuild(job)).rejects.toThrow(
            "Original-source access revoked",
        );
        await expect(service.listViewBuilds(build.corpusId)).rejects.toThrow(
            "Original-source access revoked",
        );
        await expect(
            service.listViewBuildSummaries({ corpusId: build.corpusId }),
        ).rejects.toThrow("Original-source access revoked");
        await expect(service.getViewHistory(read)).rejects.toThrow(
            "Original-source access revoked",
        );
        await expect(
            service.publishView({
                ...read,
                revisionId: view.revisionId,
                expectedVersion: view.version,
                expectedHead: head,
            }),
        ).rejects.toThrow("Original-source access revoked");
        expect(completions).toBe(1);
    });

    test("denied source scope fails before model admission", async () => {
        const build = await request();
        allowed = false;
        await expect(service.buildViews(build)).rejects.toThrow(
            "Original-source access revoked",
        );
        expect(completions).toBe(0);
        expect(constructCalls).toBe(0);
    });

    test("explicit continuation keeps the failed build identity and checkpoint across restart", async () => {
        const build = await request();
        failAfterCheckpoint = reuseCheckpoint = true;
        const first = await finish(await service.buildViews(build));
        expect(first.state).toBe("failed");
        expect(completions).toBe(1);
        await service.close();
        failAfterCheckpoint = false;
        service = open();
        const continued = await finish(await service.buildViews(build));
        expect(continued.jobId).toBe(first.jobId);
        expect(continued.state).toBe("complete");
        const stage = continued.results[0].providerStages?.find(
            (item) => item.stage === "explanation",
        );
        expect(stage?.completions).toHaveLength(1);
        expect(stage?.checkpoints).toHaveLength(2);
        expect(completions).toBe(1);
        expect(constructCalls).toBe(2);
        expect((await service.buildViews(build)).jobId).toBe(first.jobId);
        expect(completions).toBe(1);
    });

    test("explicit continuation does not bypass a fidelity block or revoked originals", async () => {
        const build = await request();
        approved = false;
        const rejected = await finish(await service.buildViews(build));
        expect(rejected.results[0].state).toBe("blocked");
        expect((await service.buildViews(build)).jobId).toBe(rejected.jobId);
        expect(completions).toBe(1);
        allowed = false;
        await expect(service.buildViews(build)).rejects.toThrow(
            "Original-source access revoked",
        );
        expect(completions).toBe(1);
    });

    test("reading stays responsive while a model waits, and revocation prevents its publication", async () => {
        const build = await request();
        let releaseModel: (() => void) | undefined;
        modelGate = new Promise<void>((resolve) => {
            releaseModel = resolve;
        });
        const started = new Promise<void>((resolve) => {
            modelStarted = resolve;
        });
        const denied = new Promise<void>((resolve) => {
            deniedObserved = resolve;
        });
        const job = await service.buildViews(build);
        await started;
        try {
            expect(
                await service.getView({
                    corpusId: build.corpusId,
                    viewId: "lookup-workspace",
                }),
            ).toBeUndefined();
            allowed = false;
            releaseModel?.();
            await denied;
        } finally {
            releaseModel?.();
            allowed = true;
        }
        const terminal = await finish(job);
        expect(terminal.state).toBe("failed");
        expect(terminal.results[0].reason).toContain(
            "Original-source access revoked",
        );
        expect(
            terminal.results[0].providerStages?.[0].completions[0].state,
        ).toBe("succeeded");
        expect(terminal.results[0].providerStages?.[0].candidates).toHaveLength(
            0,
        );
        expect(
            await service.getView({
                corpusId: build.corpusId,
                viewId: "lookup-workspace",
            }),
        ).toBeUndefined();
    });
});
