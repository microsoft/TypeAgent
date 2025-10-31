// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { TopicGraphBuilder, type CooccurrenceData } from "./graph/topicGraphBuilder.js";
import { MetricsCalculator } from "./graph/metricsCalculator.js";
import type { HierarchicalTopicRecord } from "./tables.js";

const debug = registerDebug("typeagent:website:buildTopicGraph");

export async function buildTopicGraphWithGraphology(
    hierarchicalTopics: HierarchicalTopicRecord[],
    cacheManager: any,
    topicRelationshipsTable: any,
    topicMetricsTable: any,
): Promise<void> {
    debug(`Building topic graph for ${hierarchicalTopics.length} hierarchical topics`);

    const cooccurrences = extractCooccurrencesFromCache(cacheManager);
    debug(`Extracted ${cooccurrences.length} cooccurrences from cache`);

    const graphBuilder = new TopicGraphBuilder();
    const { flatGraph, hierarchicalGraph } = graphBuilder.buildFromTopicHierarchy(
        hierarchicalTopics,
        cooccurrences,
    );

    debug(`Graphs built: flat=${flatGraph.order} nodes, hierarchical=${hierarchicalGraph.order} nodes`);

    const relationships = graphBuilder.exportToTopicRelationships();
    debug(`Exporting ${relationships.length} topic relationships to database`);

    for (const rel of relationships) {
        topicRelationshipsTable.upsertRelationship(rel);
    }

    const metricsCalculator = new MetricsCalculator();
    const topicCounts = metricsCalculator.calculateTopicCounts(
        hierarchicalTopics.map((t) => ({
            topicId: t.topicId,
            url: t.url,
            domain: t.domain,
        })),
    );

    const { topicMetrics, communities } = metricsCalculator.calculateMetrics(
        hierarchicalGraph,
        topicCounts,
    );

    debug(`Calculated metrics for ${topicMetrics.size} topics, ${communities.size} communities`);

    for (const [, metrics] of topicMetrics) {
        topicMetricsTable.upsertMetrics(metrics);
    }

    debug(`Topic graph build complete`);
}

function extractCooccurrencesFromCache(cacheManager: any): CooccurrenceData[] {
    const cachedRelationships = cacheManager.getAllTopicRelationships();
    return cachedRelationships.map((rel: any) => ({
        fromTopic: rel.fromTopic,
        toTopic: rel.toTopic,
        count: rel.count,
        urls: rel.sources || [],
    }));
}
