// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AnalyticsCache,
    AnalyticsCacheEntry,
    CacheConfiguration,
    CacheStatus,
    CacheIndicatorType,
} from "../interfaces/cacheTypes";
import { AnalyticsData } from "../interfaces/analyticsTypes";

export class AnalyticsCacheManager {
    private static readonly CACHE_KEY = "typeagent_analytics_cache";
    private static readonly CACHE_VERSION = "1.0.0";

    // Default configuration
    private static readonly DEFAULT_CONFIG: CacheConfiguration = {
        staleThreshold: 5 * 60 * 1000, // 5 minutes
        refreshThreshold: 2 * 60 * 1000, // 2 minutes
        enableCache: true,
        showCacheIndicators: false, // Disabled by default - only console logging
        retryOnError: true,
        maxRetries: 3,
        alwaysShowCached: true,
    };

    private config: CacheConfiguration;

    constructor(config?: Partial<CacheConfiguration>) {
        this.config = { ...AnalyticsCacheManager.DEFAULT_CONFIG, ...config };
    }

    /**
     * Get the current cache from localStorage
     */
    getCache(): AnalyticsCache {
        if (!this.config.enableCache) {
            return this.getEmptyCache();
        }

        try {
            const stored = localStorage.getItem(
                AnalyticsCacheManager.CACHE_KEY,
            );
            if (!stored) {
                return this.getEmptyCache();
            }

            const cache = JSON.parse(stored) as AnalyticsCache;

            // Validate cache version
            if (
                cache.metadata?.cacheVersion !==
                AnalyticsCacheManager.CACHE_VERSION
            ) {
                console.warn("Cache version mismatch, clearing cache");
                this.clearCache();
                return this.getEmptyCache();
            }

            return cache;
        } catch (error) {
            console.error("Failed to load cache:", error);
            this.clearCache();
            return this.getEmptyCache();
        }
    }

    /**
     * Save cache to localStorage
     */
    setCache(cache: AnalyticsCache): void {
        if (!this.config.enableCache) {
            return;
        }

        try {
            const serialized = JSON.stringify(cache);
            localStorage.setItem(AnalyticsCacheManager.CACHE_KEY, serialized);
        } catch (error) {
            console.error("Failed to save cache:", error);
            // Handle storage quota errors by clearing old data
            if (error instanceof DOMException && error.code === 22) {
                this.clearCache();
                console.warn("Storage quota exceeded, cache cleared");
            }
        }
    }

    /**
     * Get cached analytics data if present
     */
    getCachedAnalytics(): AnalyticsCacheEntry | null {
        const cache = this.getCache();
        return cache.analytics;
    }

    /**
     * Update cache with fresh analytics data
     */
    updateAnalyticsCache(data: AnalyticsData): void {
        const cache = this.getCache();

        const entry: AnalyticsCacheEntry = {
            data,
            timestamp: Date.now(),
            lastUpdated: new Date().toISOString(),
            version: AnalyticsCacheManager.CACHE_VERSION,
        };

        cache.analytics = entry;
        cache.metadata.lastCleanup = Date.now();

        this.setCache(cache);
    }

    /**
     * Check if cache entry is present and valid version
     */
    isCachePresent(entry: AnalyticsCacheEntry | null): boolean {
        return (
            entry !== null &&
            entry.version === AnalyticsCacheManager.CACHE_VERSION
        );
    }

    /**
     * Check if cache entry has exceeded stale threshold
     */
    isCacheStale(entry: AnalyticsCacheEntry): boolean {
        const now = Date.now();
        const age = now - entry.timestamp;
        return age > this.config.staleThreshold;
    }

    /**
     * Check if cache should be refreshed (background fetch)
     */
    shouldRefreshCache(entry: AnalyticsCacheEntry): boolean {
        const now = Date.now();
        const age = now - entry.timestamp;
        return age > this.config.refreshThreshold;
    }

    /**
     * Get cache status for UI indicators
     */
    getCacheStatus(entry: AnalyticsCacheEntry | null): CacheStatus {
        if (!entry || !this.isCachePresent(entry)) {
            return {
                hasCache: false,
                isStale: false,
                lastUpdated: null,
                indicatorType: CacheIndicatorType.FRESH,
            };
        }

        const isStale = this.isCacheStale(entry);

        return {
            hasCache: true,
            isStale,
            lastUpdated: entry.lastUpdated,
            indicatorType: isStale
                ? CacheIndicatorType.STALE
                : CacheIndicatorType.FRESH,
        };
    }

    /**
     * Update cache status to error state
     */
    setCacheErrorStatus(entry: AnalyticsCacheEntry | null): CacheStatus {
        if (!entry || !this.isCachePresent(entry)) {
            return {
                hasCache: false,
                isStale: false,
                lastUpdated: null,
                indicatorType: CacheIndicatorType.ERROR,
            };
        }

        return {
            hasCache: true,
            isStale: this.isCacheStale(entry),
            lastUpdated: entry.lastUpdated,
            indicatorType: CacheIndicatorType.ERROR,
        };
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        try {
            localStorage.removeItem(AnalyticsCacheManager.CACHE_KEY);
        } catch (error) {
            console.error("Failed to clear cache:", error);
        }
    }

    /**
     * Invalidate cache (force refresh on next load)
     */
    invalidateCache(): void {
        const cache = this.getCache();
        if (cache.analytics) {
            // Set timestamp to 0 to force refresh
            cache.analytics.timestamp = 0;
            this.setCache(cache);
        }
    }

    /**
     * Get cache statistics for debugging
     */
    getCacheStats(): {
        hasCache: boolean;
        cacheAge: number;
        isStale: boolean;
        shouldRefresh: boolean;
        lastUpdated: string | null;
    } {
        const entry = this.getCachedAnalytics();

        if (!entry) {
            return {
                hasCache: false,
                cacheAge: 0,
                isStale: false,
                shouldRefresh: false,
                lastUpdated: null,
            };
        }

        const now = Date.now();
        const age = now - entry.timestamp;

        return {
            hasCache: true,
            cacheAge: age,
            isStale: this.isCacheStale(entry),
            shouldRefresh: this.shouldRefreshCache(entry),
            lastUpdated: entry.lastUpdated,
        };
    }

    /**
     * Get configuration
     */
    getConfig(): CacheConfiguration {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<CacheConfiguration>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Create empty cache structure
     */
    private getEmptyCache(): AnalyticsCache {
        return {
            analytics: null,
            metadata: {
                cacheVersion: AnalyticsCacheManager.CACHE_VERSION,
                maxAge: this.config.staleThreshold,
                created: Date.now(),
                lastCleanup: Date.now(),
            },
        };
    }

    /**
     * Format relative time for display
     */
    formatRelativeTime(timestamp: string): string {
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - date.getTime());
            const diffMinutes = Math.floor(diffTime / (1000 * 60));

            if (diffMinutes < 1) {
                return "Just now";
            } else if (diffMinutes < 60) {
                return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
            } else {
                const diffHours = Math.floor(diffMinutes / 60);
                if (diffHours < 24) {
                    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
                } else {
                    const diffDays = Math.floor(diffHours / 24);
                    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
                }
            }
        } catch (error) {
            return "Unknown time";
        }
    }
}
