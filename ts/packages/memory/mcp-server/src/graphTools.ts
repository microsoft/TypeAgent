// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
    MemoryService,
    MemoryGraphQueryRequest,
    MemoryGraphSupportRequest,
} from "@typeagent/memory-service";
import {
    graphQueryRequestSchema,
    graphQueryResultSchema,
    graphSupportRequestSchema,
    graphSupportPageSchema,
    graphToolNames,
} from "@typeagent/memory-client";

export function registerGraphTools(
    server: McpServer,
    service: MemoryService,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    server.registerTool(
        graphToolNames.queryKnowledgeGraph,
        {
            description:
                "Read a bounded corpus-qualified document/event entity, topic or maintained hierarchy graph without evidence text. Coverage reports preparation and staleness explicitly.",
            inputSchema: graphQueryRequestSchema,
            outputSchema: z.object({ result: graphQueryResultSchema }),
        },
        (request) =>
            run(() => {
                if (!service.queryKnowledgeGraph)
                    throw new Error("Memory graph queries are not supported");
                return service.queryKnowledgeGraph(
                    request as MemoryGraphQueryRequest,
                );
            }),
    );
    server.registerTool(
        graphToolNames.queryGraphSupport,
        {
            description:
                "Page document/event provenance for a graph node or edge in an exact graph generation; no evidence bodies.",
            inputSchema: graphSupportRequestSchema,
            outputSchema: z.object({ result: graphSupportPageSchema }),
        },
        (request) =>
            run(() => {
                if (!service.queryGraphSupport)
                    throw new Error("Memory graph support is not supported");
                return service.queryGraphSupport(
                    request as MemoryGraphSupportRequest,
                );
            }),
    );
}
