// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import type { HierarchicalTopicRecord, TopicMetrics } from "../tables.js";
import { MetricsCalculator } from "./metricsCalculator.js";
import type { CooccurrenceData } from "./topicGraphBuilder.js";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:website:graph:incremental");

type Graph = any;

export interface WebpageKnowledge {
    url: string;
    domain: string;
    hierarchicalTopics: HierarchicalTopicRecord[];
    cooccurrences: CooccurrenceData[];
}

export interface UpdateResult {
    addedTopics: number;
    updatedTopics: number;
    addedRelationships: number;
    metricsRecomputed: boolean;
    durationMs: number;
}

export class IncrementalGraphUpdater {
    private flatGraph: Graph;
    private hierarchicalGraph: Graph;
    private metricsCalculator: MetricsCalculator;
    private cachedMetrics: Map<string, TopicMetrics> | null = null;
    private changedTopics: Set<string> = new Set();

    constructor(flatGraph: Graph, hierarchicalGraph: Graph) {
        this.flatGraph = flatGraph;
        this.hierarchicalGraph = hierarchicalGraph;
        this.metricsCalculator = new MetricsCalculator();
        this.setupEventListeners();
    }

    public async addWebpage(
        knowledge: WebpageKnowledge,
    ): Promise<UpdateResult> {
        const startTime = Date.now();
        debug(
            `Adding webpage: ${knowledge.url}, ${knowledge.hierarchicalTopics.length} topics, ${knowledge.cooccurrences.length} cooccurrences`,
        );

        this.changedTopics.clear();

        const addedTopics = this.updateFlatGraph(knowledge);
        const updatedTopics = this.updateHierarchicalGraph(knowledge);
        const addedRelationships = this.updateCooccurrences(knowledge);

        const metricsRecomputed = await this.recomputeMetrics({
            affectedOnly: true,
        });

        const durationMs = Date.now() - startTime;
        debug(`Webpage added in ${durationMs}ms`);

        return {
            addedTopics,
            updatedTopics,
            addedRelationships,
            metricsRecomputed,
            durationMs,
        };
    }

    private updateFlatGraph(knowledge: WebpageKnowledge): number {
        let addedTopics = 0;

        const leafTopics = knowledge.hierarchicalTopics.filter((topic) => {
            const sourceTopicNames = topic.sourceTopicNames
                ? JSON.parse(topic.sourceTopicNames)
                : [];
            return sourceTopicNames.length > 0;
        });

        for (const topic of leafTopics) {
            if (!this.flatGraph.hasNode(topic.topicId)) {
                this.flatGraph.addNode(topic.topicId, {
                    topicName: topic.topicName,
                    level: topic.level,
                    confidence: topic.confidence,
                    sourceTopicNames: topic.sourceTopicNames
                        ? JSON.parse(topic.sourceTopicNames)
                        : [],
                    isLeaf: true,
                });
                addedTopics++;
                this.changedTopics.add(topic.topicId);
            }
        }

        debug(`Flat graph: added ${addedTopics} new leaf topics`);
        return addedTopics;
    }

    private updateHierarchicalGraph(knowledge: WebpageKnowledge): number {
        let updatedTopics = 0;

        for (const topic of knowledge.hierarchicalTopics) {
            if (!this.hierarchicalGraph.hasNode(topic.topicId)) {
                this.hierarchicalGraph.addNode(topic.topicId, {
                    topicName: topic.topicName,
                    level: topic.level,
                    confidence: topic.confidence,
                    sourceTopicNames: topic.sourceTopicNames
                        ? JSON.parse(topic.sourceTopicNames)
                        : [],
                    parentTopicId: topic.parentTopicId,
                    childIds: [],
                });
                updatedTopics++;
                this.changedTopics.add(topic.topicId);

                if (topic.parentTopicId) {
                    if (this.hierarchicalGraph.hasNode(topic.parentTopicId)) {
                        this.hierarchicalGraph.addDirectedEdge(
                            topic.parentTopicId,
                            topic.topicId,
                            { type: "parent-child" },
                        );

                        const parentAttrs =
                            this.hierarchicalGraph.getNodeAttributes(
                                topic.parentTopicId,
                            );
                        if (!parentAttrs.childIds.includes(topic.topicId)) {
                            parentAttrs.childIds.push(topic.topicId);
                        }
                        this.changedTopics.add(topic.parentTopicId);
                    }
                }
            }
        }

        debug(`Hierarchical graph: updated ${updatedTopics} topics`);
        return updatedTopics;
    }

    private updateCooccurrences(knowledge: WebpageKnowledge): number {
        let addedRelationships = 0;

        const leafTopics = knowledge.hierarchicalTopics.filter((topic) => {
            const sourceTopicNames = topic.sourceTopicNames
                ? JSON.parse(topic.sourceTopicNames)
                : [];
            return sourceTopicNames.length > 0;
        });

        for (const cooccur of knowledge.cooccurrences) {
            const fromTopics = this.findTopicsBySourceName(
                leafTopics,
                cooccur.fromTopic,
            );
            const toTopics = this.findTopicsBySourceName(
                leafTopics,
                cooccur.toTopic,
            );

            for (const fromTopic of fromTopics) {
                for (const toTopic of toTopics) {
                    if (fromTopic.topicId === toTopic.topicId) continue;

                    const edgeKey = this.getEdgeKey(
                        fromTopic.topicId,
                        toTopic.topicId,
                    );

                    if (this.flatGraph.hasEdge(edgeKey)) {
                        const current =
                            this.flatGraph.getEdgeAttributes(edgeKey);
                        this.flatGraph.setEdgeAttribute(
                            edgeKey,
                            "count",
                            current.count + cooccur.count,
                        );
                        this.flatGraph.setEdgeAttribute(edgeKey, "urls", [
                            ...current.urls,
                            ...cooccur.urls,
                        ]);
                        const newStrength = this.calculateStrength(
                            current.count + cooccur.count,
                        );
                        this.flatGraph.setEdgeAttribute(
                            edgeKey,
                            "strength",
                            newStrength,
                        );
                    } else {
                        this.flatGraph.addEdge(
                            fromTopic.topicId,
                            toTopic.topicId,
                            {
                                count: cooccur.count,
                                urls: cooccur.urls,
                                strength: this.calculateStrength(cooccur.count),
                            },
                        );
                        addedRelationships++;
                    }

                    this.changedTopics.add(fromTopic.topicId);
                    this.changedTopics.add(toTopic.topicId);
                }
            }
        }

        this.propagateCooccurrencesToHierarchy();

        debug(`Added/updated ${addedRelationships} cooccurrence relationships`);
        return addedRelationships;
    }

    private propagateCooccurrencesToHierarchy(): void {
        const changedTopicsArray = Array.from(this.changedTopics);

        for (const topicId of changedTopicsArray) {
            if (!this.hierarchicalGraph.hasNode(topicId)) continue;

            const attrs = this.hierarchicalGraph.getNodeAttributes(topicId);

            const existingCooccurrences = this.hierarchicalGraph
                .edges(topicId)
                .filter((edge: string) => {
                    const edgeAttrs =
                        this.hierarchicalGraph.getEdgeAttributes(edge);
                    return edgeAttrs.type === "cooccurrence";
                });

            for (const edge of existingCooccurrences) {
                this.hierarchicalGraph.dropEdge(edge);
            }

            if (this.flatGraph.hasNode(topicId)) {
                for (const edge of this.flatGraph.edges(topicId)) {
                    const source = this.flatGraph.source(edge);
                    const target = this.flatGraph.target(edge);
                    const edgeAttrs = this.flatGraph.getEdgeAttributes(edge);
                    const otherNode = source === topicId ? target : source;

                    if (!this.hierarchicalGraph.hasNode(otherNode)) continue;

                    const hierarchicalEdgeKey = this.getEdgeKey(
                        topicId,
                        otherNode,
                    );
                    if (!this.hierarchicalGraph.hasEdge(hierarchicalEdgeKey)) {
                        this.hierarchicalGraph.addEdge(topicId, otherNode, {
                            type: "cooccurrence",
                            count: edgeAttrs.count,
                            urls: edgeAttrs.urls,
                            strength: edgeAttrs.strength,
                        });
                    }
                }
            }

            let currentParent = attrs.parentTopicId;
            while (currentParent) {
                this.changedTopics.add(currentParent);
                const parentAttrs =
                    this.hierarchicalGraph.getNodeAttributes(currentParent);
                this.aggregateCooccurrencesForNode(currentParent);
                currentParent = parentAttrs.parentTopicId;
            }
        }
    }

    private aggregateCooccurrencesForNode(topicId: string): void {
        const attrs = this.hierarchicalGraph.getNodeAttributes(topicId);
        if (attrs.childIds.length === 0) return;

        const existingCooccurrences = this.hierarchicalGraph
            .edges(topicId)
            .filter((edge: string) => {
                const edgeAttrs =
                    this.hierarchicalGraph.getEdgeAttributes(edge);
                return edgeAttrs.type === "cooccurrence";
            });

        for (const edge of existingCooccurrences) {
            this.hierarchicalGraph.dropEdge(edge);
        }

        const aggregatedCooccurrences = new Map<
            string,
            { count: number; urls: Set<string> }
        >();

        for (const childId of attrs.childIds) {
            for (const edge of this.hierarchicalGraph.edges(childId)) {
                const edgeAttrs =
                    this.hierarchicalGraph.getEdgeAttributes(edge);
                if (edgeAttrs.type !== "cooccurrence") continue;

                const source = this.hierarchicalGraph.source(edge);
                const target = this.hierarchicalGraph.target(edge);
                const otherNode = source === childId ? target : source;

                if (attrs.childIds.includes(otherNode)) continue;

                if (!aggregatedCooccurrences.has(otherNode)) {
                    aggregatedCooccurrences.set(otherNode, {
                        count: 0,
                        urls: new Set(),
                    });
                }
                const agg = aggregatedCooccurrences.get(otherNode)!;
                agg.count += edgeAttrs.count || 0;
                for (const url of edgeAttrs.urls || []) {
                    agg.urls.add(url);
                }
            }
        }

        for (const [otherNode, agg] of aggregatedCooccurrences) {
            const hierarchicalEdgeKey = this.getEdgeKey(topicId, otherNode);
            if (!this.hierarchicalGraph.hasEdge(hierarchicalEdgeKey)) {
                this.hierarchicalGraph.addEdge(topicId, otherNode, {
                    type: "cooccurrence",
                    count: agg.count,
                    urls: Array.from(agg.urls),
                    strength: this.calculateStrength(agg.count),
                });
            }
        }
    }

    private async recomputeMetrics(options: {
        affectedOnly?: boolean;
    }): Promise<boolean> {
        if (options.affectedOnly && this.changedTopics.size > 0) {
            debug(
                `Recomputing metrics for ${this.changedTopics.size} affected topics`,
            );

            const affectedSubgraph = this.extractAffectedSubgraph(2);

            const { topicMetrics } =
                this.metricsCalculator.calculateMetrics(affectedSubgraph);

            if (!this.cachedMetrics) {
                this.cachedMetrics = new Map();
            }

            for (const [topicId, metrics] of topicMetrics) {
                this.cachedMetrics.set(topicId, metrics);
            }

            return true;
        }

        return false;
    }

    private extractAffectedSubgraph(hops: number): Graph {
        const affectedNodes = new Set<string>();

        const queue: Array<{ node: string; depth: number }> = [];
        for (const node of this.changedTopics) {
            queue.push({ node, depth: 0 });
            affectedNodes.add(node);
        }

        while (queue.length > 0) {
            const { node, depth } = queue.shift()!;
            if (depth >= hops) continue;

            for (const neighbor of this.hierarchicalGraph.neighbors(node)) {
                if (!affectedNodes.has(neighbor)) {
                    affectedNodes.add(neighbor);
                    queue.push({ node: neighbor, depth: depth + 1 });
                }
            }
        }

        const subgraph = new Graph({ type: "directed" });
        for (const node of affectedNodes) {
            if (this.hierarchicalGraph.hasNode(node)) {
                subgraph.addNode(
                    node,
                    this.hierarchicalGraph.getNodeAttributes(node),
                );
            }
        }

        for (const edge of this.hierarchicalGraph.edges()) {
            const source = this.hierarchicalGraph.source(edge);
            const target = this.hierarchicalGraph.target(edge);
            if (affectedNodes.has(source) && affectedNodes.has(target)) {
                subgraph.addEdge(
                    source,
                    target,
                    this.hierarchicalGraph.getEdgeAttributes(edge),
                );
            }
        }

        debug(
            `Extracted affected subgraph: ${subgraph.order} nodes, ${subgraph.size} edges`,
        );
        return subgraph;
    }

    private setupEventListeners(): void {
        this.hierarchicalGraph.on("nodeAdded", () => {
            this.cachedMetrics = null;
        });

        this.hierarchicalGraph.on("edgeAdded", () => {
            this.cachedMetrics = null;
        });

        this.hierarchicalGraph.on("edgeDropped", () => {
            this.cachedMetrics = null;
        });
    }

    private findTopicsBySourceName(
        topics: HierarchicalTopicRecord[],
        sourceName: string,
    ): HierarchicalTopicRecord[] {
        return topics.filter((topic) => {
            const sourceTopicNames = topic.sourceTopicNames
                ? JSON.parse(topic.sourceTopicNames)
                : [];
            return sourceTopicNames.includes(sourceName);
        });
    }

    private getEdgeKey(nodeA: string, nodeB: string): string {
        return nodeA < nodeB ? `${nodeA}|${nodeB}` : `${nodeB}|${nodeA}`;
    }

    private calculateStrength(count: number): number {
        return Math.min(1.0, Math.log(count + 1) / Math.log(10));
    }

    public getCachedMetrics(): Map<string, TopicMetrics> | null {
        return this.cachedMetrics;
    }

    public getGraphs(): { flatGraph: Graph; hierarchicalGraph: Graph } {
        return {
            flatGraph: this.flatGraph,
            hierarchicalGraph: this.hierarchicalGraph,
        };
    }
}
