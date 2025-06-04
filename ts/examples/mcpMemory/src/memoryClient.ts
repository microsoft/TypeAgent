// Copyright (c) Microsoft Corporation.

import { Content, McpClientFactory } from "./mcp.js";

// Licensed under the MIT License.
export class MemoryClient {
    constructor(private _clientFactory: McpClientFactory) {}

    public async ping(): Promise<string> {
        const client = await this._clientFactory();
        try {
            const result = await client.callTool({
                name: "ping",
                arguments: { message: "Yo" },
            });
            const content: Content[] = result.content as Content[];
            return content[0].text;
        } finally {
            client.close();
        }
    }
}
