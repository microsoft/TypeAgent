// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import type { TopicMetrics } from "../tables.js";

const require = createRequire(import.meta.url);
const Graph = require("graphology");
const betweennessCentrality = require("graphology-metrics/centrality/betweenness");
const { degreeCentrality } = require("graphology-metrics/centrality/degree");
const louvain = require("graphology-communities-louvain");

const debug = registerDebug("typeagent:website:graph:metrics");

type Graph = any;

export interface MetricsResult {
    topicMetrics: Map<string, TopicMetrics>;
    communities: Map<string, number>;
}

export class MetricsCalculator {
    public calculateMetrics(
        hierarchicalGraph: Graph,
        topicCounts?: Map<string, { documentCount: number; domainCount: number }>,
    ): MetricsResult {
        debug(`Calculating metrics for ${hierarchicalGraph.order} topics`);

        const undirectedGraph = this.createUndirectedCooccurrenceGraph(
            hierarchicalGraph,
        );

        debug("Running betweenness centrality...");
        const betweennessScores = betweennessCentrality(undirectedGraph);

        debug("Running degree centrality...");
        const degreeScores = degreeCentrality(undirectedGraph);

        debug("Running community detection (Louvain)...");
        const communities = new Map<string, number>();
        louvain.assign(undirectedGraph);
        for (const node of undirectedGraph.nodes()) {
            const community = undirectedGraph.getNodeAttribute(node, "community");
            communities.set(node, community);
        }

        debug("Computing topic metrics...");
        const topicMetrics = new Map<string, TopicMetrics>();
        const now = new Date().toISOString();

        for (const topicId of hierarchicalGraph.nodes()) {
            const attrs = hierarchicalGraph.getNodeAttributes(topicId);
            const counts = topicCounts?.get(topicId) || {
                documentCount: 0,
                domainCount: 0,
            };

            const cooccurrenceEdges = hierarchicalGraph
                .edges(topicId)
                .filter((edge: string) => {
                    const edgeAttrs = hierarchicalGraph.getEdgeAttributes(edge);
                    return edgeAttrs.type === "cooccurrence";
                });

            const strongRelationships = cooccurrenceEdges.filter(
                (edge: string) => {
                    const edgeAttrs = hierarchicalGraph.getEdgeAttributes(edge);
                    return (edgeAttrs.strength || 0) >= 0.7;
                },
            );

            const metrics: TopicMetrics = {
                topicId,
                topicName: attrs.topicName,
                documentCount: counts.documentCount,
                domainCount: counts.domainCount,
                degreeCentrality: undirectedGraph.hasNode(topicId)
                    ? degreeScores[topicId] || 0
                    : 0,
                betweennessCentrality: undirectedGraph.hasNode(topicId)
                    ? betweennessScores[topicId] || 0
                    : 0,
                activityPeriod: 0,
                avgConfidence: attrs.confidence || 0,
                maxConfidence: attrs.confidence || 0,
                totalRelationships: cooccurrenceEdges.length,
                strongRelationships: strongRelationships.length,
                entityCount: 0,
                updated: now,
            };

            topicMetrics.set(topicId, metrics);
        }

        debug(
            `Calculated metrics for ${topicMetrics.size} topics, ${communities.size} community assignments`,
        );

        return { topicMetrics, communities };
    }

    private createUndirectedCooccurrenceGraph(
        hierarchicalGraph: Graph,
    ): Graph {
        const undirectedGraph = new Graph({ type: "undirected" });

        for (const node of hierarchicalGraph.nodes()) {
            const attrs = hierarchicalGraph.getNodeAttributes(node);
            undirectedGraph.addNode(node, {
                topicName: attrs.topicName,
                level: attrs.level,
            });
        }

        for (const edge of hierarchicalGraph.edges()) {
            const attrs = hierarchicalGraph.getEdgeAttributes(edge);
            if (attrs.type !== "cooccurrence") continue;

            const source = hierarchicalGraph.source(edge);
            const target = hierarchicalGraph.target(edge);

            if (
                !undirectedGraph.hasNode(source) ||
                !undirectedGraph.hasNode(target)
            ) {
                continue;
            }

            if (!undirectedGraph.hasEdge(source, target)) {
                undirectedGraph.addEdge(source, target, {
                    weight: attrs.strength || 0.5,
                });
            }
        }

        debug(
            `Created undirected graph: ${undirectedGraph.order} nodes, ${undirectedGraph.size} edges`,
        );

        return undirectedGraph;
    }

    public calculateTopicCounts(
        hierarchicalTopics: Array<{
            topicId: string;
            url: string;
            domain: string;
        }>,
    ): Map<string, { documentCount: number; domainCount: number }> {
        const counts = new Map<
            string,
            { documents: Set<string>; domains: Set<string> }
        >();

        for (const topic of hierarchicalTopics) {
            if (!counts.has(topic.topicId)) {
                counts.set(topic.topicId, {
                    documents: new Set(),
                    domains: new Set(),
                });
            }
            const count = counts.get(topic.topicId)!;
            count.documents.add(topic.url);
            count.domains.add(topic.domain);
        }

        const result = new Map<
            string,
            { documentCount: number; domainCount: number }
        >();
        for (const [topicId, count] of counts) {
            result.set(topicId, {
                documentCount: count.documents.size,
                domainCount: count.domains.size,
            });
        }

        return result;
    }
}
