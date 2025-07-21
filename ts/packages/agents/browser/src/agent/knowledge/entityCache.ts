// Entity Graph Cache Implementation
// High-performance caching system for entity graphs and relationships

import type {
    EnhancedEntity,
    EntityRelationship,
    EntityKnowledgeGraph,
} from "./entityExtractor.js";

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    accessCount: number;
    lastAccessed: number;
}

export interface CacheStats {
    hitRate: number;
    missRate: number;
    totalRequests: number;
    totalHits: number;
    totalMisses: number;
    cacheSize: number;
    memoryUsage: number;
}

export interface CacheOptions {
    maxSize: number;
    defaultTtl: number;
    cleanupInterval: number;
    enableCompression: boolean;
    enableMetrics: boolean;
}

/**
 * High-performance Entity Graph Cache
 * Provides fast access to entities, relationships, and graph data with intelligent eviction
 */
export class EntityGraphCache {
    private entityCache: Map<string, CacheEntry<EnhancedEntity>> = new Map();
    private relationshipCache: Map<string, CacheEntry<EntityRelationship[]>> =
        new Map();
    private graphCache: Map<string, CacheEntry<EntityKnowledgeGraph>> =
        new Map();
    private searchCache: Map<string, CacheEntry<any>> = new Map();

    private stats = {
        totalRequests: 0,
        totalHits: 0,
        totalMisses: 0,
    };

    private options: CacheOptions;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(options: Partial<CacheOptions> = {}) {
        this.options = {
            maxSize: 1000,
            defaultTtl: 3600000, // 1 hour
            cleanupInterval: 300000, // 5 minutes
            enableCompression: false,
            enableMetrics: true,
            ...options,
        };

        this.startCleanupTimer();
    }

    /**
     * Get entity from cache
     */
    async getEntity(entityName: string): Promise<EnhancedEntity | null> {
        this.stats.totalRequests++;

        const entry = this.entityCache.get(entityName.toLowerCase());
        if (entry && this.isEntryValid(entry)) {
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.totalHits++;
            return entry.data;
        }

        this.stats.totalMisses++;
        return null;
    }

    /**
     * Cache entity with TTL
     */
    async cacheEntity(
        entity: EnhancedEntity,
        ttl: number = this.options.defaultTtl,
    ): Promise<void> {
        const key = entity.name.toLowerCase();
        const entry: CacheEntry<EnhancedEntity> = {
            data: entity,
            timestamp: Date.now(),
            ttl,
            accessCount: 0,
            lastAccessed: Date.now(),
        };

        this.entityCache.set(key, entry);
        await this.enforceMaxSize(this.entityCache);
    }

    /**
     * Get relationships for entity
     */
    async getRelationships(
        entityName: string,
    ): Promise<EntityRelationship[] | null> {
        this.stats.totalRequests++;

        const entry = this.relationshipCache.get(entityName.toLowerCase());
        if (entry && this.isEntryValid(entry)) {
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.totalHits++;
            return entry.data;
        }

        this.stats.totalMisses++;
        return null;
    }

    /**
     * Cache relationships for entity
     */
    async cacheRelationships(
        entityName: string,
        relationships: EntityRelationship[],
        ttl: number = this.options.defaultTtl,
    ): Promise<void> {
        const key = entityName.toLowerCase();
        const entry: CacheEntry<EntityRelationship[]> = {
            data: relationships,
            timestamp: Date.now(),
            ttl,
            accessCount: 0,
            lastAccessed: Date.now(),
        };

        this.relationshipCache.set(key, entry);
        await this.enforceMaxSize(this.relationshipCache);
    }

    /**
     * Get cached entity graph
     */
    async getEntityGraph(
        graphId: string,
    ): Promise<EntityKnowledgeGraph | null> {
        this.stats.totalRequests++;

        const entry = this.graphCache.get(graphId);
        if (entry && this.isEntryValid(entry)) {
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.totalHits++;
            return entry.data;
        }

        this.stats.totalMisses++;
        return null;
    }

    /**
     * Cache entity graph
     */
    async cacheEntityGraph(
        graphId: string,
        graph: EntityKnowledgeGraph,
        ttl: number = this.options.defaultTtl,
    ): Promise<void> {
        const entry: CacheEntry<EntityKnowledgeGraph> = {
            data: graph,
            timestamp: Date.now(),
            ttl,
            accessCount: 0,
            lastAccessed: Date.now(),
        };

        this.graphCache.set(graphId, entry);
        await this.enforceMaxSize(this.graphCache);
    }

    /**
     * Get cached search results
     */
    async getSearchResults(query: string, filters?: any): Promise<any | null> {
        this.stats.totalRequests++;

        const key = this.generateSearchKey(query, filters);
        const entry = this.searchCache.get(key);

        if (entry && this.isEntryValid(entry)) {
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.totalHits++;
            return entry.data;
        }

        this.stats.totalMisses++;
        return null;
    }

    /**
     * Cache search results
     */
    async cacheSearchResults(
        query: string,
        results: any,
        filters?: any,
        ttl: number = this.options.defaultTtl / 2,
    ): Promise<void> {
        const key = this.generateSearchKey(query, filters);
        const entry: CacheEntry<any> = {
            data: results,
            timestamp: Date.now(),
            ttl,
            accessCount: 0,
            lastAccessed: Date.now(),
        };

        this.searchCache.set(key, entry);
        await this.enforceMaxSize(this.searchCache);
    }

    /**
     * Invalidate entity and related data
     */
    async invalidateEntity(entityName: string): Promise<void> {
        const key = entityName.toLowerCase();

        // Remove entity from cache
        this.entityCache.delete(key);
        this.relationshipCache.delete(key);

        // Remove from search cache (clear all search results)
        this.searchCache.clear();

        // Remove from any graphs that contain this entity
        const graphsToRemove: string[] = [];
        for (const [graphId, entry] of this.graphCache) {
            if (entry.data.entities.has(entityName)) {
                graphsToRemove.push(graphId);
            }
        }

        for (const graphId of graphsToRemove) {
            this.graphCache.delete(graphId);
        }
    }

    /**
     * Warm cache with frequently accessed entities
     */
    async warmCache(entities: string[]): Promise<void> {
        console.log(`Warming cache with ${entities.length} entities...`);

        // This would typically load entities from the database/API
        // For now, we'll mark them as "requested" in cache metrics
        for (const _entityName of entities) {
            // In a real implementation, you would:
            // 1. Load the entity from the database
            // 2. Load its relationships
            // 3. Cache both

            // For demonstration, we'll just increment request count
            this.stats.totalRequests++;
        }
    }

    /**
     * Preload related entities based on usage patterns
     */
    async preloadRelatedEntities(
        centerEntity: string,
        depth: number = 1,
    ): Promise<void> {
        const relationships = await this.getRelationships(centerEntity);
        if (!relationships) return;

        for (const rel of relationships) {
            // Check if related entity is already cached
            const cached = await this.getEntity(rel.relatedEntity);
            if (!cached && depth > 0) {
                // In a real implementation, load and cache the related entity
                // Then recursively preload its relationships
                await this.preloadRelatedEntities(rel.relatedEntity, depth - 1);
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): CacheStats {
        const hitRate =
            this.stats.totalRequests > 0
                ? this.stats.totalHits / this.stats.totalRequests
                : 0;
        const missRate =
            this.stats.totalRequests > 0
                ? this.stats.totalMisses / this.stats.totalRequests
                : 0;

        return {
            hitRate,
            missRate,
            totalRequests: this.stats.totalRequests,
            totalHits: this.stats.totalHits,
            totalMisses: this.stats.totalMisses,
            cacheSize:
                this.entityCache.size +
                this.relationshipCache.size +
                this.graphCache.size +
                this.searchCache.size,
            memoryUsage: this.estimateMemoryUsage(),
        };
    }

    /**
     * Clear all caches
     */
    async clearAll(): Promise<void> {
        this.entityCache.clear();
        this.relationshipCache.clear();
        this.graphCache.clear();
        this.searchCache.clear();

        this.stats = {
            totalRequests: 0,
            totalHits: 0,
            totalMisses: 0,
        };
    }

    /**
     * Clear expired entries
     */
    async clearExpired(): Promise<number> {
        let removedCount = 0;

        // Clear expired entities
        for (const [key, entry] of this.entityCache) {
            if (!this.isEntryValid(entry)) {
                this.entityCache.delete(key);
                removedCount++;
            }
        }

        // Clear expired relationships
        for (const [key, entry] of this.relationshipCache) {
            if (!this.isEntryValid(entry)) {
                this.relationshipCache.delete(key);
                removedCount++;
            }
        }

        // Clear expired graphs
        for (const [key, entry] of this.graphCache) {
            if (!this.isEntryValid(entry)) {
                this.graphCache.delete(key);
                removedCount++;
            }
        }

        // Clear expired search results
        for (const [key, entry] of this.searchCache) {
            if (!this.isEntryValid(entry)) {
                this.searchCache.delete(key);
                removedCount++;
            }
        }

        return removedCount;
    }

    /**
     * Get cache key for entity graph
     */
    getGraphCacheKey(
        centerEntity: string,
        depth: number,
        filters?: any,
    ): string {
        const filterStr = filters ? JSON.stringify(filters) : "";
        return `graph_${centerEntity}_${depth}_${this.hashString(filterStr)}`;
    }

    /**
     * Batch get entities
     */
    async getEntitiesBatch(
        entityNames: string[],
    ): Promise<Map<string, EnhancedEntity>> {
        const results = new Map<string, EnhancedEntity>();

        for (const name of entityNames) {
            const entity = await this.getEntity(name);
            if (entity) {
                results.set(name, entity);
            }
        }

        return results;
    }

    /**
     * Batch cache entities
     */
    async cacheEntitiesBatch(
        entities: EnhancedEntity[],
        ttl: number = this.options.defaultTtl,
    ): Promise<void> {
        for (const entity of entities) {
            await this.cacheEntity(entity, ttl);
        }
    }

    /**
     * Export cache data for persistence
     */
    exportCacheData(): any {
        return {
            entities: Array.from(this.entityCache.entries()),
            relationships: Array.from(this.relationshipCache.entries()),
            graphs: Array.from(this.graphCache.entries()),
            stats: this.stats,
            timestamp: Date.now(),
        };
    }

    /**
     * Import cache data from persistence
     */
    importCacheData(data: any): void {
        if (data.entities) {
            this.entityCache = new Map(data.entities);
        }
        if (data.relationships) {
            this.relationshipCache = new Map(data.relationships);
        }
        if (data.graphs) {
            this.graphCache = new Map(data.graphs);
        }
        if (data.stats) {
            this.stats = data.stats;
        }
    }

    /**
     * Destroy cache and cleanup
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        this.clearAll();
    }

    // Private helper methods

    private isEntryValid<T>(entry: CacheEntry<T>): boolean {
        return Date.now() - entry.timestamp < entry.ttl;
    }

    private async enforceMaxSize<T>(
        cache: Map<string, CacheEntry<T>>,
    ): Promise<void> {
        if (cache.size <= this.options.maxSize) return;

        // Sort by least recently used and lowest access count
        const entries = Array.from(cache.entries()).sort((a, b) => {
            const aScore = a[1].accessCount + a[1].lastAccessed / 1000000;
            const bScore = b[1].accessCount + b[1].lastAccessed / 1000000;
            return aScore - bScore;
        });

        // Remove oldest 10% of entries
        const toRemove = Math.floor(cache.size * 0.1);
        for (let i = 0; i < toRemove; i++) {
            cache.delete(entries[i][0]);
        }
    }

    private generateSearchKey(query: string, filters?: any): string {
        const filterStr = filters ? JSON.stringify(filters) : "";
        return `search_${query.toLowerCase()}_${this.hashString(filterStr)}`;
    }

    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    private estimateMemoryUsage(): number {
        // Rough estimation of memory usage in bytes
        let size = 0;

        // Estimate entity cache size
        for (const _entry of this.entityCache.values()) {
            size += 1000; // Rough estimate per entity
        }

        // Estimate relationship cache size
        for (const entry of this.relationshipCache.values()) {
            size += JSON.stringify(entry.data).length * 2;
        }

        // Estimate graph cache size
        for (const _entry of this.graphCache.values()) {
            size += 1000; // Rough estimate for graph metadata
        }

        return size;
    }

    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(async () => {
            const removed = await this.clearExpired();
            if (this.options.enableMetrics && removed > 0) {
                console.log(
                    `Cache cleanup: removed ${removed} expired entries`,
                );
            }
        }, this.options.cleanupInterval);
    }
}

/**
 * Global cache instance
 */
export const globalEntityCache = new EntityGraphCache({
    maxSize: 2000,
    defaultTtl: 3600000, // 1 hour
    cleanupInterval: 300000, // 5 minutes
    enableCompression: false,
    enableMetrics: true,
});
