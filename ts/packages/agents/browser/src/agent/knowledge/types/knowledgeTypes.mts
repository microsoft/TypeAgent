// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowledgeExtractionResult } from "../schema/knowledgeExtraction.mjs";

export interface AnalyticsDataResponse {
    overview: {
        totalSites: number;
        totalBookmarks: number;
        totalHistory: number;
        topDomains: number;
        knowledgeExtracted: number;
    };
    knowledge: {
        extractionProgress: {
            entityProgress: number;
            topicProgress: number;
            actionProgress: number;
        };
        qualityDistribution: {
            highQuality: number;
            mediumQuality: number;
            lowQuality: number;
        };
        totalEntities: number;
        totalTopics: number;
        totalActions: number;
        totalRelationships: number;
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
    domains: {
        topDomains: Array<{
            domain: string;
            count: number;
            percentage: number;
        }>;
        totalSites: number;
    };
    activity: {
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
    analytics: {
        extractionMetrics: any;
        qualityReport: any;
    };
}

export interface WebPageDocument {
    url: string;
    title: string;
    content: string;
    htmlFragments: any[];
    timestamp: string;
    indexed: boolean;
    knowledge?: KnowledgeExtractionResult;
    metadata?: {
        quality: string;
        textOnly: boolean;
        contentLength: number;
        entityCount: number;
    };
}

export interface GraphCache {
    entities: any[];
    communities: any[];
    relationships: any[];
    entityMetrics: any[];
    presetLayout?: {
        elements: any[];
        layoutDuration?: number;
        communityCount?: number;
    } | undefined;
    lastUpdated: number;
    isValid: boolean;
}

export interface TopicGraphCache {
    topics: any[];
    relationships: any[];
    topicMetrics: any[];
    lastUpdated: number;
    isValid: boolean;
}

export interface ImportanceLevel {
    entities: Array<{
        id: string;
        name: string;
        type: string;
        importance: number;
        pagerank: number;
        betweenness: number;
        degree: number;
        relationships: number;
    }>;
    totalLevels: number;
    threshold: number;
    description: string;
}
