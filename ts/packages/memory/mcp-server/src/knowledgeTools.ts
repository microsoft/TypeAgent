// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryKnowledgeService } from "@typeagent/memory-service";
import {
    knowledgeCorpusRequestSchema,
    knowledgeDiscoveryUpdateSchema,
    knowledgeCheckpointRequestSchema,
    knowledgeCheckpointReadSchema,
    knowledgeCheckpointWaitSchema,
    knowledgeCheckpointSchema,
    knowledgeStatusSchema,
    knowledgeToolNames,
} from "@typeagent/memory-client";
import { z } from "zod";

export function registerKnowledgeTools(
    server: McpServer,
    service: Partial<MemoryKnowledgeService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
) {
    function required<K extends keyof MemoryKnowledgeService>(
        name: K,
    ): MemoryKnowledgeService[K] {
        const method = service[name];
        if (typeof method !== "function")
            throw new Error(`Memory ${name} capability is unavailable`);
        return method.bind(service) as MemoryKnowledgeService[K];
    }
    server.registerTool(
        knowledgeToolNames.getKnowledgeStatus,
        {
            description:
                "Read source-observed discovery receipts and fixed-scope knowledge checkpoints. Source ingestion completion is not knowledge readiness. Does not invoke models or external tools.",
            inputSchema: knowledgeCorpusRequestSchema,
            outputSchema: z.strictObject({ result: knowledgeStatusSchema }),
        },
        ({ corpusId }) => run(() => required("getKnowledgeStatus")(corpusId)),
    );
    server.registerTool(
        knowledgeToolNames.updateKnowledgeDiscovery,
        {
            description:
                "Explicitly set corpus discovery off, suggest, or sourceObserved. Policy admission is informational, not human confirmation or permission for external tools. Existing corpora are not silently enabled.",
            inputSchema: knowledgeDiscoveryUpdateSchema,
            outputSchema: z.strictObject({ result: knowledgeStatusSchema }),
        },
        ({ corpusId, policy, retryFailed }) =>
            run(() =>
                required("updateKnowledgeDiscovery")({
                    corpusId,
                    policy,
                    ...(retryFailed === undefined ? {} : { retryFailed }),
                }),
            ),
    );
    server.registerTool(
        knowledgeToolNames.createKnowledgeCheckpoint,
        {
            description:
                "Capture a bounded source-revision and knowledge-family checkpoint. Set producerComplete only after the producer has sealed the batch. Readiness is scoped, never an exhaustive-memory claim. No external tools are authorized.",
            inputSchema: knowledgeCheckpointRequestSchema,
            outputSchema: z.strictObject({ result: knowledgeCheckpointSchema }),
        },
        ({ corpusId, sourceIds, families, producerComplete, timeoutMs }) =>
            run(() =>
                required("createKnowledgeCheckpoint")({
                    corpusId,
                    ...(sourceIds === undefined ? {} : { sourceIds }),
                    ...(families === undefined ? {} : { families }),
                    ...(producerComplete === undefined
                        ? {}
                        : { producerComplete }),
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                }),
            ),
    );
    server.registerTool(
        knowledgeToolNames.getKnowledgeCheckpoint,
        {
            description:
                "Read a captured knowledge checkpoint, including exclusions, inspected/deferred coverage and failure reasons.",
            inputSchema: knowledgeCheckpointReadSchema,
            outputSchema: z.strictObject({ result: knowledgeCheckpointSchema }),
        },
        (request) => run(() => required("getKnowledgeCheckpoint")(request)),
    );
    server.registerTool(
        knowledgeToolNames.waitForKnowledgeCheckpoint,
        {
            description:
                "Wait for a fixed knowledge checkpoint within a finite timeout (1 to 3600000ms). A nonready return or timeout is not successful readiness; inspect state and reasons.",
            inputSchema: knowledgeCheckpointWaitSchema,
            outputSchema: z.strictObject({ result: knowledgeCheckpointSchema }),
        },
        ({ corpusId, checkpointId, timeoutMs }) =>
            run(() =>
                required("waitForKnowledgeCheckpoint")({
                    corpusId,
                    checkpointId,
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                }),
            ),
    );
}
