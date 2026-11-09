// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpMemoryServiceClient } from "@typeagent/memory-client";
import {
    FileMemoryService,
    type ViewBuildJob,
} from "@typeagent/memory-service";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
const {
    projectSources,
}: typeof import("../../service/dist/test/projectTestSources.js") =
    await import(
        new URL(
            "../../../service/dist/test/projectTestSources.js",
            import.meta.url,
        ).href
    );
const {
    FakeIndexedCorpusIndex,
}: typeof import("../../service/dist/test/fakeIndexedCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeIndexedCorpusIndex.js",
            import.meta.url,
        ).href
    );
const {
    projectSummaryTestResponse,
}: typeof import("../../service/dist/test/informationalProjectTestModel.js") =
    await import(
        new URL(
            "../../../service/dist/test/informationalProjectTestModel.js",
            import.meta.url,
        ).href
    );
const {
    inventoryTestAnswer,
}: typeof import("../../service/dist/test/viewInventoryTestModel.js") =
    await import(
        new URL(
            "../../../service/dist/test/viewInventoryTestModel.js",
            import.meta.url,
        ).href
    );
const {
    timelineTestAnswer,
}: typeof import("../../service/dist/test/timelineTestModel.js") = await import(
    new URL("../../../service/dist/test/timelineTestModel.js", import.meta.url)
        .href
);
const {
    createConfiguredViewSynthesisAdapter,
}: typeof import("../../service/dist/viewSynthesis.js") = await import(
    new URL("../../../service/dist/viewSynthesis.js", import.meta.url).href
);

test.each(["troubleshootingGuide", "projectBrief", "timeline"] as const)(
    "configured %s inventory and final coverage survive authenticated MCP, history and reopen",
    async (kind) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "inventory-mcp-offline-"),
        );
        const stages: string[] = [];
        const modelFailures: unknown[] = [];
        const model = createServer(async (request, response) => {
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of request)
                    chunks.push(Buffer.from(chunk));
                const body = JSON.parse(
                    Buffer.concat(chunks).toString("utf8"),
                ) as {
                    messages: Array<{ role: string; content: string }>;
                    response_format?: {
                        json_schema?: { name: string; strict: boolean };
                    };
                };
                const schema = body.response_format?.json_schema;
                const user = body.messages.find(
                    (message) => message.role === "user",
                );
                if (!schema?.strict || !user)
                    throw new Error(
                        "Expected configured strict evidence-first request",
                    );
                stages.push(schema.name);
                const answer =
                    kind === "projectBrief"
                        ? projectSummaryTestResponse(
                              JSON.parse(user.content).fragments,
                          )
                        : (kind === "timeline"
                              ? timelineTestAnswer
                              : inventoryTestAnswer)(
                              schema.name,
                              JSON.parse(user.content),
                          );
                response.writeHead(200, { "content-type": "application/json" });
                response.end(
                    JSON.stringify({
                        id: "offline-inventory-protocol",
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: JSON.stringify(answer),
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                );
            } catch (error) {
                modelFailures.push(error);
                response.writeHead(500, { "content-type": "application/json" });
                response.end(
                    JSON.stringify({
                        error: "Synthetic loopback model request failed",
                    }),
                );
            }
        });
        await new Promise<void>((resolve) =>
            model.listen(0, "127.0.0.1", resolve),
        );
        const address = model.address();
        if (!address || typeof address === "string")
            throw new Error("Offline model listener unavailable");
        const endpoint =
            kind === "timeline"
                ? "TIMELINE_OFFLINE"
                : kind === "projectBrief"
                  ? "PROJECT_BRIEF_OFFLINE"
                  : "V5_OFFLINE";
        const environment = {
            [`OPENAI_ENDPOINT_${endpoint}`]: `http://127.0.0.1:${address.port}/chat/completions`,
            [`OPENAI_API_KEY_${endpoint}`]:
                "synthetic-offline-token-not-a-secret",
            [`OPENAI_MODEL_${endpoint}`]: "synthetic-offline-model",
            [`OPENAI_ORGANIZATION_${endpoint}`]: "synthetic-offline",
            [`OPENAI_RESPONSE_FORMAT_${endpoint}`]: "1",
            [`ENABLE_MODEL_REQUEST_LOGGING_${endpoint}`]: "false",
        };
        let host: MemoryServiceHost | undefined;
        let client: McpMemoryServiceClient | undefined;
        const installed: string[] = [];
        const open = () =>
            new FileMemoryService(root, {
                discoveryPolicy: "off",
                viewDrafts: true,
                sourceSynopses: false,
                informationalViews: kind === "projectBrief",
                viewModelEndpoint: `openai:${endpoint}`,
                viewSynthesisAdapter: createConfiguredViewSynthesisAdapter(
                    `openai:${endpoint}`,
                ),
                indexFactory: (_id, directory) =>
                    kind === "projectBrief"
                        ? new FakeIndexedCorpusIndex(directory)
                        : new FakeSemanticCorpusIndex(directory),
            });
        try {
            const malformed = await fetch(
                `http://127.0.0.1:${address.port}/chat/completions`,
                { method: "POST", body: "PRIVATE_LOOPBACK_INPUT" },
            );
            expect(malformed.status).toBe(500);
            expect(await malformed.json()).toEqual({
                error: "Synthetic loopback model request failed",
            });
            expect(modelFailures).toHaveLength(1);
            expect(modelFailures[0]).toBeInstanceOf(SyntaxError);
            modelFailures.length = 0;
            for (const [key, value] of Object.entries(environment)) {
                if (key in process.env)
                    throw new Error(
                        "Offline fixture endpoint is already configured",
                    );
                process.env[key] = value;
                installed.push(key);
            }
            host = await MemoryServiceHost.start(open());
            client = await McpMemoryServiceClient.create({
                kind: "http",
                url: host.endpoint,
                headers: { authorization: `Bearer ${host.bearerToken}` },
            });
            const corpus = await client.createCorpus(
                "Inventory transport synthetic fixture",
            );
            if (kind === "projectBrief")
                for (const family of ["wiki", "projects"] as const)
                    await client.maintainViews({
                        corpusId: corpus.corpusId,
                        family,
                        operation: "pause",
                        expectedHead: (await client.listViews(corpus.corpusId))
                            .head,
                    });
            const source = await client.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "s",
                    sourceType: "text",
                    title: "Synthetic evidence",
                    text:
                        kind === "timeline"
                            ? "## Record capacity\nClassification: observation\nState: blocked\nOccurred at: 2026-10-05T08:45:00Z\nRecorded / known at: 2026-10-06T08:05:00Z\nCapacity is blocked pending owner review."
                            : kind === "projectBrief"
                              ? `${projectSources.charter}\n\n${projectSources.baseline}`
                              : "Capacity is blocked pending owner review. No recovery is confirmed.",
                },
            });
            await client.waitForJob(source.jobId);
            const sources = [
                { sourceId: source.sourceId, revisionId: source.revisionId },
            ];
            let job: ViewBuildJob = await client.buildViews({
                corpusId: corpus.corpusId,
                expectedHead: (await client.listViews(corpus.corpusId)).head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "guide",
                            kind,
                            ...(kind === "projectBrief"
                                ? {
                                      projectSummary: {
                                          construction:
                                              "informational-project-summary-v1" as const,
                                          query: "Payments",
                                          aliases: [],
                                          excludedSourceIds: [],
                                      },
                                  }
                                : {}),
                            selector:
                                kind === "timeline"
                                    ? {
                                          kind: "timelineEvidence",
                                          events: [],
                                          sources,
                                      }
                                    : { kind: "sources", sources },
                        },
                    },
                ],
            });
            for (
                let tries = 0;
                job.state === "running" && tries < 1000;
                tries++
            ) {
                await new Promise<void>((resolve) => setTimeout(resolve, 10));
                const current = await client.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: job.jobId,
                });
                if (!current)
                    throw new Error("Missing durable MCP inventory receipt");
                job = current;
            }
            expect(job.results[0]).toMatchObject({
                state: kind === "projectBrief" ? "draft" : "searchable",
            });
            expect(job.state).toBe("complete");
            expect(stages).toEqual(
                kind === "projectBrief"
                    ? ["informational_project_summary"]
                    : [
                          "memory_source_fact_inventory",
                          "memory_source_inventory_check",
                          kind === "timeline"
                              ? "memory_timeline_construction"
                              : "memory_inventory_guide_construction",
                          "memory_inventory_artifact_support",
                          "memory_inventory_artifact_support",
                      ],
            );
            const result = job.results[0];
            expect(result.state).toBe(
                kind === "projectBrief" ? "draft" : "searchable",
            );
            const policy = await client.getViewPublicationPolicy(
                corpus.corpusId,
            );
            expect(policy.autoPublish).toBe(true);
            const publication = await client.getViewPublication({
                corpusId: corpus.corpusId,
                viewId: "guide",
            });
            expect(publication.indexedRevisionId).toBe(result.revisionId);
            const search = await client.searchViews({
                corpusId: corpus.corpusId,
                query: "Capacity",
                freshness: "current",
            });
            expect(search[0].view.revisionId).toBe(result.revisionId);
            expect(search[0].review).toBe("unreviewed");
            const current = await client.listViews(corpus.corpusId);
            await client.updateViewPublicationPolicy({
                corpusId: corpus.corpusId,
                expectedHead: current.head,
                expectedRevision: policy.revision,
                autoPublish: false,
            });
            expect(
                (
                    await client.getViewPublication({
                        corpusId: corpus.corpusId,
                        viewId: "guide",
                    })
                ).publishedRevisionId,
            ).toBe(result.revisionId);
            if (kind === "projectBrief") {
                expect(result.snapshot.pipeline).toBe(
                    "informational-project-summary-v1",
                );
                expect(result.inventory).toBeUndefined();
                expect(result.inventoryAudit).toBeUndefined();
                expect(result.coverage).toBeUndefined();
                const view = (await client.listViews(corpus.corpusId)).views[0];
                expect(view.content.citations[0].locator).toMatch(/^indexed:/);
                const citation = view.content.citations[0];
                expect(
                    (
                        await client.getSourceContent({
                            corpusId: corpus.corpusId,
                            sourceId: citation.sourceId,
                            revisionId: citation.revisionId,
                            indexedLocator: citation.locator,
                        })
                    ).content,
                ).toBe(citation.excerpt);
            } else {
                expect(result.inventory!.items[0].citations[0].revisionId).toBe(
                    source.revisionId,
                );
                expect(result.inventoryAudit!.supported).toBe(true);
                expect(
                    result
                        .coverage!.items.map((item) => item.excerpt)
                        .join("\n"),
                ).toContain("pending owner review");
                expect(result.coverage!.reuseEligibility).toBe(
                    kind !== "troubleshootingGuide"
                        ? "requiresFreshEvidence"
                        : "diagnosticOnly",
                );
            }
            const view = (await client.listViews(corpus.corpusId)).views[0];
            expect(view.generation!.inventory).toEqual(result.inventory);
            expect(view.generation!.coverage).toEqual(result.coverage);
            expect(
                (
                    await client.getViewHistory({
                        corpusId: corpus.corpusId,
                        viewId: "guide",
                    })
                )[0].version.generation!.inventoryAudit,
            ).toEqual(result.inventoryAudit);
            await client.close();
            client = undefined;
            await host.close();
            host = await MemoryServiceHost.start(open());
            client = await McpMemoryServiceClient.create({
                kind: "http",
                url: host.endpoint,
                headers: { authorization: `Bearer ${host.bearerToken}` },
            });
            expect(
                (await client.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: job.jobId,
                }))!.results[0].coverage,
            ).toEqual(result.coverage);
            const latest = await client.listViews(corpus.corpusId);
            const retry = await client.retryViewIndex({
                corpusId: corpus.corpusId,
                viewId: "guide",
                revisionId: result.revisionId!,
                expectedVersion: latest.views[0].version,
                expectedHead: latest.head!,
            });
            expect(retry.intent).toEqual(publication.intent);
            expect(stages).toHaveLength(kind === "projectBrief" ? 1 : 5);
            if (kind === "timeline") {
                const canonical = (
                    await client.appendEvent({
                        corpusId: corpus.corpusId,
                        idempotencyKey: "canonical-correction",
                        producer: {
                            producerId: "observer",
                            producerType: "test",
                        },
                        eventType: "configurationCorrection",
                        sourceKind: "system",
                        eventTime: "2026-10-05T08:45:00Z",
                        observedAt: "2026-10-06T08:05:00Z",
                        content:
                            "Configuration change learned the following day.",
                    })
                ).event;
                let eventJob = await client.buildViews({
                    corpusId: corpus.corpusId,
                    expectedHead: (await client.listViews(corpus.corpusId))
                        .head,
                    publication: false,
                    targets: [
                        {
                            expectedVersion: 0,
                            definition: {
                                viewId: "canonical-timeline",
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
                for (
                    let tries = 0;
                    eventJob.state === "running" && tries < 1000;
                    tries++
                ) {
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 10),
                    );
                    eventJob = (await client.getViewBuild({
                        corpusId: corpus.corpusId,
                        jobId: eventJob.jobId,
                    }))!;
                }
                expect(eventJob.results[0].state).toBe("draft");
                const eventView = (await client.getView({
                    corpusId: corpus.corpusId,
                    viewId: "canonical-timeline",
                }))!;
                expect(eventView.content.kind).toBe("timeline");
                expect(eventView.content.sections[0]).toMatchObject({
                    id: canonical.eventId,
                    role: "event",
                    details: {
                        identity: {
                            kind: "canonicalEvent",
                            eventId: canonical.eventId,
                        },
                        occurredAt: "2026-10-05T08:45:00.000Z",
                        learnedAt: "2026-10-06T08:05:00.000Z",
                        capturedAt: canonical.createdAt,
                    },
                });
                expect(eventView.content.citations[0]).toMatchObject({
                    evidence: { kind: "event", eventId: canonical.eventId },
                });
                await client.forgetEvents({
                    corpusId: corpus.corpusId,
                    eventIds: [canonical.eventId],
                    forgetLinkedSources: false,
                });
                expect(
                    await client.getView({
                        corpusId: corpus.corpusId,
                        viewId: "canonical-timeline",
                    }),
                ).toBeUndefined();
                expect(
                    await client.getView({
                        corpusId: corpus.corpusId,
                        viewId: "guide",
                    }),
                ).toBeDefined();
            }
            const edited = (await client.getView({
                corpusId: corpus.corpusId,
                viewId: "guide",
            }))!;
            const authored = edited.relationships.flatMap((edge) => {
                if (edge.origin === "system") return [];
                const {
                    schemaVersion: _schema,
                    family: _family,
                    origin: _origin,
                    reviewState: _review,
                    ...input
                } = edge;
                return [input];
            });
            const humanTitle = `Human maintained ${kind}`;
            await client.saveViewDraft({
                corpusId: corpus.corpusId,
                viewId: "guide",
                expectedVersion: edited.version,
                expectedHead: (await client.listViews(corpus.corpusId)).head,
                definition: {
                    viewId: "guide",
                    kind,
                    selector: edited.definition.selector,
                    ...(kind === "projectBrief"
                        ? {
                              projectSummary: edited.definition.projectSummary,
                          }
                        : {}),
                },
                content: { ...edited.content, title: humanTitle },
                relationships: authored,
            });
            const draft = (await client.getView({
                corpusId: corpus.corpusId,
                viewId: "guide",
            }))!;
            expect(
                draft.edits!.some(
                    (edit) =>
                        edit.target === "title" && edit.actor === draft.actor,
                ),
            ).toBe(true);
            const draftSearch = await client.searchViews({
                corpusId: corpus.corpusId,
                query: humanTitle,
                freshness: "current",
                kinds: [kind],
            });
            expect(
                draftSearch.some(
                    (match) => match.view.revisionId === draft.revisionId,
                ),
            ).toBe(kind === "projectBrief");
            if (kind === "projectBrief") return;
            async function rebuild(revisionId: string) {
                if (!client) throw new Error("Missing offline client");
                const snapshot = await client.listViews(corpus.corpusId);
                let job = await client.buildViews({
                    corpusId: corpus.corpusId,
                    expectedHead: snapshot.head,
                    publication: true,
                    targets: [
                        {
                            expectedVersion: snapshot.views.find(
                                (view) => view.viewId === "guide",
                            )!.version,
                            definition: {
                                viewId: "guide",
                                kind,
                                selector:
                                    kind === "timeline"
                                        ? {
                                              kind: "timelineEvidence",
                                              events: [],
                                              sources: [
                                                  {
                                                      sourceId: source.sourceId,
                                                      revisionId,
                                                  },
                                              ],
                                          }
                                        : {
                                              kind: "sources",
                                              sources: [
                                                  {
                                                      sourceId: source.sourceId,
                                                      revisionId,
                                                  },
                                              ],
                                          },
                            },
                        },
                    ],
                });
                for (
                    let tries = 0;
                    job.state === "running" && tries < 1000;
                    tries++
                ) {
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 10),
                    );
                    job = (await client.getViewBuild({
                        corpusId: corpus.corpusId,
                        jobId: job.jobId,
                    }))!;
                }
                expect(job.results[0]).toMatchObject({ state: "searchable" });
                expect(job.results[0].snapshot.publicationPolicy).toMatchObject(
                    { autoPublish: true, origin: "build" },
                );
            }
            await rebuild(source.revisionId);
            const merged = (await client.getView({
                corpusId: corpus.corpusId,
                viewId: "guide",
            }))!;
            expect(merged.content.title).toBe(humanTitle);
            expect(merged.provenance).toBe("merged");
            expect(
                merged
                    .edits!.filter((edit) => edit.status !== "cleared")
                    .every((edit) => edit.actor === draft.actor),
            ).toBe(true);
            expect(
                (
                    await client.searchViews({
                        corpusId: corpus.corpusId,
                        query: humanTitle,
                        freshness: "current",
                        kinds: [kind],
                    })
                )[0].view.revisionId,
            ).toBe(merged.revisionId);
            const retained = await client.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: source.sourceId,
                revisionId: source.revisionId,
            });
            const replacement = await client.replaceSource({
                corpusId: corpus.corpusId,
                sourceId: source.sourceId,
                expectedActiveRevisionId: source.revisionId,
                source: {
                    sourceType: "text",
                    title: "Synthetic evidence updated",
                    text: `${retained.content}\n\nContext: Additional capacity observation remains unresolved.`,
                },
            });
            await client.waitForJob(replacement.jobId);
            expect(
                await client.searchViews({
                    corpusId: corpus.corpusId,
                    query: humanTitle,
                    freshness: "current",
                    kinds: [kind],
                }),
            ).toEqual([]);
            await rebuild(replacement.revisionId);
            const updated = (await client.getView({
                corpusId: corpus.corpusId,
                viewId: "guide",
            }))!;
            expect(updated.content.title).toBe(humanTitle);
            expect(
                updated.content.citations.every(
                    (citation) =>
                        citation.revisionId === replacement.revisionId,
                ),
            ).toBe(true);
            await client.archiveView({
                corpusId: corpus.corpusId,
                viewId: "guide",
                expectedVersion: updated.version,
                expectedHead: (await client.listViews(corpus.corpusId)).head!,
            });
            expect(
                await client.searchViews({
                    corpusId: corpus.corpusId,
                    query: humanTitle,
                    freshness: "current",
                    kinds: [kind],
                }),
            ).toEqual([]);
            const preview = await client.previewForgetSource(
                corpus.corpusId,
                source.sourceId,
            );
            await client.forgetSource({
                corpusId: corpus.corpusId,
                sourceId: source.sourceId,
                confirmationToken: preview.confirmationToken,
            });
            expect(
                await client.getViewHistory({
                    corpusId: corpus.corpusId,
                    viewId: "guide",
                }),
            ).toEqual([]);
            expect(await client.listViewBuilds(corpus.corpusId)).toEqual([]);
            expect((await client.listViews(corpus.corpusId)).views).toEqual([]);
        } finally {
            await client?.close();
            await host?.close();
            await new Promise<void>((resolve, reject) =>
                model.close((error) => (error ? reject(error) : resolve())),
            );
            for (const key of installed) delete process.env[key];
            await rm(root, { recursive: true, force: true });
            expect(modelFailures).toEqual([]);
        }
    },
);
