// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import type { TopicGraphJson } from "../storage/graphJsonStorage.js";

const debug = registerDebug("typeagent:website:queries:topic");

export interface TopicNode {
    id: string;
    name: string;
    level: number;
    parentId?: string;
    confidence: number;
    metadata: {
        keywords: string[];
        sourceTopicNames: string[];
        domains: string[];
        urls: string[];
        extractionDate: string;
    };
}

export interface TopicRelationship {
    source: string;
    target: string;
    type: string;
    strength: number;
    metadata: {
        cooccurrenceCount?: number;
        sourceUrls: string[];
        firstSeen?: string;
        lastSeen?: string;
        updated: string;
    };
}

export interface TopicEntityRelation {
    topicId: string;
    entityName: string;
    relevance: number;
    domain: string;
}

export interface TopicMetrics {
    topicId: string;
    topicName: string;
    documentCount: number;
    domainCount: number;
    degreeCentrality: number;
    betweennessCentrality: number;
    firstSeen?: string;
    lastSeen?: string;
    activityPeriod: number;
    avgConfidence: number;
    maxConfidence: number;
    totalRelationships: number;
    strongRelationships: number;
    entityCount: number;
    topEntities?: string;
    updated: string;
}

/**
 * Provides query interface for topic graph data stored in JSON format
 * Mirrors the functionality of SQLite table queries
 */
export class TopicGraphQueries {
    private nodeMap: Map<string, TopicNode> = new Map();
    private levelIndex: Map<number, TopicNode[]> = new Map();
    private parentChildIndex: Map<string, TopicNode[]> = new Map();
    private relationshipMap: Map<string, TopicRelationship[]> = new Map();
    private topicEntityMap: Map<string, TopicEntityRelation[]> = new Map();
    private entityTopicMap: Map<string, TopicEntityRelation[]> = new Map();
    private metricsMap: Map<string, TopicMetrics> = new Map();

    constructor(private jsonData: TopicGraphJson) {
        this.buildIndexes();
    }

    /**
     * Build internal indexes for fast queries
     */
    private buildIndexes(): void {
        debug(`Building indexes for ${this.jsonData.metadata.nodeCount} topics`);

        // Node indexes
        for (const node of this.jsonData.nodes) {
            this.nodeMap.set(node.id, node);

            // Level index
            if (!this.levelIndex.has(node.level)) {
                this.levelIndex.set(node.level, []);
            }
            this.levelIndex.get(node.level)!.push(node);

            // Parent-child index
            if (node.parentId) {
                if (!this.parentChildIndex.has(node.parentId)) {
                    this.parentChildIndex.set(node.parentId, []);
                }
                this.parentChildIndex.get(node.parentId)!.push(node);
            }
        }

        // Relationship index
        for (const edge of this.jsonData.edges) {
            // Index by source
            if (!this.relationshipMap.has(edge.source)) {
                this.relationshipMap.set(edge.source, []);
            }
            this.relationshipMap.get(edge.source)!.push(edge);

            // Index by target
            if (!this.relationshipMap.has(edge.target)) {
                this.relationshipMap.set(edge.target, []);
            }
            this.relationshipMap.get(edge.target)!.push(edge);
        }

        // Topic-entity relationship indexes
        for (const relation of this.jsonData.topicEntityRelations) {
            // Index by topic
            if (!this.topicEntityMap.has(relation.topicId)) {
                this.topicEntityMap.set(relation.topicId, []);
            }
            this.topicEntityMap.get(relation.topicId)!.push(relation);

            // Index by entity
            if (!this.entityTopicMap.has(relation.entityName)) {
                this.entityTopicMap.set(relation.entityName, []);
            }
            this.entityTopicMap.get(relation.entityName)!.push(relation);
        }

        // Metrics index
        for (const [topicId, metrics] of Object.entries(this.jsonData.metrics)) {
            this.metricsMap.set(topicId, metrics);
        }

        debug(`Indexes built: ${this.nodeMap.size} topics, ${this.relationshipMap.size} relationship entries, ${this.topicEntityMap.size} topic-entity mappings`);
    }

    /**
     * Get topics by level (mirrors HierarchicalTopicTable.getTopicsByLevel)
     */
    getTopicsByLevel(level: number): TopicNode[] {
        const topics = this.levelIndex.get(level) || [];
        return topics.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get child topics (mirrors HierarchicalTopicTable.getChildTopics)
     */
    getChildTopics(parentTopicId: string): TopicNode[] {
        const children = this.parentChildIndex.get(parentTopicId) || [];
        return children.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get topic hierarchy (mirrors HierarchicalTopicTable.getTopicHierarchy)
     */
    getTopicHierarchy(domain?: string): TopicNode[] {
        let topics = Array.from(this.nodeMap.values());
        
        if (domain) {
            topics = topics.filter(topic => 
                topic.metadata.domains.includes(domain)
            );
        }
        
        return topics.sort((a, b) => {
            if (a.level !== b.level) {
                return a.level - b.level;
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Get root topics (mirrors HierarchicalTopicTable.getRootTopics)
     */
    getRootTopics(domain?: string): TopicNode[] {
        const rootTopics = this.getTopicsByLevel(0);
        
        if (domain) {
            return rootTopics.filter(topic => 
                topic.metadata.domains.includes(domain)
            );
        }
        
        return rootTopics;
    }

    /**
     * Get topic by ID (mirrors HierarchicalTopicTable.getTopicById)
     */
    getTopicById(topicId: string): TopicNode | undefined {
        return this.nodeMap.get(topicId);
    }

    /**
     * Get child topic by name (mirrors HierarchicalTopicTable.getChildByName)
     */
    getChildByName(topicName: string, parentTopicId: string): TopicNode | undefined {
        const children = this.getChildTopics(parentTopicId);
        return children.find(child => child.name === topicName);
    }

    /**
     * Get topic by name and level (mirrors HierarchicalTopicTable.getTopicByName)
     */
    getTopicByName(topicName: string, level: number): TopicNode | undefined {
        const levelTopics = this.getTopicsByLevel(level);
        return levelTopics.find(topic => topic.name === topicName);
    }

    /**
     * Get relationships for topic (mirrors TopicRelationshipTable.getRelationshipsForTopic)
     */
    getRelationshipsForTopic(topicId: string): TopicRelationship[] {
        const relationships = this.relationshipMap.get(topicId) || [];
        return relationships.sort((a, b) => b.strength - a.strength);
    }

    /**
     * Get strong relationships (mirrors TopicRelationshipTable.getStrongRelationships)
     */
    getStrongRelationships(topicId: string, minStrength: number = 0.7): TopicRelationship[] {
        const relationships = this.getRelationshipsForTopic(topicId);
        return relationships.filter(rel => rel.strength >= minStrength);
    }

    /**
     * Get relationships for multiple topics (mirrors TopicRelationshipTable.getRelationshipsForTopics)
     */
    getRelationshipsForTopics(topicIds: string[]): TopicRelationship[] {
        if (topicIds.length === 0) return [];

        const relationships = new Set<TopicRelationship>();
        
        for (const topicId of topicIds) {
            const topicRels = this.relationshipMap.get(topicId) || [];
            topicRels.forEach(rel => relationships.add(rel));
        }

        return Array.from(relationships).sort((a, b) => b.strength - a.strength);
    }

    /**
     * Get optimized relationships for topics (mirrors TopicRelationshipTable.getRelationshipsForTopicsOptimized)
     */
    getRelationshipsForTopicsOptimized(topicIds: string[], minStrength: number = 0.3): TopicRelationship[] {
        if (topicIds.length === 0) return [];

        const topicIdSet = new Set(topicIds);
        const relationships: TopicRelationship[] = [];

        for (const edge of this.jsonData.edges) {
            if (edge.strength >= minStrength &&
                topicIdSet.has(edge.source) && 
                topicIdSet.has(edge.target)) {
                relationships.push(edge);
            }
        }

        return relationships.sort((a, b) => b.strength - a.strength);
    }

    /**
     * Get entities for topic (mirrors TopicEntityRelationTable.getEntitiesForTopic)
     */
    getEntitiesForTopic(topicId: string): TopicEntityRelation[] {
        const relations = this.topicEntityMap.get(topicId) || [];
        return relations.sort((a, b) => b.relevance - a.relevance);
    }

    /**
     * Get topics for entity (mirrors TopicEntityRelationTable.getTopicsForEntity)
     */
    getTopicsForEntity(entityName: string): TopicEntityRelation[] {
        const relations = this.entityTopicMap.get(entityName) || [];
        return relations.sort((a, b) => b.relevance - a.relevance);
    }

    /**
     * Get entities for multiple topics (mirrors TopicEntityRelationTable.getEntitiesForTopics)
     */
    getEntitiesForTopics(topicIds: string[]): TopicEntityRelation[] {
        if (topicIds.length === 0) return [];

        const relations: TopicEntityRelation[] = [];
        
        for (const topicId of topicIds) {
            const topicRelations = this.topicEntityMap.get(topicId) || [];
            relations.push(...topicRelations);
        }

        return relations.sort((a, b) => {
            if (a.topicId !== b.topicId) {
                return a.topicId.localeCompare(b.topicId);
            }
            return b.relevance - a.relevance;
        });
    }

    /**
     * Get topic metrics (mirrors TopicMetricsTable.getMetrics)
     */
    getMetrics(topicId: string): TopicMetrics | undefined {
        return this.metricsMap.get(topicId);
    }

    /**
     * Get top topics by importance (mirrors TopicMetricsTable.getTopTopicsByImportance)
     */
    getTopTopicsByImportance(limit: number = 20): TopicMetrics[] {
        const allMetrics = Array.from(this.metricsMap.values());
        
        return allMetrics
            .sort((a, b) => {
                // Sort by document count first, then centrality measures
                if (a.documentCount !== b.documentCount) {
                    return b.documentCount - a.documentCount;
                }
                if (a.degreeCentrality !== b.degreeCentrality) {
                    return b.degreeCentrality - a.degreeCentrality;
                }
                return b.betweennessCentrality - a.betweennessCentrality;
            })
            .slice(0, limit);
    }

    /**
     * Get topic statistics similar to legacy getTopTopics
     */
    getTopTopics(limit: number = 20): Array<{ topic: string; count: number }> {
        const topicCounts = new Map<string, number>();

        // Count topic occurrences across URLs
        for (const node of this.jsonData.nodes) {
            const count = node.metadata.urls.length;
            topicCounts.set(node.name, (topicCounts.get(node.name) || 0) + count);
        }

        return Array.from(topicCounts.entries())
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * Get related topics (similar to legacy getRelatedTopics)
     */
    getRelatedTopics(topicName: string, limit: number = 10): TopicNode[] {
        const topic = Array.from(this.nodeMap.values()).find(t => t.name.includes(topicName));
        if (!topic) return [];

        const relatedTopics = new Set<TopicNode>();
        
        // Find topics that appear on the same URLs
        for (const node of this.jsonData.nodes) {
            if (node.id !== topic.id) {
                const commonUrls = node.metadata.urls.filter(url => 
                    topic.metadata.urls.includes(url)
                );
                if (commonUrls.length > 0) {
                    relatedTopics.add(node);
                }
            }
        }

        return Array.from(relatedTopics)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, limit);
    }

    /**
     * Get total topic count
     */
    getTotalTopicCount(): number {
        return this.jsonData.metadata.nodeCount;
    }

    /**
     * Search topics by name
     */
    searchTopicsByName(searchTerm: string, limit: number = 10): TopicNode[] {
        const term = searchTerm.toLowerCase();
        const matches: TopicNode[] = [];

        for (const node of this.jsonData.nodes) {
            if (node.name.toLowerCase().includes(term)) {
                matches.push(node);
            }
        }

        return matches
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, limit);
    }

    /**
     * Get topic statistics
     */
    getTopicStatistics(): {
        totalTopics: number;
        totalRelationships: number;
        totalEntityRelations: number;
        topicsByLevel: Array<{ level: number; count: number }>;
        topDomains: Array<{ domain: string; count: number }>;
        averageConfidence: number;
    } {
        // Level statistics
        const levelCounts = new Map<number, number>();
        for (const node of this.jsonData.nodes) {
            levelCounts.set(node.level, (levelCounts.get(node.level) || 0) + 1);
        }

        // Domain statistics
        const domainCounts = new Map<string, number>();
        for (const node of this.jsonData.nodes) {
            for (const domain of node.metadata.domains) {
                domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
            }
        }

        // Average confidence
        const totalConfidence = this.jsonData.nodes.reduce((sum, node) => sum + node.confidence, 0);
        const averageConfidence = this.jsonData.nodes.length > 0 ? totalConfidence / this.jsonData.nodes.length : 0;

        return {
            totalTopics: this.getTotalTopicCount(),
            totalRelationships: this.jsonData.metadata.edgeCount,
            totalEntityRelations: this.jsonData.metadata.relationshipCount,
            topicsByLevel: Array.from(levelCounts.entries())
                .map(([level, count]) => ({ level, count }))
                .sort((a, b) => a.level - b.level),
            topDomains: Array.from(domainCounts.entries())
                .map(([domain, count]) => ({ domain, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
            averageConfidence
        };
    }
}