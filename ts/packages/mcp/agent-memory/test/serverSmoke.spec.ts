// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SequenceIdGenerator, createAccessScope } from "../src/index.js";
import { SqliteMemoryRepository } from "../src/repository/index.js";
import {
    createMemoryServer,
    serviceName,
    serviceVersion,
    type MemoryStatus,
} from "../src/server.js";

const packageDirectory = fileURLToPath(new URL("../../", import.meta.url));
const serverPath = fileURLToPath(
    new URL("../../dist/src/main.js", import.meta.url),
);

describe("agent-memory MCP server", () => {
    test("creates and closes without a transport", async () => {
        const server = createMemoryServer();

        await server.close();
    });

    test("records, queries, and gets memory over stdio", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "agent-memory-m8-stdio-"),
        );
        const databasePath = path.join(directory, "memory.db");
        const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 10));
        const scope = createAccessScope(ids.generate("Scope"), {
            userId: "m8-user",
        });
        const otherScope = createAccessScope(ids.generate("Scope"), {
            userId: "other-user",
        });
        const repository = SqliteMemoryRepository.open(databasePath);
        repository.saveScope(scope);
        repository.saveScope(otherScope);
        repository.close();
        const client = new Client({
            name: "agent-memory-test-client",
            version: "0.0.1",
        });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [
                serverPath,
                "--database",
                databasePath,
                "--cursor-secret",
                "m8-stdio-integration-secret-value",
            ],
            cwd: packageDirectory,
            stderr: "pipe",
        });

        try {
            await client.connect(transport);

            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "memory_status",
                    "memory_record_turn",
                    "memory_query",
                    "memory_get",
                ]),
            );

            const result = await client.callTool({
                name: "memory_status",
                arguments: {},
            });
            const status = result.structuredContent as MemoryStatus;

            expect(status).toEqual({
                service: serviceName,
                version: serviceVersion,
                schemaVersion: 2,
                database: "ready",
            });

            const turnId = ids.generate("Turn");
            const recorded = await client.callTool({
                name: "memory_record_turn",
                arguments: {
                    turnId,
                    idempotencyKey: "m8-stdio-turn",
                    scope,
                    conversationId: "m8-stdio-conversation",
                    sequence: 1,
                    primaryTopicPath: "/project/memory",
                    requestSummary: "Expose MCP retrieval",
                    outcomeSummary: "M8 query and get are available",
                    occurredAt: "2026-08-10T12:00:00.000Z",
                    provenance: {
                        sourceType: "agent",
                        actorId: "m8-test",
                        observedAt: "2026-08-10T12:00:00.000Z",
                    },
                    terms: [{ text: "retrieval" }],
                },
            });
            if (recorded.isError === true) {
                throw new Error(JSON.stringify(recorded.content));
            }
            expect(recorded.isError).not.toBe(true);

            const queried = await client.callTool({
                name: "memory_query",
                arguments: {
                    scopeId: scope.scopeId,
                    query: "/topics/project/memory/turns tokens 1024",
                    timeZone: "UTC",
                    now: "2026-08-10T12:00:00.000Z",
                },
            });
            expect(queried.isError).not.toBe(true);
            expect(queried.content).toEqual([
                expect.objectContaining({
                    type: "text",
                    text: expect.stringContaining("M8 query and get"),
                }),
            ]);
            const queryMetadata = queried.structuredContent as {
                packet: {
                    references: readonly { entityId: string }[];
                    estimatedTokens: number;
                    truncated: boolean;
                };
            };
            expect(queryMetadata.packet.references).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ entityId: turnId }),
                ]),
            );

            const fetched = await client.callTool({
                name: "memory_get",
                arguments: {
                    scopeId: scope.scopeId,
                    memoryIds: ["missing-id", turnId],
                    tokenBudget: 4096,
                },
            });
            expect(fetched.isError).not.toBe(true);
            expect(fetched.content).toEqual([
                expect.objectContaining({
                    text: expect.stringContaining("M8 query and get"),
                }),
            ]);
            expect(
                (fetched.structuredContent as { items: unknown[] }).items,
            ).toEqual([
                { memoryId: "missing-id", status: "notFound" },
                expect.objectContaining({ memoryId: turnId, status: "found" }),
            ]);

            const unknownField = await client.callTool({
                name: "memory_get",
                arguments: {
                    scopeId: scope.scopeId,
                    memoryIds: [turnId],
                    tokenBudget: 4096,
                    unexpected: true,
                },
            });
            expect(unknownField.isError).toBe(true);

            const inaccessible = await client.callTool({
                name: "memory_get",
                arguments: {
                    scopeId: otherScope.scopeId,
                    memoryIds: [turnId],
                    tokenBudget: 4096,
                },
            });
            expect(inaccessible.isError).not.toBe(true);
            expect(
                (inaccessible.structuredContent as { items: unknown[] }).items,
            ).toEqual([{ memoryId: turnId, status: "notFound" }]);
        } finally {
            await client.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
