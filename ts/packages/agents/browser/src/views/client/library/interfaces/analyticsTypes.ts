// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface AnalyticsData {
    overview: {
        totalSites: number;
        totalBookmarks: number;
        totalHistory: number;
        knowledgeExtracted: number;
    };
    trends: Array<{
        date: string;
        visits: number;
        bookmarks: number;
    }>;
    insights: Array<{
        category: string;
        value: number;
        change: number;
    }>;
    domains?: {
        topDomains: Array<{
            domain: string;
            count: number;
            percentage: number;
        }>;
        totalSites: number;
    };
    knowledge?: {
        extractionProgress?: {
            entityProgress: number;
            topicProgress: number;
            actionProgress: number;
        };
        qualityDistribution?: {
            highQuality: number;
            mediumQuality: number;
            lowQuality: number;
        };
        totalEntities?: number;
        totalTopics?: number;
        totalActions?: number;
        totalRelationships?: number;
        recentItems?: any[];
        recentEntities?: Array<{
            name: string;
            type: string;
            fromPage: string;
            extractedAt: string;
        }>;
        recentTopics?: Array<{
            name: string;
            fromPage: string;
            extractedAt: string;
        }>;
        recentActions?: Array<{
            type: string;
            element: string;
            text?: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }>;
        recentRelationships?: Array<{
            from: string;
            relationship: string;
            to: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }>;
    };
    activity?: {
        trends: Array<{
            date: string;
            visits: number;
            bookmarks: number;
        }>;
        summary: {
            totalActivity: number;
            peakDay: string | null;
            averagePerDay: number;
            timeRange: string;
        };
    };
}
