// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryFrameService } from "@typeagent/memory-service";
import {
    frameCorpusRequestSchema,
    frameQueryRequestSchema,
    frameQueryResultSchema,
    frameSchemasSchema,
    frameProjectionStatusSchema,
    frameToolNames,
} from "@typeagent/memory-client";
import { z } from "zod";

export function registerFrameTools(
    server: McpServer,
    service: Partial<MemoryFrameService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    server.registerTool(
        frameToolNames.listFrameSchemas,
        {
            description:
                "List admitted source/view dataframe schemas and typed fields. Backfills deterministic projections; performs no synthesis.",
            inputSchema: frameCorpusRequestSchema,
            outputSchema: z.object({ result: frameSchemasSchema }),
        },
        ({ corpusId }) =>
            run(() => {
                if (!service.listFrameSchemas)
                    throw new Error("Memory dataframes are not supported");
                return service.listFrameSchemas(corpusId);
            }),
    );
    server.registerTool(
        frameToolNames.queryFrame,
        {
            description:
                "Query exact same-item typed frame predicates with revision-pinned evidence and coverage. Natural-language query is optional and uses only the admitted schema.",
            inputSchema: frameQueryRequestSchema,
            outputSchema: z.object({ result: frameQueryResultSchema }),
        },
        (request) =>
            run(() => {
                if (!service.queryFrame)
                    throw new Error("Memory dataframes are not supported");
                return service.queryFrame(request);
            }),
    );
    server.registerTool(
        frameToolNames.getFrameProjectionStatus,
        {
            description:
                "Reconcile deterministic frame projections and return revision readiness and unavailable-value coverage.",
            inputSchema: frameCorpusRequestSchema,
            outputSchema: z.object({ result: frameProjectionStatusSchema }),
        },
        ({ corpusId }) =>
            run(() => {
                if (!service.getFrameProjectionStatus)
                    throw new Error("Memory dataframes are not supported");
                return service.getFrameProjectionStatus(corpusId);
            }),
    );
}
