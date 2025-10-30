// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CytoscapeElement } from "./graphologyLayoutEngine.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:knowledge:graphology:cache");

type Graph = any;

export interface GraphologyCache {
    graph: Graph;
    cytoscapeElements: CytoscapeElement[];
    metadata: {
        nodeCount: number;
        edgeCount: number;
        communityCount: number;
        layoutTimestamp: number;
        layoutDuration: number;
        avgSpacing: number;
    };
    lastUpdated: number;
    isValid: boolean;
}

export interface CacheEntry {
    key: string;
    cache: GraphologyCache;
    accessCount: number;
    lastAccessed: number;
}

class GraphologyCacheManager {
    private caches: Map<string, CacheEntry> = new Map();
    private maxCacheSize: number = 50;

    setCacheEntry(key: string, cache: GraphologyCache): void {
        debug(`Setting cache entry: ${key}`);

        if (this.caches.size >= this.maxCacheSize) {
            this.evictLRU();
        }

        this.caches.set(key, {
            key,
            cache,
            accessCount: 0,
            lastAccessed: Date.now(),
        });

        debug(
            `Cache size: ${this.caches.size}/${this.maxCacheSize} entries`,
        );
    }

    getCacheEntry(key: string): GraphologyCache | null {
        const entry = this.caches.get(key);
        if (!entry) {
            debug(`Cache miss: ${key}`);
            return null;
        }

        if (!entry.cache.isValid) {
            debug(`Cache entry invalid: ${key}`);
            this.caches.delete(key);
            return null;
        }

        entry.accessCount++;
        entry.lastAccessed = Date.now();
        debug(`Cache hit: ${key} (access count: ${entry.accessCount})`);

        return entry.cache;
    }

    invalidateCache(key: string): void {
        const entry = this.caches.get(key);
        if (entry) {
            entry.cache.isValid = false;
            debug(`Invalidated cache: ${key}`);
        }
    }

    invalidateAllCaches(): void {
        debug("Invalidating all caches");
        for (const entry of this.caches.values()) {
            entry.cache.isValid = false;
        }
        this.caches.clear();
    }

    private evictLRU(): void {
        if (this.caches.size === 0) return;

        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.caches.entries()) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.caches.delete(oldestKey);
            debug(`Evicted LRU cache entry: ${oldestKey}`);
        }
    }

    getCacheStats(): {
        size: number;
        maxSize: number;
        entries: Array<{
            key: string;
            nodeCount: number;
            accessCount: number;
            lastAccessed: Date;
        }>;
    } {
        return {
            size: this.caches.size,
            maxSize: this.maxCacheSize,
            entries: Array.from(this.caches.values()).map((entry) => ({
                key: entry.key,
                nodeCount: entry.cache.metadata.nodeCount,
                accessCount: entry.accessCount,
                lastAccessed: new Date(entry.lastAccessed),
            })),
        };
    }

    clearCache(): void {
        debug("Clearing all caches");
        this.caches.clear();
    }
}

const globalCacheManager = new GraphologyCacheManager();

export function getGraphologyCache(key: string): GraphologyCache | null {
    return globalCacheManager.getCacheEntry(key);
}

export function setGraphologyCache(
    key: string,
    cache: GraphologyCache,
): void {
    globalCacheManager.setCacheEntry(key, cache);
}

export function invalidateGraphologyCache(key: string): void {
    globalCacheManager.invalidateCache(key);
}

export function invalidateAllGraphologyCaches(): void {
    globalCacheManager.invalidateAllCaches();
}

export function getGraphologyCacheStats(): ReturnType<
    typeof globalCacheManager.getCacheStats
> {
    return globalCacheManager.getCacheStats();
}

export function clearGraphologyCache(): void {
    globalCacheManager.clearCache();
}

export function createGraphologyCache(
    graph: Graph,
    cytoscapeElements: CytoscapeElement[],
    layoutDuration: number,
    avgSpacing: number,
): GraphologyCache {
    const communities = new Set<number>();
    for (const node of graph.nodes()) {
        const comm = graph.getNodeAttribute(node, "community") as number;
        communities.add(comm);
    }

    return {
        graph,
        cytoscapeElements,
        metadata: {
            nodeCount: graph.order,
            edgeCount: graph.size,
            communityCount: communities.size,
            layoutTimestamp: Date.now(),
            layoutDuration,
            avgSpacing,
        },
        lastUpdated: Date.now(),
        isValid: true,
    };
}
