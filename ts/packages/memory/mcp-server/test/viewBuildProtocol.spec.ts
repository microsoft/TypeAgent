// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    McpMemoryServiceClient,
    readViewDetail,
    viewBuildRequestSchema,
    viewResolutionSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    viewDetailPageChars,
    type ViewDetailPageRequest,
    type ViewBuildSnapshot,
    type ViewSynthesisOutput,
    type ViewExtensionProvider,
    extensionViewId,
    viewExtensionDigest,
} from "@typeagent/memory-service";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";
const {
    FakeSemanticCorpusIndex,
}: typeof import("../../service/dist/test/fakeSemanticCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeSemanticCorpusIndex.js",
            import.meta.url,
        ).href
    );

function syntheticOutput(input: ViewBuildSnapshot): ViewSynthesisOutput {
    const source = input.inputs[0];
    const citation = {
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        locator: `chars:0-${source.content.length}`,
        excerpt: source.content,
    };
    const roles = [
        "description",
        "prerequisites",
        "diagnostic",
        "guard",
        "verification",
        "recovery",
        "context",
    ] as const;
    return {
        content: {
            kind: "troubleshootingGuide",
            title: "Synthetic guide",
            citations: [citation],
            sections: roles.map((role) => ({
                id: role,
                role,
                heading: role,
                body: source.content.repeat(1000),
            })),
        },
        relationships: roles.map((role) => ({
            id: `support-${role}`,
            predicate: "supportedBy",
            from: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: role,
            },
            to: {
                kind: "source",
                sourceId: source.sourceId,
                revisionId: source.revisionId,
            },
            citations: [citation],
        })),
        outcome: "diagnosticOnly",
        missingEvidence: ["No confirmed recovery"],
    };
}

test("authenticated MCP installs, builds and reopens provider content with scope-gated journals", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-provider-protocol-"),
    );
    let completions = 0;
    let allowed = true;
    const outputSchema = {
        type: "object" as const,
        properties: {
            questionTitle: { type: "string" as const, maxLength: 200 },
            statement: { type: "string" as const, maxLength: 2000 },
        },
        required: ["questionTitle", "statement"],
    };
    const identity = {
        providerId: "fixture.protocol",
        version: "1",
        implementationDigest: "a".repeat(64),
        inputContract: "fixture-input-v1",
        outputContract: "fixture-output-v1",
        schemaDigest: viewExtensionDigest(outputSchema),
        recipeDigest: "b".repeat(64),
    };
    const provider: ViewExtensionProvider = {
        descriptor: {
            apiVersion: 1,
            identity,
            modelIdentity: "offline-protocol-model",
            label: "Protocol fixture",
            outputSchema,
            definitions: [
                { id: "lookup", eligibilityVersion: "1", mode: "static" },
            ],
            limits: {
                maxSources: 32,
                maxInputChars: 120000,
                maxOutputChars: 120000,
                maxModelCalls: 4,
                timeoutMs: 30000,
            },
        },
        authorize: async () => {
            if (!allowed) throw new Error("Original access revoked");
            return true;
        },
        evaluateEligibility: async () => ({
            disposition: "eligible",
            reason: "Synthetic approved input",
        }),
        prepare: async () => null,
        model: {
            completionSettings: {},
            async complete() {
                completions++;
                return {
                    success: true,
                    data: "The lookup failed, not an empty result.",
                };
            },
        },
        async generate(input, _prepared, context) {
            const completion = await context.complete(
                "explanation",
                "Explain the retained result.",
            );
            const source = input.inputs[0];
            const citation = {
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                locator: `chars:0-${source.content.length}`,
                excerpt: source.content,
            };
            const document = {
                title: "Lookup result",
                data: {
                    questionTitle: "What did the lookup establish?",
                    statement: completion,
                },
                missingEvidence: [],
                statements: [
                    {
                        id: "lookup",
                        text: completion,
                        citations: [citation],
                    },
                ],
            };
            await context.recordCandidate!("explanation", document.data);
            await context.checkpoint("explanation", { accepted: true });
            return {
                kind: "extension",
                construction: "extension-v1",
                provider: identity,
                title: document.title,
                payload: document.data,
                sections: document.statements.map((statement) => ({
                    id: statement.id,
                    role: "context",
                    heading: statement.id,
                    body: statement.text,
                })),
                citations: [citation],
                evidence: [
                    { blockId: "lookup", support: [citation], opposition: [] },
                ],
                inputUse: [
                    {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                        disposition: "represented",
                        reason: "Synthetic original support",
                    },
                ],
                presentation: {
                    schemaVersion: 1,
                    templateId: "document-v1",
                    templateVersion: 1,
                    layouts: [
                        {
                            id: "story",
                            label: "Story",
                            groups: [
                                {
                                    id: "lookup",
                                    label: "Lookup",
                                    blockIds: ["lookup"],
                                },
                            ],
                        },
                    ],
                },
                fidelity: {
                    supported: true,
                    reasons: [
                        "Synthetic transport fixture, not real-data fidelity qualification",
                    ],
                    missingContext: [],
                    sections: [
                        {
                            sectionId: "lookup",
                            supported: true,
                            reason: "Controlled fixture",
                        },
                    ],
                    relationships: [
                        {
                            edgeId: "lookup.support.0",
                            supported: true,
                            reason: "Controlled fixture",
                        },
                    ],
                },
            };
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            discoveryPolicy: "off",
            informationalViews: false,
            sourceSynopses: false,
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            extensionBuilds: true,
            extensionProviders: [provider],
            maintenanceLimits: {
                requestBudget: {
                    tokenizer: "offline-chars",
                    countTokens: (text) => text.length,
                    inputTokens: 120000,
                    outputTokens: 2000,
                    contextTokens: 124000,
                    safetyTokens: 64,
                    reservedTokens: 1000000,
                    chatAttempts: 4,
                    embeddingAttempts: 1,
                    elapsedMs: 30000,
                },
            },
        });
    let host = await MemoryServiceHost.start(open());
    const connect = () =>
        McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { authorization: "Bearer " + host.bearerToken },
        });
    let client = await connect();
    try {
        expect((await client.getCapabilities()).derivedViews).toMatchObject({
            kinds: expect.arrayContaining(["extension"]),
        });
        const corpus = await client.createCorpus("Provider transport fixture");
        const source = await client.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "lookup",
                sourceType: "text",
                title: "Lookup",
                text: "The lookup failed. No successful result was returned.",
            },
        });
        await client.waitForJob(source.jobId);
        const definition = {
            viewId: extensionViewId(identity.providerId, "lookup", "retained"),
            kind: "extension" as const,
            selector: {
                kind: "sources" as const,
                sources: [
                    {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                    },
                ],
            },
            extension: {
                ...identity,
                definitionId: "lookup",
                targetKey: "retained",
                eligibilityVersion: "1",
                policyDigest: "c".repeat(64),
                parameters: { inputMode: "retained" },
            },
        };
        const request = {
            corpusId: corpus.corpusId,
            expectedHead: (await client.listViews(corpus.corpusId)).head,
            publication: false,
            targets: [{ expectedVersion: 0, definition }],
        };
        let job = await client.buildViews(request);
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            job = (await client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            }))!;
        }
        expect(job.state).toBe("complete");
        expect(job.results[0].providerCheckpoints).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    stage: "explanation",
                    state: { accepted: true },
                }),
            ]),
        );
        expect(job.results[0].providerCandidates).toMatchObject([
            {
                stage: "explanation",
                value: { questionTitle: "What did the lookup establish?" },
            },
        ]);
        expect(job.results[0].providerAttempts).toMatchObject([
            { state: "returned" },
        ]);
        const read = { corpusId: corpus.corpusId, viewId: definition.viewId };
        const view = await client.getView(read);
        if (!view || view.content.kind !== "extension")
            throw new Error("Provider view missing");
        expect(view.content.payload).toMatchObject({
            questionTitle: "What did the lookup establish?",
        });
        expect(
            (
                await client.getSourceViewUsage({
                    corpusId: corpus.corpusId,
                    sourceId: source.sourceId,
                })
            ).items[0].kind,
        ).toBe("extension");
        await expect(
            client.saveViewDraft({
                ...read,
                expectedHead: (await client.listViews(corpus.corpusId)).head,
                expectedVersion: view.version,
                definition,
                content: view.content,
                relationships: [],
            }),
        ).rejects.toThrow();
        await client.close();
        await host.close();
        host = await MemoryServiceHost.start(open());
        client = await connect();
        expect((await client.getView(read))?.content).toEqual(view.content);
        expect((await client.buildViews(request)).jobId).toBe(job.jobId);
        expect(completions).toBe(1);
        allowed = false;
        await expect(client.getView(read)).rejects.toThrow(
            "Original access revoked",
        );
        await expect(
            client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            }),
        ).rejects.toThrow("Original access revoked");
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("real authenticated loopback MCP builds, inspects, edits, rejects publication and crosses restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-view-protocol-"));
    const open = () =>
        new FileMemoryService(root, {
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-protocol-test",
                generate: async (input) => syntheticOutput(input),
                validate: async (_input, output) => ({
                    supported: true,
                    missingContext: [],
                    reasons: [],
                    sections: output.content.sections.map((section) => ({
                        sectionId: section.id,
                        supported: true,
                        reason: "Controlled offline assessment",
                    })),
                    relationships: output.relationships.map((edge) => ({
                        edgeId: edge.id,
                        supported: true,
                        reason: "Controlled offline assessment",
                    })),
                }),
            },
        });
    const service = open();
    const detailRequests: ViewDetailPageRequest[] = [];
    const getViewDetailPage = service.getViewDetailPage.bind(service);
    service.getViewDetailPage = async (request) => {
        detailRequests.push(request);
        return getViewDetailPage(request);
    };
    let host = await MemoryServiceHost.start(service);
    let client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const capabilities = await client.getCapabilities();
        expect(capabilities.derivedViews?.builds).toBe(true);
        const corpus = await client.createCorpus("Transport fixture");
        const source = await client.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "s",
                sourceType: "text",
                title: "Synthetic evidence",
                text: "Read only. No confirmed recovery. Escalate with fresh approval.",
            },
        });
        await client.waitForJob(source.jobId);
        const definition = {
            viewId: "guide",
            kind: "troubleshootingGuide" as const,
            selector: {
                kind: "sources" as const,
                sources: [
                    {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                    },
                ],
            },
        };
        const request = {
            corpusId: corpus.corpusId,
            expectedHead: (await client.listViews(corpus.corpusId)).head,
            targets: [{ definition, expectedVersion: 0 }],
            publication: false as const,
        };
        let job = await client.buildViews(request);
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            job = (await client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            }))!;
        }
        expect(job.state).toBe("complete");
        const usage = await client.getSourceViewUsage({
            corpusId: corpus.corpusId,
            sourceId: source.sourceId,
        });
        expect(usage).toMatchObject({
            total: 1,
            items: [
                {
                    viewId: "guide",
                    kind: "troubleshootingGuide",
                    provenance: "generated",
                },
            ],
        });
        expect(job.results[0].state).toBe("draft");
        const snapshot = await client.listViews(corpus.corpusId);
        const view = snapshot.views[0];
        const detailRequest = {
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            includeContext: false,
        };
        const firstPage = await client.getViewDetailPage(detailRequest);
        expect(detailRequests[0]).toMatchObject(detailRequest);
        expect(firstPage?.text.length).toBe(viewDetailPageChars);
        expect(firstPage?.nextOffset).toBe(viewDetailPageChars);
        expect(await readViewDetail(client, detailRequest)).toEqual(view);
        const presentation = await readViewDetail(client, {
            ...detailRequest,
            projection: "presentation",
        });
        expect(presentation?.content).toEqual(view.content);
        expect(presentation?.relationships).toEqual(view.relationships);
        expect(presentation?.generation?.input).toBeUndefined();
        await expect(
            client.getViewDetailPage({
                ...detailRequest,
                offset: viewDetailPageChars,
                digest: "a".repeat(64),
            }),
        ).rejects.toThrow(/changed or continuation/);
        if (view.content.kind !== "troubleshootingGuide")
            throw new Error("Expected a generated troubleshooting guide");
        expect(view.generation?.input?.inputs[0].content).toContain(
            "Read only",
        );
        expect(view.actor).toBe("memory-view-generator");
        const saved = await client.saveViewDraft({
            corpusId: corpus.corpusId,
            viewId: "guide",
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition,
            content: {
                ...view.content,
                title: "Explicit human title",
            },
            relationships: view.relationships.flatMap((edge) => {
                if (edge.origin === "system") return [];
                const { schemaVersion, family, origin, reviewState, ...input } =
                    edge;
                return [input];
            }),
        });
        expect(saved.version.actor).toBe(os.userInfo().username);
        expect(
            saved.version.edits?.some((edit) => edit.target === "title"),
        ).toBe(true);
        await expect(
            client.publishView({
                corpusId: corpus.corpusId,
                viewId: "guide",
                revisionId: saved.version.revisionId,
                expectedVersion: saved.version.version,
                expectedHead: saved.commitId,
            }),
        ).rejects.toThrow("complete source inventory");
        await client.close();
        await host.close();
        host = await MemoryServiceHost.start(open());
        client = await McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { authorization: `Bearer ${host.bearerToken}` },
        });
        expect(
            (
                await client.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: job.jobId,
                })
            )?.results[0].revisionId,
        ).toBe(job.results[0].revisionId);
        expect(
            (
                await client.getViewHistory({
                    corpusId: corpus.corpusId,
                    viewId: "guide",
                })
            )[0].version.content.title,
        ).toBe("Explicit human title");
        expect((await client.buildViews(request)).jobId).toBe(job.jobId);
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("wire rejects spoofed actors, unsupported kinds and publication permissions", () => {
    const request = {
        corpusId: "c",
        expectedHead: null,
        targets: [
            {
                expectedVersion: 0,
                definition: {
                    viewId: "g",
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
                        sources: [{ sourceId: "s", revisionId: "r" }],
                    },
                },
            },
        ],
    };
    expect(viewBuildRequestSchema.safeParse(request).success).toBe(true);
    expect(
        viewBuildRequestSchema.safeParse({ ...request, actor: "spoofed" })
            .success,
    ).toBe(false);
    expect(
        viewBuildRequestSchema.safeParse({ ...request, publication: true })
            .success,
    ).toBe(true);
    expect(
        viewBuildRequestSchema.safeParse({
            ...request,
            targets: [
                {
                    ...request.targets[0],
                    definition: {
                        ...request.targets[0].definition,
                        kind: "unsupportedOntology",
                    },
                },
            ],
        }).success,
    ).toBe(false);
    expect(
        viewResolutionSchema.safeParse({ corpusId: "c", actor: "spoofed" })
            .success,
    ).toBe(false);
});
