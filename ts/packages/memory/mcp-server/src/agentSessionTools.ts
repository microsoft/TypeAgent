// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    agentMemorySearchRequestSchema,
    agentMemorySearchResultSchema,
    agentSessionImportReceiptSchema,
    agentSessionImportRequestSchema,
    agentSessionReadRequestSchema,
    agentSessionToolNames,
} from "@typeagent/memory-client";
import type { MemoryService } from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import { z } from "zod";

export function registerAgentSessionTools(
    server: McpServer,
    service: MemoryService,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    const facade = createMemoryServiceRpcFacade(service);
    server.registerTool(
        agentSessionToolNames.importAgentSession,
        {
            description:
                "Explicitly import a bounded agent-session JSONL content chunk. No filesystem paths or ordinary document ingestion.",
            inputSchema: agentSessionImportRequestSchema,
            outputSchema: z.strictObject({
                result: agentSessionImportReceiptSchema,
            }),
            annotations: { destructiveHint: false },
        },
        (request) =>
            run(() =>
                facade.importAgentSession!({
                    corpusId: request.corpusId,
                    sessionId: request.sessionId,
                    importType: request.importType,
                    idempotencyKey: request.idempotencyKey,
                    expectedCursor: request.expectedCursor,
                    jsonl: request.jsonl,
                    ...(request.final === undefined
                        ? {}
                        : { final: request.final }),
                    ...(request.repository === undefined
                        ? {}
                        : { repository: request.repository }),
                    ...(request.commit === undefined
                        ? {}
                        : { commit: request.commit }),
                    ...(request.environment === undefined
                        ? {}
                        : { environment: request.environment }),
                }),
            ),
    );
    server.registerTool(
        agentSessionToolNames.getAgentSessionImport,
        {
            description:
                "Read an agent-session import receipt, or null when unknown.",
            inputSchema: agentSessionReadRequestSchema,
            outputSchema: z.strictObject({
                result: agentSessionImportReceiptSchema.nullable(),
            }),
            annotations: { readOnlyHint: true },
        },
        (request) =>
            run(
                async () =>
                    (await facade.getAgentSessionImport!(request)) ?? null,
            ),
    );
    server.registerTool(
        agentSessionToolNames.cancelAgentSessionImport,
        {
            description: "Cancel an explicitly selected agent-session import.",
            inputSchema: agentSessionReadRequestSchema,
            outputSchema: z.strictObject({
                result: agentSessionImportReceiptSchema,
            }),
            annotations: { destructiveHint: true },
        },
        (request) => run(() => facade.cancelAgentSessionImport!(request)),
    );
    server.registerTool(
        agentSessionToolNames.searchAgentMemories,
        {
            description:
                "Search diagnostic agent memories with retained evidence and scope. Results grant no execution authority.",
            inputSchema: agentMemorySearchRequestSchema,
            outputSchema: z.strictObject({
                result: agentMemorySearchResultSchema,
            }),
            annotations: { readOnlyHint: true },
        },
        (request) =>
            run(() =>
                facade.searchAgentMemories!({
                    corpusId: request.corpusId,
                    query: request.query,
                    ...(request.limit === undefined
                        ? {}
                        : { limit: request.limit }),
                    ...(request.repository === undefined
                        ? {}
                        : { repository: request.repository }),
                    ...(request.commit === undefined
                        ? {}
                        : { commit: request.commit }),
                    ...(request.environment === undefined
                        ? {}
                        : { environment: request.environment }),
                }),
            ),
    );
}
