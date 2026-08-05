// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
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

    test("reports status over stdio", async () => {
        const client = new Client({
            name: "agent-memory-test-client",
            version: "0.0.1",
        });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [serverPath],
            cwd: packageDirectory,
            stderr: "pipe",
        });

        try {
            await client.connect(transport);

            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toContain(
                "memory_status",
            );

            const result = await client.callTool({
                name: "memory_status",
                arguments: {},
            });
            const status = result.structuredContent as MemoryStatus;

            expect(status).toEqual({
                service: serviceName,
                version: serviceVersion,
                schemaVersion: 1,
                database: "ready",
            });
        } finally {
            await client.close();
        }
    });
});
