// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import type { HierarchicalTopicRecord, TopicRelationship } from "../tables.js";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:website:graph:builder");

type Graph = any;

export interface CooccurrenceData {
    fromTopic: string;
    toTopic: string;
    count: number;
    urls: string[];
}

export interface TopicGraphs {
    flatGraph: Graph;
    hierarchicalGraph: Graph;
}

export class TopicGraphBuilder {
    private flatGraph: Graph;
    private hierarchicalGraph: Graph;

    constructor() {
        this.flatGraph = new Graph({ type: "undirected" });
        this.hierarchicalGraph = new Graph({ type: "directed" });
    }

    public buildFromTopicHierarchy(
        hierarchicalTopics: HierarchicalTopicRecord[],
        cooccurrences: CooccurrenceData[],
    ): TopicGraphs {
        debug(
            `Building topic graphs: ${hierarchicalTopics.length} topics, ${cooccurrences.length} cooccurrences`,
        );

        this.buildFlatGraph(hierarchicalTopics, cooccurrences);
        this.buildHierarchicalGraph(hierarchicalTopics);
        this.aggregateCooccurrencesBottomUp();

        debug(
            `Graphs built: flat=${this.flatGraph.order} nodes, ${this.flatGraph.size} edges; hierarchical=${this.hierarchicalGraph.order} nodes, ${this.hierarchicalGraph.size} edges`,
        );

        return {
            flatGraph: this.flatGraph,
            hierarchicalGraph: this.hierarchicalGraph,
        };
    }

    private buildFlatGraph(
        hierarchicalTopics: HierarchicalTopicRecord[],
        cooccurrences: CooccurrenceData[],
    ): void {
        debug("Building flat graph with ground truth cooccurrences");

        const leafTopics = hierarchicalTopics.filter((topic) => {
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
            }
        }

        for (const cooccur of cooccurrences) {
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

                    if (
                        this.flatGraph.hasEdge(
                            fromTopic.topicId,
                            toTopic.topicId,
                        )
                    ) {
                        const current = this.flatGraph.getEdgeAttributes(
                            fromTopic.topicId,
                            toTopic.topicId,
                        );
                        this.flatGraph.setEdgeAttribute(
                            fromTopic.topicId,
                            toTopic.topicId,
                            "count",
                            current.count + cooccur.count,
                        );
                        this.flatGraph.setEdgeAttribute(
                            fromTopic.topicId,
                            toTopic.topicId,
                            "urls",
                            [...current.urls, ...cooccur.urls],
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
                    }
                }
            }
        }

        debug(
            `Flat graph: ${this.flatGraph.order} nodes, ${this.flatGraph.size} edges`,
        );
    }

    private buildHierarchicalGraph(
        hierarchicalTopics: HierarchicalTopicRecord[],
    ): void {
        debug("Building hierarchical graph structure");

        for (const topic of hierarchicalTopics) {
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
            }
        }

        for (const topic of hierarchicalTopics) {
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
                    parentAttrs.childIds.push(topic.topicId);
                }
            }
        }

        debug(
            `Hierarchical graph: ${this.hierarchicalGraph.order} nodes, ${this.hierarchicalGraph.size} structural edges`,
        );
    }

    private aggregateCooccurrencesBottomUp(): void {
        debug("Aggregating cooccurrences bottom-up through hierarchy");

        const nodesByLevel = new Map<number, string[]>();
        for (const node of this.hierarchicalGraph.nodes()) {
            const level = this.hierarchicalGraph.getNodeAttribute(
                node,
                "level",
            );
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        const maxLevel = Math.max(...Array.from(nodesByLevel.keys()));

        for (let level = maxLevel; level >= 0; level--) {
            const nodesAtLevel = nodesByLevel.get(level) || [];

            for (const topicId of nodesAtLevel) {
                const attrs = this.hierarchicalGraph.getNodeAttributes(topicId);

                if (attrs.childIds.length === 0) {
                    if (this.flatGraph.hasNode(topicId)) {
                        for (const edge of this.flatGraph.edges(topicId)) {
                            const source = this.flatGraph.source(edge);
                            const target = this.flatGraph.target(edge);
                            const edgeAttrs =
                                this.flatGraph.getEdgeAttributes(edge);
                            const otherNode =
                                source === topicId ? target : source;

                            if (!this.hierarchicalGraph.hasNode(otherNode)) {
                                continue;
                            }

                            const hierarchicalEdgeKey = this.getEdgeKey(
                                topicId,
                                otherNode,
                            );
                            if (
                                !this.hierarchicalGraph.hasEdge(
                                    hierarchicalEdgeKey,
                                )
                            ) {
                                this.hierarchicalGraph.addEdge(
                                    topicId,
                                    otherNode,
                                    {
                                        type: "cooccurrence",
                                        count: edgeAttrs.count,
                                        urls: edgeAttrs.urls,
                                        strength: edgeAttrs.strength,
                                    },
                                );
                            }
                        }
                    }
                } else {
                    const aggregatedCooccurrences = new Map<
                        string,
                        {
                            count: number;
                            urls: Set<string>;
                        }
                    >();

                    for (const childId of attrs.childIds) {
                        for (const edge of this.hierarchicalGraph.edges(
                            childId,
                        )) {
                            const edgeAttrs =
                                this.hierarchicalGraph.getEdgeAttributes(edge);
                            if (edgeAttrs.type !== "cooccurrence") continue;

                            const source = this.hierarchicalGraph.source(edge);
                            const target = this.hierarchicalGraph.target(edge);
                            const otherNode =
                                source === childId ? target : source;

                            if (attrs.childIds.includes(otherNode)) {
                                continue;
                            }

                            const ancestorId = this.findCommonAncestor(
                                topicId,
                                otherNode,
                            );
                            if (ancestorId && ancestorId !== topicId) {
                                continue;
                            }

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
                        const hierarchicalEdgeKey = this.getEdgeKey(
                            topicId,
                            otherNode,
                        );
                        if (
                            !this.hierarchicalGraph.hasEdge(hierarchicalEdgeKey)
                        ) {
                            this.hierarchicalGraph.addEdge(topicId, otherNode, {
                                type: "cooccurrence",
                                count: agg.count,
                                urls: Array.from(agg.urls),
                                strength: this.calculateStrength(agg.count),
                            });
                        }
                    }
                }
            }
        }

        debug(
            `Hierarchical graph after aggregation: ${this.hierarchicalGraph.order} nodes, ${this.hierarchicalGraph.size} total edges`,
        );
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

    private findCommonAncestor(nodeA: string, nodeB: string): string | null {
        const ancestorsA = new Set<string>();
        let current: string | null = nodeA;

        while (current) {
            ancestorsA.add(current);
            const attrs: any =
                this.hierarchicalGraph.getNodeAttributes(current);
            current = attrs.parentTopicId || null;
        }

        current = nodeB;
        while (current) {
            if (ancestorsA.has(current)) {
                return current;
            }
            const attrs: any =
                this.hierarchicalGraph.getNodeAttributes(current);
            current = attrs.parentTopicId || null;
        }

        return null;
    }

    private getEdgeKey(nodeA: string, nodeB: string): string {
        return nodeA < nodeB ? `${nodeA}|${nodeB}` : `${nodeB}|${nodeA}`;
    }

    private calculateStrength(count: number): number {
        return Math.min(1.0, Math.log(count + 1) / Math.log(10));
    }

    public exportToTopicRelationships(): TopicRelationship[] {
        const relationships: TopicRelationship[] = [];
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

        debug(`Exported ${relationships.length} topic relationships`);
        return relationships;
    }

    public getGraphs(): TopicGraphs {
        return {
            flatGraph: this.flatGraph,
            hierarchicalGraph: this.hierarchicalGraph,
        };
    }
}
