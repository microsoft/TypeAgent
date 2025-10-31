// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import {
    TopicGraphBuilder,
    type CooccurrenceData,
} from "./topicGraphBuilder.js";
import {
    IncrementalGraphUpdater,
    type WebpageKnowledge,
} from "./incrementalUpdater.js";
import { MetricsCalculator } from "./metricsCalculator.js";
import type { HierarchicalTopicRecord } from "../tables.js";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:website:graph:state");

type Graph = any;

export class GraphStateManager {
    private flatGraph: Graph | null = null;
    private hierarchicalGraph: Graph | null = null;
    private incrementalUpdater: IncrementalGraphUpdater | null = null;

    public async ensureGraphsInitialized(
        hierarchicalTopics: HierarchicalTopicRecord[],
        cooccurrences: CooccurrenceData[],
    ): Promise<void> {
        if (this.flatGraph && this.hierarchicalGraph) {
            debug("Graphs already initialized, skipping rebuild");
            return;
        }

        debug(
            `Initializing graphs with ${hierarchicalTopics.length} topics, ${cooccurrences.length} cooccurrences`,
        );

        const graphBuilder = new TopicGraphBuilder();
        const graphs = graphBuilder.buildFromTopicHierarchy(
            hierarchicalTopics,
            cooccurrences,
        );

        this.flatGraph = graphs.flatGraph;
        this.hierarchicalGraph = graphs.hierarchicalGraph;

        this.incrementalUpdater = new IncrementalGraphUpdater(
            this.flatGraph,
            this.hierarchicalGraph,
        );

        debug(
            `Graphs initialized: flat=${this.flatGraph.order} nodes, hierarchical=${this.hierarchicalGraph.order} nodes`,
        );
    }

    public async addWebpage(knowledge: WebpageKnowledge): Promise<{
        addedTopics: number;
        updatedTopics: number;
        addedRelationships: number;
        durationMs: number;
    }> {
        if (!this.incrementalUpdater) {
            throw new Error(
                "Graphs not initialized. Call ensureGraphsInitialized() first.",
            );
        }

        const result = await this.incrementalUpdater.addWebpage(knowledge);
        debug(
            `Added webpage in ${result.durationMs}ms: ${result.addedTopics} topics, ${result.addedRelationships} relationships`,
        );
        return result;
    }

    public getGraphs(): {
        flatGraph: Graph | null;
        hierarchicalGraph: Graph | null;
    } {
        return {
            flatGraph: this.flatGraph,
            hierarchicalGraph: this.hierarchicalGraph,
        };
    }

    public getMetrics(): Map<string, any> | null {
        if (!this.incrementalUpdater) {
            return null;
        }
        return this.incrementalUpdater.getCachedMetrics();
    }

    public exportRelationships(): any[] {
        if (!this.hierarchicalGraph) {
            return [];
        }

        const relationships: any[] = [];
        const now = new Date().toISOString();

        for (const edge of this.hierarchicalGraph.edges()) {
            const attrs = this.hierarchicalGraph.getEdgeAttributes(edge);
            if (attrs.type !== "cooccurrence") continue;

            const source = this.hierarchicalGraph.source(edge);
            const target = this.hierarchicalGraph.target(edge);
            const sourceName = this.hierarchicalGraph.getNodeAttribute(
                source,
                "topicName",
            );
            const targetName = this.hierarchicalGraph.getNodeAttribute(
                target,
                "topicName",
            );

            relationships.push({
                fromTopic: source,
                toTopic: target,
                relationshipType: "cooccurrence",
                strength: attrs.strength || 0,
                metadata: JSON.stringify({
                    fromTopicName: sourceName,
                    toTopicName: targetName,
                }),
                sourceUrls: JSON.stringify(attrs.urls || []),
                cooccurrenceCount: attrs.count || 0,
                updated: now,
            });
        }

        return relationships;
    }

    public async recomputeMetrics(
        topicCounts?: Map<
            string,
            { documentCount: number; domainCount: number }
        >,
    ): Promise<{
        topicMetrics: Map<string, any>;
        communities: Map<string, number>;
    }> {
        if (!this.hierarchicalGraph) {
            throw new Error(
                "Graphs not initialized. Call ensureGraphsInitialized() first.",
            );
        }

        const metricsCalculator = new MetricsCalculator();
        const result = metricsCalculator.calculateMetrics(
            this.hierarchicalGraph,
            topicCounts,
        );

        debug(
            `Recomputed metrics for ${result.topicMetrics.size} topics, ${result.communities.size} communities`,
        );
        return result;
    }

    public reset(): void {
        this.flatGraph = null;
        this.hierarchicalGraph = null;
        this.incrementalUpdater = null;
        debug("Graph state reset");
    }
}
