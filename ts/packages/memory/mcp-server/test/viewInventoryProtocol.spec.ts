// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FileMemoryService,
    type ViewBuildJob,
} from "@typeagent/memory-service";
import { McpMemoryServiceClient } from "@typeagent/memory-client";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const {
    FakeProcedureCorpusIndex,
}: typeof import("../../service/dist/test/fakeProcedureCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeProcedureCorpusIndex.js",
            import.meta.url,
        ).href
    );
const {
    projectBriefTestAnswer,
    projectSources,
}: typeof import("../../service/dist/test/projectBriefTestModel.js") =
    await import(
        new URL(
            "../../../service/dist/test/projectBriefTestModel.js",
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
                const answer = (
                    kind === "timeline"
                        ? timelineTestAnswer
                        : kind === "projectBrief"
                          ? projectBriefTestAnswer
                          : inventoryTestAnswer
                )(schema.name, JSON.parse(user.content));
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
                viewDrafts: true,
                runbookModelEndpoint: `openai:${endpoint}`,
                indexFactory: (_id, directory) =>
                    new FakeProcedureCorpusIndex(directory),
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
            expect(job.results[0]).toMatchObject({ state: "searchable" });
            expect(job.state).toBe("complete");
            expect(stages).toEqual([
                "memory_source_fact_inventory",
                "memory_source_inventory_check",
                kind === "timeline"
                    ? "memory_timeline_construction"
                    : kind === "projectBrief"
                      ? "memory_project_brief_construction"
                      : "memory_inventory_guide_construction",
                "memory_inventory_artifact_support",
                "memory_inventory_artifact_support",
            ]);
            const result = job.results[0];
            expect(result.state).toBe("searchable");
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
            expect(result.inventory!.items[0].citations[0].revisionId).toBe(
                source.revisionId,
            );
            expect(result.inventoryAudit!.supported).toBe(true);
            expect(
                result.coverage!.items.map((item) => item.excerpt).join("\n"),
            ).toContain("pending owner review");
            expect(result.coverage!.reuseEligibility).toBe(
                kind !== "troubleshootingGuide"
                    ? "requiresFreshEvidence"
                    : "diagnosticOnly",
            );
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
            expect(stages).toHaveLength(5);
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
