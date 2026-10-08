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
    inventoryTestAnswer,
}: typeof import("../../service/dist/test/viewInventoryTestModel.js") =
    await import(
        new URL(
            "../../../service/dist/test/viewInventoryTestModel.js",
            import.meta.url,
        ).href
    );

test("configured adapter inventory and final coverage survive authenticated MCP, history and reopen", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "inventory-mcp-offline-"),
    );
    const stages: string[] = [];
    const modelFailures: unknown[] = [];
    const model = createServer(async (request, response) => {
        try {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
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
            const answer = inventoryTestAnswer(
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
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    if (!address || typeof address === "string")
        throw new Error("Offline model listener unavailable");
    const environment = {
        OPENAI_ENDPOINT_V5_OFFLINE: `http://127.0.0.1:${address.port}/chat/completions`,
        OPENAI_API_KEY_V5_OFFLINE: "synthetic-offline-token-not-a-secret",
        OPENAI_MODEL_V5_OFFLINE: "synthetic-offline-model",
        OPENAI_ORGANIZATION_V5_OFFLINE: "synthetic-offline",
        OPENAI_RESPONSE_FORMAT_V5_OFFLINE: "1",
        ENABLE_MODEL_REQUEST_LOGGING_V5_OFFLINE: "false",
    };
    let host: MemoryServiceHost | undefined;
    let client: McpMemoryServiceClient | undefined;
    const installed: string[] = [];
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            runbookModelEndpoint: "openai:V5_OFFLINE",
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
                text: "Capacity is blocked pending owner review. No recovery is confirmed.",
            },
        });
        await client.waitForJob(source.jobId);
        let job: ViewBuildJob = await client.buildViews({
            corpusId: corpus.corpusId,
            expectedHead: (await client.listViews(corpus.corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "guide",
                        kind: "troubleshootingGuide",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                },
                            ],
                        },
                    },
                },
            ],
        });
        for (let tries = 0; job.state === "running" && tries < 1000; tries++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            const current = await client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            });
            if (!current)
                throw new Error("Missing durable MCP inventory receipt");
            job = current;
        }
        expect(job.state).toBe("complete");
        expect(stages).toEqual([
            "memory_source_fact_inventory",
            "memory_source_inventory_check",
            "memory_inventory_guide_construction",
            "memory_inventory_artifact_support",
            "memory_inventory_artifact_support",
        ]);
        const result = job.results[0];
        expect(result.inventory!.items[0].citations[0].revisionId).toBe(
            source.revisionId,
        );
        expect(result.inventoryAudit!.supported).toBe(true);
        expect(result.coverage!.items[0].excerpt).toContain(
            "pending owner review",
        );
        expect(result.coverage!.reuseEligibility).toBe("diagnosticOnly");
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
});
