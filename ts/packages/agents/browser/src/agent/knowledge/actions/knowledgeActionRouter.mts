// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { searchWebMemories } from "../../searchWebMemories.mjs";
import {
    extractKnowledgeFromPage,
    extractKnowledgeFromPageStreaming,
} from "./extractionActions.mjs";
import {
    indexWebPageContent,
    checkPageIndexStatus,
    getKnowledgeIndexStats,
    clearKnowledgeIndex,
} from "./indexingActions.mjs";
import {
    getExtractionAnalytics,
    generateQualityReport,
    getPageQualityMetrics,
    getAnalyticsData,
    getRecentKnowledgeItems,
    getTopDomains,
    getActivityTrends,
    getDetailedKnowledgeStats,
} from "./analyticsActions.mjs";
import {
    getKnowledgeGraphStatus,
    buildKnowledgeGraph,
    rebuildKnowledgeGraph,
    testMergeTopicHierarchies,
    mergeTopicHierarchies,
    getAllRelationships,
    getAllCommunities,
    getAllEntitiesWithMetrics,
    getEntityNeighborhood,
    getGlobalImportanceLayer,
    getTopicImportanceLayer,
    getImportanceStatistics,
    getTopicMetrics,
    getUrlContentBreakdown,
    getTopicTimelines,
    discoverRelatedKnowledge,
    getTopicDetails,
    getEntityDetails,
} from "./graphActions.mjs";
import {
    checkAIModelStatus,
    checkActionDetectionStatus,
} from "./utilityActions.mjs";
import {
    getPageIndexedKnowledge,
    getDiscoverInsights,
    generateSmartSuggestedQuestions,
} from "./queryActions.mjs";

export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        // Extraction Actions
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPage(parameters, context);
        case "extractKnowledgeFromPageStreaming":
            return await extractKnowledgeFromPageStreaming(parameters, context);

        // Indexing Actions
        case "indexWebPageContent":
            return await indexWebPageContent(parameters, context);
        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);
        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);
        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

        // Analytics Actions
        case "getExtractionAnalytics":
            return await getExtractionAnalytics(parameters, context);
        case "generateQualityReport":
            return await generateQualityReport(parameters, context);
        case "getPageQualityMetrics":
            return await getPageQualityMetrics(parameters, context);
        case "getAnalyticsData":
            return await getAnalyticsData(parameters, context);

        // Graph Actions
        case "getKnowledgeGraphStatus":
            return await getKnowledgeGraphStatus(parameters, context);
        case "buildKnowledgeGraph":
            return await buildKnowledgeGraph(parameters, context);
        case "rebuildKnowledgeGraph":
            return await rebuildKnowledgeGraph(parameters, context);
        case "testMergeTopicHierarchies":
            return await testMergeTopicHierarchies(parameters, context);
        case "mergeTopicHierarchies":
            return await mergeTopicHierarchies(parameters, context);
        case "getAllRelationships":
            return await getAllRelationships(parameters, context);
        case "getAllCommunities":
            return await getAllCommunities(parameters, context);
        case "getAllEntitiesWithMetrics":
            return await getAllEntitiesWithMetrics(parameters, context);
        case "getEntityNeighborhood":
            return await getEntityNeighborhood(parameters, context);
        case "getGlobalImportanceLayer":
            return await getGlobalImportanceLayer(parameters, context);
        case "getImportanceStatistics":
            return await getImportanceStatistics(parameters, context);
        case "getTopicImportanceLayer":
            return await getTopicImportanceLayer(parameters, context);
        case "getTopicMetrics":
            return await getTopicMetrics(parameters, context);
        case "getUrlContentBreakdown":
            return await getUrlContentBreakdown(parameters, context);
        case "getTopicTimelines":
            return await getTopicTimelines(parameters, context);

        // Query Actions
        case "getRecentKnowledgeItems":
            return await getRecentKnowledgeItems(parameters, context);
        case "getTopDomains":
            return await getTopDomains(parameters, context);
        case "getActivityTrends":
            return await getActivityTrends(parameters, context);
        case "getPageIndexedKnowledge":
            return await getPageIndexedKnowledge(parameters, context);
        case "getDiscoverInsights":
            return await getDiscoverInsights(parameters, context);
        case "getKnowledgeStats":
            return await getDetailedKnowledgeStats(parameters, context);
        case "checkAIModelStatus":
            return await checkAIModelStatus(parameters, context);
        case "checkActionDetectionStatus":
            return await checkActionDetectionStatus(parameters, context);
        case "generateSmartSuggestedQuestions":
            return await generateSmartSuggestedQuestions(
                parameters.knowledge,
                parameters.extractionResult,
                parameters.url,
                context,
            );
        case "discoverRelatedKnowledge":
            return await discoverRelatedKnowledge(parameters, context);
        // Search Actions (kept in searchWebMemories)
        case "searchWebMemories":
            return await searchWebMemories(parameters, context);

        case "getTopicDetails":
            return await getTopicDetails(parameters, context);
        case "getEntityDetails":
            return await getEntityDetails(parameters, context);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}
