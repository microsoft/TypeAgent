// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

export async function callTool<T>(
    clientFactory: McpClientFactory,
    caller: (client: Client) => Promise<T>,
): Promise<T> {
    const client = await clientFactory();
    try {
        return await caller(client);
    } finally {
        client.close();
    }
}
