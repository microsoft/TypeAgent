// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    ExploreServer,
    type RepositoryExplorer,
} from "../src/exploreServer.js";

describe("ExploreServer", () => {
    const clients: Client[] = [];
    const servers: ExploreServer[] = [];

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.close()));
        await Promise.all(servers.splice(0).map((server) => server.close()));
    });

    async function connect(
        explorer: RepositoryExplorer,
        expectedQuery?: string,
    ): Promise<Client> {
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const server = new ExploreServer(explorer, expectedQuery);
        const client = new Client({
            name: "typeagent-explore-test",
            version: "1.0.0",
        });

        await server.start(serverTransport);
        await client.connect(clientTransport);
        servers.push(server);
        clients.push(client);
        return client;
    }

    it("advertises exactly one explore tool and delegates valid calls", async () => {
        const explore = jest
            .fn<RepositoryExplorer["explore"]>()
            .mockResolvedValue(
                "src/auth.ts:10-20 relevant authentication code",
            );
        const client = await connect({ explore });

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(["explore"]);
        const tool = tools.tools[0];
        expect(tool).toBeDefined();
        if (!tool) {
            throw new Error("Expected explore tool");
        }
        const inputSchema = tool.inputSchema as unknown as {
            properties: {
                query: { maxLength: number; description: string };
                maxResults: { maximum: number };
            };
        };
        expect(tool.description).toContain("Code Mode");
        expect(tool.description).toContain("ls, glob, grep, and read");
        expect(inputSchema.properties.query.maxLength).toBe(12000);
        expect(inputSchema.properties.query.description).toMatch(
            /complete issue/i,
        );
        expect(inputSchema.properties.query.description).toMatch(/verbatim/i);
        expect(inputSchema.properties.maxResults.maximum).toBe(6);
        expect(tool.annotations).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        });

        const query = "  where is authentication handled?\n";
        const result = (await client.callTool({
            name: "explore",
            arguments: {
                query,
                maxResults: 4,
            },
        })) as CallToolResult;

        expect(explore).toHaveBeenCalledWith({
            query,
            maxResults: 4,
        });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([
            {
                type: "text",
                text: "src/auth.ts:10-20 relevant authentication code",
            },
        ]);
    });

    it("binds the exact benchmark query behind a zero-query schema", async () => {
        const expectedQuery =
            "  preserve this query exactly\r\nincluding e\u0301 and trailing spaces  ";
        const explore = jest
            .fn<RepositoryExplorer["explore"]>()
            .mockResolvedValue("src/index.ts:1");
        const client = await connect({ explore }, expectedQuery);

        const tools = await client.listTools();
        const properties = (
            tools.tools[0]?.inputSchema as {
                properties?: Record<string, unknown>;
            }
        ).properties;
        expect(properties).toEqual({
            maxResults: expect.objectContaining({ maximum: 6 }),
        });

        const accepted = (await client.callTool({
            name: "explore",
            arguments: {},
        })) as CallToolResult;
        expect(accepted.isError).not.toBe(true);
        expect(explore).toHaveBeenCalledWith({ query: expectedQuery });

        const rejected = (await client.callTool({
            name: "explore",
            arguments: { query: expectedQuery },
        })) as CallToolResult;
        expect(rejected.isError).toBe(true);
        expect(explore).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid input before invoking the explorer", async () => {
        const explore = jest.fn<RepositoryExplorer["explore"]>();
        const client = await connect({ explore });

        const result = (await client.callTool({
            name: "explore",
            arguments: { query: "", maxResults: 0 },
        })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(explore).not.toHaveBeenCalled();
    });

    it("returns explorer failures as MCP tool errors", async () => {
        const client = await connect({
            explore: async () => {
                throw new Error("code generation unavailable");
            },
        });

        const result = (await client.callTool({
            name: "explore",
            arguments: { query: "find the parser" },
        })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            {
                type: "text",
                text: "Explore failed: code generation unavailable",
            },
        ]);
    });
});
