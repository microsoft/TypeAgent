// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionContext } from "@typeagent/agent-sdk";
import type {
    MemoryKnowledgeGraph,
    MemorySource,
} from "@typeagent/memory-service";
import type { BrowserActionContext } from "../../browserActions.mjs";
import type { DetailedKnowledgeStats } from "../../browserKnowledgeSchema.js";
import type { AnalyticsDataResponse } from "../types/knowledgeTypes.mjs";

type BrowserSnapshot = {
    sources: MemorySource[];
    graph: MemoryKnowledgeGraph;
};

async function loadSnapshot(
    context: SessionContext<BrowserActionContext>,
): Promise<BrowserSnapshot> {
    const memory = context.agentContext.browserMemoryService;
    if (memory === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    const [sources, graph] = await Promise.all([
        memory.listSources(),
        memory.getKnowledgeGraph(),
    ]);
    return { sources, graph };
}

function sourceTimestamp(source: MemorySource): string | undefined {
    const revision = source.revisions.find(
        (item) => item.revisionId === source.activeRevisionId,
    );
    return revision?.capturedAt ?? revision?.indexedAt;
}

function sourceDomain(source: MemorySource): string {
    const metadataDomain = source.metadata?.domain;
    if (typeof metadataDomain === "string" && metadataDomain.length > 0) {
        return metadataDomain;
    }
    try {
        return source.canonicalUri === undefined
            ? "unknown"
            : new URL(source.canonicalUri).hostname;
    } catch {
        return "unknown";
    }
}

function sourceIdsFor(
    sourceId: string,
    graph: MemoryKnowledgeGraph,
): {
    entityCount: number;
    topicCount: number;
    relationshipCount: number;
} {
    return {
        entityCount: graph.entities.filter((item) =>
            item.sourceIds.includes(sourceId),
        ).length,
        topicCount: graph.topics.filter((item) =>
            item.sourceIds.includes(sourceId),
        ).length,
        relationshipCount: graph.relationships.filter((item) =>
            item.sourceIds.includes(sourceId),
        ).length,
    };
}

function qualityScore(counts: ReturnType<typeof sourceIdsFor>): number {
    return Math.min(
        1,
        0.2 +
            (counts.entityCount > 0 ? 0.3 : 0) +
            (counts.topicCount > 0 ? 0.2 : 0) +
            (counts.relationshipCount > 0 ? 0.3 : 0),
    );
}

export async function getExtractionAnalytics(
    parameters: { timeRange?: string; mode?: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{ success: boolean; analytics: any }> {
    try {
        const { sources } = await loadSnapshot(context);
        const modes = { basic: 0, content: 0, actions: 0, full: 0 };
        for (const source of sources) {
            const mode = source.metadata?.extractionMode;
            if (typeof mode === "string" && mode in modes) {
                modes[mode as keyof typeof modes]++;
            }
        }
        return {
            success: true,
            analytics: {
                totalExtractions: sources.length,
                successRate: sources.length === 0 ? 0 : 100,
                averageProcessingTime: 0,
                modes,
            },
        };
    } catch {
        return { success: false, analytics: null };
    }
}

export async function generateQualityReport(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{ success: boolean; report: any }> {
    try {
        const { sources, graph } = await loadSnapshot(context);
        const scores = sources.map((source) =>
            qualityScore(sourceIdsFor(source.sourceId, graph)),
        );
        const average =
            scores.length === 0
                ? 0
                : scores.reduce((sum, score) => sum + score, 0) / scores.length;
        return {
            success: true,
            report: {
                overallQuality:
                    average >= 0.8
                        ? "excellent"
                        : average >= 0.5
                          ? "good"
                          : average > 0
                            ? "fair"
                            : "poor",
                averageConfidence: average,
                totalItems: sources.length,
                qualityDistribution: {
                    excellent: scores.filter((score) => score >= 0.8).length,
                    good: scores.filter((score) => score >= 0.6 && score < 0.8)
                        .length,
                    fair: scores.filter((score) => score >= 0.4 && score < 0.6)
                        .length,
                    poor: scores.filter((score) => score < 0.4).length,
                },
            },
        };
    } catch {
        return { success: false, report: null };
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
    const empty = {
        score: 0,
        entityCount: 0,
        topicCount: 0,
        actionCount: 0,
        extractionMode: "unknown",
        lastUpdated: null,
    };
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) return empty;
        const source = await memory.getSource(parameters.url);
        if (source === undefined) return empty;
        const graph = await memory.getKnowledgeGraph();
        const counts = sourceIdsFor(source.sourceId, graph);
        return {
            score: qualityScore(counts),
            entityCount: counts.entityCount,
            topicCount: counts.topicCount,
            actionCount: counts.relationshipCount,
            extractionMode:
                typeof source.metadata?.extractionMode === "string"
                    ? source.metadata.extractionMode
                    : "durable",
            lastUpdated: sourceTimestamp(source) ?? null,
        };
    } catch {
        return empty;
    }
}

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
        const { sources, graph } = await loadSnapshot(context);
        const limit = parameters.limit ?? 10;
        const type = parameters.type ?? "all";
        const sourceById = new Map(
            sources.map((source) => [source.sourceId, source]),
        );
        const details = (sourceId: string) => {
            const source = sourceById.get(sourceId);
            return {
                fromPage: source?.title ?? "Unknown Page",
                extractedAt:
                    source === undefined ? "" : (sourceTimestamp(source) ?? ""),
            };
        };
        const entities =
            type === "entities" || type === "all"
                ? graph.entities.flatMap((entity) =>
                      entity.sourceIds.map((sourceId) => ({
                          name: entity.name,
                          type: entity.types.join(", "),
                          ...details(sourceId),
                      })),
                  )
                : [];
        const topics =
            type === "topics" || type === "all"
                ? graph.topics.flatMap((topic) =>
                      topic.sourceIds.map((sourceId) => ({
                          name: topic.name,
                          ...details(sourceId),
                      })),
                  )
                : [];
        const relationships =
            type === "relationships" || type === "all"
                ? graph.relationships.flatMap((relationship) =>
                      relationship.sourceIds.map((sourceId) => ({
                          from: relationship.fromEntity,
                          relationship: relationship.relationshipType,
                          to: relationship.toEntity,
                          confidence: 0.8,
                          ...details(sourceId),
                      })),
                  )
                : [];
        const newestFirst = <T extends { extractedAt: string }>(items: T[]) =>
            items
                .sort((left, right) =>
                    right.extractedAt.localeCompare(left.extractedAt),
                )
                .slice(0, limit);
        return {
            entities: newestFirst(entities),
            topics: newestFirst(topics),
            actions: [],
            relationships: newestFirst(relationships),
            success: true,
        };
    } catch {
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
    parameters: { limit?: number },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    domains: Array<{ domain: string; count: number; percentage: number }>;
    totalSites: number;
    success: boolean;
}> {
    try {
        const { sources } = await loadSnapshot(context);
        const counts = new Map<string, number>();
        for (const source of sources) {
            const domain = sourceDomain(source);
            counts.set(domain, (counts.get(domain) ?? 0) + 1);
        }
        return {
            domains: [...counts]
                .sort((left, right) => right[1] - left[1])
                .slice(0, parameters.limit ?? 10)
                .map(([domain, count]) => ({
                    domain,
                    count,
                    percentage:
                        sources.length === 0
                            ? 0
                            : Number(
                                  ((count / sources.length) * 100).toFixed(1),
                              ),
                })),
            totalSites: sources.length,
            success: true,
        };
    } catch {
        return { domains: [], totalSites: 0, success: false };
    }
}

export async function getActivityTrends(
    parameters: { timeRange?: string; granularity?: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    trends: Array<{ date: string; visits: number; bookmarks: number }>;
    summary: {
        totalActivity: number;
        peakDay: string | null;
        averagePerDay: number;
        timeRange: string;
    };
    success: boolean;
}> {
    const timeRange = parameters.timeRange ?? "30d";
    try {
        const { sources } = await loadSnapshot(context);
        const days = Number.parseInt(timeRange, 10) || 30;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const activity = new Map<
            string,
            { visits: number; bookmarks: number }
        >();
        for (const source of sources) {
            const timestamp = sourceTimestamp(source);
            if (timestamp === undefined || Date.parse(timestamp) < cutoff)
                continue;
            const date = timestamp.slice(0, 10);
            const current = activity.get(date) ?? { visits: 0, bookmarks: 0 };
            if (source.metadata?.source === "bookmark") current.bookmarks++;
            else current.visits++;
            activity.set(date, current);
        }
        const trends = [...activity]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, counts]) => ({ date, ...counts }));
        const totalActivity = trends.reduce(
            (sum, item) => sum + item.visits + item.bookmarks,
            0,
        );
        const peak = trends.reduce<(typeof trends)[number] | undefined>(
            (best, item) =>
                best === undefined ||
                item.visits + item.bookmarks > best.visits + best.bookmarks
                    ? item
                    : best,
            undefined,
        );
        return {
            trends,
            summary: {
                totalActivity,
                peakDay: peak?.date ?? null,
                averagePerDay:
                    trends.length === 0 ? 0 : totalActivity / trends.length,
                timeRange,
            },
            success: true,
        };
    } catch {
        return {
            trends: [],
            summary: {
                totalActivity: 0,
                peakDay: null,
                averagePerDay: 0,
                timeRange,
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
    try {
        const { sources, graph } = await loadSnapshot(context);
        const entityTypes = new Map<string, number>();
        for (const entity of graph.entities) {
            for (const type of entity.types) {
                entityTypes.set(type, (entityTypes.get(type) ?? 0) + 1);
            }
        }
        const domainCounts = new Map<string, number>();
        const activityCounts = new Map<string, number>();
        const sourceKnowledge = sources.map((source) => {
            const domain = sourceDomain(source);
            domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
            const timestamp = sourceTimestamp(source);
            if (timestamp !== undefined) {
                const date = timestamp.slice(0, 10);
                activityCounts.set(date, (activityCounts.get(date) ?? 0) + 1);
            }
            return sourceIdsFor(source.sourceId, graph);
        });
        const pagesWithEntities = sourceKnowledge.filter(
            (item) => item.entityCount > 0,
        ).length;
        const pagesWithTopics = sourceKnowledge.filter(
            (item) => item.topicCount > 0,
        ).length;
        const pagesWithActions = sourceKnowledge.filter(
            (item) => item.relationshipCount > 0,
        ).length;
        const percentage = (count: number) =>
            sources.length === 0 ? 0 : (count / sources.length) * 100;
        const scores = sourceKnowledge.map(qualityScore);
        return {
            totalPages: sources.length,
            totalEntities: graph.entities.length,
            totalTopics: graph.topics.length,
            totalRelationships: graph.relationships.length,
            uniqueDomains: domainCounts.size,
            topEntityTypes: [...entityTypes]
                .sort((left, right) => right[1] - left[1])
                .slice(0, 10)
                .map(([type, count]) => ({ type, count })),
            topDomains: [...domainCounts]
                .sort((left, right) => right[1] - left[1])
                .slice(0, 10)
                .map(([domain, pageCount]) => ({ domain, pageCount })),
            recentActivity: [...activityCounts]
                .sort(([left], [right]) => right.localeCompare(left))
                .slice(0, parameters.timeRange ?? 30)
                .map(([date, pagesIndexed]) => ({ date, pagesIndexed })),
            storageSize: {
                totalBytes: 0,
                entitiesBytes: 0,
                contentBytes: 0,
                metadataBytes: 0,
            },
            extractionProgress: {
                entityProgress: percentage(pagesWithEntities),
                topicProgress: percentage(pagesWithTopics),
                actionProgress: percentage(pagesWithActions),
            },
            qualityDistribution: {
                highQuality: scores.filter((score) => score >= 0.8).length,
                mediumQuality: scores.filter(
                    (score) => score >= 0.5 && score < 0.8,
                ).length,
                lowQuality: scores.filter((score) => score < 0.5).length,
            },
            completionRates: {
                pagesWithEntities,
                pagesWithTopics,
                pagesWithActions,
                totalProcessedPages: sources.length,
            },
        };
    } catch {
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
    const [stats, domains, activity, extraction, recent, quality] =
        await Promise.all([
            getDetailedKnowledgeStats(
                {
                    ...(parameters.includeQuality === undefined
                        ? {}
                        : { includeQuality: parameters.includeQuality }),
                    ...(parameters.includeProgress === undefined
                        ? {}
                        : { includeProgress: parameters.includeProgress }),
                    timeRange: Number.parseInt(
                        parameters.timeRange ?? "30",
                        10,
                    ),
                },
                context,
            ),
            getTopDomains({ limit: parameters.topDomainsLimit ?? 10 }, context),
            getActivityTrends(
                {
                    timeRange: parameters.timeRange ?? "30d",
                    granularity: parameters.activityGranularity ?? "day",
                },
                context,
            ),
            getExtractionAnalytics(
                { timeRange: parameters.timeRange ?? "30d" },
                context,
            ),
            getRecentKnowledgeItems({ limit: 10, type: "all" }, context),
            generateQualityReport({}, context),
        ]);
    const sources = await context.agentContext.browserMemoryService
        ?.listSources()
        .catch(() => []);
    const totalBookmarks =
        sources?.filter((source) => source.metadata?.source === "bookmark")
            .length ?? 0;
    const totalHistory =
        sources?.filter((source) => source.metadata?.source === "history")
            .length ?? 0;
    return {
        overview: {
            totalSites: stats.totalPages,
            totalBookmarks,
            totalHistory,
            topDomains: domains.domains.length,
            knowledgeExtracted: stats.completionRates.totalProcessedPages,
        },
        knowledge: {
            extractionProgress: stats.extractionProgress,
            qualityDistribution: stats.qualityDistribution,
            totalEntities: stats.totalEntities,
            totalTopics: stats.totalTopics,
            totalActions: stats.totalRelationships,
            totalRelationships: stats.totalRelationships,
            recentEntities: recent.entities,
            recentTopics: recent.topics,
            recentActions: recent.actions,
            recentRelationships: recent.relationships,
        },
        domains: {
            topDomains: domains.domains,
            totalSites: domains.totalSites,
        },
        activity: {
            trends: activity.trends,
            summary: activity.summary,
        },
        analytics: {
            extractionMetrics: extraction.analytics,
            qualityReport: quality.report,
        },
    };
}
