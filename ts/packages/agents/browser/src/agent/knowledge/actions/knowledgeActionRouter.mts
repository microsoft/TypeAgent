// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import { searchWebMemories } from "../../durableWebSearch.mjs";
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
    mergeTopicHierarchies,
    getEntityNeighborhood,
    getEntityNeighborhoodLayoutData,
    getGlobalImportanceLayer,
    getGlobalGraphLayoutData,
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
        case "mergeTopicHierarchies":
            return await mergeTopicHierarchies(parameters, context);
        case "getEntityNeighborhood":
            return await getEntityNeighborhood(parameters, context);
        case "getEntityNeighborhoodLayoutData":
            return await getEntityNeighborhoodLayoutData(parameters, context);
        case "getGlobalGraphLayoutData":
            return await getGlobalGraphLayoutData(parameters, context);
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
        case "discoverRelationships":
            return await discoverDurableRelationships(parameters, context);
        case "analyzeKnowledgeGaps":
            return await analyzeDurableKnowledgeGaps(parameters, context);
        case "getViewportBasedNeighborhood":
            return await getDurableViewportNeighborhood(parameters, context);
        case "getTopicViewportNeighborhood":
            return await getDurableTopicViewport(parameters, context);
        case "testMergeTopicHierarchies":
            return await testDurableTopicMerge(context);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}

async function getDurableGraph(context: SessionContext<BrowserActionContext>) {
    const memory = context.agentContext.browserMemoryService;
    if (memory === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    return memory.getKnowledgeGraph();
}

async function discoverDurableRelationships(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
) {
    const graph = await getDurableGraph(context);
    const requestedNames = new Set<string>(
        (parameters.knowledge?.entities ?? []).map((entity: any) =>
            String(entity.name ?? entity).toLowerCase(),
        ),
    );
    const relationships = graph.relationships
        .filter(
            (relationship) =>
                requestedNames.size === 0 ||
                requestedNames.has(relationship.fromEntity.toLowerCase()) ||
                requestedNames.has(relationship.toEntity.toLowerCase()),
        )
        .slice(0, parameters.maxResults ?? 10);
    return {
        success: true,
        relationships,
        totalFound: relationships.length,
    };
}

async function analyzeDurableKnowledgeGaps(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
) {
    const graph = await getDurableGraph(context);
    const knownEntities = new Set(
        graph.entities.map((entity) => entity.name.toLowerCase()),
    );
    const gaps = (parameters.knowledge?.entities ?? [])
        .map((entity: any) => String(entity.name ?? entity))
        .filter((name: string) => !knownEntities.has(name.toLowerCase()))
        .map((name: string) => ({
            type: "entity",
            name,
            reason: "No supporting durable-memory source was found",
        }));
    return { success: true, gaps, totalGaps: gaps.length };
}

async function getDurableViewportNeighborhood(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
) {
    const graph = await getDurableGraph(context);
    const names = new Set<string>([
        parameters.centerEntity,
        ...(parameters.viewportNodeNames ?? []),
    ]);
    const relationships = graph.relationships.filter(
        (relationship) =>
            names.has(relationship.fromEntity) ||
            names.has(relationship.toEntity),
    );
    for (const relationship of relationships) {
        names.add(relationship.fromEntity);
        names.add(relationship.toEntity);
    }
    const maxNodes = parameters.maxNodes ?? 5000;
    const entities = graph.entities
        .filter((entity) => names.has(entity.name))
        .slice(0, maxNodes);
    const included = new Set(entities.map((entity) => entity.name));
    return {
        entities,
        relationships: relationships.filter(
            (relationship) =>
                included.has(relationship.fromEntity) &&
                included.has(relationship.toEntity),
        ),
        metadata: {
            centerEntity: parameters.centerEntity,
            totalNodes: entities.length,
        },
    };
}

async function getDurableTopicViewport(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
) {
    const graph = await getDurableGraph(context);
    const requested = new Set<string>(
        [parameters.centerTopic, ...(parameters.viewportTopicIds ?? [])]
            .filter(Boolean)
            .map((topic) => String(topic).toLowerCase()),
    );
    const topics = graph.topics
        .filter(
            (topic) =>
                requested.size === 0 || requested.has(topic.name.toLowerCase()),
        )
        .slice(0, parameters.maxNodes ?? 5000);
    return {
        topics,
        relationships: [],
        metadata: {
            centerTopic: parameters.centerTopic,
            totalNodes: topics.length,
        },
    };
}

async function testDurableTopicMerge(
    context: SessionContext<BrowserActionContext>,
) {
    const graph = await getDurableGraph(context);
    const normalized = new Set<string>();
    let mergeCount = 0;
    for (const topic of graph.topics) {
        const key = topic.name.trim().toLowerCase();
        if (normalized.has(key)) {
            mergeCount++;
        } else {
            normalized.add(key);
        }
    }
    return { success: true, mergeCount };
}
