// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
    MemoryViewService,
    ViewSummaryRequest,
    QuestionSummaryRequest,
    QuestionReadRequest,
    InventoryPageRequest,
    ViewPublicationBatchRequest,
} from "@typeagent/memory-service";
import {
    inventoryToolNames,
    inventoryPageRequestSchema,
    viewSummaryRequestSchema,
    questionSummaryRequestSchema,
    questionReadRequestSchema,
    viewPublicationBatchRequestSchema,
    viewSummaryPageSchema,
    questionSummaryPageSchema,
    questionDetailSchema,
    viewBuildSummaryPageSchema,
    viewPublicationBatchSchema,
} from "@typeagent/memory-client";

export function registerInventoryTools(
    server: McpServer,
    service: Partial<MemoryViewService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
) {
    function required<K extends keyof MemoryViewService>(
        name: K,
    ): NonNullable<MemoryViewService[K]> {
        const method = service[name];
        if (typeof method !== "function")
            throw new Error(`Memory ${String(name)} capability is unavailable`);
        return method.bind(service) as NonNullable<MemoryViewService[K]>;
    }
    server.registerTool(
        inventoryToolNames.listViewSummaries,
        {
            description:
                "Read a bounded page of view titles, type, state and batched publication status; no document bodies or build inputs.",
            inputSchema: viewSummaryRequestSchema,
            outputSchema: z.object({ result: viewSummaryPageSchema }),
        },
        (request) =>
            run(() =>
                required("listViewSummaries")(request as ViewSummaryRequest),
            ),
    );
    server.registerTool(
        inventoryToolNames.listQuestionSummaries,
        {
            description:
                "Read a bounded, filterable page of question status cards without answer values, schemas or repeated evidence excerpts.",
            inputSchema: questionSummaryRequestSchema,
            outputSchema: z.object({ result: questionSummaryPageSchema }),
        },
        (request) =>
            run(() =>
                required("listQuestionSummaries")(
                    request as QuestionSummaryRequest,
                ),
            ),
    );
    server.registerTool(
        inventoryToolNames.getQuestion,
        {
            description:
                "Read one complete question including schema, candidates and source evidence on demand.",
            inputSchema: questionReadRequestSchema,
            outputSchema: z.object({ result: questionDetailSchema }),
        },
        (request) =>
            run(() => required("getQuestion")(request as QuestionReadRequest)),
    );
    server.registerTool(
        inventoryToolNames.listViewBuildSummaries,
        {
            description:
                "Read a bounded page of operation status without frozen source text, prompts or generated document bodies.",
            inputSchema: inventoryPageRequestSchema,
            outputSchema: z.object({ result: viewBuildSummaryPageSchema }),
        },
        (request) =>
            run(() =>
                required("listViewBuildSummaries")(
                    request as InventoryPageRequest,
                ),
            ),
    );
    server.registerTool(
        inventoryToolNames.getViewPublications,
        {
            description:
                "Read publication states for at most 100 unique view IDs in one consistent history snapshot.",
            inputSchema: viewPublicationBatchRequestSchema,
            outputSchema: z.object({ result: viewPublicationBatchSchema }),
        },
        (request) =>
            run(() =>
                required("getViewPublications")(
                    request as ViewPublicationBatchRequest,
                ),
            ),
    );
}
