// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { registerInventoryTools } from "./inventoryTools.js";
import { registerKnowledgeTools } from "./knowledgeTools.js";
import {
    questionCorpusRequestSchema,
    questionInventorySchema,
    questionEditRequestSchema,
    schemaViewPageRequestSchema,
    schemaViewPageSchema,
    schemaViewProposalRequestSchema,
    schemaQuestionDiscoveryRequestSchema,
    schemaViewToolNames,
    viewHistoryEntrySchema,
    acquisitionCorpusRequestSchema,
    acquisitionCancelRequestSchema,
    acquisitionProgressSchema,
    acquisitionProgressListSchema,
    acquisitionToolNames,
    projectAcquisitionProgress,
    safeAcquisitionOperation,
} from "@typeagent/memory-client";
import type {
    MemoryViewService,
    QuestionEditRequest,
    SchemaViewPageRequest,
    SchemaViewProposalRequest,
    SchemaQuestionDiscoveryRequest,
} from "@typeagent/memory-service";

export function registerSchemaViewTools(
    server: McpServer,
    service: Partial<MemoryViewService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
) {
    registerInventoryTools(server, service, run);
    registerKnowledgeTools(server, service, run);
    function required<K extends keyof MemoryViewService>(
        name: K,
    ): NonNullable<MemoryViewService[K]> {
        const method = service[name];
        if (typeof method !== "function")
            throw new Error(`Memory ${String(name)} capability is unavailable`);
        return method.bind(service) as NonNullable<MemoryViewService[K]>;
    }
    server.registerTool(
        schemaViewToolNames.listQuestions,
        {
            description:
                "Read the complete versioned question inventory, including proposals, candidates, citations, rubrics, freshness and maintenance errors. This read performs no model or tool calls.",
            inputSchema: questionCorpusRequestSchema,
            outputSchema: z.object({ result: questionInventorySchema }),
        },
        ({ corpusId }) => run(() => required("listQuestions")(corpusId)),
    );
    server.registerTool(
        schemaViewToolNames.editQuestion,
        {
            description:
                "Explicitly review candidates, record user assertions, approve or reject questions, edit slots/rubrics, or set finite discovery bounds with exact head/version guards. Never rewrites source evidence or authorizes external tools.",
            inputSchema: questionEditRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        (request) =>
            run(() => required("editQuestion")(request as QuestionEditRequest)),
    );
    server.registerTool(
        schemaViewToolNames.getViewPage,
        {
            description:
                "Resolve a deterministic agent-readable memory-view page with optional exact revision, slot and collection item selectors. No synthesis or external tools.",
            inputSchema: schemaViewPageRequestSchema,
            outputSchema: z.object({ result: schemaViewPageSchema }),
        },
        (request) =>
            run(() =>
                required("getViewPage")(request as SchemaViewPageRequest),
            ),
    );
    server.registerTool(
        schemaViewToolNames.proposeSchemaView,
        {
            description:
                "After explicit user approval, propose a schema-defined view from prose, a form or an example with explicit maintenance scope. Examples are specifications, not facts; proposed slots require separate user approval.",
            inputSchema: schemaViewProposalRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        (request) =>
            run(() =>
                required("proposeSchemaView")(
                    request as SchemaViewProposalRequest,
                ),
            ),
    );
    server.registerTool(
        schemaViewToolNames.discoverSchemaQuestions,
        {
            description:
                "Explicitly generate bounded question proposals from existing retained evidence for a discovery-enabled view. Proposals are not approved facts and confer no acquisition authority.",
            inputSchema: schemaQuestionDiscoveryRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        (request) =>
            run(() =>
                required("discoverSchemaQuestions")(
                    request as SchemaQuestionDiscoveryRequest,
                ),
            ),
    );
    server.registerTool(
        acquisitionToolNames.listAcquisitionProgress,
        {
            description:
                "Read acquisition progress and consumer IDs only. Outbound arguments, authority details, staged content and raw request errors are excluded.",
            inputSchema: acquisitionCorpusRequestSchema,
            outputSchema: z.object({ result: acquisitionProgressListSchema }),
        },
        ({ corpusId }) =>
            run(() =>
                safeAcquisitionOperation(async () =>
                    (await required("listAcquisitions")(corpusId)).map(
                        projectAcquisitionProgress,
                    ),
                ),
            ),
    );
    server.registerTool(
        acquisitionToolNames.runAcquisitionProgress,
        {
            description:
                "Explicitly run existing host-authorized acquisition requests once. Does not admit requests, grant tools, change outbound arguments or enable periodic work. Tools remain disabled unless the host authorizes them.",
            inputSchema: acquisitionCorpusRequestSchema,
            outputSchema: z.object({ result: acquisitionProgressListSchema }),
        },
        ({ corpusId }) =>
            run(() =>
                safeAcquisitionOperation(async () =>
                    (await required("runAcquisitions")(corpusId)).map(
                        projectAcquisitionProgress,
                    ),
                ),
            ),
    );
    server.registerTool(
        acquisitionToolNames.cancelAcquisitionProgress,
        {
            description:
                "Cancel an existing acquisition by corpus/request ID without deleting shared retained sources. Returns sanitized progress only.",
            inputSchema: acquisitionCancelRequestSchema,
            outputSchema: z.object({ result: acquisitionProgressSchema }),
        },
        (request) =>
            run(() =>
                safeAcquisitionOperation(async () =>
                    projectAcquisitionProgress(
                        await required("cancelAcquisition")(request),
                    ),
                ),
            ),
    );
}
