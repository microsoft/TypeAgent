// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cm from "conversation-memory";
import { addPingTool } from "./mcp.js";

export class MemoryServer {
    public server: McpServer;
    public memoryName: string | undefined;
    public memory?: cm.ConversationMemory | undefined;

    constructor(
        public basePath: string,
        name?: string,
        debugMode: boolean = true,
    ) {
        name ??= "Memory-Server";
        this.server = new McpServer({ name, version: "1.0.0" });
        this.addTools();
        if (debugMode) {
            this.addDiagnosticTools();
        }
    }

    public addDiagnosticTools() {
        addPingTool(this.server);
    }

    public async start(transport?: StdioServerTransport): Promise<void> {
        transport ??= new StdioServerTransport();
        await this.server.connect(transport);
    }

    protected addTools() {
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
        let memory = await this.getMemory(memoryName);
        if (!memory) {
            return "No such memory";
        }
        const result = await memory.getAnswerFromLanguage(query);
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

    private async getMemory(
        memoryName: string,
    ): Promise<cm.ConversationMemory> {
        if (memoryName === this.memoryName && this.memory) {
            return this.memory;
        }
        this.memory = undefined;
        return await this.loadMemory(memoryName);
    }

    private async loadMemory(
        memoryName: string,
    ): Promise<cm.ConversationMemory> {
        const memory = await cm.createConversationMemory(
            {
                dirPath: this.basePath,
                baseFileName: memoryName,
            },
            false,
        );
        this.memoryName = memoryName;
        return memory;
    }
}
