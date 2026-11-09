// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    knowledgeToolNames,
} from "@typeagent/memory-client";
import type {
    KnowledgeCheckpoint,
    KnowledgeStatus,
    MemoryKnowledgeService,
    MemoryService,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const checkpoint: KnowledgeCheckpoint = {
    version: 1,
    checkpointId: "checkpoint",
    corpusId: "corpus",
    createdAt: "now",
    updatedAt: "now",
    state: "partial",
    sources: [{ sourceId: "source", revisionId: "revision" }],
    families: ["questions"],
    excludedFamilies: ["wiki"],
    producerComplete: false,
    indexVersion: "index",
    viewIds: [],
    jobIds: [],
    discoveryFingerprints: [],
    coverage: { inspectedSources: 1, deferredSources: 2 },
    reasons: ["Budget exhausted"],
};
const status: KnowledgeStatus = {
    discovery: {
        version: 1,
        policy: "off",
        policyVersion: 1,
        receipts: [],
        routes: [],
        callTimes: [],
    },
    checkpoints: [checkpoint],
};

test("knowledge operations round-trip over actual MCP HTTP, retaining nonready coverage and strict authority boundaries", async () => {
    const calls: unknown[] = [];
    const reference = {
        viewId: "view",
        revisionId: "revision",
        state: "selected" as const,
    };
    const methods: MemoryKnowledgeService & Pick<MemoryService, "answer"> = {
        async answer(request) {
            calls.push(request);
            return {
                question: request.question,
                answer: "You stated Ada.",
                mode: "synthesized",
                citations: [],
                grounded: true,
                indexVersion: "index",
                derivedReferences: [reference],
                assertionReferences: [
                    {
                        ...reference,
                        candidateId: "candidate",
                        assertionOrigin: "user",
                    },
                ],
                warnings: [
                    "User assertion is not independent source verification",
                ],
            };
        },
        async getKnowledgeStatus(corpusId) {
            calls.push(corpusId);
            return status;
        },
        async updateKnowledgeDiscovery(request) {
            calls.push(request);
            return {
                ...status,
                discovery: { ...status.discovery, policy: request.policy },
            };
        },
        async createKnowledgeCheckpoint(request) {
            calls.push(request);
            return checkpoint;
        },
        async getKnowledgeCheckpoint(request) {
            calls.push(request);
            return checkpoint;
        },
        async waitForKnowledgeCheckpoint(request) {
            calls.push(request);
            return checkpoint;
        },
    };
    const host = await MemoryServiceHost.start(
        methods as MemoryService & MemoryKnowledgeService,
    );
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    const raw = new Client({ name: "knowledge-offline-test", version: "1" });
    try {
        await raw.connect(
            new StreamableHTTPClientTransport(new URL(host.endpoint), {
                requestInit: {
                    headers: { Authorization: `Bearer ${host.bearerToken}` },
                },
            }) as Transport,
        );
        const local = new InProcessMemoryServiceClient(
            methods as MemoryService & MemoryKnowledgeService,
        );
        expect(await client.getKnowledgeStatus("corpus")).toEqual(
            await local.getKnowledgeStatus("corpus"),
        );
        expect(
            (
                await client.updateKnowledgeDiscovery({
                    corpusId: "corpus",
                    policy: "sourceObserved",
                    retryFailed: true,
                })
            ).discovery.policy,
        ).toBe("sourceObserved");
        expect(
            await client.createKnowledgeCheckpoint({
                corpusId: "corpus",
                producerComplete: false,
                families: ["questions"],
                timeoutMs: 600000,
            }),
        ).toEqual(checkpoint);
        expect(
            await client.getKnowledgeCheckpoint({
                corpusId: "corpus",
                checkpointId: "checkpoint",
            }),
        ).toEqual(checkpoint);
        expect(
            await client.waitForKnowledgeCheckpoint({
                corpusId: "corpus",
                checkpointId: "checkpoint",
                timeoutMs: 3600000,
            }),
        ).toEqual(checkpoint);
        const answer = await client.answer({
            corpusId: "corpus",
            question: "Name?",
            retrievalPolicy: "sourcesAndViews",
            knowledgeCheckpointId: "checkpoint",
        });
        expect(answer.derivedReferences).toEqual([reference]);
        expect(answer.assertionReferences?.[0].candidateId).toBe("candidate");
        expect(calls.at(-1)).toEqual({
            corpusId: "corpus",
            question: "Name?",
            retrievalPolicy: "sourcesAndViews",
            knowledgeCheckpointId: "checkpoint",
        });
        await client.updateKnowledgeDiscovery({
            corpusId: "corpus",
            policy: "off",
        });
        expect(calls.at(-1)).toEqual({ corpusId: "corpus", policy: "off" });
        await client.createKnowledgeCheckpoint({ corpusId: "corpus" });
        expect(calls.at(-1)).toEqual({ corpusId: "corpus" });
        await client.waitForKnowledgeCheckpoint({
            corpusId: "corpus",
            checkpointId: "checkpoint",
        });
        expect(calls.at(-1)).toEqual({
            corpusId: "corpus",
            checkpointId: "checkpoint",
        });
        const previous = calls.length;
        const invalid = await raw.callTool({
            name: knowledgeToolNames.updateKnowledgeDiscovery,
            arguments: {
                corpusId: "corpus",
                policy: "sourceObserved",
                externalTool: "fetch",
            },
        });
        expect(invalid.isError).toBe(true);
        expect(calls).toHaveLength(previous);
        const tooLong = await raw.callTool({
            name: knowledgeToolNames.waitForKnowledgeCheckpoint,
            arguments: {
                corpusId: "corpus",
                checkpointId: "checkpoint",
                timeoutMs: 3600001,
            },
        });
        expect(tooLong.isError).toBe(true);
        expect(calls).toHaveLength(previous);
    } finally {
        await raw.close();
        await client.close();
        await host.close();
    }
});
test("unsupported knowledge capability fails explicitly in process", async () => {
    const client = new InProcessMemoryServiceClient({} as MemoryService);
    await expect(client.getKnowledgeStatus("corpus")).rejects.toThrow(
        "not supported",
    );
    await expect(
        client.createKnowledgeCheckpoint({ corpusId: "corpus" }),
    ).rejects.toThrow("not supported");
});
