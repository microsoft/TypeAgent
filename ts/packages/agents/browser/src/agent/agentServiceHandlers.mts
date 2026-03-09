// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import type { BrowserAgentInvokeFunctions } from "../common/serviceTypes.mjs";
import type { BrowserActionContext } from "./browserActions.mjs";
import { handleKnowledgeAction } from "./knowledge/actions/knowledgeActionRouter.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import {
    generatePageQuestions,
    generateGraphQuestions,
} from "./knowledge/actions/pageQnAActions.mjs";
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
    async function knowledgeHandler(method: string, params: any): Promise<any> {
        return handleKnowledgeAction(method, params, context);
    }

    async function discoveryHandler(
        method: string,
        params: any,
    ): Promise<any> {
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
        // Knowledge extraction
        extractKnowledgeFromPage: (params: any) =>
            knowledgeHandler("extractKnowledgeFromPage", params),
        extractKnowledgeFromPageStreaming: (params: any) =>
            knowledgeHandler("extractKnowledgeFromPageStreaming", params),

        // Knowledge queries
        searchWebMemories: (params: any) =>
            websiteHandler("searchWebMemories", params),
        queryKnowledge: (params: any) =>
            knowledgeHandler("searchWebMemories", params),
        searchByEntities: (params: any) =>
            websiteHandler("searchByEntities", params),
        searchByTopics: (params: any) =>
            websiteHandler("searchByTopics", params),
        hybridSearch: (params: any) =>
            websiteHandler("hybridSearch", params),
        getHierarchicalTopics: (params: any) =>
            knowledgeHandler("getHierarchicalTopics", params),
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
        discoverRelatedKnowledge: (params: any) =>
            knowledgeHandler("discoverRelatedKnowledge", params),
        discoverRelationships: (params: any) =>
            knowledgeHandler("discoverRelationships", params),
        analyzeKnowledgeGaps: (params: any) =>
            knowledgeHandler("analyzeKnowledgeGaps", params),
        generatePageQuestions: (params: any) =>
            generatePageQuestions(params, context),
        generateGraphQuestions: (params: any) =>
            generateGraphQuestions(params, context),

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
        detectPageActions: (params: any) =>
            discoveryHandler("detectPageActions", params),
        registerPageDynamicAgent: (params: any) =>
            discoveryHandler("registerPageDynamicAgent", params),
        getIntentFromRecording: (params: any) =>
            discoveryHandler("getIntentFromRecording", params),
        getMacrosForUrl: (params: any) =>
            discoveryHandler("getMacrosForUrl", params),
        getAllMacros: (params: any) =>
            discoveryHandler("getAllMacros", params),
        getActionDomains: (params: any) =>
            discoveryHandler("getActionDomains", params),
        deleteMacro: (params: any) =>
            discoveryHandler("deleteMacro", params),

        // Search/analytics
        getRecentKnowledgeItems: (params: any) =>
            knowledgeHandler("getRecentKnowledgeItems", params),
        getDiscoverInsights: (params: any) =>
            knowledgeHandler("getDiscoverInsights", params),
        getAnalyticsData: (params: any) =>
            knowledgeHandler("getAnalyticsData", params),
        checkAIModelAvailability: (params: any) =>
            knowledgeHandler("extractKnowledgeFromPage", params),

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

        // Tab index
        addTabIdToIndex: (params: any) =>
            knowledgeHandler("addTabIdToIndex", params),
        deleteTabIdFromIndex: (params: any) =>
            knowledgeHandler("deleteTabIdFromIndex", params),
        getTabIdFromIndex: (params: any) =>
            knowledgeHandler("getTabIdFromIndex", params),
        resetTabIdToIndex: (params: any) =>
            knowledgeHandler("resetTabIdToIndex", params),
    };

    return handlers;
}
