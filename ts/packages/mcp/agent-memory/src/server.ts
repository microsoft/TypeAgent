// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

export const serviceName = "agent-memory-mcp";
export const serviceVersion = "0.0.1";

export type MemoryStatus = {
    service: string;
    version: string;
    schemaVersion: number;
    database: "not-initialized" | "ready";
};

export interface MemoryStatusProvider {
    getSchemaVersion(): number;
}

export function createMemoryServer(
    statusProvider?: MemoryStatusProvider,
): McpServer {
    const server = new McpServer({
        name: serviceName,
        version: serviceVersion,
    });

    server.registerTool(
        "memory_status",
        {
            description:
                "Report the agent-memory service and storage schema status.",
            inputSchema: {},
        },
        async () => {
            const status: MemoryStatus = {
                service: serviceName,
                version: serviceVersion,
                schemaVersion: statusProvider?.getSchemaVersion() ?? 0,
                database:
                    statusProvider === undefined ? "not-initialized" : "ready",
            };

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(status),
                    },
                ],
                structuredContent: status,
            };
        },
    );

    return server;
}

export async function startMemoryServer(
    statusProvider?: MemoryStatusProvider,
): Promise<McpServer> {
    const server = createMemoryServer(statusProvider);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}
