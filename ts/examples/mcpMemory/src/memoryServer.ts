// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IConversation } from "knowpro";
import { z } from "zod";
import * as cm from "conversation-memory";

export class MemoryServer {
    public server: McpServer;
    public conversation?: IConversation | undefined;

    constructor(
        public basePath: string,
        name?: string,
    ) {
        name ??= "Memory-Server";
        this.server = new McpServer({ name, version: "1.0.0" });
        this.addTools();
    }

    public async start(transport?: StdioServerTransport): Promise<void> {
        transport ??= new StdioServerTransport();
        await this.server.connect(transport);
    }

    protected addTools() {
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
        this.server.tool(
            "getAnswer",
            { memoryName: z.string(), query: z.string() },
            async ({ memoryName, query }) => {
                let response = await this.getAnswer(memoryName, query);
                return {
                    content: [{ type: "text", text: response }],
                };
            },
        );
    }

    public async getAnswer(memoryName: string, query: string): Promise<string> {
        let conversation = await this.loadMemory(memoryName);
        if (!conversation) {
            return "No such memory";
        }
        const result = await conversation.getAnswerFromLanguage(query);
        if (!result.success) {
            return result.message;
        }
        const responses = result.data;
        let text = "";
        for (const response of responses) {
            const [_, answer] = response;
            if (text.length > 0) {
                text += "\n";
            }
            text +=
                answer.type === "Answered" ? answer.answer : answer.whyNoAnswer;
        }
        return text;
    }

    private loadMemory(
        memoryName: string,
    ): Promise<cm.ConversationMemory | undefined> {
        console.log(`Loading ${this.basePath} ${memoryName}`);
        return cm.createConversationMemory(
            {
                dirPath: this.basePath,
                baseFileName: memoryName,
            },
            false,
        );
    }
}
