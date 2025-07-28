// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnalyticsServices } from "../knowledgeUtilities";
import { AnalyticsCacheManager } from "../utils/analyticsCacheManager";
import { CacheLoadResult, CacheConfiguration } from "../interfaces/cacheTypes";
import { AnalyticsData } from "../interfaces/analyticsTypes";

export class CachedAnalyticsService implements AnalyticsServices {
    private cacheManager: AnalyticsCacheManager;
    private originalService: AnalyticsServices;

    constructor(
        originalService: AnalyticsServices,
        config?: Partial<CacheConfiguration>,
    ) {
        this.originalService = originalService;
        this.cacheManager = new AnalyticsCacheManager(config);
    }

    /**
     * Load analytics data with caching support
     * Always returns cached data immediately if available, then fetches fresh data
     */
    async loadAnalyticsData(): Promise<CacheLoadResult> {
        console.log("🚀 CachedAnalyticsService.loadAnalyticsData() called");

        // Always load cached data first for immediate rendering (regardless of age)
        const cachedEntry = this.cacheManager.getCachedAnalytics();
        const cachedData = cachedEntry?.data || null;
        const isCached = this.cacheManager.isCachePresent(cachedEntry);
        const isStale = cachedEntry
            ? this.cacheManager.isCacheStale(cachedEntry)
            : false;

        console.log("📊 Cache status:", {
            hasCachedData: !!cachedData,
            isCached,
            isStale,
            cacheTimestamp: cachedEntry?.timestamp,
        });

        // Start fresh data fetch in background
        const freshDataPromise = this.fetchFreshDataWithCaching();

        return {
            cachedData,
            freshDataPromise,
            isCached,
            isStale,
        };
    }

    /**
     * Get cache status for UI indicators
     */
    getCacheStatus() {
        const cachedEntry = this.cacheManager.getCachedAnalytics();
        return this.cacheManager.getCacheStatus(cachedEntry);
    }

    /**
     * Get cache status with error state
     */
    getCacheErrorStatus() {
        const cachedEntry = this.cacheManager.getCachedAnalytics();
        return this.cacheManager.setCacheErrorStatus(cachedEntry);
    }

    /**
     * Invalidate cache (force refresh)
     */
    invalidateCache(): void {
        this.cacheManager.invalidateCache();
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.cacheManager.clearCache();
    }

    /**
     * Get cache statistics for debugging
     */
    getCacheStats() {
        return this.cacheManager.getCacheStats();
    }

    /**
     * Update cache configuration
     */
    updateConfig(config: Partial<CacheConfiguration>): void {
        this.cacheManager.updateConfig(config);
    }

    /**
     * Get current configuration
     */
    getConfig(): CacheConfiguration {
        return this.cacheManager.getConfig();
    }

    /**
     * Format relative time for display
     */
    formatCacheTime(timestamp: string): string {
        return this.cacheManager.formatRelativeTime(timestamp);
    }

    /**
     * Private method to fetch fresh data and update cache
     */
    private async fetchFreshDataWithCaching(): Promise<any> {
        try {
            console.log("Fetching fresh analytics data...");
            const response = await this.originalService.loadAnalyticsData();

            // Update cache with fresh data
            if (response && response.success && response.analytics) {
                console.log("Fresh analytics data received, updating cache");
                this.cacheManager.updateAnalyticsCache(response.analytics);
            }

            return response;
        } catch (error) {
            console.error("Failed to fetch fresh analytics data:", error);
            throw error;
        }
    }

    /**
     * Check if we should show cached data (always true in this implementation)
     */
    shouldShowCachedData(cachedEntry: any): boolean {
        const config = this.cacheManager.getConfig();
        return (
            config.alwaysShowCached &&
            this.cacheManager.isCachePresent(cachedEntry)
        );
    }

    /**
     * Preload analytics data in background
     */
    async preloadAnalytics(): Promise<void> {
        try {
            const cachedEntry = this.cacheManager.getCachedAnalytics();

            // Only preload if cache is stale or missing
            if (
                !cachedEntry ||
                this.cacheManager.shouldRefreshCache(cachedEntry)
            ) {
                console.log("Preloading analytics data in background...");
                await this.fetchFreshDataWithCaching();
            }
        } catch (error) {
            console.warn("Background preload failed:", error);
            // Fail silently for background operations
        }
    }

    /**
     * Handle cache cleanup and maintenance
     */
    performMaintenance(): void {
        try {
            const cache = this.cacheManager.getCache();
            const now = Date.now();

            // Perform cleanup if it's been more than 24 hours
            const daysSinceCleanup =
                (now - cache.metadata.lastCleanup) / (1000 * 60 * 60 * 24);

            if (daysSinceCleanup > 1) {
                console.log("Performing cache maintenance...");

                // Could add logic here to clean up very old entries
                // For now, just update the cleanup timestamp
                cache.metadata.lastCleanup = now;
                this.cacheManager.setCache(cache);
            }
        } catch (error) {
            console.warn("Cache maintenance failed:", error);
        }
    }

    /**
     * Export cache data for debugging
     */
    exportCacheData(): any {
        const cache = this.cacheManager.getCache();
        const stats = this.cacheManager.getCacheStats();

        return {
            cache,
            stats,
            config: this.cacheManager.getConfig(),
            timestamp: new Date().toISOString(),
        };
    }
}
