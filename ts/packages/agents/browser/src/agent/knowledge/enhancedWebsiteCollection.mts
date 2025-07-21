// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as website from "website-memory";
import {
    EntityKnowledgeGraph,
    EntityGraphManager,
    EnhancedEntity,
    EntityRelationship,
    EntitySearchOptions,
    EntityGraphQuery,
    EntityGraphData,
} from "./entityGraph.mjs";
import { EntityMockDataGenerator, MOCK_SCENARIOS } from "./mockEntityData.mjs";

/**
 * Enhanced Website Collection with Entity Graph Support
 * Extends the base WebsiteCollection with entity-centric knowledge graph capabilities
 */
export class EnhancedWebsiteCollection extends website.WebsiteCollection {
    private entityGraphManager: EntityGraphManager;
    private mockDataGenerator: EntityMockDataGenerator;
    private entityGraphInitialized: boolean = false;
    private mockMode: boolean = false;
    private currentMockScenario: string | null = null;

    constructor() {
        super();
        this.entityGraphManager = new EntityGraphManager();
        this.mockDataGenerator = new EntityMockDataGenerator();
    }

    /**
     * Initialize the entity graph system
     */
    async initializeEntityGraph(): Promise<void> {
        if (this.entityGraphInitialized) return;

        await this.entityGraphManager.initialize();
        this.entityGraphInitialized = true;
    }

    /**
     * Get the current entity knowledge graph
     */
    async getEntityGraph(): Promise<EntityKnowledgeGraph> {
        await this.initializeEntityGraph();
        return this.entityGraphManager.getGraph();
    }

    /**
     * Get a specific entity by name
     */
    async getEntity(entityName: string): Promise<EnhancedEntity | null> {
        await this.initializeEntityGraph();
        const entity = this.entityGraphManager.getEntity(entityName);
        return entity || null;
    }

    /**
     * Get relationships for a specific entity
     */
    async getEntityRelationships(
        entityName: string,
    ): Promise<EntityRelationship[]> {
        await this.initializeEntityGraph();
        return this.entityGraphManager.getEntityRelationships(entityName);
    }

    /**
     * Find entities by type
     */
    async findEntitiesByType(
        type: import("./entityGraph.mjs").EntityType,
    ): Promise<EnhancedEntity[]> {
        await this.initializeEntityGraph();
        return this.entityGraphManager.getEntitiesByType(type);
    }

    /**
     * Search entities with advanced options
     */
    async searchEntities(
        query: string,
        options?: EntitySearchOptions,
    ): Promise<EnhancedEntity[]> {
        await this.initializeEntityGraph();
        return this.entityGraphManager.searchEntities(query, options);
    }

    /**
     * Get entity graph data for visualization
     */
    async getEntityGraphData(
        query: EntityGraphQuery,
    ): Promise<EntityGraphData> {
        await this.initializeEntityGraph();
        return this.entityGraphManager.getEntityGraphData(query);
    }

    /**
     * Enable mock mode with a specific scenario
     */
    async enableMockMode(scenario: string): Promise<void> {
        await this.initializeEntityGraph();

        const mockGraph =
            await this.mockDataGenerator.generateScenario(scenario);
        if (mockGraph) {
            // Clear existing graph and load mock data
            this.entityGraphManager.clear();

            // Add all entities from mock graph
            for (const entity of mockGraph.entities.values()) {
                this.entityGraphManager.addEntity(entity);
            }

            this.mockMode = true;
            this.currentMockScenario = scenario;
        }
    }

    /**
     * Load a specific mock entity graph scenario
     */
    async loadMockEntityGraph(scenario: string): Promise<void> {
        await this.enableMockMode(scenario);
    }

    /**
     * Disable mock mode and return to real data
     */
    async disableMockMode(): Promise<void> {
        this.mockMode = false;
        this.currentMockScenario = null;

        // TODO: In Phase 4, this would reload real entity data
        // For now, just clear the graph
        this.entityGraphManager.clear();
    }

    /**
     * Check if currently in mock mode
     */
    isMockMode(): boolean {
        return this.mockMode;
    }

    /**
     * Get current mock scenario
     */
    getCurrentMockScenario(): string | null {
        return this.currentMockScenario;
    }

    /**
     * Get available mock scenarios
     */
    getAvailableMockScenarios(): Array<{
        id: string;
        name: string;
        description: string;
    }> {
        return this.mockDataGenerator.getAvailableScenarios();
    }

    /**
     * Add an entity to the graph
     */
    async addEntity(entity: EnhancedEntity): Promise<void> {
        await this.initializeEntityGraph();
        this.entityGraphManager.addEntity(entity);
    }

    /**
     * Add a relationship between entities
     */
    async addEntityRelationship(
        fromEntity: string,
        toEntity: string,
        relationship: EntityRelationship,
    ): Promise<void> {
        await this.initializeEntityGraph();
        this.entityGraphManager.addRelationship(
            fromEntity,
            toEntity,
            relationship,
        );
    }

    /**
     * Get entity graph statistics
     */
    async getEntityGraphStatistics() {
        await this.initializeEntityGraph();
        return this.entityGraphManager.getStatistics();
    }

    /**
     * Extract entities from existing website knowledge
     * This will be implemented in Phase 4 for real data integration
     */
    async extractEntitiesFromWebsites(): Promise<void> {
        await this.initializeEntityGraph();

        // TODO: Phase 4 implementation
        // - Iterate through all websites in the collection
        // - Extract entities from their knowledge data
        // - Build relationships based on co-occurrence
        // - Update the entity graph

        console.log(
            "Entity extraction from websites not yet implemented - use mock data for Phase 1-3",
        );
    }

    /**
     * Build entity relationships from website data
     * This will be implemented in Phase 4 for real data integration
     */
    async buildEntityRelationshipsFromWebsites(): Promise<void> {
        await this.initializeEntityGraph();

        // TODO: Phase 4 implementation
        // - Analyze co-occurrence patterns
        // - Build semantic relationships
        // - Calculate confidence scores
        // - Update relationship strengths

        console.log(
            "Entity relationship building not yet implemented - use mock data for Phase 1-3",
        );
    }

    /**
     * Update entity graph with new website data
     * This will be called when new websites are added to the collection
     */
    async updateEntityGraphWithNewWebsite(websiteData: any): Promise<void> {
        await this.updateEntityGraphFromWebsites([websiteData]);
    }

    /**
     * Update entity graph from a batch of websites
     */
    async updateEntityGraphFromWebsites(websites: any[]): Promise<void> {
        if (!this.entityGraphInitialized || this.mockMode) {
            return;
        }

        try {
            const { RealTimeEntityExtractor } = await import("./entityExtractor.js");
            const entityExtractor = new RealTimeEntityExtractor();

            // Convert websites to the format expected by entity extractor
            const websiteInputs = websites.map((site) => ({
                url: site.metadata?.url || site.url || "",
                title: site.metadata?.title || site.title || "",
                content: site.textChunks?.join("\n") || site.metadata?.description || "",
                timestamp: site.metadata?.visitDate || site.metadata?.bookmarkDate || new Date().toISOString(),
            }));

            // Extract entities from all websites
            const extractedEntities = await entityExtractor.extractEntitiesFromWebsites(websiteInputs);

            // Convert to canonical entity format and add to the graph
            for (const entity of extractedEntities) {
                // Convert the entity to match the canonical EntityGraph types
                const canonicalEntity: EnhancedEntity = {
                    ...entity,
                    coOccurringEntities: entity.coOccurringEntities.map(coOcc => ({
                        entityName: (coOcc as any).entity || (coOcc as any).entityName,
                        coOccurrenceCount: coOcc.coOccurrenceCount,
                        contexts: coOcc.contexts,
                        confidence: (coOcc as any).strength || (coOcc as any).confidence || 0.5
                    }))
                };
                this.entityGraphManager.addEntity(canonicalEntity);
            }

            // Build relationships between entities
            const relationships = await entityExtractor.buildEntityRelationships(extractedEntities, websiteInputs);

            // Update relationship mappings
            for (const relationship of relationships) {
                // Find the entity that this relationship belongs to
                const sourceEntity = extractedEntities.find(e => 
                    e.strongRelationships.some(r => r.relatedEntity === relationship.relatedEntity)
                );
                if (sourceEntity) {
                    this.entityGraphManager.addRelationship(sourceEntity.name, relationship.relatedEntity, relationship);
                }
            }

        } catch (error) {
            console.warn("Failed to update entity graph from websites:", error);
        }
    }

    /**
     * Override addWebsites to integrate with entity graph
     */
    addWebsites(websites: any[]): void {
        super.addWebsites(websites);

        // Update entity graph if not in mock mode
        if (this.entityGraphInitialized && !this.mockMode) {
            this.updateEntityGraphFromWebsites(websites).catch((error) => {
                console.warn("Failed to update entity graph for websites:", error);
            });
        }
    }
}

/**
 * Helper function to create an enhanced website collection
 */
export function createEnhancedWebsiteCollection(): EnhancedWebsiteCollection {
    return new EnhancedWebsiteCollection();
}

/**
 * Mock scenario constants for easy reference
 */
export { MOCK_SCENARIOS };
