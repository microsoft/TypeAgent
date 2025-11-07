// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * In-memory cache manager for graph building operations
 * Reduces database queries by caching frequently accessed data during graph construction
 */

interface Relationship {
    id: string;
    fromEntity: string;
    toEntity: string;
    relationshipType: string;
    confidence: number;
    metadata?: string;
    cooccurrenceCount?: number;
    extractionDate: string;
    sources?: string;
    strength?: number;
    updated: string;
}

import { Website } from "../websiteMeta.js";

export interface GraphBuildingCache {
    websites: Website[];
    entitiesByWebsite: Map<string, string[]>; // url -> entity names
    topicsByWebsite: Map<string, string[]>; // url -> topic names
    entityToWebsites: Map<string, string[]>; // entity -> urls
    topicToWebsites: Map<string, string[]>; // topic -> urls
    entityCooccurrences: Map<string, Map<string, number>>; // entity -> entity -> count
    topicCooccurrences: Map<string, Map<string, number>>; // topic -> topic -> count
    strongRelationships: Relationship[];
    lastUpdated: number;
}

export class GraphBuildingCacheManager {
    private cache: GraphBuildingCache | null = null;

    /**
     * Initialize cache from website collection
     */
    async initializeCache(websites: Website[]): Promise<void> {
        const entitiesByWebsite = new Map<string, string[]>();
        const topicsByWebsite = new Map<string, string[]>();
        const entityToWebsites = new Map<string, string[]>();
        const topicToWebsites = new Map<string, string[]>();
        const entityCooccurrences = new Map<string, Map<string, number>>();
        const topicCooccurrences = new Map<string, Map<string, number>>();

        // Pre-process all websites to build lookup tables
        for (const website of websites) {
            const url = website.metadata.url;

            // Extract entities
            const entities: string[] = [];
            if (website.knowledge?.entities) {
                for (const entity of website.knowledge.entities) {
                    entities.push(entity.name);

                    // Build entity -> websites mapping
                    if (!entityToWebsites.has(entity.name)) {
                        entityToWebsites.set(entity.name, []);
                    }
                    entityToWebsites.get(entity.name)!.push(url);
                }
            }
            entitiesByWebsite.set(url, entities);

            // Extract topics
            const topics: string[] = [];
            if (website.knowledge?.topics) {
                for (const topic of website.knowledge.topics) {
                    const topicName =
                        typeof topic === "string" ? topic : (topic as any).name;
                    if (topicName) {
                        topics.push(topicName);

                        // Build topic -> websites mapping
                        if (!topicToWebsites.has(topicName)) {
                            topicToWebsites.set(topicName, []);
                        }
                        topicToWebsites.get(topicName)!.push(url);
                    }
                }
            }
            topicsByWebsite.set(url, topics);

            // Pre-compute entity co-occurrences for this website
            this.computeCooccurrences(entities, entityCooccurrences);

            // Pre-compute topic co-occurrences for this website
            this.computeCooccurrences(topics, topicCooccurrences);
        }

        this.cache = {
            websites,
            entitiesByWebsite,
            topicsByWebsite,
            entityToWebsites,
            topicToWebsites,
            entityCooccurrences,
            topicCooccurrences,
            strongRelationships: [], // Will be populated separately
            lastUpdated: Date.now(),
        };
    }

    /**
     * Set strong relationships in cache
     */
    setStrongRelationships(relationships: Relationship[]): void {
        if (this.cache) {
            this.cache.strongRelationships = relationships;
        }
    }

    /**
     * Get all unique entities from cache
     */
    getAllEntities(): string[] {
        if (!this.cache) return [];
        return Array.from(this.cache.entityToWebsites.keys());
    }

    /**
     * Get all unique topics from cache
     */
    getAllTopics(): string[] {
        if (!this.cache) return [];
        return Array.from(this.cache.topicToWebsites.keys());
    }

    /**
     * Get websites that contain a specific entity
     */
    getWebsitesForEntity(entityName: string): string[] {
        if (!this.cache) return [];
        return this.cache.entityToWebsites.get(entityName) || [];
    }

    /**
     * Get websites that contain a specific topic
     */
    getWebsitesForTopic(topicName: string): string[] {
        if (!this.cache) return [];
        return this.cache.topicToWebsites.get(topicName) || [];
    }

    /**
     * Get entities for a specific website
     */
    getEntitiesForWebsite(url: string): string[] {
        if (!this.cache) return [];
        return this.cache.entitiesByWebsite.get(url) || [];
    }

    /**
     * Get topics for a specific website
     */
    getTopicsForWebsite(url: string): string[] {
        if (!this.cache) return [];
        return this.cache.topicsByWebsite.get(url) || [];
    }

    /**
     * Get entity co-occurrence count
     */
    getEntityCooccurrenceCount(entityA: string, entityB: string): number {
        if (!this.cache) return 0;
        const cooccurrences = this.cache.entityCooccurrences.get(entityA);
        return cooccurrences?.get(entityB) || 0;
    }

    /**
     * Get topic co-occurrence count
     */
    getTopicCooccurrenceCount(topicA: string, topicB: string): number {
        if (!this.cache) return 0;
        const cooccurrences = this.cache.topicCooccurrences.get(topicA);
        return cooccurrences?.get(topicB) || 0;
    }

    /**
     * Get all entity relationships from co-occurrences
     */
    getAllEntityRelationships(): Array<{
        fromEntity: string;
        toEntity: string;
        count: number;
        sources: string[];
    }> {
        if (!this.cache) return [];

        const relationships: Array<{
            fromEntity: string;
            toEntity: string;
            count: number;
            sources: string[];
        }> = [];

        for (const [entityA, cooccurrences] of this.cache.entityCooccurrences) {
            for (const [entityB, count] of cooccurrences) {
                // Get source URLs for this relationship
                const sourcesA = this.cache.entityToWebsites.get(entityA) || [];
                const sourcesB = this.cache.entityToWebsites.get(entityB) || [];
                const commonSources = sourcesA.filter((url) =>
                    sourcesB.includes(url),
                );

                relationships.push({
                    fromEntity: entityA,
                    toEntity: entityB,
                    count,
                    sources: commonSources,
                });
            }
        }

        return relationships;
    }

    /**
     * Get all topic relationships from co-occurrences
     */
    getAllTopicRelationships(): Array<{
        fromTopic: string;
        toTopic: string;
        count: number;
        sources: string[];
    }> {
        if (!this.cache) return [];

        const relationships: Array<{
            fromTopic: string;
            toTopic: string;
            count: number;
            sources: string[];
        }> = [];

        for (const [topicA, cooccurrences] of this.cache.topicCooccurrences) {
            for (const [topicB, count] of cooccurrences) {
                // Get source URLs for this relationship
                const sourcesA = this.cache.topicToWebsites.get(topicA) || [];
                const sourcesB = this.cache.topicToWebsites.get(topicB) || [];
                const commonSources = sourcesA.filter((url) =>
                    sourcesB.includes(url),
                );

                relationships.push({
                    fromTopic: topicA,
                    toTopic: topicB,
                    count,
                    sources: commonSources,
                });
            }
        }

        return relationships;
    }

    /**
     * Get connected entities for community detection
     */
    getConnectedEntities(
        entity: string,
        minCooccurrence: number = 2,
    ): string[] {
        if (!this.cache) return [];

        const connected: string[] = [];
        const cooccurrences = this.cache.entityCooccurrences.get(entity);

        if (cooccurrences) {
            for (const [otherEntity, count] of cooccurrences) {
                if (count >= minCooccurrence) {
                    connected.push(otherEntity);
                }
            }
        }

        return connected;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        if (!this.cache) {
            return {
                isInitialized: false,
                websites: 0,
                entities: 0,
                topics: 0,
                entityRelationships: 0,
                topicRelationships: 0,
            };
        }

        let entityRelationships = 0;
        for (const cooccurrences of this.cache.entityCooccurrences.values()) {
            entityRelationships += cooccurrences.size;
        }

        let topicRelationships = 0;
        for (const cooccurrences of this.cache.topicCooccurrences.values()) {
            topicRelationships += cooccurrences.size;
        }

        return {
            isInitialized: true,
            websites: this.cache.websites.length,
            entities: this.cache.entityToWebsites.size,
            topics: this.cache.topicToWebsites.size,
            entityRelationships,
            topicRelationships,
            lastUpdated: this.cache.lastUpdated,
        };
    }

    /**
     * Clear cache
     */
    clear(): void {
        this.cache = null;
    }

    /**
     * Check if cache is valid
     */
    isValid(): boolean {
        return this.cache !== null;
    }

    /**
     * Helper method to compute co-occurrences for a list of items
     */
    private computeCooccurrences(
        items: string[],
        cooccurrenceMap: Map<string, Map<string, number>>,
    ): void {
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const itemA = items[i];
                const itemB = items[j];

                // Initialize maps if needed
                if (!cooccurrenceMap.has(itemA)) {
                    cooccurrenceMap.set(itemA, new Map());
                }
                if (!cooccurrenceMap.has(itemB)) {
                    cooccurrenceMap.set(itemB, new Map());
                }

                // Increment co-occurrence counts
                const mapA = cooccurrenceMap.get(itemA)!;
                const mapB = cooccurrenceMap.get(itemB)!;

                mapA.set(itemB, (mapA.get(itemB) || 0) + 1);
                mapB.set(itemA, (mapB.get(itemA) || 0) + 1);
            }
        }
    }
}
