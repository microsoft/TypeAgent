// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
} from "@typeagent/memory-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
    MemoryService,
    MemoryGraphQueryResult,
    MemoryGraphSupportPage,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";
import { registerGraphTools } from "../src/graphTools.js";

const graph: MemoryGraphQueryResult = {
    corpusId: "corpus",
    generation: "generation",
    state: "building",
    nodes: [
        {
            id: "graph:corpus:entity:abc",
            kind: "entity",
            label: "Zephyr",
            types: ["system"],
            mentionCount: 3,
            supportCount: 2,
            distinctEventCount: 1,
            distinctTurnCount: 1,
        },
    ],
    edges: [],
    counts: { nodes: 10, edges: 2, omittedNodes: 9, omittedEdges: 2 },
    limits: { maxNodes: 1, maxEdges: 1 },
    coverage: {
        documents: { state: "ready", total: 1, eligible: 1, indexed: 1 },
        events: { state: "building", total: 1, eligible: 1, indexed: 0 },
        reasons: ["Projection preparation"],
    },
    nextContinuationToken: "inventory-next",
};
const support: MemoryGraphSupportPage = {
    generation: "generation",
    total: 2,
    nextContinuationToken: "support-next",
    items: [
        {
            kind: "document",
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Guide",
            locator: "exact-locator",
        },
        {
            kind: "event",
            corpusId: "corpus",
            eventId: "event",
            conversationId: "chat",
            turnId: "turn",
            eventTime: "2026-10-24T00:00:00Z",
            sender: "assistant",
            authority: "evidence-only",
            title: "turn.completed",
        },
    ],
};

test("graph and support round-trip across RPC facade, in-process SDK and real MCP HTTP", async () => {
    const calls: unknown[] = [];
    const service = {
        queryKnowledgeGraph: async (request: unknown) => {
            calls.push(request);
            return graph;
        },
        queryGraphSupport: async (request: unknown) => {
            calls.push(request);
            return support;
        },
    } as unknown as MemoryService;
    const facade = createMemoryServiceRpcFacade(service);
    const local = new InProcessMemoryServiceClient(facade);
    const host = await MemoryServiceHost.start(facade);
    const remote = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const request = {
            corpusId: "corpus",
            kind: "entities" as const,
            maxNodes: 2,
            maxEdges: 1,
            pageBy: "edges" as const,
            evidenceKinds: ["document" as const, "event" as const],
            eventFilter: { authorities: ["evidence-only" as const] },
            expectedGeneration: "generation",
            continuationToken: "inventory-next",
        };
        expect(await remote.queryKnowledgeGraph(request)).toEqual(
            await local.queryKnowledgeGraph(request),
        );
        expect(calls[0]).toEqual(request);
        const detail = {
            corpusId: "corpus",
            generation: "generation",
            nodeId: graph.nodes[0].id,
            pageSize: 2,
        };
        expect(await remote.queryGraphSupport(detail)).toEqual(
            await local.queryGraphSupport(detail),
        );
        expect(() =>
            remote.queryKnowledgeGraph({ ...request, maxNodes: 251 }),
        ).toThrow();
        expect(() =>
            remote.queryKnowledgeGraph({ ...request, maxNodes: 1 }),
        ).toThrow();
        expect(() =>
            remote.queryGraphSupport({ ...detail, pageSize: 51 }),
        ).toThrow();
        const raw = new Client({ name: "graph-validation", version: "1" });
        try {
            await raw.connect(
                new StreamableHTTPClientTransport(new URL(host.endpoint), {
                    requestInit: {
                        headers: {
                            Authorization: `Bearer ${host.bearerToken}`,
                        },
                    },
                }) as Transport,
            );
            const malformed = await raw.callTool({
                name: "memory_graph_query",
                arguments: {
                    corpusId: "corpus",
                    kind: "entities",
                    eventFilter: { authorities: ["trusted"] },
                },
            });
            expect(malformed.isError).toBe(true);
            const invalidEdges = await raw.callTool({
                name: "memory_graph_query",
                arguments: {
                    corpusId: "corpus",
                    kind: "entities",
                    pageBy: "edges",
                    maxNodes: 1,
                },
            });
            expect(invalidEdges.isError).toBe(true);
        } finally {
            await raw.close();
        }
        expect(calls).toHaveLength(4);
    } finally {
        await remote.close();
        await host.close();
    }
});

test("legacy hosts retain absent RPC capabilities and explicit unsupported SDK errors", async () => {
    const facade = createMemoryServiceRpcFacade({} as MemoryService);
    expect(facade.queryKnowledgeGraph).toBeUndefined();
    expect(facade.queryGraphSupport).toBeUndefined();
    const client = new InProcessMemoryServiceClient(facade);
    await expect(
        client.queryKnowledgeGraph({ corpusId: "corpus", kind: "topics" }),
    ).rejects.toThrow("not supported");
    await expect(
        client.queryGraphSupport({
            corpusId: "corpus",
            generation: "generation",
            nodeId: "node",
        }),
    ).rejects.toThrow("not supported");
});

test("graph tool inventory advertises only implemented host operations", async () => {
    const server = new McpServer({ name: "graph-inventory", version: "1" });
    const register = jest.spyOn(server, "registerTool");
    const run = async () => ({ content: [] });
    try {
        registerGraphTools(server, {} as MemoryService, run);
        expect(register).not.toHaveBeenCalled();
        registerGraphTools(
            server,
            { queryKnowledgeGraph: async () => graph } as MemoryService,
            run,
        );
        expect(register.mock.calls.map(([name]) => name)).toEqual([
            "memory_graph_query",
        ]);
    } finally {
        await server.close();
    }
});
