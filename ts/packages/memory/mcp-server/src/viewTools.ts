// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
    MemoryService,
    PersonalHowToService,
    MemoryViewService,
    ViewReadRequest,
    ViewSaveRequest,
    ViewBuildRequest,
    ViewConflictResolution,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import {
    viewToolNames,
    viewSnapshotSchema,
    viewReadRequestSchema,
    viewVersionSchema,
    viewSaveRequestSchema,
    viewArchiveRequestSchema,
    viewHistoryEntrySchema,
    viewBuildRequestSchema,
    viewBuildJobRequestSchema,
    viewBuildJobSchema,
    viewConflictReadSchema,
    viewConflictSchema,
    viewResolutionSchema,
} from "@typeagent/memory-client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function registerViewTools(
    server: McpServer,
    service: MemoryService & PersonalHowToService & Partial<MemoryViewService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    const views = createMemoryServiceRpcFacade(service);
    const corpus = z.strictObject({ corpusId: z.string().min(1).max(200) });
    server.registerTool(
        viewToolNames.listViews,
        {
            description:
                "List developer draft views; never default search results.",
            inputSchema: corpus,
            outputSchema: z.object({ result: viewSnapshotSchema }),
        },
        async ({ corpusId }) => run(() => views.listViews(corpusId)),
    );
    server.registerTool(
        viewToolNames.getView,
        {
            description: "Inspect exact draft view revision.",
            inputSchema: viewReadRequestSchema,
            outputSchema: z.object({ result: viewVersionSchema.nullable() }),
        },
        async (request) =>
            run(
                async () =>
                    (await views.getView(request as ViewReadRequest)) ?? null,
            ),
    );
    server.registerTool(
        viewToolNames.saveViewDraft,
        {
            description:
                "Save explicit human edits under expected head/version; OS actor assigned by service.",
            inputSchema: viewSaveRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        async (request) =>
            run(() => views.saveViewDraft(request as ViewSaveRequest)),
    );
    server.registerTool(
        viewToolNames.archiveView,
        {
            description: "Archive a draft with concurrency guards.",
            inputSchema: viewArchiveRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        async (request) => run(() => views.archiveView(request)),
    );
    server.registerTool(
        viewToolNames.getViewHistory,
        {
            description: "Inspect durable view history.",
            inputSchema: viewReadRequestSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema.array() }),
        },
        async (request) =>
            run(() => views.getViewHistory(request as ViewReadRequest)),
    );
    server.registerTool(
        viewToolNames.publishView,
        {
            description: "Explicitly unsupported: memory views are draft-only.",
            inputSchema: viewReadRequestSchema,
        },
        async (request) =>
            run(() => views.publishView(request as ViewReadRequest)),
    );
    server.registerTool(
        viewToolNames.buildViews,
        {
            description:
                "Build draft troubleshooting guides from complete exact retained input snapshots.",
            inputSchema: viewBuildRequestSchema,
            outputSchema: z.object({ result: viewBuildJobSchema }),
        },
        async (request) =>
            run(() => views.buildViews(request as ViewBuildRequest)),
    );
    server.registerTool(
        viewToolNames.getViewBuild,
        {
            description: "Inspect durable per-target build progress/receipt.",
            inputSchema: viewBuildJobRequestSchema,
            outputSchema: z.object({ result: viewBuildJobSchema.nullable() }),
        },
        async (request) =>
            run(async () => (await views.getViewBuild(request)) ?? null),
    );
    server.registerTool(
        viewToolNames.listViewBuilds,
        {
            description: "Inspect latest bounded draft build receipts.",
            inputSchema: corpus,
            outputSchema: z.object({ result: viewBuildJobSchema.array() }),
        },
        async ({ corpusId }) => run(() => views.listViewBuilds(corpusId)),
    );
    server.registerTool(
        viewToolNames.cancelViewBuild,
        {
            description:
                "Cancel pending materialization; completed drafts remain.",
            inputSchema: viewBuildJobRequestSchema,
            outputSchema: z.object({ result: viewBuildJobSchema }),
        },
        async (request) => run(() => views.cancelViewBuild(request)),
    );
    server.registerTool(
        viewToolNames.retryViewBuild,
        {
            description:
                "Explicit retry under current target/head; stale source selectors require a new build.",
            inputSchema: viewBuildJobRequestSchema,
            outputSchema: z.object({ result: viewBuildJobSchema }),
        },
        async (request) => run(() => views.retryViewBuild(request)),
    );
    server.registerTool(
        viewToolNames.getViewConflict,
        {
            description: "Inspect exact base/human/new conflict comparison.",
            inputSchema: viewConflictReadSchema,
            outputSchema: z.object({ result: viewConflictSchema.nullable() }),
        },
        async (request) =>
            run(async () => (await views.getViewConflict(request)) ?? null),
    );
    server.registerTool(
        viewToolNames.resolveViewConflict,
        {
            description:
                "Authenticated explicit conflict resolution, revalidated against exact evidence and guarded current/head/input.",
            inputSchema: viewResolutionSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        async (request) =>
            run(() =>
                views.resolveViewConflict(request as ViewConflictResolution),
            ),
    );
}
