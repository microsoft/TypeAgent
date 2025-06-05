// Copyright (c) Microsoft Corporation.

import { Content, McpClientFactory } from "./mcp.js";

export class MemoryClient {
    constructor(private _clientFactory: McpClientFactory) {}

    public async getAnswer(memoryName: string, query: string): Promise<string> {
        const client = await this._clientFactory();
        try {
            const result = await client.callTool({
                name: "getAnswer",
                arguments: { memoryName, query },
            });
            const content: Content[] = result.content as Content[];
            return content[0].text;
        } finally {
            client.close();
        }
    }
}
