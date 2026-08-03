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

    constructor(
        private readonly explorer: RepositoryExplorer,
        private readonly expectedQuery?: string,
    ) {
        this.server = new McpServer({
            name: "typeagent-explore",
            version: "0.1.0",
        });
        const querySchema = z
            .string()
            .min(1)
            .max(12000)
            .refine((value) => value.trim().length > 0, {
                message: "query must not be blank",
            })
            .describe(
                "The complete issue or repository question copied verbatim from the user query, including exact identifiers, errors, reproduction details, and historical line clues; do not summarize or reformat it",
            );
        const maxResultsSchema = z
            .number()
            .int()
            .min(1)
            .max(6)
            .optional()
            .describe("Maximum ranked code chunks (default 6)");
        const inputSchema =
            this.expectedQuery === undefined
                ? z.strictObject({
                      query: querySchema,
                      maxResults: maxResultsSchema,
                  })
                : z.strictObject({ maxResults: maxResultsSchema });
        this.server.registerTool(
            "explore",
            {
                description:
                    "Use a bounded TypeAgent reasoning loop to execute typed Explorer discovery, refinement, and submission actions. Two Code Mode programs share one ls, glob, grep, and read budget; final locations are selected after both results are visible. Returns server-validated repository-relative path:line evidence.",
                inputSchema,
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: false,
                },
            },
            async (request) => {
                try {
                    const query =
                        this.expectedQuery ??
                        ("query" in request && typeof request.query === "string"
                            ? request.query
                            : undefined);
                    if (query === undefined) {
                        throw new Error("query is required");
                    }
                    const exploreRequest: ExploreRequest = {
                        query,
                        ...(request.maxResults !== undefined
                            ? { maxResults: request.maxResults }
                            : {}),
                    };
                    return textResult(
                        await this.explorer.explore(exploreRequest),
                    );
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
