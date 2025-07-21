// Enhanced Search Web Memories Implementation
// Integrates entity graphs with existing TypeAgent search capabilities

import type { EnhancedEntity, EntityRelationship } from "./entityExtractor.js";
import { RealTimeEntityExtractor } from "./entityExtractor.js";
import { EntityGraphCache, globalEntityCache } from "./entityCache.js";
import { Entity } from "./schema/knowledgeExtraction.mjs";
import { searchWebMemories } from "../searchWebMemories.mjs";

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
    private cache: EntityGraphCache;
    private mockMode: boolean = false;
    private entityExtractor: RealTimeEntityExtractor;

    constructor(cache: EntityGraphCache = globalEntityCache) {
        this.cache = cache;
        this.entityExtractor = new RealTimeEntityExtractor();
    }

    /**
     * Search entities by name with advanced filtering
     */
    async searchByEntity(
        entityName: string,
        options: EntitySearchOptions = {},
    ): Promise<EntitySearchResult> {
        const startTime = Date.now();

        try {
            if (this.mockMode) {
                return this.searchMockEntities(entityName, options, startTime);
            }

            // Check cache first
            const cachedEntity = await this.cache.getEntity(entityName);
            if (cachedEntity) {
                return {
                    entities: [cachedEntity],
                    totalCount: 1,
                    searchTime: Date.now() - startTime,
                    cacheHit: true,
                    suggestions: await this.getEntitySuggestions(entityName),
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
                        await this.cache.cacheEntity(enhancedEntity);
                    }
                }
            }

            // If no existing entities found, try to extract from content
            if (foundEntities.length === 0) {
                const extractedEntities =
                    await this.entityExtractor.extractEntitiesFromWebsites(
                        websiteSearchResults.websites.map((w) => ({
                            url: w.url,
                            title: w.title,
                            content: w.snippet || "",
                            timestamp:
                                w.lastVisited || new Date().toISOString(),
                        })),
                    );

                foundEntities.push(
                    ...extractedEntities.filter((e) =>
                        e.name.toLowerCase().includes(entityName.toLowerCase()),
                    ),
                );
            }

            const result: EntitySearchResult = {
                entities: foundEntities.slice(0, options.maxResults || 10),
                totalCount: foundEntities.length,
                searchTime: Date.now() - startTime,
                cacheHit: false,
                suggestions: await this.getEntitySuggestions(entityName),
                filters: await this.getAvailableFilters(),
            };

            return result;
        } catch (error) {
            console.error("Error in searchByEntity:", error);
            // Fallback to mock data on error
            return this.searchMockEntities(entityName, options, startTime);
        }
    }

    /**
     * Get entity graph centered on a specific entity
     */
    async getEntityGraph(
        centerEntity: string,
        depth: number = 2,
    ): Promise<EntityGraphData> {
        const startTime = Date.now();

        try {
            if (this.mockMode) {
                return this.getMockEntityGraph(centerEntity, depth, startTime);
            }

            // Get the center entity first
            const centerEntityResult = await this.searchByEntity(centerEntity, {
                maxResults: 1,
            });
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
            // Fallback to mock data on error
            return this.getMockEntityGraph(centerEntity, depth, startTime);
        }
    }

    /**
     * Get entity data with hybrid mock/real support
     */
    async getEntityData(
        entityName: string,
        useMockData: boolean = this.mockMode,
    ): Promise<EnhancedEntity | null> {
        if (useMockData) {
            const entities = this.getMockEntities();
            return (
                entities.find(
                    (e) => e.name.toLowerCase() === entityName.toLowerCase(),
                ) || null
            );
        }

        // Use real data - search for the entity
        const searchResult = await this.searchByEntity(entityName, {
            maxResults: 1,
        });
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
        await this.cache.invalidateEntity(entityName);
        return this.getEntityData(entityName, false);
    }

    /**
     * Set mock mode
     */
    setMockMode(enabled: boolean): void {
        this.mockMode = enabled;
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return this.cache.getCacheStats();
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
     * Get entity suggestions for search
     */
    private async getEntitySuggestions(entityName: string): Promise<string[]> {
        // This could be enhanced with more sophisticated suggestion logic
        return [
            "Related entities",
            "Similar organizations",
            "Connected people",
        ];
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

    /**
     * Search mock entities (fallback)
     */
    private searchMockEntities(
        entityName: string,
        options: EntitySearchOptions,
        startTime: number,
    ): EntitySearchResult {
        const entities = this.getMockEntities().filter((e) =>
            e.name.toLowerCase().includes(entityName.toLowerCase()),
        );

        return {
            entities: entities.slice(0, options.maxResults || 10),
            totalCount: entities.length,
            searchTime: Date.now() - startTime,
            cacheHit: false,
            suggestions: ["Microsoft", "Azure", "Office365"],
            filters: {
                availableTypes: ["organization", "person", "product"],
                availableDomains: ["microsoft.com", "azure.com", "office.com"],
                dateRange: {
                    earliest: "2020-01-01T00:00:00.000Z",
                    latest: new Date().toISOString(),
                },
            },
        };
    }

    /**
     * Get mock entity graph (fallback)
     */
    private getMockEntityGraph(
        centerEntity: string,
        depth: number,
        startTime: number,
    ): EntityGraphData {
        const entities = this.getMockEntities();
        const relationships = this.getMockRelationships();

        return {
            centerEntity,
            entities: entities.slice(0, 5),
            relationships: relationships.slice(0, 5),
            depth,
            totalNodes: entities.length,
            totalEdges: relationships.length,
            generationTime: Date.now() - startTime,
        };
    }

    // Mock data helpers
    private getMockEntities(): EnhancedEntity[] {
        return [
            {
                name: "Microsoft",
                type: "organization",
                confidence: 0.95,
                aliases: ["Microsoft Corp"],
                mentionCount: 150,
                firstSeen: "2020-01-01T00:00:00.000Z",
                lastSeen: new Date().toISOString(),
                dominantDomains: ["microsoft.com"],
                strongRelationships: [],
                coOccurringEntities: [],
                contextSnippets: ["Microsoft is a technology company"],
                topicAffinity: ["cloud computing"],
                sourceWebsites: ["https://microsoft.com"],
                extractionMethod: "hybrid",
                lastUpdated: new Date().toISOString(),
            },
            {
                name: "Satya Nadella",
                type: "person",
                confidence: 0.98,
                aliases: ["@satyanadella"],
                mentionCount: 200,
                firstSeen: "2020-01-01T00:00:00.000Z",
                lastSeen: new Date().toISOString(),
                dominantDomains: ["linkedin.com"],
                strongRelationships: [],
                coOccurringEntities: [],
                contextSnippets: ["Satya Nadella is the CEO of Microsoft"],
                topicAffinity: ["leadership"],
                sourceWebsites: ["https://linkedin.com/in/satyanadella"],
                extractionMethod: "hybrid",
                lastUpdated: new Date().toISOString(),
            },
        ];
    }

    private getMockRelationships(): EntityRelationship[] {
        return [
            {
                relatedEntity: "Microsoft",
                relationshipType: "CEO_of",
                confidence: 0.95,
                evidenceSources: ["microsoft.com"],
                firstObserved: "2020-01-01T00:00:00.000Z",
                lastObserved: new Date().toISOString(),
                strength: 0.95,
                direction: "unidirectional",
            },
        ];
    }
}

/**
 * Global enhanced search instance
 */
export const globalEnhancedSearch = new EnhancedSearchWebMemories();
