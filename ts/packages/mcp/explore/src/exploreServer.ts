// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExploreRequest, RepositoryExplorer } from "explorer-typeagent";
import { z } from "zod/v4";

export type { ExploreRequest, RepositoryExplorer } from "explorer-typeagent";

function textResult(text: string, isError = false): CallToolResult {
    return {
        content: [{ type: "text", text }],
        ...(isError ? { isError: true } : {}),
    };
}

export class ExploreServer {
    public readonly server: McpServer;

    constructor(private readonly explorer: RepositoryExplorer) {
        this.server = new McpServer({
            name: "typeagent-explore",
            version: "0.1.0",
        });
        this.server.registerTool(
            "explore",
            {
                description:
                    "Use a bounded TypeAgent reasoning loop to discover and execute typed Explorer AppAgent actions. Code Mode runs bounded read-only repository programs with one shared ls, glob, grep, and read budget, then submits server-validated locations. Returns compact repository-relative path:line evidence.",
                inputSchema: {
                    query: z
                        .string()
                        .trim()
                        .min(1)
                        .max(12000)
                        .describe(
                            "The complete issue or repository question, including exact identifiers, errors, reproduction details, and historical line clues; do not summarize it",
                        ),
                    maxResults: z
                        .number()
                        .int()
                        .min(1)
                        .max(6)
                        .optional()
                        .describe("Maximum ranked code chunks (default 6)"),
                },
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: false,
                },
            },
            async (request: ExploreRequest) => {
                try {
                    return textResult(await this.explorer.explore(request));
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    return textResult(`Explore failed: ${message}`, true);
                }
            },
        );
    }

    public async start(transport?: Transport): Promise<void> {
        await this.server.connect(transport ?? new StdioServerTransport());
    }

    public async close(): Promise<void> {
        await this.server.close();
        await this.explorer.close?.();
    }
}
