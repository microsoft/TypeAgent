// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchResult, SearchFilters, SearchSuggestion } from "./searchTypes";
import { DiscoverInsights } from "./discoveryTypes";
import { AnalyticsData } from "./analyticsTypes";

export interface SearchServices {
    searchWebMemories(query: string, filters: SearchFilters): Promise<SearchResult>;
    getSearchSuggestions(query: string): Promise<string[]>;
    saveSearch(query: string, results: SearchResult): Promise<void>;
    checkKnowledgeStatus(url: string): Promise<any>;
}

export interface DiscoveryServices {
    getDiscoverInsights(limit: number, timeframe: string): Promise<{
        success: boolean;
        trendingTopics?: any[];
        readingPatterns?: any[];
        popularPages?: any[];
        topDomains?: any[];
        error?: any;
    }>;
}

export interface AnalyticsServices {
    getAnalyticsData(options: {
        timeRange: string;
        includeQuality: boolean;
        includeProgress: boolean;
        topDomainsLimit: number;
        activityGranularity: string;
    }): Promise<{
        success: boolean;
        analytics: AnalyticsData;
        error?: string;
    }>;
    getRecentKnowledgeItems(limit: number): Promise<{
        success: boolean;
        entities?: any[];
        topics?: any[];
        actions?: any[];
    }>;
}

export interface BaseServices {
    checkWebSocketConnection(): Promise<{ connected: boolean }>;
    getLibraryStats(): Promise<any>;
}
