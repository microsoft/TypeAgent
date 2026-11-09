// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnalyticsData } from "./analyticsTypes";

export interface AnalyticsCacheEntry {
    data: AnalyticsData;
    timestamp: number;
    lastUpdated: string; // ISO string
    version: string; // Cache schema version for migration
}

export interface AnalyticsCache {
    // Main analytics data
    analytics: AnalyticsCacheEntry | null;

    // Cache metadata
    metadata: {
        cacheVersion: string;
        maxAge: number; // milliseconds
        created: number;
        lastCleanup: number;
    };
}

export interface CacheConfiguration {
    staleThreshold: number; // 5 minutes - when to show "may be outdated" warning
    refreshThreshold: number; // 2 minutes - when to trigger background refresh
    enableCache: boolean; // true default
    showCacheIndicators: boolean; // true default
    retryOnError: boolean; // true default
    maxRetries: number; // 3 default
    alwaysShowCached: boolean; // true - always render cached data regardless of age
}

export interface CacheLoadResult {
    cachedData: AnalyticsData | null;
    freshDataPromise: Promise<any>;
    isCached: boolean;
    isStale: boolean;
}

export enum CacheIndicatorType {
    FRESH = "fresh",
    STALE = "stale",
    ERROR = "error",
}

export interface CacheStatus {
    hasCache: boolean;
    isStale: boolean;
    lastUpdated: string | null;
    indicatorType: CacheIndicatorType;
}
