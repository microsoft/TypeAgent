// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    McpMemoryServiceClient,
    viewBuildJobSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    extensionViewId,
    viewExtensionDigest,
    type ViewExtensionProvider,
    type ViewPayloadSchema,
    type ViewBuildJob,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
    EXTENSION_ID,
    RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { previewMetaKey, previewResourceUri } from "../src/previewTypes.js";
import { fetchWithRetry, type ChatModel } from "@typeagent/aiclient";
import type { IndexedFragmentRequest } from "@typeagent/memory-service";

const {
    FakeSemanticCorpusIndex,
}: typeof import("../../service/dist/test/fakeSemanticCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeSemanticCorpusIndex.js",
            import.meta.url,
        ).href
    );

test("registered extension traverses authenticated MCP/client with 33 exact members, receipt and restart", async () => {
    const directory = path.resolve(
        ".extension-protocol-fixtures",
        randomUUID(),
    );
    await mkdir(directory, { recursive: true });
    const schema: ViewPayloadSchema = {
        type: "object",
        properties: {
            title: { type: "string", maxLength: 200 },
            decisionId: {
                type: "union",
                variants: [
                    { type: "string", maxLength: 200 },
                    { type: "null" },
                ],
            },
        },
        required: ["title", "decisionId"],
    };
    let constructionCalls = 0;
    let physicalRequests = 0;
    let readerCalls = 0,
        approved = true;
    const reader: ChatModel = {
        completionSettings: {},
        async complete(prompt) {
            const text =
                typeof prompt === "string"
                    ? prompt
                    : prompt.find((part) => part.role === "user")!.content;
            const input = JSON.parse(String(text));
            const view = input.evidence.find(
                (item: { kind: string }) => item.kind === "derived",
            );
            if (!view)
                throw new Error(
                    "MCP reader was not supplied extension evidence",
                );
            readerCalls++;
            const evidenceIds = [
                view.id,
                ...view.supportingEvidenceIds,
                ...view.opposingEvidenceIds,
            ];
            return {
                success: true,
                data: JSON.stringify(
                    "candidates" in input
                        ? {
                              schemaVersion: 1,
                              status: "answered",
                              title: "Amber recap",
                              summary: {
                                  text: "Amber retains original qualifications.",
                                  role: "memory",
                                  evidenceIds,
                              },
                              sections: [],
                              unknowns: [],
                              followUps: [],
                              moduleSignals: [],
                              retrievalQueries: [],
                          }
                        : {
                              status: "answered",
                              answer: "Amber retains original qualifications.",
                              evidenceIds,
                              retrievalQueries: [],
                          },
                ),
            };
        },
    };
    class QueryIndex extends FakeSemanticCorpusIndex {
        async readFragments(input: IndexedFragmentRequest) {
            const fragments = this.documents
                .filter(
                    (document) =>
                        input.sourceIds.includes(document.source.sourceId) &&
                        input.terms.some((term) =>
                            document.content
                                .toLowerCase()
                                .includes(term.toLowerCase()),
                        ),
                )
                .slice(0, input.maxFragments ?? 12)
                .map((document) => ({
                    sourceId: document.source.sourceId,
                    revisionId: document.revision.revisionId,
                    locator: `chars:0-${document.content.length}`,
                    snippet: document.content,
                    score: 1,
                }));
            return {
                fragments,
                readChars: fragments.reduce(
                    (sum, item) => sum + item.snippet.length,
                    0,
                ),
                limited: false,
            };
        }
    }
    const provider: ViewExtensionProvider = {
        descriptor: {
            apiVersion: 1,
            label: "Synthetic grouped recap",
            identity: {
                providerId: "synthetic-mcp",
                version: "1",
                implementationDigest: viewExtensionDigest("implementation"),
                inputContract: "input-v1",
                outputContract: "output-v1",
                schemaDigest: viewExtensionDigest(schema),
                recipeDigest: viewExtensionDigest("recipe"),
            },
            outputSchema: schema,
            definitions: [
                { id: "recap", eligibilityVersion: "1", mode: "static" },
            ],
            limits: {
                maxSources: 64,
                maxInputChars: 240000,
                maxOutputChars: 120000,
                maxModelCalls: 6,
                timeoutMs: 30000,
            },
        },
        authorize: async () => true,
        evaluateEligibility: async () => ({
            disposition: "eligible",
            reason: "Complete synthetic case group",
        }),
        prepare: async () => ({ title: "Prepared" }),
        model: {
            completionSettings: {},
            async complete(prompt) {
                const endpoint = "https://synthetic.invalid/extension";
                const originalFetch = globalThis.fetch;
                globalThis.fetch = (input, options) => {
                    if (input !== endpoint)
                        return originalFetch(input, options);
                    physicalRequests++;
                    return Promise.resolve(new Response("{}"));
                };
                try {
                    const response = await fetchWithRetry(
                        endpoint,
                        {
                            method: "POST",
                            body: JSON.stringify({
                                messages: [{ role: "user", content: prompt }],
                                max_tokens: 16,
                            }),
                        },
                        0,
                    );
                    if (!response.success) throw new Error(response.message);
                    return { success: true, data: "Synthetic completion" };
                } finally {
                    globalThis.fetch = originalFetch;
                }
            },
        },
        generate: async (input, _prepared, context) => {
            constructionCalls++;
            await context.complete("draft", "Synthetic grouped recap");
            const source = input.inputs[0];
            const citation = {
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                locator: `chars:0-${source.content.length}`,
                excerpt: source.content,
            };
            return {
                kind: "extension",
                construction: "extension-v1",
                provider: provider.descriptor.identity,
                title: "Grouped amber recap",
                sections: [
                    {
                        id: "claim",
                        role: "context",
                        heading: "Status",
                        body: "Amber recap retains its qualifications. ".repeat(
                            60,
                        ),
                    },
                ],
                citations: [citation],
                evidence: [
                    { blockId: "claim", support: [citation], opposition: [] },
                ],
                payload: { title: "Grouped amber recap", decisionId: null },
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
                                    id: "main",
                                    label: "Recap",
                                    blockIds: ["claim"],
                                },
                            ],
                        },
                    ],
                },
                inputUse: input.inputs.map((source, index) => ({
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    disposition: index ? "unused" : "represented",
                    reason: index ? "Complete group context" : "Claim support",
                })),
                fidelity: {
                    supported: true,
                    missingContext: [],
                    reasons: [],
                    sections: [
                        {
                            sectionId: "claim",
                            supported: true,
                            reason: "Synthetic support",
                        },
                    ],
                    relationships: [
                        {
                            edgeId: "claim.support.0",
                            supported: true,
                            reason: "Synthetic support",
                        },
                    ],
                },
            };
        },
    };
    const open = () =>
        new FileMemoryService(directory, {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            discoveryPolicy: "off",
            maintenanceMode: "manual",
            maintenanceLimits: {
                requestBudget: {
                    inputTokens: 4096,
                    outputTokens: 128,
                    safetyTokens: 16,
                    chatAttempts: 6,
                    embeddingAttempts: 1,
                    reservedTokens: 30000,
                    elapsedMs: 30000,
                    tokenizer: "synthetic-character-estimate",
                    countTokens: (serialized) => serialized.length,
                },
            },
            extensionBuilds: true,
            extensionProviders: [provider],
            sourceAuthorization: async () => approved,
            understanding: true,
            indexedAnswerModel: reader,
            indexFactory: (_id, directory) => new QueryIndex(directory),
        });
    let host = await MemoryServiceHost.start(open(), { previews: true });
    const connect = () =>
        McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { authorization: `Bearer ${host.bearerToken}` },
        });
    let client = await connect();
    try {
        const capabilities = await client.getCapabilities();
        expect(
            capabilities.derivedViews?.extension?.providers[0].identity,
        ).toEqual(provider.descriptor.identity);
        const corpus = await client.createCorpus("Extension transport fixture");
        const members = [];
        for (let index = 0; index < 33; index++) {
            const text = `Ready amber record ${index}`;
            const ingested = await client.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: `s-${index}`,
                    sourceType: "text",
                    title: `Record ${index}`,
                    text,
                },
                pipeline: { mode: "content" },
            });
            await client.waitForJob(ingested.jobId);
            members.push({
                sourceId: ingested.sourceId,
                revisionId: ingested.revisionId,
                contentHash: viewExtensionDigest(text),
            });
        }
        const manifestText = JSON.stringify({
            schemaVersion: 1,
            corpusId: corpus.corpusId,
            members,
        });
        const manifest = await client.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "manifest",
                sourceType: "text",
                title: "Exact manifest",
                text: manifestText,
            },
            pipeline: { mode: "content" },
        });
        await client.waitForJob(manifest.jobId);
        const viewId = extensionViewId(
            provider.descriptor.identity.providerId,
            "recap",
            "complete-group",
        );
        let job: ViewBuildJob = await client.buildViews({
            corpusId: corpus.corpusId,
            expectedHead: (await client.listViews(corpus.corpusId)).head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId,
                        kind: "extension",
                        extension: {
                            ...provider.descriptor.identity,
                            definitionId: "recap",
                            targetKey: "complete-group",
                            eligibilityVersion: "1",
                            policyDigest:
                                viewExtensionDigest("approved policy"),
                            parameters: {},
                        },
                        selector: {
                            kind: "sourceManifest",
                            sources: members.map(
                                ({ sourceId, revisionId }) => ({
                                    sourceId,
                                    revisionId,
                                }),
                            ),
                            manifest: {
                                sourceId: manifest.sourceId,
                                revisionId: manifest.revisionId,
                                contentHash: viewExtensionDigest(manifestText),
                            },
                        },
                    },
                },
            ],
        });
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            job = (await client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            }))!;
        }
        expect(job.state).toBe("complete");
        expect(job.results[0].eligibility?.disposition).toBe("eligible");
        expect(job.results[0].snapshot.inputs).toHaveLength(33);
        expect(job.results[0].snapshot.influenceSources).toHaveLength(34);
        expect(physicalRequests).toBe(1);
        expect(job.results[0].providerRequests).toHaveLength(1);
        const request = job.results[0].providerRequests![0];
        expect(request.state).toBe("returned");
        expect(request.reservation).toMatchObject({
            attempt: 1,
            kind: "chat",
            tokenAccounting: "estimate",
        });
        expect(request.reservation).not.toHaveProperty("tokenizer");
        const withReservation = (reservation: unknown) =>
            viewBuildJobSchema.safeParse({
                ...job,
                results: [
                    {
                        ...job.results[0],
                        providerRequests: [{ ...request, reservation }],
                    },
                ],
            });
        expect(
            withReservation({
                ...request.reservation,
                tokenizer: "synthetic-estimate",
            }).success,
        ).toBe(true);
        expect(
            withReservation({ ...request.reservation, tokenizer: 42 }).success,
        ).toBe(false);
        expect(
            withReservation({ ...request.reservation, outputTokens: -1 })
                .success,
        ).toBe(false);
        const view = await client.getView({
            corpusId: corpus.corpusId,
            viewId,
        });
        expect(view?.content.kind).toBe("extension");
        const revisionId = view!.revisionId;
        await client.close();
        await host.close();
        host = await MemoryServiceHost.start(open(), { previews: true });
        client = await connect();
        expect(
            (await client.getView({ corpusId: corpus.corpusId, viewId }))
                ?.revisionId,
        ).toBe(revisionId);
        expect(constructionCalls).toBe(1);
        await client.publishView({
            corpusId: corpus.corpusId,
            viewId,
            revisionId,
            expectedVersion: view!.version,
            expectedHead: (await client.listViews(corpus.corpusId)).head!,
        });
        const found = await client.search({
            corpusId: corpus.corpusId,
            query: "Amber",
        });
        expect(found.derivedViews).toHaveLength(1);
        const answer = await client.answer({
            corpusId: corpus.corpusId,
            question: "Amber",
            retrievalPolicy: "sourcesAndViews",
        });
        expect(answer.derivedReferences?.[0]).toMatchObject({
            viewId,
            revisionId,
            sectionId: "claim",
        });
        expect(answer.citations.map((citation) => citation.sourceId)).toContain(
            "s-0",
        );
        expect(
            await client.refreshExtensionViews({ corpusId: corpus.corpusId }),
        ).toEqual([]);
        const explanation = await client.understand({
            corpusId: corpus.corpusId,
            question: "Amber",
            retrievalPolicy: "sourcesAndViews",
        });
        const initial = await client.understandingModule({
            corpusId: corpus.corpusId,
            snapshotId: explanation.snapshotId,
            kind: "derivedViews",
        });
        expect(initial.derivedViews?.[0].blocks[0].selectedForAnswer).toBe(
            true,
        );
        expect(initial.derivedViews?.[0].blocks[0].nextBodyOffset).toBe(1600);
        const beforeExpansion = readerCalls;
        for (const html of [true, false]) {
            const capabilities: ClientCapabilities & {
                extensions?: Record<string, { mimeTypes: string[] }>;
            } = html
                ? {
                      extensions: {
                          [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
                      },
                  }
                : {};
            const sdk = new Client(
                { name: "synthetic-extension-host", version: "1" },
                {
                    capabilities,
                },
            );
            try {
                await sdk.connect(
                    new StreamableHTTPClientTransport(new URL(host.endpoint), {
                        requestInit: {
                            headers: {
                                authorization: `Bearer ${host.bearerToken}`,
                            },
                        },
                    }) as unknown as Transport,
                );
                const preview = await sdk.callTool({
                    name: "memory_preview",
                    arguments: {
                        corpusId: corpus.corpusId,
                        question: "Amber",
                        retrievalPolicy: "sourcesAndViews",
                        selection: { mode: "only", modules: ["derivedViews"] },
                    },
                });
                expect(preview.isError).not.toBe(true);
                expect(!!preview._meta?.[previewMetaKey]).toBe(html);
                const compact = (
                    preview.structuredContent as {
                        result: Record<string, unknown>;
                    }
                ).result;
                const expanded = await sdk.callTool({
                    name: "memory_preview_expand",
                    arguments: {
                        corpusId: corpus.corpusId,
                        snapshotId: compact.snapshotId,
                        kind: "derivedViews",
                        viewId,
                        revisionId,
                        layoutId: "story",
                        blockId: "claim",
                        bodyOffset: 1600,
                    },
                });
                expect(expanded.isError).not.toBe(true);
                expect(!!expanded._meta?.[previewMetaKey]).toBe(html);
                expect(JSON.stringify(expanded.content)).toContain(
                    "qualifications",
                );
                expect(JSON.stringify(expanded.content)).toContain("s-0");
                expect(
                    Buffer.byteLength(JSON.stringify(expanded)),
                ).toBeLessThanOrEqual(65536);
                const original = await sdk.callTool({
                    name: "memory_preview_expand",
                    arguments: {
                        corpusId: corpus.corpusId,
                        snapshotId: compact.snapshotId,
                        kind: "derivedViews",
                        viewId,
                        revisionId,
                        blockId: "claim",
                        citationId: "claim.support.0",
                    },
                });
                expect(original.isError).not.toBe(true);
                expect(JSON.stringify(original)).toContain(
                    "Ready amber record 0",
                );
                const outside = await sdk.callTool({
                    name: "memory_preview_expand",
                    arguments: {
                        corpusId: corpus.corpusId,
                        snapshotId: compact.snapshotId,
                        kind: "derivedViews",
                        viewId,
                        revisionId: "outside-revision",
                    },
                });
                expect(outside.isError).toBe(true);
                if (html) {
                    const resource = await sdk.readResource({
                        uri: previewResourceUri,
                    });
                    const content = resource.contents[0];
                    expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
                    expect(
                        "text" in content &&
                            String(content.text).includes("Derived views"),
                    ).toBe(true);
                    expect(
                        Buffer.byteLength(JSON.stringify(content)),
                    ).toBeLessThanOrEqual(410 * 1024);
                }
                approved = false;
                const revoked = await sdk.callTool({
                    name: "memory_preview_expand",
                    arguments: {
                        corpusId: corpus.corpusId,
                        snapshotId: compact.snapshotId,
                        kind: "derivedViews",
                    },
                });
                expect(revoked.isError).toBe(true);
                expect(JSON.stringify(revoked)).not.toContain(
                    "Amber recap retains",
                );
                approved = true;
            } finally {
                await sdk.close();
            }
        }
        expect(readerCalls).toBe(beforeExpansion);
    } finally {
        await client.close();
        await host.close();
        await rm(directory, { recursive: true, force: true });
    }
}, 60000);
