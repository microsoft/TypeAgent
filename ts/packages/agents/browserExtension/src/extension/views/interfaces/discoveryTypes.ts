// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface DiscoverInsights {
    trendingTopics: Array<{
        topic: string;
        count: number;
        trend: "up" | "down" | "stable";
        percentage: number;
    }>;
    readingPatterns: Array<{
        timeframe: string;
        activity: number;
        peak: boolean;
    }>;
    popularPages: Array<{
        url: string;
        title: string;
        visitCount: number;
        isBookmarked: boolean;
        domain: string;
        lastVisited: string;
    }>;
    topDomains: Array<{
        domain: string;
        count: number;
        favicon?: string;
    }>;
}
