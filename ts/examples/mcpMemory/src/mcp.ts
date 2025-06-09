// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type Content = {
    type: string;
    text: string;
};

export type McpClientFactory = () => Promise<Client>;

export type NodeServerSettings = {
    scriptPath: string;
    clientName?: string;
};

export async function createNodeClient(
    settings: NodeServerSettings,
): Promise<Client> {
    const client = new Client({
        name: settings.clientName ?? "TypeAgent",
        version: "1.0.0",
    });
    const transport = new StdioClientTransport({
        command: "node",
        args: [settings.scriptPath],
        stderr: "pipe",
    });
    await client.connect(transport);
    return client;
}

//-------------------
//
// TOOLS
//
//-------------------
export async function callTool<T extends Record<string, any>>(
    client: Client | McpClientFactory,
    name: string,
    request: T,
) {
    if (!(client instanceof Client)) {
        client = await client();
    }
    try {
        return (await client.callTool({
            name,
            arguments: request,
        })) as CallToolResult;
    } finally {
        client.close();
    }
}

export async function callTextTool<T extends Record<string, any>>(
    client: Client | McpClientFactory,
    name: string,
    request: T,
): Promise<string> {
    const result = await callTool<T>(client, name, request);
    return result.content.length > 0 && result.content[0].type == "text"
        ? result.content[0].text
        : "NO response";
}

export function toolResult(result: string): CallToolResult {
    return {
        content: [{ type: "text", text: result }],
    };
}

//------------------------
//
// PING TOOL
//
//------------------------

function pingSchema() {
    return { message: z.string() };
}
const PingRequestSchema = z.object(pingSchema());

export type PingRequest = z.infer<typeof PingRequestSchema>;
export type PingResponse = string;

export function addPingTool(server: McpServer) {
    server.tool("ping", pingSchema(), async (pingRequest: PingRequest) => {
        let response = pingRequest.message
            ? "PONG: " + pingRequest.message
            : "pong";
        return toolResult(response);
    });
}

export async function callPingTool(
    client: Client | McpClientFactory,
    request: PingRequest,
): Promise<PingResponse> {
    return await callTextTool<PingRequest>(client, "ping", request);
}
