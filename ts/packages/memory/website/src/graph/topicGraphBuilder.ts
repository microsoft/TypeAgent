// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import registerDebug from "debug";
import type { HierarchicalTopicRecord, TopicRelationship } from "../tables.js";
import type { TopicGraphJson } from "../storage/graphJsonStorage.js";
import type { GraphJsonStorageManager } from "../storage/graphJsonStorage.js";

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

    /**
     * Export topic graph data to JSON format for persistence
     */
    public exportToTopicGraphJson(): TopicGraphJson {
        debug("Exporting topic graph to JSON format");

        const now = new Date().toISOString();
        const nodes: TopicGraphJson['nodes'] = [];
        const edges: TopicGraphJson['edges'] = [];
        const topicEntityRelations: TopicGraphJson['topicEntityRelations'] = [];
        const metrics: TopicGraphJson['metrics'] = {};

        // Export nodes from hierarchical graph
        for (const nodeId of this.hierarchicalGraph.nodes()) {
            const attrs = this.hierarchicalGraph.getNodeAttributes(nodeId);
            
            nodes.push({
                id: nodeId,
                name: attrs.topicName || nodeId,
                level: attrs.level || 0,
                parentId: attrs.parentTopicId,
                confidence: attrs.confidence || 0.5,
                metadata: {
                    keywords: [], // Will be populated from source data if available
                    sourceTopicNames: attrs.sourceTopicNames || [],
                    domains: [], // Will be derived from URLs
                    urls: [], // Will be aggregated from cooccurrence URLs
                    extractionDate: now
                }
            });
        }

        // Export edges from hierarchical graph (cooccurrence relationships)
        for (const edge of this.hierarchicalGraph.edges()) {
            const attrs = this.hierarchicalGraph.getEdgeAttributes(edge);
            if (attrs.type === "cooccurrence") {
                const source = this.hierarchicalGraph.source(edge);
                const target = this.hierarchicalGraph.target(edge);

                edges.push({
                    source,
                    target,
                    type: attrs.type,
                    strength: attrs.strength || 0,
                    metadata: {
                        cooccurrenceCount: attrs.count || 0,
                        sourceUrls: attrs.urls || [],
                        updated: now
                    }
                });
            }
        }

        // Include pending entity relations if available
        const pendingEntityRelations = (this as any)._pendingEntityRelations || [];
        topicEntityRelations.push(...pendingEntityRelations);

        const entityCountByTopic = (this as any)._entityCountByTopic || new Map<string, number>();

        // Calculate basic metrics for each topic
        for (const node of nodes) {
            const nodeRelationships = edges.filter(e => e.source === node.id || e.target === node.id);
            const uniqueUrls = new Set<string>();
            const uniqueDomains = new Set<string>();

            // Aggregate URLs and domains from relationships
            for (const rel of nodeRelationships) {
                for (const url of rel.metadata.sourceUrls) {
                    uniqueUrls.add(url);
                    try {
                        const domain = new URL(url).hostname;
                        uniqueDomains.add(domain);
                    } catch {
                        // Skip invalid URLs
                    }
                }
            }

            // Update node metadata with aggregated data
            const nodeData = nodes.find(n => n.id === node.id);
            if (nodeData) {
                nodeData.metadata.urls = Array.from(uniqueUrls);
                nodeData.metadata.domains = Array.from(uniqueDomains);
            }

            // Calculate metrics
            metrics[node.id] = {
                topicId: node.id,
                topicName: node.name,
                documentCount: uniqueUrls.size,
                domainCount: uniqueDomains.size,
                degreeCentrality: nodeRelationships.length,
                betweennessCentrality: 0, // Would need full graph analysis
                activityPeriod: 0, // Would need temporal data
                avgConfidence: node.confidence,
                maxConfidence: node.confidence,
                totalRelationships: nodeRelationships.length,
                strongRelationships: nodeRelationships.filter(r => r.strength > 0.7).length,
                entityCount: entityCountByTopic.get(node.id) || 0,
                updated: now
            };
        }

        debug(`Exported topic graph: ${nodes.length} nodes, ${edges.length} edges, ${Object.keys(metrics).length} metrics`);

        return {
            nodes,
            edges,
            topicEntityRelations, // Empty for now, will be populated by WebsiteCollection
            metrics,
            metadata: {
                version: "1.0.0",
                lastUpdated: now,
                nodeCount: nodes.length,
                edgeCount: edges.length,
                relationshipCount: topicEntityRelations.length
            }
        };
    }

    /**
     * Save topic graph to JSON storage
     */
    public async saveToJsonStorage(storage: GraphJsonStorageManager): Promise<void> {
        debug("Saving topic graph to JSON storage");
        
        const jsonData = this.exportToTopicGraphJson();
        await storage.saveTopicGraph(jsonData);
        
        debug("Topic graph saved successfully");
    }

    /**
     * Update topic graph with entity relations and enhanced metrics
     */
    public updateTopicGraphWithEntityRelations(
        entityRelations: TopicGraphJson['topicEntityRelations']
    ): void {
        debug(`Updating topic graph with ${entityRelations.length} entity relations`);
        
        // This method allows WebsiteCollection to add entity relation data
        // after the basic graph structure is built
        
        // Update metrics with entity counts
        const entityCountByTopic = new Map<string, number>();
        for (const relation of entityRelations) {
            const count = entityCountByTopic.get(relation.topicId) || 0;
            entityCountByTopic.set(relation.topicId, count + 1);
        }
        
        // This data will be included in the next export
        // Store for use in exportToTopicGraphJson
        (this as any)._pendingEntityRelations = entityRelations;
        (this as any)._entityCountByTopic = entityCountByTopic;
    }
}
