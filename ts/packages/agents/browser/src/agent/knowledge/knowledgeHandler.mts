// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../browserActions.mjs";
import { searchWebMemories } from "../searchWebMemories.mjs";
import { KnowledgeExtractionResult } from "./schema/knowledgeExtraction.mjs";
import {
    extractKnowledgeFromPage,
    extractKnowledgeFromPageStreaming,
} from "./actions/extractionActions.mjs";
import {
    indexWebPageContent,
    checkPageIndexStatus,
    getKnowledgeIndexStats,
    clearKnowledgeIndex,
} from "./actions/indexingActions.mjs";
import {
    getExtractionAnalytics,
    generateQualityReport,
    getPageQualityMetrics,
    getAnalyticsData,
    getRecentKnowledgeItems,
    getTopDomains,
    getActivityTrends,
    getDetailedKnowledgeStats,
} from "./actions/analyticsActions.mjs";
import {
    getKnowledgeGraphStatus,
    buildKnowledgeGraph,
    rebuildKnowledgeGraph,
    getAllRelationships,
    getAllCommunities,
    getAllEntitiesWithMetrics,
    getEntityNeighborhood,
    getGlobalImportanceLayer,
    getImportanceStatistics,
} from "./actions/graphActions.mjs";
import {
    checkAIModelStatus,
    checkActionDetectionStatus,
} from "./actions/utilityActions.mjs";
import {
    getPageIndexedKnowledge,
    getDiscoverInsights,
    generateSmartSuggestedQuestions,
} from "./actions/queryActions.mjs";

export interface WebPageDocument {
    url: string;
    title: string;
    content: string;
    htmlFragments: any[];
    timestamp: string;
    indexed: boolean;
    knowledge?: KnowledgeExtractionResult;
    metadata?: {
        quality: string;
        textOnly: boolean;
        contentLength: number;
        entityCount: number;
    };
}

export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPage(parameters, context);

        case "extractKnowledgeFromPageStreaming":
            return await extractKnowledgeFromPageStreaming(parameters, context);

        case "indexWebPageContent":
            return await indexWebPageContent(parameters, context);

        case "searchWebMemories":
            return await searchWebMemories(parameters, context);

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);

        case "getKnowledgeStats":
            return await getDetailedKnowledgeStats(parameters, context);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

        case "getExtractionAnalytics":
            return await getExtractionAnalytics(parameters, context);

        case "generateQualityReport":
            return await generateQualityReport(parameters, context);

        case "getPageQualityMetrics":
            return await getPageQualityMetrics(parameters, context);

        case "checkAIModelStatus":
            return await checkAIModelStatus(parameters, context);

        case "checkActionDetectionStatus":
            return await checkActionDetectionStatus(parameters, context);

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

        case "getAnalyticsData":
            return await getAnalyticsData(parameters, context);

        case "getKnowledgeGraphStatus":
            return await getKnowledgeGraphStatus(parameters, context);

        case "buildKnowledgeGraph":
            return await buildKnowledgeGraph(parameters, context);

        case "rebuildKnowledgeGraph":
            return await rebuildKnowledgeGraph(parameters, context);

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

        case "generateSmartSuggestedQuestions":
            return await generateSmartSuggestedQuestions(
                parameters.knowledge,
                parameters.extractionResult,
                parameters.url,
                context,
            );

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}
