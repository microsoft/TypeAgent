// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export class MemoryServer {
    private server: McpServer;

    constructor(name?: string) {
        name ??= "Memory-Server";
        this.server = new McpServer({ name, version: "1.0.0" });
        this.addTools();
    }

    public async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }

    protected addTools() {
        this.addStandardTools();
    }

    protected addStandardTools() {
        this.server.tool(
            "ping",
            { message: z.string() },
            async ({ message }) => {
                let response = message ? "PONG: " + message : "pong";
                return {
                    content: [{ type: "text", text: response }],
                };
            },
        );
    }
}
