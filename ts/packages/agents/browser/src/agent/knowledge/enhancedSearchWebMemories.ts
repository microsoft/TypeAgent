// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Enhanced Search Web Memories Implementation
// Integrates entity graphs with existing TypeAgent search capabilities

import { Entity } from "./schema/knowledgeExtraction.mjs";
import { searchWebMemories } from "../searchWebMemories.mjs";


export type EntityType =
    | "person"
    | "organization"
    | "product"
    | "concept"
    | "location"
    | "technology"
    | "event"
    | "document";

export interface EntityCoOccurrence {
    entityName: string;
    coOccurrenceCount: number;
    contexts: string[]; // Where they co-occurred
    confidence: number;
}

export interface EnhancedEntity {
    name: string;
    type: EntityType;
    confidence: number;

    // Graph properties
    aliases: string[];
    mentionCount: number;
    firstSeen: string;
    lastSeen: string;
    dominantDomains: string[];

    // Relationship properties
    strongRelationships: EntityRelationship[];
    coOccurringEntities: EntityCoOccurrence[];

    // Content properties
    contextSnippets: string[];
    topicAffinity: string[];

    // Data source tracking
    sourceWebsites: string[];
    extractionMethod: "nlp" | "pattern" | "manual" | "hybrid";
    lastUpdated: string;
}

export interface EntityRelationship {
    relatedEntity: string;
    relationshipType: string;
    confidence: number;
    evidenceSources: string[];
    firstObserved: string;
    lastObserved: string;
    strength: number;
    direction: "bidirectional" | "unidirectional";
}


export interface EntitySearchOptions {
    entityType?: string;
    confidenceThreshold?: number;
    maxResults?: number;
    includeRelationships?: boolean;
    sortBy?: "relevance" | "confidence" | "recency";
    domainFilter?: string[];
    timeRange?: {
        start: string;
        end: string;
    };
}

export interface EntitySearchResult {
    entities: EnhancedEntity[];
    totalCount: number;
    searchTime: number;
    cacheHit: boolean;
    suggestions: string[];
    filters: {
        availableTypes: string[];
        availableDomains: string[];
        dateRange: {
            earliest: string;
            latest: string;
        };
    };
}

export interface EntityGraphData {
    centerEntity: string;
    entities: EnhancedEntity[];
    relationships: EntityRelationship[];
    depth: number;
    totalNodes: number;
    totalEdges: number;
    generationTime: number;
}

/**
 * Enhanced Search Web Memories
 * Extends existing search capabilities with entity graph functionality
 */
export class EnhancedSearchWebMemories {
    private cache: Map<string, any> = new Map();

    /**
     * Search entities by name with advanced filtering
     */
    async searchByEntity(
        entityName: string,
        options: EntitySearchOptions = {},
    ): Promise<EntitySearchResult|undefined> {
        const startTime = Date.now();

        try {

            // Check cache first
            const cachedEntity = this.cache.get(entityName);
            if (cachedEntity) {
                return {
                    entities: [cachedEntity],
                    totalCount: 1,
                    searchTime: Date.now() - startTime,
                    cacheHit: true,
                    suggestions: [],
                    filters: await this.getAvailableFilters(),
                };
            }

            // Search websites for entity mentions
            const websiteSearchResults = await searchWebMemories(
                {
                    query: entityName,
                    limit: options.maxResults || 20,
                    includeRelatedEntities: true,
                    generateAnswer: false,
                },
                {} as any,
            );

            // Extract entities from website content
            const foundEntities: EnhancedEntity[] = [];

            if (websiteSearchResults.relatedEntities) {
                // Convert existing entities to enhanced entities
                for (const entity of websiteSearchResults.relatedEntities) {
                    if (
                        entity.name
                            .toLowerCase()
                            .includes(entityName.toLowerCase()) ||
                        entityName
                            .toLowerCase()
                            .includes(entity.name.toLowerCase())
                    ) {
                        const enhancedEntity =
                            await this.convertToEnhancedEntity(
                                entity,
                                websiteSearchResults.websites,
                            );
                        foundEntities.push(enhancedEntity);

                        // Cache the entity
                        this.cache.set(enhancedEntity.name, enhancedEntity);
                    }
                }
            }

            const result: EntitySearchResult = {
                entities: foundEntities.slice(0, options.maxResults || 10),
                totalCount: foundEntities.length,
                searchTime: Date.now() - startTime,
                cacheHit: false,
                suggestions: [],
                filters: await this.getAvailableFilters(),
            };

            return result;
        } catch (error) {
            console.error("Error in searchByEntity:", error);
        }
    }

    /**
     * Get entity graph centered on a specific entity
     */
    async getEntityGraph(
        centerEntity: string,
        depth: number = 2,
    ): Promise<EntityGraphData | undefined>  {
        const startTime = Date.now();

        try {

            // Get the center entity first
            const centerEntityResult = await this.searchByEntity(centerEntity, {
                maxResults: 1,
            });
            
            if(!centerEntityResult || centerEntityResult.entities.length === 0) {
                console.warn(`Center entity "${centerEntity}" not found.`);
                return {
                    centerEntity,
                    entities: [],
                    relationships: [],
                    depth,
                    totalNodes: 0,
                    totalEdges: 0,
                    generationTime: Date.now() - startTime,
                };
            }

            if (centerEntityResult.entities.length === 0) {
                // Return empty graph if center entity not found
                return {
                    centerEntity,
                    entities: [],
                    relationships: [],
                    depth,
                    totalNodes: 0,
                    totalEdges: 0,
                    generationTime: Date.now() - startTime,
                };
            }

            const centerEntityData = centerEntityResult.entities[0];
            const allEntities: EnhancedEntity[] = [centerEntityData];
            const allRelationships: EntityRelationship[] = [];

            // Expand outward based on depth
            let currentEntities = [centerEntityData];

            for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
                const nextLevelEntities: EnhancedEntity[] = [];

                for (const entity of currentEntities) {
                    // Find related entities by searching for co-occurrences
                    const relatedSearch = await searchWebMemories(
                        {
                            query: `${entity.name} AND (related OR connected OR associated)`,
                            limit: 10,
                            includeRelatedEntities: true,
                            generateAnswer: false,
                        },
                        {} as any,
                    );

                    if (relatedSearch.relatedEntities) {
                        for (const relatedEntity of relatedSearch.relatedEntities) {
                            if (
                                !allEntities.some(
                                    (e) => e.name === relatedEntity.name,
                                )
                            ) {
                                const enhancedRelated =
                                    await this.convertToEnhancedEntity(
                                        relatedEntity,
                                        relatedSearch.websites,
                                    );
                                allEntities.push(enhancedRelated);
                                nextLevelEntities.push(enhancedRelated);

                                // Create relationship
                                allRelationships.push({
                                    relatedEntity: relatedEntity.name,
                                    relationshipType: "related_to",
                                    confidence: relatedEntity.confidence,
                                    evidenceSources: relatedSearch.websites
                                        .slice(0, 3)
                                        .map((w) => w.url),
                                    firstObserved: new Date().toISOString(),
                                    lastObserved: new Date().toISOString(),
                                    strength: relatedEntity.confidence,
                                    direction: "bidirectional",
                                });
                            }
                        }
                    }
                }

                currentEntities = nextLevelEntities;
                if (currentEntities.length === 0) break; // No more entities to expand
            }

            return {
                centerEntity,
                entities: allEntities,
                relationships: allRelationships,
                depth,
                totalNodes: allEntities.length,
                totalEdges: allRelationships.length,
                generationTime: Date.now() - startTime,
            };
        } catch (error) {
            console.error("Error in getEntityGraph:", error);
        }
    }

    /**
     * Get entity data with hybrid mock/real support
     */
    async getEntityData(
        entityName: string,
    ): Promise<EnhancedEntity | null> {
        const searchResult = await this.searchByEntity(entityName, {
            maxResults: 1,
        });
        if(!searchResult || searchResult.entities.length === 0) {
            console.warn(`Entity "${entityName}" not found.`);
            return null;
        }
        return searchResult.entities.length > 0
            ? searchResult.entities[0]
            : null;
    }

    /**
     * Refresh entity data from source
     */
    async refreshEntityData(
        entityName: string,
    ): Promise<EnhancedEntity | null> {
        this.cache.delete(entityName);
        return this.getEntityData(entityName);
    }


    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            entityCount: this.cache.size,
            cacheSize: this.cache.size
        };
    }

    /**
     * Helper method to convert Entity to EnhancedEntity
     */
    private async convertToEnhancedEntity(
        entity: Entity,
        websites: any[],
    ): Promise<EnhancedEntity> {
        return {
            name: entity.name,
            type: entity.type as any, // Type conversion from string to EntityType
            confidence: entity.confidence,
            aliases: [],
            mentionCount: websites.length,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            dominantDomains: websites
                .slice(0, 3)
                .map((w) => new URL(w.url).hostname),
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: websites
                .slice(0, 3)
                .map((w) => w.snippet || w.title)
                .filter((s) => s),
            topicAffinity: [],
            sourceWebsites: websites.slice(0, 5).map((w) => w.url),
            extractionMethod: "hybrid",
            lastUpdated: new Date().toISOString(),
        };
    }


    /**
     * Get available filters for search
     */
    private async getAvailableFilters(): Promise<any> {
        return {
            availableTypes: ["organization", "person", "product", "concept"],
            availableDomains: ["various domains from search results"],
            dateRange: {
                earliest: "2020-01-01T00:00:00.000Z",
                latest: new Date().toISOString(),
            },
        };
    }

}

/**
 * Global enhanced search instance
 */
export const globalEnhancedSearch = new EnhancedSearchWebMemories();
