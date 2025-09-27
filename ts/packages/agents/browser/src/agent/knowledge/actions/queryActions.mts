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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                isIndexed: false,
                error: "No website collection available",
            };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (!foundWebsite) {
            return {
                isIndexed: false,
                error: "Page not found in index",
            };
        }

        try {
            const knowledge = foundWebsite.getKnowledge();

            if (!knowledge) {
                return {
                    isIndexed: true,
                    knowledge: {
                        title: "",
                        entities: [],
                        relationships: [],
                        keyTopics: [],
                        detectedActions: [],
                        suggestedQuestions: [],
                        summary:
                            "Page is indexed but no knowledge was extracted.",
                        contentMetrics: {
                            readingTime: 0,
                            wordCount: 0,
                        },
                    },
                };
            }

            let detectedActions: any[] = [];

            // Check websiteObj metadata for detectedActions first (with safe property access)
            if (
                foundWebsite.metadata &&
                (foundWebsite.metadata as any).detectedActions &&
                Array.isArray((foundWebsite.metadata as any).detectedActions)
            ) {
                detectedActions = (foundWebsite.metadata as any)
                    .detectedActions;
            }

            // Also check knowledge object for detectedActions (fallback)
            if (
                (knowledge as any).detectedActions &&
                Array.isArray((knowledge as any).detectedActions)
            ) {
                detectedActions.push(...(knowledge as any).detectedActions);
            }

            // Convert the stored knowledge to the expected format
            const entities: Entity[] =
                knowledge.entities?.map((entity) => ({
                    name: entity.name,
                    type: Array.isArray(entity.type)
                        ? entity.type.join(", ")
                        : entity.type,
                    description: entity.facets?.find(
                        (f) => f.name === "description",
                    )?.value as string,
                    confidence: 0.8, // Default confidence for indexed content
                })) || [];

            const keyTopics: string[] = knowledge.topics || [];

            const allRelationships: Relationship[] =
                knowledge.actions?.map((action) => ({
                    from: action.subjectEntityName || "unknown",
                    relationship: action.verbs?.join(", ") || "related to",
                    to: action.objectEntityName || "unknown",
                    confidence: 0.8, // Default confidence for indexed content
                })) || [];

            // Deduplicate relationships
            const relationships = allRelationships.filter(
                (rel, index, arr) =>
                    arr.findIndex(
                        (r) =>
                            r.from === rel.from &&
                            r.relationship === rel.relationship &&
                            r.to === rel.to,
                    ) === index,
            );

            // Generate contextual questions for indexed content
            const suggestedQuestions: string[] = [];
            /*
            const suggestedQuestions: string[] =
                await generateSmartSuggestedQuestions(
                    knowledge,
                    null,
                    parameters.url,
                    context,
                );
            */

            // Calculate content metrics from the stored text
            const textContent = foundWebsite.textChunks?.join("\n\n") || "";
            const wordCount = textContent.split(/\s+/).length;
            const contentMetrics = {
                readingTime: Math.ceil(wordCount / 225),
                wordCount: wordCount,
            };

            const summary = `Retrieved indexed knowledge: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships.`;

            return {
                isIndexed: true,
                knowledge: {
                    title: (knowledge as any).title || "",
                    entities,
                    relationships,
                    keyTopics,
                    detectedActions,
                    contentActions: knowledge.actions || [],
                    actionSummary: foundWebsite.metadata
                        ? (foundWebsite.metadata as any).actionSummary
                        : undefined,
                    suggestedQuestions,
                    summary,
                    contentMetrics,
                },
            };
        } catch (knowledgeError) {
            console.warn(
                "Error extracting knowledge from indexed page:",
                knowledgeError,
            );
            return {
                isIndexed: true,
                knowledge: {
                    title: "",
                    entities: [],
                    relationships: [],
                    keyTopics: [],
                    detectedActions: [],
                    suggestedQuestions: [],
                    summary: "Page is indexed but knowledge extraction failed.",
                    contentMetrics: {
                        readingTime: 0,
                        wordCount: 0,
                    },
                },
            };
        }
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
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                trendingTopics: [],
                readingPatterns: [],
                popularPages: [],
                topDomains: [],
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
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

    // Use DataFrames for context-aware questions
    const websiteCollection = context.agentContext.websiteCollection;
    if (websiteCollection && websiteCollection.visitFrequency) {
        try {
            // Domain visit history - simplified approach for now
            debug("Checking domain visit data for enhanced questions");

            if (domain) {
                questions.push(`When did I first visit ${domain}?`);
                questions.push(`What's my learning journey on ${domain}?`);
            }
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

    // Temporal questions
    questions.push("When did I first encounter this information?");
    questions.push("What have I learned recently in this domain?");

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