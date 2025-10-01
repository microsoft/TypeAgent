// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import * as website from "website-memory";
import { ExtractionMode } from "website-memory";
import { DetailedKnowledgeStats } from "../../browserKnowledgeSchema.js";
import { AnalyticsDataResponse } from "../types/knowledgeTypes.mjs";

export async function getExtractionAnalytics(
    parameters: {
        timeRange?: string;
        mode?: ExtractionMode;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    analytics: any;
}> {
    try {
        // Analytics functionality moved to website-memory package
        // For now, return basic analytics info
        return {
            success: true,
            analytics: {
                totalExtractions: 0,
                successRate: 100,
                averageProcessingTime: 0,
                modes: {
                    basic: 0,
                    content: 0,
                    actions: 0,
                    full: 0,
                },
            },
        };
    } catch (error) {
        console.error("Error getting extraction analytics:", error);
        return {
            success: false,
            analytics: null,
        };
    }
}

export async function generateQualityReport(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    report: any;
}> {
    try {
        // Quality monitoring functionality moved to website-memory package
        // For now, return basic quality report
        return {
            success: true,
            report: {
                overallQuality: "good",
                averageConfidence: 0.8,
                totalItems: 0,
                qualityDistribution: {
                    excellent: 0,
                    good: 0,
                    fair: 0,
                    poor: 0,
                },
            },
        };
    } catch (error) {
        console.error("Error generating quality report:", error);
        return {
            success: false,
            report: null,
        };
    }
}

export async function getPageQualityMetrics(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    score: number;
    entityCount: number;
    topicCount: number;
    actionCount: number;
    extractionMode: string;
    lastUpdated: string | null;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                score: 0,
                entityCount: 0,
                topicCount: 0,
                actionCount: 0,
                extractionMode: "unknown",
                lastUpdated: null,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (!foundWebsite) {
            return {
                score: 0,
                entityCount: 0,
                topicCount: 0,
                actionCount: 0,
                extractionMode: "unknown",
                lastUpdated: null,
            };
        }

        const knowledge = foundWebsite.getKnowledge();
        const metadata = foundWebsite.metadata as any;

        const entityCount = knowledge?.entities?.length || 0;
        const topicCount = knowledge?.topics?.length || 0;
        const actionCount = knowledge?.actions?.length || 0;

        // Calculate quality score based on knowledge richness
        let score = 0.2; // Base score

        if (entityCount > 0) score += 0.2;
        if (topicCount > 2) score += 0.2;
        if (actionCount > 0) score += 0.2;
        if (entityCount > 5) score += 0.1;
        if (topicCount > 5) score += 0.1;

        score = Math.min(score, 1.0);

        // Determine extraction mode based on knowledge richness
        let extractionMode = "basic";
        if (actionCount > 0) {
            extractionMode = "full";
        } else if (entityCount > 3 && topicCount > 2) {
            extractionMode = "content";
        }

        return {
            score,
            entityCount,
            topicCount,
            actionCount,
            extractionMode,
            lastUpdated: metadata.visitDate || metadata.bookmarkDate || null,
        };
    } catch (error) {
        console.error("Error getting page quality metrics:", error);
        return {
            score: 0,
            entityCount: 0,
            topicCount: 0,
            actionCount: 0,
            extractionMode: "unknown",
            lastUpdated: null,
        };
    }
}

export async function getAnalyticsData(
    parameters: {
        timeRange?: string;
        includeQuality?: boolean;
        includeProgress?: boolean;
        topDomainsLimit?: number;
        activityGranularity?: "day" | "week" | "month";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<AnalyticsDataResponse> {
    try {
        // Single coordinated data collection using Promise.all for efficiency
        const [
            knowledgeStats,
            topDomains,
            activityTrends,
            extractionAnalytics,
            recentKnowledgeItems,
        ] = await Promise.all([
            getDetailedKnowledgeStats(
                {
                    includeQuality: parameters.includeQuality !== false,
                    includeProgress: parameters.includeProgress !== false,
                    timeRange: 30,
                },
                context,
            ),
            getTopDomains(
                {
                    limit: parameters.topDomainsLimit || 10,
                },
                context,
            ),
            getActivityTrends(
                {
                    timeRange: parameters.timeRange || "30d",
                    granularity: parameters.activityGranularity || "day",
                },
                context,
            ),
            getExtractionAnalytics(
                {
                    timeRange: parameters.timeRange || "30d",
                },
                context,
            ),
            getRecentKnowledgeItems({ limit: 10, type: "all" }, context),
        ]);

        // Get basic website statistics from websiteCollection
        const websiteCollection = context.agentContext.websiteCollection;
        let totalSites = 0;
        let totalBookmarks = 0;
        let totalHistory = 0;
        let totalActions = 0;

        if (websiteCollection) {
            const websites = websiteCollection.messages.getAll();
            totalSites = websites.length;

            // Count bookmarks vs history and total actions
            websites.forEach((site) => {
                const metadata = site.metadata as website.WebsiteDocPartMeta;
                if (metadata?.bookmarkDate) {
                    totalBookmarks++;
                } else {
                    totalHistory++;
                }

                // Count actions in this site's knowledge
                const knowledge = site.getKnowledge();
                if (knowledge) {
                    const actions =
                        (knowledge as any).actions ||
                        (knowledge as any).detectedActions ||
                        [];
                    if (Array.isArray(actions)) {
                        totalActions += actions.length;
                    }
                }
            });
        }

        return {
            overview: {
                totalSites,
                totalBookmarks,
                totalHistory,
                topDomains: topDomains.domains?.length || 0,
                knowledgeExtracted: knowledgeStats.totalPages || 0,
            },
            knowledge: {
                extractionProgress: knowledgeStats.extractionProgress || {
                    entityProgress: 0,
                    topicProgress: 0,
                    actionProgress: 0,
                },
                qualityDistribution: knowledgeStats.qualityDistribution || {
                    highQuality: 0,
                    mediumQuality: 0,
                    lowQuality: 0,
                },
                totalEntities: knowledgeStats.totalEntities || 0,
                totalTopics: knowledgeStats.totalTopics || 0,
                totalActions: totalActions,
                totalRelationships: knowledgeStats.totalRelationships || 0,
                recentItems: knowledgeStats.recentActivity || [],
                recentEntities: recentKnowledgeItems.entities || [],
                recentTopics: recentKnowledgeItems.topics || [],
                recentActions: recentKnowledgeItems.actions || [],
                recentRelationships: recentKnowledgeItems.relationships || [],
            },
            domains: {
                topDomains: topDomains.domains || [],
                totalSites: topDomains.totalSites || 0,
            },
            activity: {
                trends: activityTrends.trends || [],
                summary: activityTrends.summary || {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
            },
            analytics: {
                extractionMetrics: extractionAnalytics.analytics || {},
                qualityReport: extractionAnalytics.analytics || {},
            },
        };
    } catch (error) {
        console.error("Error aggregating analytics data:", error);
        // Return empty analytics data on error
        return {
            overview: {
                totalSites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                topDomains: 0,
                knowledgeExtracted: 0,
            },
            knowledge: {
                extractionProgress: {
                    entityProgress: 0,
                    topicProgress: 0,
                    actionProgress: 0,
                },
                qualityDistribution: {
                    highQuality: 0,
                    mediumQuality: 0,
                    lowQuality: 0,
                },
                totalEntities: 0,
                totalTopics: 0,
                totalActions: 0,
                totalRelationships: 0,
                recentItems: [],
            },
            domains: {
                topDomains: [],
                totalSites: 0,
            },
            activity: {
                trends: [],
                summary: {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
            },
            analytics: {
                extractionMetrics: {},
                qualityReport: {},
            },
        };
    }
}

// Helper function dependencies for getAnalyticsData
export async function getRecentKnowledgeItems(
    parameters: {
        limit?: number;
        type?: "entities" | "topics" | "actions" | "relationships" | "all";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: Array<{
        name: string;
        type: string;
        fromPage: string;
        extractedAt: string;
    }>;
    topics: Array<{ name: string; fromPage: string; extractedAt: string }>;
    actions: Array<{
        type: string;
        element: string;
        text?: string;
        confidence: number;
        fromPage: string;
        extractedAt: string;
    }>;
    relationships: Array<{
        from: string;
        relationship: string;
        to: string;
        confidence: number;
        fromPage: string;
        extractedAt: string;
    }>;
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                topics: [],
                actions: [],
                relationships: [],
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;
        const type = parameters.type || "all";

        const recentEntities: Array<{
            name: string;
            type: string;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentTopics: Array<{
            name: string;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentActions: Array<{
            type: string;
            element: string;
            text?: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentRelationships: Array<{
            from: string;
            relationship: string;
            to: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }> = [];

        // Process all websites and extract entities/topics with timestamps
        for (const site of websites) {
            const knowledge = site.getKnowledge();
            const metadata = site.metadata as any;
            const extractedAt =
                metadata.visitDate ||
                metadata.bookmarkDate ||
                new Date().toISOString();
            const pageTitle = metadata.title || metadata.url || "Unknown Page";

            if (knowledge) {
                // Extract entities
                if (
                    (type === "entities" || type === "all") &&
                    knowledge.entities
                ) {
                    for (const entity of knowledge.entities) {
                        recentEntities.push({
                            name: entity.name,
                            type: Array.isArray(entity.type)
                                ? entity.type.join(", ")
                                : entity.type,
                            fromPage: pageTitle,
                            extractedAt: extractedAt,
                        });
                    }
                }

                // Extract topics
                if ((type === "topics" || type === "all") && knowledge.topics) {
                    for (const topic of knowledge.topics) {
                        recentTopics.push({
                            name: topic,
                            fromPage: pageTitle,
                            extractedAt: extractedAt,
                        });
                    }
                }

                // Extract actions (if available)
                // Note: Actions might not be available in current website-memory structure
                if (type === "actions" || type === "all") {
                    // Try to get actions from various possible sources in the knowledge object
                    const actions =
                        (knowledge as any).actions ||
                        (knowledge as any).detectedActions ||
                        [];

                    if (Array.isArray(actions)) {
                        for (const action of actions) {
                            // Handle different action object structures gracefully
                            const actionType =
                                (action as any).actionType ||
                                (action as any).type ||
                                "unknown";
                            const actionElement =
                                (action as any).target?.name ||
                                (action as any).name ||
                                (action as any).element ||
                                "element";
                            const actionText =
                                (action as any).name ||
                                (action as any).text ||
                                (action as any).target?.name;
                            const actionConfidence =
                                (action as any).confidence || 0.8;

                            recentActions.push({
                                type: actionType,
                                element: actionElement,
                                text: actionText,
                                confidence: actionConfidence,
                                fromPage: pageTitle,
                                extractedAt: extractedAt,
                            });
                        }
                    }
                }

                // Extract relationships from actions data
                // This provides properly formatted relationship data for the UI
                if (type === "relationships" || type === "all") {
                    const actions = (knowledge as any).actions || [];

                    if (Array.isArray(actions)) {
                        for (const action of actions) {
                            // Transform action data to relationship format
                            const from =
                                action.subjectEntityName || "Unknown Entity";
                            const relationship =
                                action.verbs?.join(", ") || "related to";
                            const to =
                                action.objectEntityName || "Unknown Target";
                            const confidence = action.confidence || 0.8;

                            recentRelationships.push({
                                from: from,
                                relationship: relationship,
                                to: to,
                                confidence: confidence,
                                fromPage: pageTitle,
                                extractedAt: extractedAt,
                            });
                        }
                    }
                }
            }
        }

        // Sort by extraction date (most recent first) and limit results
        recentEntities.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentTopics.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentActions.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentRelationships.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );

        // Remove duplicates while preserving order
        const uniqueEntities = recentEntities
            .filter(
                (entity, index, arr) =>
                    arr.findIndex(
                        (e) =>
                            e.name.toLowerCase() === entity.name.toLowerCase(),
                    ) === index,
            )
            .slice(0, limit);

        const uniqueTopics = recentTopics
            .filter(
                (topic, index, arr) =>
                    arr.findIndex(
                        (t) =>
                            t.name.toLowerCase() === topic.name.toLowerCase(),
                    ) === index,
            )
            .slice(0, limit);

        const uniqueActions = recentActions
            .filter(
                (action, index, arr) =>
                    arr.findIndex(
                        (a) =>
                            a.type === action.type &&
                            a.element === action.element &&
                            a.fromPage === action.fromPage,
                    ) === index,
            )
            .slice(0, limit);

        const uniqueRelationships = recentRelationships
            .filter(
                (relationship, index, arr) =>
                    arr.findIndex(
                        (r) =>
                            r.from === relationship.from &&
                            r.relationship === relationship.relationship &&
                            r.to === relationship.to,
                    ) === index,
            )
            .slice(0, limit);

        return {
            entities: uniqueEntities,
            topics: uniqueTopics,
            actions: uniqueActions,
            relationships: uniqueRelationships,
            success: true,
        };
    } catch (error) {
        console.error("Error getting recent knowledge items:", error);
        return {
            entities: [],
            topics: [],
            actions: [],
            relationships: [],
            success: false,
        };
    }
}

export async function getTopDomains(
    parameters: {
        limit?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    domains: Array<{
        domain: string;
        count: number;
        percentage: number;
    }>;
    totalSites: number;
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                domains: [],
                totalSites: 0,
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;

        // Count sites by domain
        const domainCounts: { [domain: string]: number } = {};
        let totalCount = websites.length;

        for (const site of websites) {
            const metadata = site.metadata as any;
            const domain = metadata.domain || "unknown";
            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        }

        // Sort by count and limit results
        const sortedDomains = Object.entries(domainCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([domain, count]) => ({
                domain,
                count,
                percentage: parseFloat(((count / totalCount) * 100).toFixed(1)),
            }));

        return {
            domains: sortedDomains,
            totalSites: totalCount,
            success: true,
        };
    } catch (error) {
        console.error("Error getting top domains:", error);
        return {
            domains: [],
            totalSites: 0,
            success: false,
        };
    }
}

export async function getActivityTrends(
    parameters: {
        timeRange?: string;
        granularity?: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
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
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                trends: [],
                summary: {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const timeRange = parameters.timeRange || "30d";

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        switch (timeRange) {
            case "7d":
                startDate.setDate(endDate.getDate() - 7);
                break;
            case "30d":
                startDate.setDate(endDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(endDate.getDate() - 90);
                break;
            default:
                startDate.setDate(endDate.getDate() - 30);
        }

        // Extract activity data from websites
        const activityMap = new Map<
            string,
            { visits: number; bookmarks: number }
        >();

        for (const site of websites) {
            const metadata = site.metadata as any;

            // Process visit dates
            if (metadata.visitDate) {
                const visitDate = new Date(metadata.visitDate);
                if (visitDate >= startDate && visitDate <= endDate) {
                    const dateKey = visitDate.toISOString().split("T")[0];
                    const current = activityMap.get(dateKey) || {
                        visits: 0,
                        bookmarks: 0,
                    };
                    current.visits += metadata.visitCount || 1;
                    activityMap.set(dateKey, current);
                }
            }

            // Process bookmark dates
            if (metadata.bookmarkDate) {
                const bookmarkDate = new Date(metadata.bookmarkDate);
                if (bookmarkDate >= startDate && bookmarkDate <= endDate) {
                    const dateKey = bookmarkDate.toISOString().split("T")[0];
                    const current = activityMap.get(dateKey) || {
                        visits: 0,
                        bookmarks: 0,
                    };
                    current.bookmarks += 1;
                    activityMap.set(dateKey, current);
                }
            }
        }

        // Convert to trends array
        const trends = Array.from(activityMap.entries())
            .map(([date, activity]) => ({
                date,
                visits: activity.visits,
                bookmarks: activity.bookmarks,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate summary statistics
        const totalVisits = trends.reduce((sum, t) => sum + t.visits, 0);
        const totalBookmarks = trends.reduce((sum, t) => sum + t.bookmarks, 0);
        const peakDay = trends.reduce(
            (peak, current) =>
                current.visits + current.bookmarks >
                peak.visits + peak.bookmarks
                    ? current
                    : peak,
            trends[0] || { date: null, visits: 0, bookmarks: 0 },
        );

        return {
            trends,
            summary: {
                totalActivity: totalVisits + totalBookmarks,
                peakDay: peakDay.date,
                averagePerDay:
                    trends.length > 0
                        ? (totalVisits + totalBookmarks) / trends.length
                        : 0,
                timeRange,
            },
            success: true,
        };
    } catch (error) {
        console.error("Error getting activity trends:", error);
        return {
            trends: [],
            summary: {
                totalActivity: 0,
                peakDay: null,
                averagePerDay: 0,
                timeRange: parameters.timeRange || "30d",
            },
            success: false,
        };
    }
}

export async function getDetailedKnowledgeStats(
    parameters: {
        includeQuality?: boolean;
        includeProgress?: boolean;
        timeRange?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<DetailedKnowledgeStats> {
    const websiteCollection = context.agentContext.websiteCollection;

    if (!websiteCollection) {
        return createEmptyKnowledgeStats();
    }

    const websites = websiteCollection.messages.getAll();

    // Calculate base stats
    const baseStats = await calculateBaseStats(websites);

    // Calculate extraction progress
    const extractionProgress = calculateExtractionProgress(websites);

    // Calculate quality distribution
    const qualityDistribution =
        parameters.includeQuality !== false
            ? calculateQualityDistribution(websites)
            : { highQuality: 0, mediumQuality: 0, lowQuality: 0 };

    // Calculate completion rates
    const completionRates = calculateCompletionRates(websites);

    return {
        ...baseStats,
        extractionProgress,
        qualityDistribution,
        completionRates,
    };
}

function createEmptyKnowledgeStats(): DetailedKnowledgeStats {
    return {
        totalPages: 0,
        totalEntities: 0,
        totalTopics: 0,
        totalRelationships: 0,
        uniqueDomains: 0,
        topEntityTypes: [],
        topDomains: [],
        recentActivity: [],
        storageSize: {
            totalBytes: 0,
            entitiesBytes: 0,
            contentBytes: 0,
            metadataBytes: 0,
        },
        extractionProgress: {
            entityProgress: 0,
            topicProgress: 0,
            actionProgress: 0,
        },
        qualityDistribution: {
            highQuality: 0,
            mediumQuality: 0,
            lowQuality: 0,
        },
        completionRates: {
            pagesWithEntities: 0,
            pagesWithTopics: 0,
            pagesWithActions: 0,
            totalProcessedPages: 0,
        },
    };
}

async function calculateBaseStats(websites: any[]): Promise<{
    totalPages: number;
    totalEntities: number;
    totalTopics: number;
    totalRelationships: number;
    uniqueDomains: number;
    topEntityTypes: Array<{ type: string; count: number }>;
    topDomains: Array<{ domain: string; pageCount: number }>;
    recentActivity: Array<{ date: string; pagesIndexed: number }>;
    storageSize: {
        totalBytes: number;
        entitiesBytes: number;
        contentBytes: number;
        metadataBytes: number;
    };
}> {
    let totalEntities = 0;
    let totalTopics = 0;
    let totalRelationships = 0;
    const domains = new Set<string>();
    const entityTypeCounts = new Map<string, number>();
    const domainCounts = new Map<string, number>();
    const uniqueTopicsSet = new Set<string>();
    let totalContent = 0;

    for (const site of websites) {
        try {
            const knowledge = site.getKnowledge();
            const metadata = site.metadata as website.WebsiteDocPartMeta;

            // Extract domain from URL
            if (metadata?.url) {
                try {
                    const domain = new URL(metadata.url).hostname;
                    domains.add(domain);
                    domainCounts.set(
                        domain,
                        (domainCounts.get(domain) || 0) + 1,
                    );
                } catch (error) {
                    // Invalid URL, skip domain extraction
                }
            }

            if (knowledge) {
                // Count entities and their types
                if (knowledge.entities?.length > 0) {
                    totalEntities += knowledge.entities.length;
                    knowledge.entities.forEach((entity: any) => {
                        const type = entity.type || "Unknown";
                        entityTypeCounts.set(
                            type,
                            (entityTypeCounts.get(type) || 0) + 1,
                        );
                    });
                }

                // Count unique topics
                if (knowledge.topics?.length > 0) {
                    knowledge.topics.forEach((topic: string) => {
                        uniqueTopicsSet.add(topic.toLowerCase().trim());
                    });
                }

                // Count relationships/actions
                if (knowledge.actions?.length > 0) {
                    totalRelationships += knowledge.actions.length;
                }
            }

            // Calculate content size
            const textContent = site.textChunks?.join("") || "";
            totalContent += textContent.length;
        } catch (error) {
            console.warn("Error processing site for stats:", error);
        }
    }

    // Set totalTopics to the count of unique topics found
    totalTopics = uniqueTopicsSet.size;

    // Convert entity types to sorted array
    const topEntityTypes = Array.from(entityTypeCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([type, count]) => ({ type, count }));

    // Convert domains to sorted array
    const topDomains = Array.from(domainCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([domain, pageCount]) => ({ domain, pageCount }));

    // Simple recent activity (last 7 days)
    const recentActivity = generateRecentActivity(websites);

    return {
        totalPages: websites.length,
        totalEntities,
        totalTopics,
        totalRelationships,
        uniqueDomains: domains.size,
        topEntityTypes,
        topDomains,
        recentActivity,
        storageSize: {
            totalBytes: totalContent,
            entitiesBytes: Math.round(totalContent * 0.3), // Estimate
            contentBytes: Math.round(totalContent * 0.6), // Estimate
            metadataBytes: Math.round(totalContent * 0.1), // Estimate
        },
    };
}

function calculateExtractionProgress(websites: any[]): {
    entityProgress: number;
    topicProgress: number;
    actionProgress: number;
} {
    let pagesWithEntities = 0;
    let pagesWithTopics = 0;
    let pagesWithActions = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge) {
                if (knowledge.entities?.length > 0) pagesWithEntities++;
                if (knowledge.topics?.length > 0) pagesWithTopics++;
                if (knowledge.actions?.length > 0) pagesWithActions++;
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    const total = websites.length || 1; // Prevent division by zero

    return {
        entityProgress: Math.round((pagesWithEntities / total) * 100),
        topicProgress: Math.round((pagesWithTopics / total) * 100),
        actionProgress: Math.round((pagesWithActions / total) * 100),
    };
}

function calculateQualityDistribution(websites: any[]): {
    highQuality: number;
    mediumQuality: number;
    lowQuality: number;
} {
    let high = 0,
        medium = 0,
        low = 0;
    let totalPagesWithKnowledge = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge && knowledge.entities?.length > 0) {
                totalPagesWithKnowledge++;

                // Calculate average confidence across entities
                const confidences = knowledge.entities
                    .map((e: any) => e.confidence || 0)
                    .filter((c: number) => c > 0);

                if (confidences.length > 0) {
                    const avgConfidence =
                        confidences.reduce((a: number, b: number) => a + b) /
                        confidences.length;

                    if (avgConfidence >= 0.8) high++;
                    else if (avgConfidence >= 0.5) medium++;
                    else low++;
                } else {
                    // No confidence scores, assume medium quality
                    medium++;
                }
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    const total = totalPagesWithKnowledge || 1;

    return {
        highQuality: Math.round((high / total) * 100),
        mediumQuality: Math.round((medium / total) * 100),
        lowQuality: Math.round((low / total) * 100),
    };
}

function calculateCompletionRates(websites: any[]): {
    pagesWithEntities: number;
    pagesWithTopics: number;
    pagesWithActions: number;
    totalProcessedPages: number;
} {
    let pagesWithEntities = 0;
    let pagesWithTopics = 0;
    let pagesWithActions = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge) {
                if (knowledge.entities?.length > 0) pagesWithEntities++;
                if (knowledge.topics?.length > 0) pagesWithTopics++;
                if (knowledge.actions?.length > 0) pagesWithActions++;
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    return {
        pagesWithEntities,
        pagesWithTopics,
        pagesWithActions,
        totalProcessedPages: websites.length,
    };
}

function generateRecentActivity(
    websites: any[],
): Array<{ date: string; pagesIndexed: number }> {
    const activityMap = new Map<string, number>();
    const now = new Date();

    // Initialize last 7 days with 0
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        activityMap.set(dateStr, 0);
    }

    // Count pages by date
    websites.forEach((site) => {
        try {
            const metadata = site.metadata as website.WebsiteDocPartMeta;
            const siteDate = metadata?.visitDate || metadata?.bookmarkDate;

            if (siteDate) {
                const date = new Date(siteDate);
                const dateStr = date.toISOString().split("T")[0];

                if (activityMap.has(dateStr)) {
                    activityMap.set(
                        dateStr,
                        (activityMap.get(dateStr) || 0) + 1,
                    );
                }
            }
        } catch (error) {
            // Skip sites with invalid dates
        }
    });

    return Array.from(activityMap.entries())
        .map(([date, pagesIndexed]) => ({ date, pagesIndexed }))
        .sort((a, b) => a.date.localeCompare(b.date));
}
