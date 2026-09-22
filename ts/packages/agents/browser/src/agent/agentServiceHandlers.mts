// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import type { BrowserAgentInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import {
    getSessionBrowserControl,
    type BrowserActionContext,
} from "./browserActions.mjs";
import { handleKnowledgeAction } from "./knowledge/actions/knowledgeActionRouter.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import {
    handleWebsiteAction,
    handleWebsiteLibraryStats,
} from "./browserActionHandler.mjs";

/**
 * Creates the BrowserAgentInvokeFunctions handlers that will be registered
 * as RPC invoke handlers for each client connection via agentRpc.
 *
 * These handlers replace the switch statement in processBrowserAgentMessage.
 */
export function createAgentInvokeHandlers(
    context: SessionContext<BrowserActionContext>,
): BrowserAgentInvokeFunctions {
    function getMemoryService() {
        const service = context.agentContext.memoryServiceClient;
        if (!service) {
            throw new Error("Durable memory service is not available");
        }
        return service;
    }

    async function knowledgeHandler(method: string, params: any): Promise<any> {
        return handleKnowledgeAction(method, params, context);
    }

    async function extractionHandler(params: any): Promise<any> {
        if (Array.isArray(params.htmlFragments)) {
            return knowledgeHandler("extractKnowledgeFromPage", params);
        }
        const browserControl = getSessionBrowserControl(context);
        const url = params.url ?? (await browserControl.getPageUrl());
        const htmlFragments = await browserControl.getHtmlFragments(
            false,
            "knowledgeExtraction",
        );
        return knowledgeHandler("extractKnowledgeFromPage", {
            ...params,
            url,
            title: params.title ?? url,
            htmlFragments,
            extractEntities: params.extractEntities ?? true,
            extractRelationships: params.extractRelationships ?? true,
            suggestQuestions: params.suggestQuestions ?? true,
        });
    }

    async function discoveryHandler(method: string, params: any): Promise<any> {
        const result = await handleSchemaDiscoveryAction(
            { actionName: method as any, parameters: params },
            context,
        );
        return result.data;
    }

    async function websiteHandler(method: string, params: any): Promise<any> {
        return handleWebsiteAction(method, params, context);
    }

    const handlers: BrowserAgentInvokeFunctions = {
        memoryCreateCorpus: ({ name, description }) =>
            getMemoryService().createCorpus(name, description),
        memoryListCorpora: () => getMemoryService().listCorpora(),
        memoryGetCorpus: ({ corpusId }) =>
            getMemoryService().getCorpus(corpusId),
        memoryListSources: (params) =>
            getMemoryService().listSourcesPage(params),
        memoryGetSource: ({ corpusId, sourceId }) =>
            getMemoryService().getSource(corpusId, sourceId),
        memoryGetSourceContent: (params) =>
            getMemoryService().getSourceContent(params),
        memoryGetSourceKnowledge: ({ corpusId, sourceId }) =>
            getMemoryService().getSourceKnowledge(corpusId, sourceId),
        memoryReplaceSource: async ({
            corpusId,
            sourceId,
            expectedActiveRevisionId,
            text,
            retainRevisionHistory,
        }) => {
            const service = getMemoryService();
            const existing = await service.getSource(corpusId, sourceId);
            if (!existing) {
                throw new Error(`Memory source '${sourceId}' was not found`);
            }
            const sourceContent =
                existing.sourceType === "html"
                    ? { html: text }
                    : existing.sourceType === "text"
                      ? { text }
                      : { markdown: text };
            return service.replaceSource({
                corpusId,
                sourceId,
                expectedActiveRevisionId,
                source: {
                    sourceType: existing.sourceType,
                    title: existing.title,
                    ...(existing.canonicalUri === undefined
                        ? {}
                        : { canonicalUri: existing.canonicalUri }),
                    ...(existing.tags === undefined
                        ? {}
                        : { tags: existing.tags }),
                    ...(existing.metadata === undefined
                        ? {}
                        : { metadata: existing.metadata }),
                    ...sourceContent,
                },
                ...(retainRevisionHistory === undefined
                    ? {}
                    : { retainRevisionHistory }),
            });
        },
        memoryPreviewForgetSource: ({ corpusId, sourceId }) =>
            getMemoryService().previewForgetSource(corpusId, sourceId),
        memoryForgetSource: (params) => getMemoryService().forgetSource(params),
        memoryReindexCorpus: ({ corpusId }) =>
            getMemoryService().reindexCorpus(corpusId),
        memoryReindexSource: ({ corpusId, sourceId }) =>
            getMemoryService().reindexSource(corpusId, sourceId),
        memoryListJobs: (params) => getMemoryService().listJobs(params),
        memoryCancelJob: ({ jobId }) => getMemoryService().cancelJob(jobId),

        // Knowledge extraction
        extractKnowledgeFromPage: extractionHandler,
        // Knowledge queries
        searchWebMemories: (params: any) =>
            websiteHandler("searchWebMemories", params),
        queryKnowledge: (params: any) =>
            knowledgeHandler("searchWebMemories", params),
        searchByEntities: (params: any) =>
            websiteHandler("searchByEntities", params),
        searchByTopics: (params: any) =>
            websiteHandler("searchByTopics", params),
        hybridSearch: (params: any) => websiteHandler("hybridSearch", params),
        getHierarchicalTopics: (params: any) =>
            websiteHandler("getHierarchicalTopics", params),
        getTopicImportanceLayer: (params: any) =>
            knowledgeHandler("getTopicImportanceLayer", params),
        getTopicViewportNeighborhood: (params: any) =>
            knowledgeHandler("getTopicViewportNeighborhood", params),
        getTopicMetrics: (params: any) =>
            knowledgeHandler("getTopicMetrics", params),
        getTopicDetails: (params: any) =>
            knowledgeHandler("getTopicDetails", params),
        getEntityDetails: (params: any) =>
            knowledgeHandler("getEntityDetails", params),
        getTopicTimelines: (params: any) =>
            knowledgeHandler("getTopicTimelines", params),
        discoverRelationships: (params: any) =>
            knowledgeHandler("discoverRelationships", params),
        analyzeKnowledgeGaps: (params: any) =>
            knowledgeHandler("analyzeKnowledgeGaps", params),

        // Knowledge graph
        getKnowledgeGraphStatus: (params: any) =>
            knowledgeHandler("getKnowledgeGraphStatus", params),
        buildKnowledgeGraph: (params: any) =>
            knowledgeHandler("buildKnowledgeGraph", params),
        rebuildKnowledgeGraph: (params: any) =>
            knowledgeHandler("rebuildKnowledgeGraph", params),
        testMergeTopicHierarchies: (params: any) =>
            knowledgeHandler("testMergeTopicHierarchies", params),
        mergeTopicHierarchies: (params: any) =>
            knowledgeHandler("mergeTopicHierarchies", params),
        getGlobalGraphLayoutData: (params: any) =>
            knowledgeHandler("getGlobalGraphLayoutData", params),
        getEntityNeighborhood: (params: any) =>
            knowledgeHandler("getEntityNeighborhood", params),
        getEntityNeighborhoodLayoutData: (params: any) =>
            knowledgeHandler("getEntityNeighborhoodLayoutData", params),
        getGlobalImportanceLayer: (params: any) =>
            knowledgeHandler("getGlobalImportanceLayer", params),
        getImportanceStatistics: (params: any) =>
            knowledgeHandler("getImportanceStatistics", params),
        getViewportBasedNeighborhood: (params: any) =>
            knowledgeHandler("getViewportBasedNeighborhood", params),

        // Index management
        indexWebPageContent: (params: any) =>
            knowledgeHandler("indexWebPageContent", params),
        checkPageIndexStatus: (params: any) =>
            knowledgeHandler("checkPageIndexStatus", params),
        getPageIndexedKnowledge: (params: any) =>
            knowledgeHandler("getPageIndexedKnowledge", params),
        getKnowledgeIndexStats: (params: any) =>
            knowledgeHandler("getKnowledgeIndexStats", params),
        clearKnowledgeIndex: (params: any) =>
            knowledgeHandler("clearKnowledgeIndex", params),

        // Import/export
        importWebsiteDataWithProgress: (params: any) =>
            websiteHandler("importWebsiteDataWithProgress", params),
        importHtmlFolder: (params: any) =>
            websiteHandler("importHtmlFolder", params),
        getLibraryStats: (params: any) =>
            handleWebsiteLibraryStats(params, context),
        getWebsiteStats: (params: any) =>
            websiteHandler("getWebsiteStats", params),

        // Macros
        autoDiscoverActions: (params: any) =>
            discoveryHandler("autoDiscoverActions", params),
        detectPageActions: (params: any) =>
            discoveryHandler("detectPageActions", params),
        registerPageDynamicAgent: (params: any) =>
            discoveryHandler("registerPageDynamicAgent", params),
        createWebFlowFromRecording: (params: any) =>
            discoveryHandler("createWebFlowFromRecording", params),
        getWebFlowsForDomain: (params: any) =>
            discoveryHandler("getWebFlowsForDomain", params),
        getAllWebFlows: (params: any) =>
            discoveryHandler("getAllWebFlows", params),
        deleteWebFlow: (params: any) =>
            discoveryHandler("deleteWebFlow", params),

        // Search/analytics
        getAnalyticsData: (params: any) =>
            knowledgeHandler("getAnalyticsData", params),

        // Navigation
        async handlePageNavigation(params: any) {
            // Navigation-triggered knowledge extraction is currently disabled.
            // This handler exists so the RPC type contract is satisfied.
        },

        // Site translator
        async enableSiteTranslator(params: any) {
            await context.toggleTransientAgent(params.translator, true);
        },
        async disableSiteTranslator(params: any) {
            await context.toggleTransientAgent(params.translator, false);
        },

        // View host
        getViewHostUrl: (_params: any) =>
            Promise.resolve({
                url: `http://localhost:${context.agentContext.localHostPort}`,
            }),

        // Tab index - use tabTitleIndex directly from context
        addTabIdToIndex: async (params: any) => {
            const index = context.agentContext.tabTitleIndex;
            if (!index) {
                return { success: false, error: "Tab index not initialized" };
            }
            await index.addOrUpdate(params.title, params.id);
            return { success: true };
        },
        deleteTabIdFromIndex: async (params: any) => {
            const index = context.agentContext.tabTitleIndex;
            if (!index) {
                return { success: false, error: "Tab index not initialized" };
            }
            await index.remove(params.id);
            return { success: true };
        },
        getTabIdFromIndex: async (params: any) => {
            const index = context.agentContext.tabTitleIndex;
            if (!index) {
                return { success: false, error: "Tab index not initialized" };
            }
            const results = await index.search(
                params.query,
                params.maxMatches || 10,
            );
            return { success: true, results };
        },
        resetTabIdToIndex: async (_params: any) => {
            const index = context.agentContext.tabTitleIndex;
            if (!index) {
                return { success: false, error: "Tab index not initialized" };
            }
            await index.reset();
            return { success: true };
        },
    };

    return handlers;
}
