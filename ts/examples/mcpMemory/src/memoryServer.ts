// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cm from "conversation-memory";
import { addPingTool, toolResult } from "./mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function getAnswerSchema() {
    return { memoryName: z.string(), query: z.string() };
}
const GetAnswerRequestSchema = z.object(getAnswerSchema());

export type GetAnswerRequest = z.infer<typeof GetAnswerRequestSchema>;

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
            getAnswerSchema(),
            async (request: GetAnswerRequest) => this.getAnswer(request),
        );
    }

    public async getAnswer(request: GetAnswerRequest): Promise<CallToolResult> {
        let memory = await this.getMemory(request.memoryName);
        if (!memory) {
            return toolResult(`Memory ${request.memoryName} does not exist`);
        }
        const result = await memory.getAnswerFromLanguage(request.query);
        if (!result.success) {
            return toolResult(result.message);
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
        return toolResult(text);
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
