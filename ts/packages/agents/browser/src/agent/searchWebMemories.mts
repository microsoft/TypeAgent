// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActions.mjs";
import * as website from "website-memory";
import * as kp from "knowpro";
import registerDebug from "debug";
import {
    Entity,
    WebPageReference,
} from "./knowledge/schema/knowledgeExtraction.mjs";
import { getWebsiteSearchPromptPreamble } from "./search/websiteSearchPrompts.mjs";
import { openai as ai } from "aiclient";
import type { TypeChatLanguageModel } from "typechat";

const debug = registerDebug("typeagent:browser:unified-search");

// Core interfaces for unified search
export interface SearchWebMemoriesRequest {
    originalUserRequest?: string | undefined;
    query: string;
    searchScope?: "current_page" | "all_indexed" | undefined;

    // Temporal filters
    dateFrom?: string | undefined;
    dateTo?: string | undefined;

    // Search configuration
    limit?: number | undefined;
    minScore?: number | undefined;
    exactMatch?: boolean | undefined;

    // Processing options (consumer controls cost)
    generateAnswer?: boolean | undefined; // Default: true
    includeRelatedEntities?: boolean | undefined; // Default: true
    enableAdvancedSearch?: boolean | undefined; // Use advanced patterns

    // Advanced options
    knowledgeTopK?: number | undefined;
    chunking?: boolean | undefined;
    fastStop?: boolean | undefined;
    combineAnswers?: boolean | undefined;
    choices?: string | undefined; // Multiple choice (semicolon separated)
    maxCharsInBudget?: number | undefined; // Character budget for context windows
    debug?: boolean | undefined;

    // Internal metadata for query enhancement
    metadata?: any;
}

export interface SearchSummary {
    totalFound: number;
    searchTime: number;
    strategies: string[];
    confidence: number;
}

export interface SearchDebugContext {
    searchTerms: string[];
    searchStrategies: string[];
    knowledgeMatchCount: number;
    timing: {
        parsing: number;
        search: number;
        processing: number;
        total: number;
    };
    intermediateFallbacks: string[];
}

export interface WebsiteResult {
    url: string;
    title: string;
    domain: string;
    pageType: string;
    source: string;
    relevanceScore: number;
    lastVisited?: string | undefined;
    snippet?: string;
}

export interface SearchWebMemoriesResponse {
    // Core results - always provided
    websites: WebsiteResult[];
    summary: SearchSummary;

    // Q&A results - when generateAnswer=true
    answer?: string | undefined;
    answerType?: "direct" | "synthesized" | "noAnswer" | undefined;
    answerSources?: WebPageReference[] | undefined;
    confidence?: number | undefined;

    // Knowledge results - when includeRelatedEntities=true
    relatedEntities?: Entity[] | undefined;
    topTopics?: string[] | undefined;

    // Query understanding
    queryIntent?: "question" | "discovery" | "mixed" | undefined;
    searchTerms?: string[] | undefined;
    suggestedFollowups?: string[] | undefined;

    // Debug info - when debug=true
    debugContext?: SearchDebugContext | undefined;
}

interface PropertyFilter {
    domain?: string;
    pageType?: string;
    source?: string;
}

interface ParsedQuery {
    searchText: string;
    propertyFilters: PropertyFilter;
}

function parsePropertySearch(query: string): ParsedQuery {
    const propertyFilters: PropertyFilter = {};
    let searchText = query;

    const domainMatch = query.match(/\bdomain:(\S+)/);
    if (domainMatch) {
        propertyFilters.domain = domainMatch[1];
        searchText = searchText.replace(domainMatch[0], "").trim();
    }

    const pageTypeMatch = query.match(/\bpageType:(\S+)/);
    if (pageTypeMatch) {
        propertyFilters.pageType = pageTypeMatch[1];
        searchText = searchText.replace(pageTypeMatch[0], "").trim();
    }

    const sourceMatch = query.match(/\bsource:(\S+)/);
    if (sourceMatch) {
        propertyFilters.source = sourceMatch[1];
        searchText = searchText.replace(sourceMatch[0], "").trim();
    }

    return { searchText, propertyFilters };
}

function convertSearchResultsToWebsites(
    results: kp.ConversationSearchResult[],
    websiteCollection: website.WebsiteCollection,
): website.Website[] {
    const websites: website.Website[] = [];
    const seenUrls = new Set<string>();

    for (const result of results) {
        for (const msgMatch of result.messageMatches) {
            const msg = websiteCollection.messages.get(msgMatch.messageOrdinal);
            if (msg && msg.metadata) {
                const url = (msg.metadata as any).url;
                if (url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    websites.push(msg as unknown as website.Website);
                }
            }
        }
    }

    return websites;
}

/**
 * Unified website search function that replaces both queryWebKnowledge and searchWebsites
 * while incorporating advanced search capabilities
 */
export async function searchWebMemories(
    request: SearchWebMemoriesRequest,
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const startTime = Date.now();
    let timing = {
        parsing: 0,
        search: 0,
        processing: 0,
        total: 0,
    };

    const debugContext: SearchDebugContext = {
        searchTerms: [],
        searchStrategies: [],
        knowledgeMatchCount: 0,
        timing,
        intermediateFallbacks: [],
    };

    try {
        // Validate inputs
        if (!request.query || request.query.trim().length === 0) {
            throw new Error("Query cannot be empty");
        }

        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createEmptyResponse(
                "No website data available. Please import website data first using the library panel.",
                startTime,
                request.debug ? debugContext : undefined,
            );
        }

        debug(`Starting unified search for query: "${request.query}"`);

        // Parse property filters from query (website-specific)
        const { searchText, propertyFilters } = parsePropertySearch(
            request.query,
        );
        if (searchText !== request.query) {
            debug(`Property filters detected:`, propertyFilters);
            debug(`Search text after filter extraction: "${searchText}"`);
        }

        // PHASE 1: Use knowpro's natural language search
        const parseStart = Date.now();

        const model = ai.createChatModel(
            ai.azureApiSettingsFromEnv(ai.ModelType.Chat),
        ) as TypeChatLanguageModel;
        const queryTranslator = kp.createSearchQueryTranslator(model);

        const langOptions = kp.createLanguageSearchOptions();
        langOptions.modelInstructions =
            getWebsiteSearchPromptPreamble(websiteCollection);
        if (request.limit) {
            langOptions.maxKnowledgeMatches = request.limit;
            langOptions.maxMessageMatches = request.limit;
        }
        if (request.minScore) {
            langOptions.thresholdScore = request.minScore;
        }
        if (request.maxCharsInBudget) {
            langOptions.maxCharsInBudget = request.maxCharsInBudget;
        }

        langOptions.fallbackRagOptions = {
            maxMessageMatches: request.limit || 10,
            maxCharsInBudget: request.maxCharsInBudget || 10000,
            thresholdScore: request.minScore || 0.7,
        };

        timing.parsing = Date.now() - parseStart;

        const searchStart = Date.now();
        const langDebugContext: kp.LanguageSearchDebugContext = {};
        const langResult = await kp.searchConversationWithLanguage(
            websiteCollection,
            searchText,
            queryTranslator,
            langOptions,
            undefined,
            request.debug ? langDebugContext : undefined,
        );

        if (!langResult.success) {
            return createErrorResponse(
                `Search query translation failed: ${langResult.message}`,
                startTime,
                request.debug ? debugContext : undefined,
            );
        }

        timing.search = Date.now() - searchStart;
        debug(`Found ${langResult.data.length} conversation results`);

        if (langDebugContext.usedSimilarityFallback) {
            const usedFallback = langDebugContext.usedSimilarityFallback.some(
                (v) => v === true,
            );
            if (usedFallback) {
                debug(
                    `Embedding similarity fallback was used for some queries`,
                );
                debugContext.searchStrategies.push("embedding-fallback");
            }
        }

        // Convert ConversationSearchResult to Website[]
        const processingStart = Date.now();
        let websites = convertSearchResultsToWebsites(
            langResult.data,
            websiteCollection,
        );

        // Apply property filters (website-specific post-processing)
        if (Object.keys(propertyFilters).length > 0) {
            debug(`Applying property filters:`, propertyFilters);
            websites = websites.filter((website) => {
                if (
                    propertyFilters.domain &&
                    website.metadata.domain !== propertyFilters.domain
                ) {
                    return false;
                }
                if (
                    propertyFilters.pageType &&
                    website.metadata.pageType !== propertyFilters.pageType
                ) {
                    return false;
                }
                if (
                    propertyFilters.source &&
                    website.metadata.websiteSource !== propertyFilters.source
                ) {
                    return false;
                }
                return true;
            });
            debug(`After property filtering: ${websites.length} results`);
        }

        // Apply limit
        const limitedWebsites = websites.slice(0, request.limit || 20);

        // Convert to website results format
        const websiteResults = convertToWebsiteResults(limitedWebsites);

        // Extract knowledge if requested
        let relatedEntities: Entity[] | undefined;
        let topTopics: string[] | undefined;

        if (
            request.includeRelatedEntities !== false &&
            limitedWebsites.length > 0
        ) {
            const knowledgeResult =
                await extractKnowledgeFromResults(limitedWebsites);
            relatedEntities = knowledgeResult.entities;
            topTopics = knowledgeResult.topics;
        }

        // Generate answer if requested
        let answer: string | undefined;
        let answerType: "direct" | "synthesized" | "noAnswer" | undefined;
        let answerSources: WebPageReference[] | undefined;
        let confidence: number | undefined;

        if (request.generateAnswer !== false && langResult.data.length > 0) {
            const answerStart = Date.now();
            debug(`Generating answer for query: "${searchText}"`);

            try {
                const answerGenerator = new kp.AnswerGenerator(
                    kp.createAnswerGeneratorSettings(),
                );

                const contextOptions: kp.AnswerContextOptions = {
                    entitiesTopK: request.knowledgeTopK || 20,
                    topicsTopK: request.knowledgeTopK || 20,
                    messagesTopK: request.limit || 20,
                    chunking: request.chunking ?? true,
                };

                const answerResult = await kp.generateAnswer(
                    websiteCollection,
                    answerGenerator,
                    searchText,
                    langResult.data,
                    undefined,
                    contextOptions,
                );

                if (answerResult.success) {
                    const answerResponse = answerResult.data;

                    if (answerResponse.type === "Answered") {
                        answer = answerResponse.answer;
                        answerType = "synthesized";
                        confidence = 0.8;

                        answerSources = limitedWebsites
                            .slice(0, 5)
                            .map((site, index) => ({
                                url: site.metadata.url,
                                title: site.metadata.title || "",
                                relevanceScore: 1.0 - index * 0.1,
                                lastIndexed:
                                    site.metadata.lastVisitTime ||
                                    new Date().toISOString(),
                            }));

                        debug(
                            `Generated answer (${answer!.length} chars) in ${Date.now() - answerStart}ms`,
                        );
                    } else {
                        answerType = "noAnswer";
                        debug(
                            `No answer generated: ${answerResponse.whyNoAnswer}`,
                        );
                    }
                } else {
                    debug(`Answer generation failed: ${answerResult.message}`);
                }
            } catch (error) {
                debug(`Answer generation error: ${error}`);
            }
        }

        timing.processing = Date.now() - processingStart;
        timing.total = Date.now() - startTime;

        // Update debug context
        debugContext.knowledgeMatchCount = limitedWebsites.length;
        debugContext.timing = timing;
        debugContext.searchStrategies.push("knowpro-language-search");

        // Build response
        const response: SearchWebMemoriesResponse = {
            websites: websiteResults,
            summary: {
                totalFound: websites.length,
                searchTime: timing.total,
                strategies: debugContext.searchStrategies,
                confidence: 0.8,
            },
            queryIntent: "discovery",
            searchTerms: [searchText],
            suggestedFollowups: [],
        };

        // Add answer fields if generated
        if (answer !== undefined) {
            response.answer = answer;
            response.answerType = answerType;
            response.answerSources = answerSources;
            response.confidence = confidence;
        }

        if (relatedEntities !== undefined) {
            response.relatedEntities = relatedEntities || undefined;
            response.topTopics = topTopics || undefined;
        }

        if (request.debug) {
            response.debugContext = debugContext;
        }

        debug(
            `Search completed in ${timing.total}ms with ${websiteResults.length} results`,
        );
        return response;
    } catch (error) {
        timing.total = Date.now() - startTime;
        debug(`Search failed: ${error}`);

        return createErrorResponse(
            error instanceof Error ? error.message : "Unknown search error",
            startTime,
            request.debug ? debugContext : undefined,
        );
    }
}

// OLD SEARCH FUNCTIONS - REMOVED (replaced by knowpro searchConversationWithLanguage)
// - performComprehensiveSearch
// - performAdvancedSearch
// - performHybridSearch
// - performBasicSemanticSearch
// - isSingleTermQuery
// - hasCapitalizedTerms
// - buildEnhancedWhenFilter

// RESTORED: Direct entity/topic search helpers for entity graph view
// These call knowpro APIs directly for fast, deterministic lookups

async function performEntitySearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Attempting entity search for: "${request.query}"`);

        const entityType = request.metadata?.entityType;
        const facetName = request.metadata?.facetName;
        const facetValue = request.metadata?.facetValue;

        const entityResults = await websiteCollection.searchByEntities(
            [request.query],
            entityType,
            facetName,
            facetValue,
        );

        debug(`Found ${entityResults.length} results using entity search`);

        const websites = entityResults.map((result) => result.toWebsite());
        const deduplicatedWebsites = deduplicateByUrl(websites);

        debug(
            `Entity search: ${websites.length} results (${deduplicatedWebsites.length} after deduplication)`,
        );

        return deduplicatedWebsites.slice(0, request.limit || 20);
    } catch (error) {
        debug(`Entity search failed: ${error}`);
        return [];
    }
}

async function performTopicSearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Attempting topic search for: "${request.query}"`);

        const whenFilter =
            request.dateFrom || request.dateTo
                ? {
                      dateRange: {
                          start: request.dateFrom
                              ? new Date(request.dateFrom)
                              : new Date(0),
                          end: request.dateTo
                              ? new Date(request.dateTo)
                              : new Date(),
                      },
                  }
                : undefined;

        const searchOptions = {
            maxKnowledgeMatches: request.limit || 20,
            exactMatch: request.exactMatch || false,
        };

        const topicResults = await websiteCollection.searchByTopics(
            [request.query],
            whenFilter,
            searchOptions,
        );

        debug(`Found ${topicResults.length} results using topic search`);

        const websites = topicResults.map((result) => result.toWebsite());
        const deduplicatedWebsites = deduplicateByUrl(websites);

        debug(
            `Topic search: ${websites.length} results (${deduplicatedWebsites.length} after deduplication)`,
        );

        return deduplicatedWebsites.slice(0, request.limit || 20);
    } catch (error) {
        debug(`Topic search failed: ${error}`);
        return [];
    }
}

function deduplicateByUrl(websites: website.Website[]): website.Website[] {
    const seenUrls = new Set<string>();
    const deduplicated: website.Website[] = [];

    for (const site of websites) {
        const metadata = site.metadata as any;
        const url = metadata?.url;

        if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            deduplicated.push(site);
        } else if (!url) {
            deduplicated.push(site);
        }
    }

    return deduplicated;
}

// Helper functions

function convertToWebsiteResults(websites: website.Website[]): WebsiteResult[] {
    return websites.map((site) => {
        const metadata = site.metadata as any;
        return {
            url: metadata.url,
            title: metadata.title || metadata.url,
            domain: metadata.domain || "unknown",
            pageType: metadata.pageType || "general",
            source: metadata.websiteSource || "unknown",
            relevanceScore: 0.8, // Could be enhanced with actual scoring
            lastVisited:
                metadata.visitDate || metadata.bookmarkDate || undefined,
            snippet: extractSnippet(site),
        };
    });
}

function extractSnippet(website: website.Website): string {
    const textContent = website.textChunks?.join(" ") || "";
    return (
        textContent.substring(0, 200) + (textContent.length > 200 ? "..." : "")
    );
}

async function extractKnowledgeFromResults(
    results: website.Website[],
): Promise<{ entities: Entity[]; topics: string[] }> {
    // Entity aggregation with count tracking
    const entityMap = new Map<
        string,
        {
            entity: any;
            count: number;
            totalConfidence: number;
            sites: string[];
        }
    >();

    // Topic aggregation with count tracking
    const topicMap = new Map<
        string,
        {
            topic: string;
            count: number;
            sites: string[];
        }
    >();

    // Process all sites (not just first 3)
    for (const site of results) {
        const knowledge = site.getKnowledge();
        const siteUrl = (site as any).url || "unknown";

        // Process ALL entities from this site (not just first n)
        if (knowledge?.entities) {
            for (const entity of knowledge.entities) {
                if (!entity.name) continue;

                const entityNameLower = entity.name.toLowerCase();

                if (entityMap.has(entityNameLower)) {
                    // Entity already exists - increment count and update confidence
                    const existing = entityMap.get(entityNameLower)!;
                    existing.count += 1;
                    existing.totalConfidence +=
                        (entity as any).confidence || 0.7;
                    existing.sites.push(siteUrl);

                    // Update entity data if current entity has facets and existing doesn't
                    if ((entity as any).facets && !existing.entity.facets) {
                        existing.entity.facets = (entity as any).facets;
                    }
                } else {
                    // New entity - create entry
                    const extractedEntity: any = {
                        name: entity.name,
                        type: Array.isArray(entity.type)
                            ? entity.type.join(", ")
                            : entity.type,
                        confidence: (entity as any).confidence || 0.7,
                    };

                    // Add description if available from facets
                    if ((entity as any).facets) {
                        const facets = (entity as any).facets;
                        const descriptionFacet = facets.find(
                            (f: any) => f.name === "description",
                        );
                        if (descriptionFacet) {
                            extractedEntity.description =
                                descriptionFacet.value;
                        }

                        // Add facets array to the entity
                        extractedEntity.facets = facets.map((facet: any) => ({
                            name: facet.name || facet.category || "Unknown",
                            value: Array.isArray(facet.value)
                                ? facet.value.join(", ")
                                : facet.value ||
                                  (facet.values ? facet.values.join(", ") : ""),
                        }));
                    }

                    entityMap.set(entityNameLower, {
                        entity: extractedEntity,
                        count: 1,
                        totalConfidence: extractedEntity.confidence,
                        sites: [siteUrl],
                    });
                }
            }
        }

        // Process ALL topics from this site
        if (knowledge?.topics) {
            for (const topic of knowledge.topics) {
                const topicName =
                    typeof topic === "string"
                        ? topic
                        : (topic as any).name || (topic as any).topic || topic;
                if (!topicName) continue;

                const topicNameLower = topicName.toLowerCase();

                if (topicMap.has(topicNameLower)) {
                    // Topic already exists - increment count
                    const existing = topicMap.get(topicNameLower)!;
                    existing.count += 1;
                    existing.sites.push(siteUrl);
                } else {
                    // New topic - create entry
                    topicMap.set(topicNameLower, {
                        topic: topicName,
                        count: 1,
                        sites: [siteUrl],
                    });
                }
            }
        }
    }

    // Sort entities by count (descending) and take top 10
    const sortedEntities = Array.from(entityMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((entry) => {
            // Update confidence to average across all occurrences
            entry.entity.confidence = entry.totalConfidence / entry.count;
            // Add occurrence count metadata
            entry.entity.occurrenceCount = entry.count;
            entry.entity.sourceSites = entry.sites.length;
            return entry.entity;
        });

    // Sort topics by count (descending) and take top 10
    const sortedTopics = Array.from(topicMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((entry) => entry.topic);

    return {
        entities: sortedEntities,
        topics: sortedTopics,
    };
}

function createEmptyResponse(
    message: string,
    startTime: number,
    debugContext?: SearchDebugContext | undefined,
): SearchWebMemoriesResponse {
    return {
        websites: [],
        summary: {
            totalFound: 0,
            searchTime: Date.now() - startTime,
            strategies: [],
            confidence: 0,
        },
        answer: message,
        answerType: "noAnswer",
        answerSources: [],
        queryIntent: "discovery",
        suggestedFollowups: [],
        debugContext: debugContext || undefined,
    };
}

function createErrorResponse(
    error: string,
    startTime: number,
    debugContext?: SearchDebugContext | undefined,
): SearchWebMemoriesResponse {
    return {
        websites: [],
        summary: {
            totalFound: 0,
            searchTime: Date.now() - startTime,
            strategies: [],
            confidence: 0,
        },
        answer: `Error occurred during search: ${error}`,
        answerType: "noAnswer",
        answerSources: [],
        queryIntent: "discovery",
        suggestedFollowups: [],
        debugContext: debugContext || undefined,
    };
}

// Entity-based search function - Uses direct entity search for fast, deterministic lookups
export async function searchByEntities(
    request: {
        entities: string[];
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const startTime = Date.now();
    debug(
        `Starting entity search for entities: ${request.entities.join(", ")}`,
    );

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for entity search",
                startTime,
            );
        }

        const searchRequest: SearchWebMemoriesRequest = {
            query: request.entities.join(" OR "),
            searchScope: request.searchScope || "all_indexed",
            limit: request.maxResults || 10,
            generateAnswer: false,
            includeRelatedEntities: true,
            exactMatch: false,
            minScore: 0.3,
        };

        // Use direct entity search (calls knowpro searchByEntities)
        const websites = await performEntitySearch(
            searchRequest,
            websiteCollection,
        );

        if (!websites || websites.length === 0) {
            debug(
                `No results found for entities: ${request.entities.join(", ")}`,
            );
            return createEmptyResponse(
                `No websites found containing entities: ${request.entities.join(", ")}`,
                startTime,
            );
        }

        debug(
            `Entity search found ${websites.length} results for entities: ${request.entities.join(", ")}`,
        );

        const websiteResults = convertToWebsiteResults(websites);
        const { entities, topics } =
            await extractKnowledgeFromResults(websites);

        return {
            websites: websiteResults,
            summary: {
                totalFound: websiteResults.length,
                searchTime: Date.now() - startTime,
                strategies: ["entity-direct"],
                confidence: websiteResults.length > 0 ? 0.9 : 0,
            },
            answer:
                websiteResults.length > 0
                    ? `Found ${websiteResults.length} websites containing the requested entities.`
                    : `No websites found containing entities: ${request.entities.join(", ")}`,
            answerType: websiteResults.length > 0 ? "direct" : "noAnswer",
            answerSources: [],
            queryIntent: "discovery",
            relatedEntities: entities,
            suggestedFollowups: [],
            topTopics: topics,
        };
    } catch (error) {
        console.error("Error in entity search:", error);
        return createErrorResponse(
            error instanceof Error ? error.message : "Entity search failed",
            startTime,
        );
    }
}

// Topic-based search function - Uses direct topic search for fast, deterministic lookups
export async function searchByTopics(
    request: {
        topics: string[];
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const startTime = Date.now();
    debug(`Starting topic search for topics: ${request.topics.join(", ")}`);

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for topic search",
                startTime,
            );
        }

        const searchRequest: SearchWebMemoriesRequest = {
            query: request.topics.join(" OR "),
            searchScope: request.searchScope || "all_indexed",
            limit: request.maxResults || 10,
            generateAnswer: false,
            includeRelatedEntities: true,
            exactMatch: false,
            minScore: 0.25,
        };

        // Use direct topic search (calls knowpro searchByTopics)
        const websites = await performTopicSearch(
            searchRequest,
            websiteCollection,
        );

        if (!websites || websites.length === 0) {
            debug(`No results found for topics: ${request.topics.join(", ")}`);
            return createEmptyResponse(
                `No websites found containing topics: ${request.topics.join(", ")}`,
                startTime,
            );
        }

        debug(
            `Topic search found ${websites.length} results for topics: ${request.topics.join(", ")}`,
        );

        const websiteResults = convertToWebsiteResults(websites);
        const { entities, topics } =
            await extractKnowledgeFromResults(websites);

        return {
            websites: websiteResults,
            summary: {
                totalFound: websiteResults.length,
                searchTime: Date.now() - startTime,
                strategies: ["topic-direct"],
                confidence: websiteResults.length > 0 ? 0.9 : 0,
            },
            answer:
                websiteResults.length > 0
                    ? `Found ${websiteResults.length} websites containing the requested topics.`
                    : `No websites found containing topics: ${request.topics.join(", ")}`,
            answerType: websiteResults.length > 0 ? "direct" : "noAnswer",
            answerSources: [],
            queryIntent: "discovery",
            relatedEntities: entities,
            suggestedFollowups: [],
            topTopics: topics,
        };
    } catch (error) {
        console.error("Error in topic search:", error);
        return createErrorResponse(
            error instanceof Error ? error.message : "Topic search failed",
            startTime,
        );
    }
}

// Hybrid search function - combines multiple strategies
export async function hybridSearch(
    request: {
        query: string;
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
        combineStrategies?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const startTime = Date.now();
    debug(`Starting hybrid search for query: ${request.query}`);

    try {
        // Extract potential entities and topics from query
        const queryWords = request.query
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);
        const potentialEntities = queryWords.filter((word) =>
            /^[A-Z]/.test(
                request.query
                    .split(" ")
                    .find((w) => w.toLowerCase() === word) || "",
            ),
        );
        const potentialTopics = queryWords;

        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for hybrid search",
                startTime,
            );
        }

        // Run multiple search strategies in parallel using direct methods
        const [textSearchPromise, entitySearchPromise, topicSearchPromise] = [
            // Standard text search
            searchWebMemories(
                {
                    query: request.query,
                    searchScope: request.searchScope || "all_indexed",
                    limit: Math.ceil((request.maxResults || 10) * 0.6),
                    generateAnswer: true,
                    includeRelatedEntities: true,
                    enableAdvancedSearch: true,
                    minScore: 0.4,
                },
                context,
            ),

            // Direct entity-based search if we detected potential entities
            potentialEntities.length > 0
                ? (async () => {
                      try {
                          const entityResults =
                              await websiteCollection.searchByEntities(
                                  potentialEntities,
                              );
                          return entityResults
                              ? {
                                    websites: convertToWebsiteResults(
                                        entityResults
                                            .map((r) => r.toWebsite())
                                            .slice(
                                                0,
                                                Math.ceil(
                                                    (request.maxResults || 10) *
                                                        0.3,
                                                ),
                                            ),
                                    ),
                                    summary: { strategies: ["entity-direct"] },
                                }
                              : null;
                      } catch (error) {
                          debug("Entity search failed in hybrid:", error);
                          return null;
                      }
                  })()
                : Promise.resolve(null),

            // Direct topic-based search
            potentialTopics.length > 0
                ? (async () => {
                      try {
                          const topicResults =
                              await websiteCollection.searchByTopics(
                                  potentialTopics.slice(0, 3),
                              );
                          return topicResults
                              ? {
                                    websites: convertToWebsiteResults(
                                        topicResults
                                            .map((r) => r.toWebsite())
                                            .slice(
                                                0,
                                                Math.ceil(
                                                    (request.maxResults || 10) *
                                                        0.3,
                                                ),
                                            ),
                                    ),
                                    summary: { strategies: ["topic-direct"] },
                                }
                              : null;
                      } catch (error) {
                          debug("Topic search failed in hybrid:", error);
                          return null;
                      }
                  })()
                : Promise.resolve(null),
        ];

        const [textResult, entityResult, topicResult] = await Promise.all([
            textSearchPromise,
            entitySearchPromise,
            topicSearchPromise,
        ]);

        // Combine and deduplicate results
        const allWebsites = new Map<string, WebsiteResult>();
        const strategies = ["hybrid"];

        // Add text search results (highest priority)
        textResult.websites.forEach((website) => {
            allWebsites.set(website.url, {
                ...website,
                relevanceScore: website.relevanceScore * 1.0, // Full weight
            });
        });
        strategies.push(...textResult.summary.strategies);

        // Add entity search results (medium priority)
        if (entityResult && entityResult.websites) {
            entityResult.websites.forEach((website) => {
                const existing = allWebsites.get(website.url);
                if (existing) {
                    // Boost score for multi-strategy matches
                    existing.relevanceScore = Math.min(
                        1.0,
                        existing.relevanceScore + 0.2,
                    );
                } else {
                    allWebsites.set(website.url, {
                        ...website,
                        relevanceScore: website.relevanceScore * 0.8, // Slightly lower weight
                    });
                }
            });
            if (entityResult.summary && entityResult.summary.strategies) {
                strategies.push(...entityResult.summary.strategies);
            }
        }

        // Add topic search results (lower priority)
        if (topicResult && topicResult.websites) {
            topicResult.websites.forEach((website) => {
                const existing = allWebsites.get(website.url);
                if (existing) {
                    // Boost score for multi-strategy matches
                    existing.relevanceScore = Math.min(
                        1.0,
                        existing.relevanceScore + 0.15,
                    );
                } else {
                    allWebsites.set(website.url, {
                        ...website,
                        relevanceScore: website.relevanceScore * 0.7, // Lower weight
                    });
                }
            });
            if (topicResult.summary && topicResult.summary.strategies) {
                strategies.push(...topicResult.summary.strategies);
            }
        }

        // Sort by combined relevance score and limit results
        const combinedWebsites = Array.from(allWebsites.values())
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, request.maxResults || 10);

        debug(
            `Hybrid search completed: ${combinedWebsites.length} results from ${strategies.length} strategies`,
        );

        // Use the best answer from text search, as it's most likely to be relevant
        const finalAnswer =
            textResult.answer ||
            "Results found from multiple search strategies.";
        const finalSources = textResult.answerSources || [];

        return {
            websites: combinedWebsites,
            summary: {
                totalFound: combinedWebsites.length,
                searchTime: Date.now() - startTime,
                strategies: Array.from(new Set(strategies)),
                confidence: Math.min(
                    1.0,
                    combinedWebsites.length > 0 ? 0.8 : 0.2,
                ),
            },
            answer: finalAnswer,
            answerType: textResult.answerType || "synthesized",
            answerSources: finalSources,
            queryIntent: textResult.queryIntent || "discovery",
            relatedEntities: textResult.relatedEntities || [],
            suggestedFollowups: textResult.suggestedFollowups || [],
            topTopics: textResult.topTopics || [],
        };
    } catch (error) {
        console.error("Error in hybridSearch:", error);
        return createErrorResponse(
            error instanceof Error ? error.message : "Hybrid search failed",
            startTime,
        );
    }
}
export function generateWebSearchHtml(
    searchResponse: SearchWebMemoriesResponse,
    summary: string,
): string {
    let html = `<div class='web-search-results'>`;

    // Add summary header
    html += `<div class='search-summary'>${summary}</div>`;

    // Add answer if available
    if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
        html += `<div class='search-answer'>
            <div class='answer-header'>Answer:</div>
            <div class='answer-content'>${searchResponse.answer}</div>
        </div>`;
    }

    // Add main results as ordered list
    if (searchResponse.websites.length > 0) {
        html += `<div class='search-results-header'>Search Results:</div>`;
        html += `<ol class='search-results-list'>`;

        const topResults = searchResponse.websites.slice(0, 10);
        topResults.forEach((site: any, index: number) => {
            html += `<li class='search-result-item'>
                <div class='result-container'>
                    <div class='result-info'>
                        <div class='result-title'>${escapeHtml(site.title)}</div>
                        <div class='result-url'><a href='${escapeHtml(site.url)}' target='_blank'>${escapeHtml(site.url)}</a></div>
                        <div class='result-meta'>
                            ${site.lastVisited ? ` • Visited: ${new Date(site.lastVisited).toLocaleDateString()}` : ""}
                        </div>
                    </div>
                </div>
            </li>`;
        });

        html += `</ol>`;
    }

    // Add related entities if available
    if (
        searchResponse.relatedEntities &&
        searchResponse.relatedEntities.length > 0
    ) {
        html += `<div class='related-section'>
            <div class='section-header'>Related Entities:</div>
            <div class='entity-tags'>`;
        const topEntities = searchResponse.relatedEntities.slice(0, 5);
        topEntities.forEach((entity: any) => {
            html += `<span class='entity-tag'>${escapeHtml(entity.name)}</span>`;
        });
        html += `</div></div>`;
    }

    // Add topics if available
    if (searchResponse.topTopics && searchResponse.topTopics.length > 0) {
        html += `<div class='topics-section'>
            <div class='section-header'>Top Topics:</div>
            <div class='topic-tags'>`;
        const topTopics = searchResponse.topTopics.slice(0, 5);
        topTopics.forEach((topic: string) => {
            html += `<span class='topic-tag'>${escapeHtml(topic)}</span>`;
        });
        html += `</div></div>`;
    }

    // Add follow-up suggestions if available
    if (
        searchResponse.suggestedFollowups &&
        searchResponse.suggestedFollowups.length > 0
    ) {
        html += `<div class='followups-section'>
            <div class='section-header'>Suggested follow-ups:</div>
            <ul class='followup-list'>`;
        searchResponse.suggestedFollowups.forEach((followup: string) => {
            html += `<li class='followup-item'>${escapeHtml(followup)}</li>`;
        });
        html += `</ul></div>`;
    }

    html += `</div>`;

    // Add CSS styles for better presentation
    html += `
    <style>
    .web-search-results {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        max-width: 800px;
        margin: 0;
        padding: 0;
    }
    .search-summary {
        background: #f5f5f5;
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-weight: 500;
        color: #333;
    }
    .search-answer {
        background: #e3f2fd;
        border-left: 4px solid #2196f3;
        padding: 16px;
        margin-bottom: 20px;
        border-radius: 4px;
    }
    .answer-header {
        font-weight: 600;
        color: #1976d2;
        margin-bottom: 8px;
    }
    .answer-content {
        line-height: 1.5;
        color: #333;
    }
    .search-results-header {
        font-size: 18px;
        font-weight: 600;
        margin: 20px 0 12px 0;
        color: #333;
    }
    .search-results-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .search-result-item {
        margin-bottom: 20px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        transition: box-shadow 0.2s;
    }
    .search-result-item:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .result-container {
        padding: 16px;
    }
    .result-title {
        font-size: 16px;
        font-weight: 600;
        color: #1976d2;
        margin-bottom: 6px;
        line-height: 1.3;
    }
    .result-url {
        margin-bottom: 8px;
    }
    .result-url a {
        color: #2e7d32;
        text-decoration: none;
        font-size: 14px;
    }
    .result-url a:hover {
        text-decoration: underline;
    }
    .result-meta {
        font-size: 12px;
        color: #666;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .result-domain {
        font-weight: 500;
    }
    .related-section, .topics-section, .followups-section {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
    }
    .section-header {
        font-weight: 600;
        margin-bottom: 12px;
        color: #333;
    }
    .entity-tags, .topic-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .entity-tag, .topic-tag {
        background: #f5f5f5;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 12px;
        color: #555;
        border: 1px solid #ddd;
    }
    .followup-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .followup-item {
        padding: 8px 0;
        color: #555;
        border-bottom: 1px solid #f0f0f0;
    }
    .followup-item:last-child {
        border-bottom: none;
    }
    </style>`;

    return html;
}
export function generateWebSearchMarkdown(
    searchResponse: SearchWebMemoriesResponse,
    query: string,
): string {
    let content = `Found ${searchResponse.websites.length} result(s) in ${searchResponse.summary.searchTime}ms\n\n`;

    // Add answer if available
    if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
        content += `** Answer:**${searchResponse.answer}\n\n`;
    }

    // Add main results (limit to top 10)
    if (searchResponse.websites.length > 0) {
        content += `**Top Results:**\n\n`;
        const topResults = searchResponse.websites.slice(0, 10);

        topResults.forEach((site: any, index: number) => {
            content += `${index + 1}. ${site.title}\n`;
            content += `([link](${site.url}))\n`;

            if (site.lastVisited) {
                content += ` • Last visited: ${new Date(site.lastVisited).toLocaleDateString()}`;
            }
            content += `\n\n`;
        });
    }

    // Add related entities if available
    if (
        searchResponse.relatedEntities &&
        searchResponse.relatedEntities.length > 0
    ) {
        content += `**Related Entities:**\n\n`;
        const topEntities = searchResponse.relatedEntities.slice(0, 5);
        topEntities.forEach((entity: any) => {
            content += `- ${entity.name}\n`;
        });
        content += `\n`;
    }

    // Add topics if available
    if (searchResponse.topTopics && searchResponse.topTopics.length > 0) {
        content += `**Top Topics**\n\n`;
        const topTopics = searchResponse.topTopics.slice(0, 5);
        topTopics.forEach((topic: string) => {
            content += `- ${topic}\n`;
        });
        content += `\n`;
    }

    // Add follow-up suggestions if available
    if (
        searchResponse.suggestedFollowups &&
        searchResponse.suggestedFollowups.length > 0
    ) {
        content += `**Suggested Follow-ups:**\n\n`;
        searchResponse.suggestedFollowups.forEach((followup: string) => {
            content += `- ${followup}\n`;
        });
    }

    return content;
}

export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
