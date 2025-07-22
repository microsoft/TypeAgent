// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebsiteCollection } from "website-memory";
import { RealTimeEntityExtractor } from "./entityExtractor.js";
import {
    EntityGraphManager,
    EnhancedEntity,
    EntityRelationship,
    EntityCoOccurrence,
} from "./entityGraph.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:entity-processing");

/**
 * Entity Processing Service
 * Handles entity extraction and knowledge graph building for WebsiteCollection
 * Uses composition instead of inheritance for cleaner architecture
 */
export class EntityProcessingService {
    private entityExtractor: RealTimeEntityExtractor;
    private graphManager: EntityGraphManager;
    private initialized: boolean = false;

    constructor() {
        this.entityExtractor = new RealTimeEntityExtractor();
        this.graphManager = new EntityGraphManager();
    }

    /**
     * Initialize the entity processing service
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        await this.graphManager.initialize();
        this.initialized = true;
        debug("Entity processing service initialized");
    }

    /**
     * Process websites and add entities to the collection
     */
    async processWebsites(
        websites: any[],
        collection: WebsiteCollection,
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            debug(
                `Processing ${websites.length} websites for entity extraction`,
            );

            // Convert websites to the format expected by entity extractor
            const websiteInputs = websites.map((site) => ({
                url: site.metadata?.url || site.url || "",
                title: site.metadata?.title || site.title || "",
                content:
                    site.textChunks?.join("\n") ||
                    site.metadata?.description ||
                    "",
                timestamp:
                    site.metadata?.visitDate ||
                    site.metadata?.bookmarkDate ||
                    new Date().toISOString(),
            }));

            // Extract entities from all websites
            const extractedEntities =
                await this.entityExtractor.extractEntitiesFromWebsites(
                    websiteInputs,
                );
            debug(`Extracted ${extractedEntities.length} entities`);

            // Convert extracted entities to canonical format
            const canonicalEntities =
                this.convertToCanonicalEntities(extractedEntities);

            // Store entities in the collection's KnowledgeEntityTable
            await this.storeEntitiesInCollection(canonicalEntities, collection);

            // Build and store relationships in the graph manager
            const relationships =
                await this.entityExtractor.buildEntityRelationships(
                    extractedEntities,
                    websiteInputs,
                );
            await this.storeRelationships(canonicalEntities, relationships);

            debug(
                `Entity processing completed for ${websites.length} websites`,
            );
        } catch (error) {
            debug("Entity processing failed:", error);
            // Don't throw - entity processing failures shouldn't break imports
        }
    }

    /**
     * Convert extracted entities to canonical EntityGraph format
     */
    private convertToCanonicalEntities(
        extractedEntities: any[],
    ): EnhancedEntity[] {
        return extractedEntities.map(
            (entity) =>
                ({
                    name: entity.name,
                    type: entity.type,
                    confidence: entity.confidence,
                    aliases: entity.aliases || [],
                    mentionCount: entity.mentionCount || 1,
                    firstSeen: entity.firstSeen || new Date().toISOString(),
                    lastSeen: entity.lastSeen || new Date().toISOString(),
                    dominantDomains: entity.dominantDomains || [],
                    strongRelationships: entity.strongRelationships || [],
                    coOccurringEntities: (entity.coOccurringEntities || []).map(
                        (coOcc: any) =>
                            ({
                                entityName:
                                    coOcc.entity || coOcc.entityName || "",
                                coOccurrenceCount: coOcc.coOccurrenceCount || 0,
                                contexts: coOcc.contexts || [],
                                confidence:
                                    coOcc.strength || coOcc.confidence || 0.5,
                            }) as EntityCoOccurrence,
                    ),
                    contextSnippets: entity.contextSnippets || [],
                    topicAffinity: entity.topicAffinity || [],
                    centrality: entity.centrality,
                    clusterGroup: entity.clusterGroup,
                    importance: entity.importance,
                }) as EnhancedEntity,
        );
    }

    /**
     * Store entities in the WebsiteCollection's KnowledgeEntityTable
     */
    private async storeEntitiesInCollection(
        entities: EnhancedEntity[],
        collection: WebsiteCollection,
    ): Promise<void> {
        for (const entity of entities) {
            // Store each entity occurrence in the knowledge entities table
            // Get source websites from dominantDomains and reconstruct URLs
            const sourceUrls = entity.dominantDomains.map(
                (domain) => `https://${domain}`,
            );

            for (const sourceUrl of sourceUrls) {
                try {
                    const domain = new URL(sourceUrl).hostname;

                    // Add to collection's knowledge entities table
                    (collection as any).knowledgeEntities.add({
                        url: sourceUrl,
                        domain: domain,
                        entityName: entity.name,
                        entityType: entity.type,
                        confidence: entity.confidence,
                        extractionDate: entity.lastSeen,
                    });

                    // Also add to our graph manager for advanced operations
                    this.graphManager.addEntity(entity);
                } catch (error) {
                    debug(`Failed to store entity ${entity.name}:`, error);
                }
            }
        }
    }

    /**
     * Store relationships in the graph manager
     */
    private async storeRelationships(
        entities: EnhancedEntity[],
        relationships: EntityRelationship[],
    ): Promise<void> {
        for (const relationship of relationships) {
            // Find the source entity for this relationship
            const sourceEntity = entities.find((e) =>
                e.strongRelationships.some(
                    (r) => r.relatedEntity === relationship.relatedEntity,
                ),
            );

            if (sourceEntity) {
                this.graphManager.addRelationship(
                    sourceEntity.name,
                    relationship.relatedEntity,
                    relationship,
                );
            }
        }
    }

    /**
     * Get entities by type from the collection
     */
    async getEntitiesByType(
        type: string,
        collection: WebsiteCollection,
    ): Promise<any[]> {
        return (collection as any).knowledgeEntities.getEntitiesByType(type);
    }

    /**
     * Get entities by domain from the collection
     */
    async getEntitiesByDomain(
        domain: string,
        collection: WebsiteCollection,
    ): Promise<any[]> {
        return (collection as any).knowledgeEntities.getEntitiesByDomain(
            domain,
        );
    }

    /**
     * Search entities across the collection
     */
    async searchEntities(
        query: string,
        collection: WebsiteCollection,
    ): Promise<any[]> {
        // Use the graph manager for advanced search
        if (!this.initialized) {
            await this.initialize();
        }

        return this.graphManager.searchEntities(query, { maxResults: 50 });
    }

    /**
     * Get entity relationships
     */
    async getEntityRelationships(
        entityName: string,
    ): Promise<EntityRelationship[]> {
        if (!this.initialized) {
            await this.initialize();
        }

        return this.graphManager.getEntityRelationships(entityName);
    }

    /**
     * Get the entity knowledge graph
     */
    async getEntityGraph() {
        if (!this.initialized) {
            await this.initialize();
        }

        return this.graphManager.getGraph();
    }

    /**
     * Clear all entity data (useful for testing)
     */
    async clear(): Promise<void> {
        if (this.initialized) {
            this.graphManager.clear();
        }
    }
}

/**
 * Singleton instance for the browser agent
 */
let globalEntityProcessor: EntityProcessingService | undefined;

/**
 * Get or create the global entity processing service
 */
export function getEntityProcessingService(): EntityProcessingService {
    if (!globalEntityProcessor) {
        globalEntityProcessor = new EntityProcessingService();
    }
    return globalEntityProcessor;
}
