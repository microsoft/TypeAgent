// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    viewArchiveRequestSchema,
    viewBuildJobRequestSchema,
    viewBuildJobSchema,
    viewBuildRequestSchema,
    viewConflictReadSchema,
    viewConflictSchema,
    viewHistoryEntrySchema,
    viewMaintenancePlanRequestSchema,
    viewMaintenancePlanSchema,
    viewMaintenanceReadSchema,
    viewMaintenanceRequestSchema,
    viewMaintenanceResultSchema,
    viewMaintenanceUpdateSchema,
    viewPublicationPolicySchema,
    viewPublicationPolicyUpdateSchema,
    viewPublicationStatusSchema,
    viewPublishRequestSchema,
    viewReadRequestSchema,
    viewResolutionSchema,
    viewSaveRequestSchema,
    viewSearchMatchSchema,
    viewSearchRequestSchema,
    viewSnapshotSchema,
    viewSourceUsageRequestSchema,
    viewSourceUsagePageSchema,
    viewToolNames,
    viewVersionSchema,
    topicQueryRequestSchema,
    topicQueryPageSchema,
    topicToolNames,
} from "@typeagent/memory-client";
import type {
    MemoryService,
    MemoryViewService,
    ViewBuildRequest,
    ViewConflictResolution,
    ViewMaintenancePlanRequest,
    ViewMaintenanceRead,
    ViewMaintenanceRequest,
    ViewMaintenanceUpdate,
    ViewPublicationPolicyUpdate,
    ViewPublishRequest,
    ViewReadRequest,
    ViewSaveRequest,
    ViewSearchRequest,
    ViewSourceUsageRequest,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import { z } from "zod";
import { registerSchemaViewTools } from "./schemaViewTools.js";

export function registerViewTools(
    server: McpServer,
    service: MemoryService & Partial<MemoryViewService>,
    run: (operation: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
    registerSchemaViewTools(server, service, run);
    const views = createMemoryServiceRpcFacade(service);
    const corpus = z.strictObject({ corpusId: z.string().min(1).max(200) });
    server.registerTool(
        topicToolNames.queryTopics,
        {
            description:
                "Browse maintained concepts or raw topic evidence with generation-bound pagination and explicit omissions. Ordinary queries do not generate prose. Set curated:true, one topicId and summarize:true only for an explicit concept detail request; this generates and caches an evidence-grounded summary. Response bounds do not bound store IO.",
            inputSchema: topicQueryRequestSchema,
            outputSchema: z.object({ result: topicQueryPageSchema }),
        },
        (request) =>
            run(() =>
                views.queryTopics({
                    corpusId: request.corpusId,
                    ...(request.topicId !== undefined
                        ? { topicId: request.topicId }
                        : {}),
                    ...(request.search !== undefined
                        ? { search: request.search }
                        : {}),
                    ...(request.depth !== undefined
                        ? { depth: request.depth }
                        : {}),
                    ...(request.pageSize !== undefined
                        ? { pageSize: request.pageSize }
                        : {}),
                    ...(request.continuationToken !== undefined
                        ? { continuationToken: request.continuationToken }
                        : {}),
                    ...(request.curated !== undefined
                        ? { curated: request.curated }
                        : {}),
                    ...(request.summarize !== undefined
                        ? { summarize: request.summarize }
                        : {}),
                }),
            ),
    );
    server.registerTool(
        topicToolNames.rebuildTopics,
        {
            description:
                "Rebuild complete eligible topic incidence and grounded summaries using existing corpus view maintenance jobs; no article or execution authority.",
            inputSchema: corpus,
            outputSchema: z.object({ result: viewBuildJobSchema }),
        },
        ({ corpusId }) => run(() => views.rebuildTopics(corpusId)),
    );
    server.registerTool(
        viewToolNames.getSourceViewUsage,
        {
            description:
                "List current derived Views that depend on a document source, without synthesis or execution.",
            inputSchema: viewSourceUsageRequestSchema,
            outputSchema: z.object({ result: viewSourceUsagePageSchema }),
        },
        (request) =>
            run(() =>
                views.getSourceViewUsage(request as ViewSourceUsageRequest),
            ),
    );
    server.registerTool(
        viewToolNames.planViewMaintenance,
        {
            description:
                "Inspect explicit timeline/troubleshooting membership, no-ops and blockers without synthesis or writes.",
            inputSchema: viewMaintenancePlanRequestSchema,
            outputSchema: z.object({ result: viewMaintenancePlanSchema }),
        },
        (request) =>
            run(() =>
                views.planViewMaintenance(
                    request as ViewMaintenancePlanRequest,
                ),
            ),
    );
    server.registerTool(
        viewToolNames.maintainViews,
        {
            description:
                "Control automatic indexed Wiki or Projects family updates, rebuilds, pause and resume without choosing sources, or reconcile explicit timeline/troubleshooting versions. Preserve edits and durable receipts; no execution authority.",
            inputSchema: viewMaintenanceRequestSchema,
            outputSchema: z.object({ result: viewMaintenanceResultSchema }),
        },
        (request) =>
            run(() => views.maintainViews(request as ViewMaintenanceRequest)),
    );
    server.registerTool(
        viewToolNames.updateViewMaintenance,
        {
            description:
                "Opt an existing timeline or troubleshooting view into bounded dynamic scope using exact head/version guards. Indexed Wiki uses family maintenance, not subject registries.",
            inputSchema: viewMaintenanceUpdateSchema,
            outputSchema: z.object({ result: viewHistoryEntrySchema }),
        },
        (request) =>
            run(() =>
                views.updateViewMaintenance(request as ViewMaintenanceUpdate),
            ),
    );
    server.registerTool(
        viewToolNames.getViewMaintenance,
        {
            description:
                "Read a durable manual maintenance receipt and its current build outcome.",
            inputSchema: viewMaintenanceReadSchema,
            outputSchema: z.object({
                result: viewMaintenanceResultSchema.nullable(),
            }),
        },
        (request) =>
            run(
                async () =>
                    (await views.getViewMaintenance(
                        request as ViewMaintenanceRead,
                    )) ?? null,
            ),
    );
    server.registerTool(
        viewToolNames.getViewPublicationPolicy,
        {
            description:
                "Read saved corpus and view auto-publish policy, with optimistic revisions.",
            inputSchema: corpus,
            outputSchema: z.object({ result: viewPublicationPolicySchema }),
        },
        async ({ corpusId }) =>
            run(() => views.getViewPublicationPolicy(corpusId)),
    );
    server.registerTool(
        viewToolNames.updateViewPublicationPolicy,
        {
            description:
                "Update corpus default or view override with exact history and policy revision guards. False is off; null inherits only for a view.",
            inputSchema: viewPublicationPolicyUpdateSchema,
            outputSchema: z.object({ result: viewPublicationPolicySchema }),
        },
        async (request) =>
            run(() =>
                views.updateViewPublicationPolicy(
                    request as ViewPublicationPolicyUpdate,
                ),
            ),
    );
    server.registerTool(
        viewToolNames.getViewPublication,
        {
            description:
                "Inspect latest built, published and indexed exact revision pointers and index failures.",
            inputSchema: viewReadRequestSchema,
            outputSchema: z.object({ result: viewPublicationStatusSchema }),
        },
        async (request) =>
            run(() => views.getViewPublication(request as ViewReadRequest)),
    );
    server.registerTool(
        viewToolNames.retryViewIndex,
        {
            description:
                "Retry indexing the same published exact revision; never rebuild or republish.",
            inputSchema: viewPublishRequestSchema,
            outputSchema: z.object({ result: viewPublicationStatusSchema }),
        },
        async (request) =>
            run(() => views.retryViewIndex(request as ViewPublishRequest)),
    );
    server.registerTool(
        viewToolNames.searchViews,
        {
            description:
                "Search only exact published/indexed, authorized current troubleshooting guides. Derived evidence is not independent corroboration.",
            inputSchema: viewSearchRequestSchema,
            outputSchema: z.object({ result: viewSearchMatchSchema.array() }),
        },
        async (request) =>
            run(() => views.searchViews(request as ViewSearchRequest)),
    );
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
            description:
                "Publish an exact current independently validated artifact with head/version guards. Human review never overrides evidence validation.",
            inputSchema: viewPublishRequestSchema,
            outputSchema: z.object({ result: viewPublicationStatusSchema }),
        },
        async (request) =>
            run(() => views.publishView(request as ViewPublishRequest)),
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
