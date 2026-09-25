// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * remember and recall for one workspace-scoped ConversationMemory.
 * memoryName is omitted: every session in the workspace shares one store.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { withWorkspaceMemory } from "../shared/memory-client.js";

function toolResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
}

function toolError(text: string): CallToolResult {
    return { isError: true, content: [{ type: "text", text }] };
}

function workspaceCwd(): string {
    return process.env.TYPEAGENT_MEMORY_CWD || process.cwd();
}

class MemoryMcpServer {
    private server: McpServer;

    constructor() {
        this.server = new McpServer({
            name: "typeagent-memory",
            version: "0.0.1",
        });
        this.registerTools();
    }

    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }

    private registerTools(): void {
        this.server.tool(
            "remember",
            "Save one durable fact into this workspace's TypeAgent conversation memory. " +
                "Use when the user asks you to remember something, or when you learn a " +
                "workspace rule that later sessions must follow. Turns are already captured " +
                "automatically; do not call this for ordinary chat.",
            {
                memory: z
                    .string()
                    .describe("The fact to store, as a single statement."),
                source: z
                    .string()
                    .optional()
                    .describe("Where the fact came from. Defaults to chat."),
            },
            async ({ memory, source }) => this.remember(memory, source),
        );
        this.server.tool(
            "recall",
            "Answer a question from this workspace's TypeAgent conversation memory. " +
                "Searches the single conversation shared by every Copilot session in " +
                "this workspace. Does not search other workspaces.",
            {
                query: z
                    .string()
                    .describe(
                        "Natural language question to answer from memory.",
                    ),
            },
            async ({ query }) => this.recall(query),
        );
    }

    private async remember(
        memory: string,
        source: string | undefined,
    ): Promise<CallToolResult> {
        try {
            const saved = await withWorkspaceMemory(workspaceCwd(), (client) =>
                client.remember(memory, source),
            );
            return toolResult(JSON.stringify(saved));
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return toolError(message);
        }
    }

    private async recall(query: string): Promise<CallToolResult> {
        try {
            const answer = await withWorkspaceMemory(workspaceCwd(), (client) =>
                client.recall(query),
            );
            return toolResult(JSON.stringify(answer));
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return toolError(message);
        }
    }
}

const server = new MemoryMcpServer();
server.start().catch((error) => {
    process.stderr.write(
        `[typeagent-memory] Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
});
