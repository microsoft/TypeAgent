// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    ImportWebsiteData,
    SearchWebsites,
    GetWebsiteStats,
} from "./actionsSchema.mjs";
import * as website from "website-memory";
import * as kp from "knowpro";
import registerDebug from "debug";

export interface BrowserActionContext {
    browserControl?: any | undefined;
    webSocket?: any | undefined;
    webAgentChannels?: any | undefined;
    crossWordState?: any | undefined;
    browserConnector?: any | undefined;
    browserProcess?: any | undefined;
    tabTitleIndex?: any | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: any | undefined;
    index: website.IndexData | undefined;
}

const debug = registerDebug("typeagent:browser:website-memory");

/**
 * Resolve URL using website visit history (bookmarks, browser history)
 * This provides a more personalized alternative to web search
 */
export async function resolveURLWithHistory(
    context: { agentContext: BrowserActionContext },
    site: string,
): Promise<string | undefined> {
    debug(`Attempting to resolve '${site}' using website visit history`);

    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection || websiteCollection.messages.length === 0) {
        debug("No website collection available or empty");
        return undefined;
    }

    try {
        // Use knowpro searchConversationKnowledge for semantic search
        const matches = await kp.searchConversationKnowledge(
            websiteCollection,
            // search group
            {
                booleanOp: "or", // Use OR to be more permissive
                terms: siteQueryToSearchTerms(site),
            },
            // when filter
            {
                // No specific knowledge type filter - search across all types
            },
            // options
            {
                exactMatch: false, // Allow fuzzy matching
            },
        );

        if (!matches || matches.size === 0) {
            debug(`No semantic matches found in history for query: '${site}'`);
            return undefined;
        }

        debug(`Found ${matches.size} semantic matches for: '${site}'`);
        debug(matches);

        const candidates: { url: string; score: number; metadata: any }[] = [];
        const processedMessages = new Set<number>();

        matches.forEach((match: kp.SemanticRefSearchResult) => {
            match.semanticRefMatches.forEach(
                (refMatch: kp.ScoredSemanticRefOrdinal) => {
                    if (refMatch.score >= 0.3) {
                        // Lower threshold for broader matching
                        const semanticRef: kp.SemanticRef | undefined =
                            websiteCollection.semanticRefs.get(
                                refMatch.semanticRefOrdinal,
                            );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;
                            if (
                                messageOrdinal !== undefined &&
                                !processedMessages.has(messageOrdinal)
                            ) {
                                processedMessages.add(messageOrdinal);

                                const website =
                                    websiteCollection.messages.get(
                                        messageOrdinal,
                                    );
                                if (website && website.metadata) {
                                    const metadata = website.metadata;
                                    let totalScore = refMatch.score;

                                    // Apply additional scoring based on special patterns and recency
                                    totalScore += calculateWebsiteScore(
                                        [site],
                                        metadata,
                                    );

                                    candidates.push({
                                        url: metadata.url,
                                        score: totalScore,
                                        metadata: metadata,
                                    });
                                }
                            }
                        }
                    }
                },
            );
        });

        if (candidates.length === 0) {
            debug(`No qualifying candidates found for query: '${site}'`);
            return undefined;
        }

        // Sort by total score (highest first) and remove duplicates
        const uniqueCandidates = new Map<
            string,
            { url: string; score: number; metadata: any }
        >();
        candidates.forEach((candidate) => {
            const existing = uniqueCandidates.get(candidate.url);
            if (!existing || candidate.score > existing.score) {
                uniqueCandidates.set(candidate.url, candidate);
            }
        });

        const sortedCandidates = Array.from(uniqueCandidates.values()).sort(
            (a, b) => b.score - a.score,
        );

        const bestMatch = sortedCandidates[0];

        debug(
            `Found best match from history (score: ${bestMatch.score.toFixed(2)}): '${bestMatch.metadata.title || bestMatch.url}' -> ${bestMatch.url}`,
        );
        debug(
            `Match details: domain=${bestMatch.metadata.domain}, source=${bestMatch.metadata.websiteSource}`,
        );

        return bestMatch.url;
    } catch (error) {
        debug(`Error searching website history: ${error}`);
        return undefined;
    }
}

/**
 * Convert site query to knowpro search terms
 */
function siteQueryToSearchTerms(site: string): any[] {
    const terms: any[] = [];
    const siteQuery = site.toLowerCase().trim();

    // Add the main query as a search term
    terms.push({ term: { text: siteQuery } });

    // Add individual words if it's a multi-word query
    /*
    const words = siteQuery.split(/\s+/).filter((word) => word.length > 2);
    words.forEach((word) => {
        if (word !== siteQuery) {
            terms.push({ term: { text: word } });
        }
    });
*/

    return terms;
}

/**
 * Calculate additional scoring based on website metadata
 */
export function calculateWebsiteScore(
    searchFilters: string[],
    metadata: any,
): number {
    let score = 0;

    const title = metadata.title?.toLowerCase() || "";
    const domain = metadata.domain?.toLowerCase() || "";
    const url = metadata.url.toLowerCase();
    const folder = metadata.folder?.toLowerCase() || "";

    for (const filter of searchFilters) {
        const queryLower = filter.toLowerCase();

        // Direct domain matches get highest boost
        if (
            domain === queryLower ||
            domain === `www.${queryLower}` ||
            domain.endsWith(`.${queryLower}`)
        ) {
            score += 3.0;
        } else if (domain.includes(queryLower)) {
            score += 2.0;
        }

        if (title.includes(queryLower)) {
            score += 1.5;
        }

        if (url.includes(queryLower)) {
            score += 1.0;
        }

        if (
            metadata.websiteSource === "bookmark" &&
            folder.includes(queryLower)
        ) {
            score += 1.0;
        }

        // Recency bonus
        if (metadata.visitDate || metadata.bookmarkDate) {
            const visitDate = new Date(
                metadata.visitDate || metadata.bookmarkDate,
            );
            const daysSinceVisit =
                (Date.now() - visitDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceVisit < 7) score += 0.5;
            else if (daysSinceVisit < 30) score += 0.3;
        }

        // Frequency bonus
        if (metadata.visitCount && metadata.visitCount > 5) {
            score += Math.min(metadata.visitCount / 20, 0.5);
        }
    }

    return score;
}

/**
 * Find websites matching search criteria using knowpro search utilities
 */
export async function findRequestedWebsites(
    searchFilters: string[],
    context: BrowserActionContext,
    exactMatch: boolean = false,
    minScore: number = 0.5,
): Promise<website.Website[]> {
    if (
        !context.websiteCollection ||
        context.websiteCollection.messages.length === 0
    ) {
        return [];
    }

    try {
        const matches = await kp.searchConversationKnowledge(
            context.websiteCollection,
            // search group
            {
                booleanOp: "or", // Use OR to match any of the search filters
                terms: searchFiltersToSearchTerms(searchFilters),
            },
            // when filter
            {
                // No specific knowledge type filter - search across all types
            },
            // options
            {
                exactMatch: exactMatch,
            },
        );

        if (!matches || matches.size === 0) {
            debug(
                `No semantic matches found for search filters: ${searchFilters.join(", ")}`,
            );
            return [];
        }

        debug(
            `Found ${matches.size} semantic matches for search filters: ${searchFilters.join(", ")}`,
        );

        debug(matches);

        const results: { website: website.Website; score: number }[] = [];
        const processedMessages = new Set<number>();

        matches.forEach((match: kp.SemanticRefSearchResult) => {
            match.semanticRefMatches.forEach(
                (refMatch: kp.ScoredSemanticRefOrdinal) => {
                    if (refMatch.score >= minScore) {
                        const semanticRef: kp.SemanticRef | undefined =
                            context.websiteCollection!.semanticRefs.get(
                                refMatch.semanticRefOrdinal,
                            );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;
                            if (
                                messageOrdinal !== undefined &&
                                !processedMessages.has(messageOrdinal)
                            ) {
                                processedMessages.add(messageOrdinal);

                                const websiteData =
                                    context.websiteCollection!.messages.get(
                                        messageOrdinal,
                                    );
                                if (websiteData) {
                                    let totalScore = refMatch.score;

                                    // Apply additional scoring based on metadata matches
                                    totalScore += calculateWebsiteScore(
                                        searchFilters,
                                        websiteData.metadata,
                                    );

                                    results.push({
                                        website: websiteData,
                                        score: totalScore,
                                    });
                                }
                            }
                        }
                    }
                },
            );
        });

        // Sort by score (highest first) and remove duplicates
        const uniqueResults = new Map<
            string,
            { website: website.Website; score: number }
        >();
        results.forEach((result) => {
            const url = result.website.metadata.url;
            const existing = uniqueResults.get(url);
            if (!existing || result.score > existing.score) {
                uniqueResults.set(url, result);
            }
        });

        const sortedResults = Array.from(uniqueResults.values()).sort(
            (a, b) => b.score - a.score,
        );

        debug(
            `Filtered to ${sortedResults.length} unique websites after scoring`,
        );

        debug(sortedResults);

        return sortedResults.map((r) => r.website);
    } catch (error) {
        debug(`Error in semantic website search: ${error}`);
        // Fallback to empty results
        return [];
    }
}

/**
 * Convert search filters to knowpro search terms
 */
function searchFiltersToSearchTerms(filters: string[]): any[] {
    const terms: any[] = [];

    filters.forEach((filter) => {
        // Add the main filter as a search term
        terms.push({ term: { text: filter } });

        // Add individual words if it's a multi-word filter
        /*
        const words = filter
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);
        words.forEach((word) => {
            if (word !== filter.toLowerCase()) {
                terms.push({ term: { text: word } });
            }
        });
        */
    });

    return terms;
}

/**
 * Import website data from browser history or bookmarks
 */
export async function importWebsiteData(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<ImportWebsiteData>,
) {
    try {
        context.actionIO.setDisplay("Importing website data...");

        const { source, type, limit, days, folder } = action.parameters;
        const defaultPaths = website.getDefaultBrowserPaths();

        let filePath: string;
        if (source === "chrome") {
            filePath =
                type === "bookmarks"
                    ? defaultPaths.chrome.bookmarks
                    : defaultPaths.chrome.history;
        } else {
            filePath =
                type === "bookmarks"
                    ? defaultPaths.edge.bookmarks
                    : defaultPaths.edge.history;
        }

        const progressCallback = (
            current: number,
            total: number,
            item: string,
        ) => {
            if (current % 100 === 0) {
                // Update every 100 items
                context.actionIO.setDisplay(
                    `Importing... ${current}/${total}: ${item.substring(0, 50)}...`,
                );
            }
        };

        // Build options object with only defined values
        const importOptions: any = {};
        if (limit !== undefined) importOptions.limit = limit;
        if (days !== undefined) importOptions.days = days;
        if (folder !== undefined) importOptions.folder = folder;

        const websites = await website.importWebsites(
            source,
            type,
            filePath,
            importOptions,
            progressCallback,
        );

        if (!context.sessionContext.agentContext.websiteCollection) {
            context.sessionContext.agentContext.websiteCollection =
                new website.WebsiteCollection();
        }

        context.sessionContext.agentContext.websiteCollection.addWebsites(
            websites,
        );
        await context.sessionContext.agentContext.websiteCollection.buildIndex();

        // Persist the website collection to disk
        try {
            if (context.sessionContext.agentContext.index?.path) {
                await context.sessionContext.agentContext.websiteCollection.writeToFile(
                    context.sessionContext.agentContext.index.path,
                    "index",
                );
                debug(
                    `Saved website collection to ${context.sessionContext.agentContext.index.path}`,
                );
            } else {
                debug("No index path available, website data not persisted");
            }
        } catch (error) {
            debug(`Failed to save website collection: ${error}`);
        }

        const result = createActionResult(
            `Successfully imported ${websites.length} ${type} from ${source}.`,
        );
        return result;
    } catch (error: any) {
        return createActionResult(
            `Failed to import website data: ${error.message}`,
            true,
        );
    }
}

/**
 * Search through imported website data
 */
export async function searchWebsites(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<SearchWebsites>,
) {
    try {
        const websiteCollection =
            context.sessionContext.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createActionResult(
                "No website data available. Please import website data first.",
                true,
            );
        }

        context.actionIO.setDisplay("Searching websites...");

        const {
            originalUserRequest,
            //query,
            domain,
            pageType,
            source,
            limit = 10,
            minScore = 0.5,
        } = action.parameters;

        // Build search filters
        const searchFilters = [originalUserRequest];
        if (domain) searchFilters.push(domain);
        if (pageType) searchFilters.push(pageType);

        // Use the improved search function
        let matchedWebsites = await findRequestedWebsites(
            searchFilters,
            context.sessionContext.agentContext,
            false,
            minScore,
        );

        // Apply additional filters
        if (source) {
            matchedWebsites = matchedWebsites.filter(
                (site) => site.metadata.websiteSource === source,
            );
        }

        // Limit results
        matchedWebsites = matchedWebsites.slice(0, limit);

        if (matchedWebsites.length === 0) {
            return createActionResult(
                "No websites found matching the search criteria.",
            );
        }

        const resultText = matchedWebsites
            .map((site, i) => {
                const metadata = site.metadata;
                return `${i + 1}. ${metadata.title || metadata.url}\n   URL: ${metadata.url}\n   Domain: ${metadata.domain} | Type: ${metadata.pageType} | Source: ${metadata.websiteSource}\n`;
            })
            .join("\n");

        return createActionResult(
            `Found ${matchedWebsites.length} websites:\n\n${resultText}`,
        );
    } catch (error: any) {
        return createActionResult(
            `Failed to search websites: ${error.message}`,
            true,
        );
    }
}

/**
 * Get statistics about imported website data
 */
export async function getWebsiteStats(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<GetWebsiteStats>,
) {
    try {
        const websiteCollection =
            context.sessionContext.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createActionResult(
                "No website data available. Please import website data first.",
                true,
            );
        }

        const { groupBy = "domain", limit = 10 } = action.parameters || {};
        const websites = websiteCollection.messages.getAll();

        let stats: { [key: string]: number } = {};
        let totalCount = websites.length;

        for (const site of websites) {
            const metadata = site.metadata;
            let key: string;

            switch (groupBy) {
                case "domain":
                    key = metadata.domain || "unknown";
                    break;
                case "pageType":
                    key = metadata.pageType || "general";
                    break;
                case "source":
                    key = metadata.websiteSource;
                    break;
                default:
                    key = metadata.domain || "unknown";
            }

            stats[key] = (stats[key] || 0) + 1;
        }

        // Sort by count and limit
        const sortedStats = Object.entries(stats)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit);

        let resultText = `Website Statistics (Total: ${totalCount} sites)\n\n`;
        resultText += `Top ${groupBy}s:\n`;

        for (const [key, count] of sortedStats) {
            const percentage = ((count / totalCount) * 100).toFixed(1);
            resultText += `  ${key}: ${count} sites (${percentage}%)\n`;
        }

        // Add some additional stats
        if (groupBy !== "source") {
            const sourceCounts = { bookmark: 0, history: 0, reading_list: 0 };
            for (const site of websites) {
                sourceCounts[site.metadata.websiteSource]++;
            }
            resultText += `\nBy Source:\n`;
            for (const [source, count] of Object.entries(sourceCounts)) {
                if (count > 0) {
                    const percentage = ((count / totalCount) * 100).toFixed(1);
                    resultText += `  ${source}: ${count} sites (${percentage}%)\n`;
                }
            }
        }

        return createActionResult(resultText);
    } catch (error: any) {
        return createActionResult(
            `Failed to get website stats: ${error.message}`,
            true,
        );
    }
}
