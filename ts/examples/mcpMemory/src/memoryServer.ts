// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cm from "conversation-memory";
import { addPingTool, toolResult } from "./mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function rememberRequestSchema() {
    return {
        memoryName: z.string(),
        memory: z.string(),
        source: z.string().optional(),
    };
}
const RememberRequestSchema = z.object(rememberRequestSchema());

function recallRequestSchema() {
    return {
        memoryName: z.string(),
        query: z.string(),
    };
}
const RecallRequestSchema = z.object(recallRequestSchema());

export type RememberRequest = z.infer<typeof RememberRequestSchema>;
export type RecallRequest = z.infer<typeof RecallRequestSchema>;

export class MemoryServer {
    public server: McpServer;
    public memoryName: string | undefined;
    public memory?: cm.ConversationMemory | undefined;

    /**
     *
     * @param baseDirPath The base directory where memories are stored. Directory must already exist
     * @param name
     * @param debugMode
     */
    constructor(
        public baseDirPath: string,
        debugMode: boolean = true,
    ) {
        this.server = new McpServer({
            name: "Memory-Server",
            version: "1.0.0",
        });
        this.addTools();
        if (debugMode) {
            this.addDiagnosticTools();
        }
    }

    public async start(transport?: StdioServerTransport): Promise<void> {
        transport ??= new StdioServerTransport();
        await this.server.connect(transport);
    }

    private addTools() {
        this.server.tool(
            "remember",
            rememberRequestSchema(),
            async (request: RememberRequest) => this.remember(request),
        );
        this.server.tool(
            "recall",
            recallRequestSchema(),
            async (request: RecallRequest) => this.recall(request),
        );
    }

    public async remember(request: RememberRequest): Promise<CallToolResult> {
        let memory = await this.getMemory(request.memoryName);
        if (!memory) {
            return toolResult(`Memory ${request.memoryName} does not exist`);
        }
        const messageMeta = request.source
            ? new cm.ConversationMessageMeta(request.source)
            : undefined;

        const message = new cm.ConversationMessage(request.memory, messageMeta);
        const result = await memory.addMessage(message);
        if (!result.success) {
            return toolResult(result.message);
        }
        return toolResult(`Added memories to memory: ${request.memoryName}`);
    }

    public async recall(request: RecallRequest): Promise<CallToolResult> {
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

    private addDiagnosticTools() {
        addPingTool(this.server);
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
                dirPath: this.baseDirPath,
                baseFileName: memoryName,
            },
            false,
        );
        this.memoryName = memoryName;
        return memory;
    }
}
