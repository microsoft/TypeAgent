// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import {
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "../schema/knowledgeExtraction.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:knowledge:query");

/**
 * Retrieves indexed knowledge for a specific page URL
 */
export async function getPageIndexedKnowledge(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    knowledge?: EnhancedKnowledgeExtractionResult;
    error?: string;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                isIndexed: false,
                error: "Durable browser memory is not available",
            };
        }
        const sourceKnowledge = await memory.getSourceKnowledge(parameters.url);
        if (sourceKnowledge === undefined) {
            return {
                isIndexed: false,
                error: "Page not found in index",
            };
        }
        const entities: Entity[] = sourceKnowledge.entities.map((entity) => ({
            name: entity.name,
            type: entity.types.join(", "),
            confidence: 0.8,
        }));
        const keyTopics = sourceKnowledge.topics.map((topic) => topic.name);
        const relationships: Relationship[] = sourceKnowledge.relationships.map(
            (item) => ({
                from: item.fromEntity,
                relationship: item.relationshipType,
                to: item.toEntity,
                confidence: 0.8,
            }),
        );
        return {
            isIndexed: true,
            knowledge: {
                title: sourceKnowledge.source.title,
                entities,
                relationships,
                keyTopics,
                detectedActions: [],
                suggestedQuestions: [],
                summary: `Retrieved indexed knowledge: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships.`,
                contentMetrics: { readingTime: 0, wordCount: 0 },
            },
        };
    } catch (error) {
        console.error("Error getting page indexed knowledge:", error);
        return {
            isIndexed: false,
            error: "Failed to retrieve indexed knowledge",
        };
    }
}

/**
 * Retrieves discover insights including trending topics, reading patterns, popular pages, and top domains
 */
export async function getDiscoverInsights(
    parameters: {
        limit?: number;
        timeframe?: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
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
        trend: "up" | "down" | "stable";
    }>;
    success: boolean;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                trendingTopics: [],
                readingPatterns: [],
                popularPages: [],
                topDomains: [],
                success: false,
            };
        }

        const [sources, graph] = await Promise.all([
            memory.listSources(),
            memory.getKnowledgeGraph(),
        ]);
        const websites = sources.map((source) => {
            const revision = source.revisions.find(
                (item) => item.revisionId === source.activeRevisionId,
            );
            const capturedAt = revision?.capturedAt ?? revision?.indexedAt;
            return {
                metadata: {
                    url: source.canonicalUri,
                    title: source.title,
                    ...(source.metadata?.source === "bookmark"
                        ? { bookmarkDate: capturedAt }
                        : { visitDate: capturedAt }),
                },
                getKnowledge: () => ({
                    entities: graph.entities
                        .filter((entity) =>
                            entity.sourceIds.includes(source.sourceId),
                        )
                        .map((entity) => ({ name: entity.name })),
                }),
            };
        });
        const limit = parameters.limit || 10;
        const timeframe = parameters.timeframe || "30d";

        // Analyze trending topics from titles and knowledge entities
        const trendingTopics = analyzeTrendingTopics(websites, limit);

        // Analyze reading patterns from temporal data
        const readingPatterns = analyzeReadingPatterns(websites, timeframe);

        // Identify popular pages by activity metrics
        const popularPages = analyzePopularPages(websites, limit);

        // Enhanced domain analysis with trends
        const topDomains = analyzeTopDomains(websites, limit);

        return {
            trendingTopics,
            readingPatterns,
            popularPages,
            topDomains,
            success: true,
        };
    } catch (error) {
        console.error("Error getting discover insights:", error);
        return {
            trendingTopics: [],
            readingPatterns: [],
            popularPages: [],
            topDomains: [],
            success: false,
        };
    }
}

/**
 * Enhanced suggested questions using content analysis and DataFrames
 */
export async function generateSmartSuggestedQuestions(
    knowledge: any,
    extractionResult: any,
    url: string,
    context: SessionContext<BrowserActionContext>,
): Promise<string[]> {
    const questions: string[] = [];
    const domain = extractDomainFromUrl(url);

    // Content-specific questions based on extraction result
    if (extractionResult?.pageContent) {
        if (extractionResult.pageContent.readingTime > 10) {
            questions.push("What are the key points from this long article?");
        }
    }

    // Add history-oriented questions only when durable browser memory is available.
    if (context.agentContext.browserMemoryService !== undefined) {
        try {
            debug("Checking domain visit data for enhanced questions");

            if (domain) {
                questions.push(`When did I first visit ${domain}?`);
                questions.push(`What's my learning journey on ${domain}?`);
            }
            questions.push("When did I first encounter this information?");
            questions.push("What have I learned recently in this domain?");
        } catch (error) {
            console.warn("Error querying domain data:", error);
        }
    }

    // Topic-based cross-references
    if (knowledge.topics && knowledge.topics.length > 0) {
        for (const topic of knowledge.topics.slice(0, 2)) {
            questions.push(`What other ${topic} resources do I have?`);
        }
    }

    // Learning progression questions
    questions.push("What should I learn next in this area?");
    questions.push("Are there any knowledge gaps I should fill?");

    return questions.slice(0, 8); // Limit to most relevant questions
}

// Helper functions

/**
 * Analyzes trending topics from website titles and knowledge entities
 */
function analyzeTrendingTopics(websites: any[], limit: number) {
    const topicCounts = new Map<string, number>();
    const recentTopicCounts = new Map<string, number>();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const site of websites) {
        const metadata = site.metadata as any;
        const title = metadata.title || "";
        const knowledge = site.getKnowledge();

        // Extract topics from title words (basic implementation)
        const titleWords = title
            .toLowerCase()
            .split(/\s+/)
            .filter(
                (word: string) =>
                    word.length > 3 &&
                    ![
                        "the",
                        "and",
                        "for",
                        "are",
                        "but",
                        "not",
                        "you",
                        "all",
                        "can",
                        "had",
                        "her",
                        "was",
                        "one",
                        "our",
                        "out",
                        "day",
                        "get",
                        "has",
                        "him",
                        "his",
                        "how",
                        "its",
                        "may",
                        "new",
                        "now",
                        "old",
                        "see",
                        "two",
                        "way",
                        "who",
                        "boy",
                        "did",
                        "man",
                        "car",
                        "got",
                        "let",
                        "say",
                        "she",
                        "too",
                        "use",
                    ].includes(word),
            );

        titleWords.forEach((word: string) => {
            topicCounts.set(word, (topicCounts.get(word) || 0) + 1);

            const visitDate = metadata.visitDate || metadata.bookmarkDate;
            if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                recentTopicCounts.set(
                    word,
                    (recentTopicCounts.get(word) || 0) + 1,
                );
            }
        });

        // Extract topics from knowledge entities
        if (knowledge?.entities) {
            knowledge.entities.forEach((entity: any) => {
                const entityName = entity.name?.toLowerCase();
                if (entityName && entityName.length > 2) {
                    topicCounts.set(
                        entityName,
                        (topicCounts.get(entityName) || 0) + 1,
                    );

                    const visitDate =
                        metadata.visitDate || metadata.bookmarkDate;
                    if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                        recentTopicCounts.set(
                            entityName,
                            (recentTopicCounts.get(entityName) || 0) + 1,
                        );
                    }
                }
            });
        }
    }

    const sortedTopics = Array.from(topicCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit);

    return sortedTopics.map(([topic, count]) => {
        const recentCount = recentTopicCounts.get(topic) || 0;
        const historicalCount = count - recentCount;
        let trend: "up" | "down" | "stable" = "stable";

        if (recentCount > historicalCount * 1.5) {
            trend = "up";
        } else if (recentCount < historicalCount * 0.5) {
            trend = "down";
        }

        return {
            topic,
            count,
            trend,
            percentage: Math.round((count / websites.length) * 100),
        };
    });
}

/**
 * Analyzes reading patterns by day of week
 */
function analyzeReadingPatterns(websites: any[], timeframe: string) {
    const patterns = new Map<string, number>();
    const dayOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    for (const site of websites) {
        const metadata = site.metadata as any;
        const visitDate = metadata.visitDate || metadata.bookmarkDate;

        if (visitDate) {
            const date = new Date(visitDate);
            const day = dayOfWeek[date.getDay()];
            patterns.set(day, (patterns.get(day) || 0) + 1);
        }
    }

    const maxActivity = Math.max(...Array.from(patterns.values()));

    return dayOfWeek.map((day) => ({
        timeframe: day,
        activity: patterns.get(day) || 0,
        peak: (patterns.get(day) || 0) === maxActivity && maxActivity > 0,
    }));
}

/**
 * Analyzes popular pages by visit count and bookmark status
 */
function analyzePopularPages(websites: any[], limit: number) {
    const pageStats = new Map<
        string,
        {
            url: string;
            title: string;
            visitCount: number;
            isBookmarked: boolean;
            domain: string;
            lastVisited: string;
        }
    >();

    for (const site of websites) {
        const metadata = site.metadata as any;
        const url = metadata.url || "";
        const title = metadata.title || url;
        const domain = url ? new URL(url).hostname : "";
        const isBookmarked = !!metadata.bookmarkDate;
        const lastVisited =
            metadata.visitDate ||
            metadata.bookmarkDate ||
            new Date().toISOString();

        if (url) {
            const existing = pageStats.get(url);
            if (existing) {
                existing.visitCount++;
                if (new Date(lastVisited) > new Date(existing.lastVisited)) {
                    existing.lastVisited = lastVisited;
                }
                if (isBookmarked) {
                    existing.isBookmarked = true;
                }
            } else {
                pageStats.set(url, {
                    url,
                    title,
                    visitCount: 1,
                    isBookmarked,
                    domain,
                    lastVisited,
                });
            }
        }
    }

    return Array.from(pageStats.values())
        .sort((a, b) => {
            // Prioritize bookmarked pages and visit count
            const scoreA = (a.isBookmarked ? 10 : 0) + a.visitCount;
            const scoreB = (b.isBookmarked ? 10 : 0) + b.visitCount;
            return scoreB - scoreA;
        })
        .slice(0, limit);
}

/**
 * Analyzes top domains with trend information
 */
function analyzeTopDomains(websites: any[], limit: number) {
    const domainCounts = new Map<string, number>();
    const recentDomainCounts = new Map<string, number>();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const site of websites) {
        const metadata = site.metadata as any;
        const url = metadata.url;

        if (url) {
            try {
                const domain = new URL(url).hostname;
                domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

                const visitDate = metadata.visitDate || metadata.bookmarkDate;
                if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                    recentDomainCounts.set(
                        domain,
                        (recentDomainCounts.get(domain) || 0) + 1,
                    );
                }
            } catch (error) {
                // Invalid URL, skip
            }
        }
    }

    return Array.from(domainCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([domain, count]) => {
            const recentCount = recentDomainCounts.get(domain) || 0;
            const historicalCount = count - recentCount;
            let trend: "up" | "down" | "stable" = "stable";

            if (recentCount > historicalCount * 1.5) {
                trend = "up";
            } else if (recentCount < historicalCount * 0.5) {
                trend = "down";
            }

            return {
                domain,
                count,
                trend,
                favicon: `https://www.google.com/s2/favicons?domain=${domain}`,
            };
        });
}

/**
 * Extract domain from URL
 */
function extractDomainFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}
