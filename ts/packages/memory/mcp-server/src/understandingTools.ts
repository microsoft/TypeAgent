// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryService } from "@typeagent/memory-service";
import {
    understandingToolNames,
    understandingRequestSchema,
    understandingResultSchema,
    understandingModuleRequestSchema,
    understandingModuleResultSchema,
} from "@typeagent/memory-client";
import { z } from "zod";

export function registerUnderstandingTools(
    server: McpServer,
    service: Pick<MemoryService, "understand" | "understandingModule">,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    const bounded = async (
        operation: () => Promise<unknown>,
        maximum: number,
    ) => {
        const result = await run(operation);
        if (Buffer.byteLength(JSON.stringify(result), "utf8") <= maximum)
            return result;
        return {
            isError: true,
            content: [
                {
                    type: "text" as const,
                    text: `Understanding tool wrapper exceeds ${maximum} byte budget`,
                },
            ],
        };
    };
    server.registerTool(
        understandingToolNames.understand,
        {
            description:
                "Explain evidence in one indexed document collection with ready source cards and optional supported visuals. Use memory_answer for Markdown; use memory_preview for compact host UI. All-memory and conversation scopes are not supported here.",
            inputSchema: understandingRequestSchema,
            outputSchema: z.object({ result: understandingResultSchema }),
            annotations: { readOnlyHint: true },
        },
        (request) =>
            bounded(() => {
                if (!service.understand)
                    throw new Error("Memory understanding is not supported");
                return service.understand(request);
            }, 128 * 1024),
    );
    server.registerTool(
        understandingToolNames.module,
        {
            description:
                "Read a bounded visual/source module for a live collection-scoped understanding. Does not call the answer model.",
            inputSchema: understandingModuleRequestSchema,
            outputSchema: z.object({ result: understandingModuleResultSchema }),
            annotations: { readOnlyHint: true },
        },
        (request) =>
            bounded(() => {
                if (!service.understandingModule)
                    throw new Error(
                        "Memory understanding modules are not supported",
                    );
                return service.understandingModule(request);
            }, 64 * 1024),
    );
}
