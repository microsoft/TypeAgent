// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    agentMemorySearchResultSchema,
    agentSessionImportReceiptSchema,
    agentSessionImportRequestSchema,
    agentSessionReadRequestSchema,
} from "@typeagent/memory-client";
import type {
    AgentMemorySearchResult,
    AgentSessionImportReceipt,
    AgentSessionImportRequest,
    MemoryService,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const request: AgentSessionImportRequest = {
    corpusId: "corpus",
    sessionId: "session",
    importType: "agent-session-jsonl",
    idempotencyKey: "chunk-0",
    expectedCursor: 0,
    jsonl: '{"id":"event-1","text":"Use retained evidence."}\n',
    final: false,
    repository: "repo",
    commit: "commit",
    environment: "offline",
};
const receipt: AgentSessionImportReceipt = {
    schemaVersion: 1,
    corpusId: request.corpusId,
    sessionId: request.sessionId,
    importType: request.importType,
    state: "partial",
    cursor: 1,
    final: false,
    sourceCount: 1,
    memoryCount: 1,
    duplicates: 2,
    losses: [{ line: 2, reason: "Unrecognized record" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
    error: "Some records were omitted",
};
const result: AgentMemorySearchResult = {
    memories: [
        {
            memoryId: "memory-1",
            kind: "procedure",
            title: "Retained observation",
            body: "Not executable authority",
            state: "diagnostic-only",
            scope: {
                repository: "repo",
                commit: "commit",
                environment: "offline",
            },
            evidence: [
                {
                    eventId: "event-1",
                    sourceId: "source-1",
                    revisionId: "revision-1",
                    locator: "event:event-1",
                    excerpt: "Original evidence",
                },
            ],
            influenceSourceIds: ["source-1", "source-2"],
            supersedes: ["previous-memory"],
            conflicted: true,
        },
    ],
    warnings: ["Diagnostic observations only"],
};

function fixture() {
    let lastRequest: AgentSessionImportRequest | undefined;
    const service = {
        importAgentSession: async (input: AgentSessionImportRequest) => {
            lastRequest = input;
            if (input.expectedCursor !== 0) throw new Error("Cursor mismatch");
            return structuredClone(receipt);
        },
        getAgentSessionImport: async (input: { sessionId: string }) =>
            input.sessionId === "missing"
                ? undefined
                : structuredClone(receipt),
        cancelAgentSessionImport: async () => ({
            ...receipt,
            state: "cancelled" as const,
        }),
        searchAgentMemories: async () => structuredClone(result),
    } as unknown as MemoryService;
    return { service, getLastRequest: () => lastRequest };
}

test("all agent session fields survive in-process, RPC and actual MCP HTTP round trips", async () => {
    const { service, getLastRequest } = fixture();
    const host = await MemoryServiceHost.start(service);
    const remote = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const read = {
            corpusId: request.corpusId,
            sessionId: request.sessionId,
        };
        const clients = [
            new InProcessMemoryServiceClient(service),
            createMemoryServiceRpcFacade(service),
            remote,
        ];
        for (const client of clients) {
            expect(await client.importAgentSession!(request)).toEqual(receipt);
            expect(getLastRequest()).toEqual(request);
            expect(await client.getAgentSessionImport!(read)).toEqual(receipt);
            expect(
                await client.getAgentSessionImport!({
                    corpusId: "corpus",
                    sessionId: "missing",
                }),
            ).toBeUndefined();
            expect(await client.cancelAgentSessionImport!(read)).toEqual({
                ...receipt,
                state: "cancelled",
            });
            expect(
                await client.searchAgentMemories!({
                    corpusId: "corpus",
                    query: "evidence",
                    repository: "repo",
                    commit: "commit",
                    environment: "offline",
                    limit: 10,
                }),
            ).toEqual(result);
        }
        await expect(
            remote.importAgentSession({ ...request, expectedCursor: 4 }),
        ).rejects.toThrow("Cursor mismatch");
        expect(agentSessionImportReceiptSchema.parse(receipt)).toEqual(receipt);
        expect(agentMemorySearchResultSchema.parse(result)).toEqual(result);
    } finally {
        await remote.close();
        await host.close();
    }
});

test("unsupported optional service capabilities produce explicit errors through every adapter", async () => {
    const service = {} as MemoryService;
    const host = await MemoryServiceHost.start(service);
    const remote = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const read = {
            corpusId: request.corpusId,
            sessionId: request.sessionId,
        };
        for (const client of [
            new InProcessMemoryServiceClient(service),
            createMemoryServiceRpcFacade(service),
            remote,
        ]) {
            await expect(client.importAgentSession!(request)).rejects.toThrow(
                "not supported",
            );
            await expect(client.getAgentSessionImport!(read)).rejects.toThrow(
                "not supported",
            );
            await expect(
                client.cancelAgentSessionImport!(read),
            ).rejects.toThrow("not supported");
            await expect(
                client.searchAgentMemories!({
                    corpusId: "corpus",
                    query: "test",
                }),
            ).rejects.toThrow("not supported");
        }
    } finally {
        await remote.close();
        await host.close();
    }
});

test("strict bounded schemas reject unknown fields, oversized UTF-8 chunks and excess lines", () => {
    expect(
        agentSessionImportRequestSchema.safeParse({
            ...request,
            path: "private.jsonl",
        }).success,
    ).toBe(false);
    expect(
        agentSessionImportRequestSchema.safeParse({
            ...request,
            jsonl: "é".repeat(262145),
        }).success,
    ).toBe(false);
    expect(
        agentSessionImportRequestSchema.safeParse({
            ...request,
            jsonl: "{}\n".repeat(1001),
        }).success,
    ).toBe(false);
    expect(
        agentSessionImportRequestSchema.safeParse({
            ...request,
            jsonl: "{}\n".repeat(1000),
        }).success,
    ).toBe(true);
    expect(
        agentSessionImportRequestSchema.safeParse({
            ...request,
            jsonl: "a".repeat(512 * 1024),
        }).success,
    ).toBe(true);
    expect(
        agentSessionReadRequestSchema.safeParse({
            corpusId: "corpus",
            sessionId: "session",
            path: "private.jsonl",
        }).success,
    ).toBe(false);
    const { evidence: _evidence, ...withoutEvidence } = result.memories[0];
    expect(
        agentMemorySearchResultSchema.safeParse({
            ...result,
            memories: [withoutEvidence],
        }).success,
    ).toBe(false);
    expect(
        agentSessionImportReceiptSchema.safeParse({
            ...receipt,
            privileged: true,
        }).success,
    ).toBe(false);
});
