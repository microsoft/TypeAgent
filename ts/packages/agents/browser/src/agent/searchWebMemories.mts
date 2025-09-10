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
import { QueryEnhancementAdapter } from "./search/queryEnhancementAdapter.mjs";
import { AnswerEnhancementAdapter } from "./search/answerEnhancementAdapter.mjs";
import type { AnswerEnhancement } from "./search/schema/answerEnhancement.mjs";
import * as cm from "conversation-memory";

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

    // Answer Enhancement - dynamic summaries and smart follow-ups
    answerEnhancement?: AnswerEnhancement | undefined;

    // Debug info - when debug=true
    debugContext?: SearchDebugContext | undefined;
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

    let enhancedRequest = request;

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

        // Query Enhancement Phase
        const enhancementStart = Date.now();
        const queryAdapter = new QueryEnhancementAdapter();

        debug(
            `Performing comprehensive LLM analysis for query: "${request.query}"`,
        );
        enhancedRequest = await queryAdapter.enhanceSearchRequest(request, {
            websiteCollection,
            userContext: context,
        });
        const detectedIntent = (enhancedRequest as any).metadata?.analysis;

        const enhancementTime = Date.now() - enhancementStart;
        debug(`Query enhancement completed in ${enhancementTime}ms`);

        // PHASE 1: Term parsing - use original query for term extraction
        const parseStart = Date.now();
        const termParser = new cm.SearchTermParser();
        // const searchTerms = termParser.getTerms(request.query); // Use original query, not enhanced
        const searchTerms = termParser.getTerms(enhancedRequest.query); // Use original query, not enhanced
        timing.parsing = Date.now() - parseStart + enhancementTime;
        debugContext.searchTerms = searchTerms;

        debug(
            `Extracted ${searchTerms.length} search terms from original query: ${searchTerms.join(", ")}`,
        );

        // PHASE 2: Core search execution
        const searchStart = Date.now();
        let searchResults: website.Website[] = [];

        debugContext.searchStrategies.push("comprehensive-unified");
        searchResults = await performComprehensiveSearch(
            enhancedRequest,
            searchTerms,
            detectedIntent,
            context,
        );

        timing.search = Date.now() - searchStart;
        debug(
            `Found ${searchResults.length} results from comprehensive search`,
        );

        // PHASE 3: Processing phase
        const processingStart = Date.now();
        let filteredResults = searchResults;

        // Apply comprehensive LLM-informed ranking
        if (detectedIntent && filteredResults.length > 0) {
            debug(
                `Applying comprehensive LLM-informed ranking for intent: ${detectedIntent.intent.type}`,
            );
            filteredResults = await queryAdapter.enhanceSearchResults(
                filteredResults,
                enhancedRequest,
                detectedIntent,
            );
        }

        // Apply limit
        const limitedResults = filteredResults.slice(
            0,
            enhancedRequest.limit || 20,
        );

        // Convert to website results format
        const websites = convertToWebsiteResults(limitedResults);

        // PHASE 4: Extract knowledge if requested
        let relatedEntities: Entity[] | undefined;
        let topTopics: string[] | undefined;

        if (
            enhancedRequest.includeRelatedEntities !== false &&
            limitedResults.length > 0
        ) {
            const knowledgeResult =
                await extractKnowledgeFromResults(limitedResults);
            relatedEntities = knowledgeResult.entities;
            topTopics = knowledgeResult.topics;
        }

        timing.processing = Date.now() - processingStart;
        timing.total = Date.now() - startTime;

        // PHASE 5: Answer Enhancement - Generate dynamic summary and smart follow-ups
        // TODO: re-enable answer generation after perf investigation
        enhancedRequest.generateAnswer = false;
        let answerEnhancement;
        if (
            enhancedRequest.generateAnswer !== false &&
            limitedResults.length > 0
        ) {
            try {
                const answerAdapter = new AnswerEnhancementAdapter();
                answerEnhancement = await answerAdapter.enhanceSearchResults(
                    request.query,
                    detectedIntent,
                    limitedResults,
                );
                if (answerEnhancement) {
                    debug(
                        `Answer enhancement generated with confidence: ${answerEnhancement.confidence}`,
                    );
                }
            } catch (error) {
                debug(`Answer enhancement failed: ${error}`);
                answerEnhancement = undefined;
            }
        }

        // Update debug context
        debugContext.knowledgeMatchCount = limitedResults.length;
        debugContext.timing = timing;

        // Build enhanced response
        const response: SearchWebMemoriesResponse = {
            websites,
            summary: {
                totalFound: filteredResults.length,
                searchTime: timing.total,
                strategies: detectedIntent
                    ? ["llm-enhanced", ...debugContext.searchStrategies]
                    : debugContext.searchStrategies,
                confidence:
                    detectedIntent?.confidence ||
                    answerEnhancement?.confidence ||
                    0.7,
            },
            queryIntent: detectedIntent?.intent.type,
            searchTerms,
            // Use enhanced followups if available, otherwise provide empty array
            suggestedFollowups:
                answerEnhancement?.followups.map((f) => f.query) || [],
        };

        // Add optional components
        if (answerEnhancement && enhancedRequest.generateAnswer !== false) {
            response.answer = answerEnhancement.summary.text;
            response.answerType = "synthesized";
            response.answerSources = websites.slice(0, 5).map((site) => ({
                url: site.url,
                title: site.title,
                relevanceScore: site.relevanceScore,
                lastIndexed: site.lastVisited || new Date().toISOString(),
            }));
            response.confidence = answerEnhancement.confidence;
        }

        if (relatedEntities !== undefined) {
            response.relatedEntities = relatedEntities || undefined;
            response.topTopics = topTopics || undefined;
        }

        if (answerEnhancement !== undefined) {
            response.answerEnhancement = answerEnhancement;
        }

        if (enhancedRequest.debug) {
            response.debugContext = debugContext;
        }

        debug(
            `Enhanced search completed in ${timing.total}ms with ${websites.length} results`,
        );
        return response;
    } catch (error) {
        timing.total = Date.now() - startTime;
        debug(`Unified search failed: ${error}`);

        return createErrorResponse(
            error instanceof Error ? error.message : "Unknown search error",
            startTime,
            enhancedRequest?.debug ? debugContext : undefined,
        );
    }
}

// Comprehensive Search Strategy Functions

/**
 * Perform comprehensive search using all available strategies
 * Replaces both performAdvancedSearch and findRequestedWebsites
 */
async function performComprehensiveSearch(
    request: SearchWebMemoriesRequest,
    searchTerms: string[],
    detectedIntent: any,
    context: SessionContext<BrowserActionContext>,
): Promise<website.Website[]> {
    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection || websiteCollection.messages.length === 0) {
        return [];
    }

    debug(`Starting comprehensive search for query: "${request.query}"`);

    // Strategy 1: Try advanced search first for all queries
    try {
        debug(
            "Attempting comprehensive search with multi-knowledge type support",
        );

        const advancedResults = await performAdvancedSearch(
            request,
            searchTerms,
            detectedIntent,
            websiteCollection,
            context,
        );

        if (advancedResults.length > 0) {
            debug(
                `Comprehensive search succeeded with ${advancedResults.length} results`,
            );
            return advancedResults;
        } else {
            debug(
                "No results found with comprehensive search, falling back to back-up strategies",
            );
        }
    } catch (error) {
        debug(
            `Comprehensive search failed: ${error}, falling back to back-up strategies`,
        );
    }

    // Strategy 2: Hybrid search for single term queries
    if (isSingleTermQuery(request.query) && !request.exactMatch) {
        const hybridResults = await performHybridSearch(
            request,
            websiteCollection,
        );
        if (hybridResults.length > 0) {
            debug(
                `Comprehensive search succeeded with hybrid strategy: ${hybridResults.length} results`,
            );
            return hybridResults;
        }
    }

    // Strategy 3: Entity search for proper nouns and capitalized terms
    if (hasCapitalizedTerms(request.query)) {
        const entityResults = await performEntitySearch(
            request,
            websiteCollection,
        );
        if (entityResults.length > 0) {
            debug(
                `Comprehensive search succeeded with entity strategy: ${entityResults.length} results`,
            );
            return entityResults;
        }
    }

    // Strategy 4: Topic search for conceptual terms
    const topicResults = await performTopicSearch(request, websiteCollection);
    if (topicResults.length > 0) {
        debug(
            `Comprehensive search succeeded with topic strategy: ${topicResults.length} results`,
        );
        return topicResults;
    }

    // Strategy 5: Basic semantic search (final fallback)
    debug(`Falling back to semantic search for query: "${request.query}"`);
    return await performBasicSemanticSearch(request, websiteCollection);
}

/**
 * Check if query is a single term (no spaces)
 */
function isSingleTermQuery(query: string): boolean {
    return query.trim().split(/\s+/).length === 1;
}

/**
 * Check if query contains capitalized terms (potential proper nouns)
 */
function hasCapitalizedTerms(query: string): boolean {
    return /\b[A-Z][a-z]+\b/.test(query);
}

/**
 * Perform hybrid search for single term queries
 */
async function performHybridSearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Attempting hybrid search for: "${request.query}"`);

        // Use combined search for both entities and topics
        const results = await websiteCollection.searchCombined({
            entities: [request.query],
            topics: [request.query],
            entityType: request.metadata?.entityType,
            facetName: request.metadata?.facetName,
            facetValue: request.metadata?.facetValue,
            when:
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
                    : undefined,
        });

        debug(`Found ${results.length} results using hybrid search`);

        const websites = results.map((result) => result.toWebsite());
        const deduplicatedWebsites = deduplicateByUrl(websites);

        debug(
            `Hybrid search: ${websites.length} results (${deduplicatedWebsites.length} after deduplication)`,
        );

        return deduplicatedWebsites.slice(0, request.limit || 20);
    } catch (error) {
        debug(`Hybrid search failed: ${error}`);
        return [];
    }
}

/**
 * Perform entity search for proper nouns and specific terms
 */
async function performEntitySearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Attempting entity search for: "${request.query}"`);

        // Extract filters from request metadata (set by QueryEnhancementAdapter)
        const entityType = request.metadata?.entityType;
        const facetName = request.metadata?.facetName;
        const facetValue = request.metadata?.facetValue;

        // Use the enhanced searchByEntities with optional filters
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

/**
 * Perform topic search for conceptual terms
 */
async function performTopicSearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Attempting topic search for: "${request.query}"`);

        // Build temporal filter if dates provided
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

        // Use the enhanced searchByTopics with filters
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

/**
 * Perform basic semantic search using knowpro (final fallback)
 * This replaces the semantic search logic from findRequestedWebsites
 */
async function performBasicSemanticSearch(
    request: SearchWebMemoriesRequest,
    websiteCollection: website.WebsiteCollection,
): Promise<website.Website[]> {
    try {
        debug(`Performing semantic search fallback for: "${request.query}"`);

        const matches = await kp.searchConversationKnowledge(
            websiteCollection,
            // search group
            {
                booleanOp: "or", // Use OR to match the query
                terms: [{ term: { text: request.query } }],
            },
            // when filter
            {
                // No specific knowledge type filter - search across all types
            },
            // options
            {
                exactMatch: request.exactMatch || false,
            },
        );

        if (!matches || matches.size === 0) {
            debug(`No semantic matches found for query: "${request.query}"`);
            return [];
        }

        debug(`Found ${matches.size} semantic matches for: "${request.query}"`);

        const results: { website: website.Website; score: number }[] = [];
        const processedMessages = new Set<number>();

        matches.forEach((match: kp.SemanticRefSearchResult) => {
            match.semanticRefMatches.forEach(
                (refMatch: kp.ScoredSemanticRefOrdinal) => {
                    if (refMatch.score >= (request.minScore || 0.3)) {
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

                                const websiteData =
                                    websiteCollection.messages.get(
                                        messageOrdinal,
                                    ) as any;
                                if (websiteData) {
                                    // Use the semantic search score as the primary score
                                    const totalScore = refMatch.score;

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
            `Filtered to ${sortedResults.length} unique websites after semantic search scoring`,
        );

        return sortedResults
            .map((r) => r.website)
            .slice(0, request.limit || 20);
    } catch (error) {
        debug(`Error in semantic search: ${error}`);
        return [];
    }
}

// Helper functions

async function performAdvancedSearch(
    request: SearchWebMemoriesRequest,
    searchTerms: string[],
    detectedIntent: any,
    websiteCollection: website.WebsiteCollection,
    context: SessionContext<BrowserActionContext>,
): Promise<website.Website[]> {
    // Enhanced WhenFilter with KnowPro native filtering
    const baseWhenFilter = buildEnhancedWhenFilter(request, detectedIntent);

    // Multi-knowledge type search like executeIntegratedSemanticSearch
    const searchPromises: Promise<
        Map<kp.KnowledgeType, kp.SemanticRefSearchResult> | undefined
    >[] = [];

    // Strategy 1: Try property-based topic search (like successful searchByTopics)
    debug(`Trying topic search for full query: "${request.query}"`);
    const topicSearchTermGroup = kp.createTopicSearchTermGroup(
        request.query,
        request.exactMatch || false,
    );
    searchPromises.push(
        kp.searchConversationKnowledge(
            websiteCollection,
            topicSearchTermGroup,
            { ...baseWhenFilter, knowledgeType: "topic" as const },
            {
                exactMatch: request.exactMatch || false,
                maxKnowledgeMatches: request.limit || 50,
            },
        ),
    );

    // Strategy 1b: Also try entity search for the full query
    debug(`Trying entity search for full query: "${request.query}"`);
    const entitySearchTermGroup = kp.createEntitySearchTermGroup(
        request.query,
        request.metadata?.entityType,
        request.metadata?.facetName,
        request.metadata?.facetValue,
        request.exactMatch || false,
    );
    searchPromises.push(
        kp.searchConversationKnowledge(
            websiteCollection,
            entitySearchTermGroup,
            { ...baseWhenFilter, knowledgeType: "entity" as const },
            {
                exactMatch: request.exactMatch || false,
                maxKnowledgeMatches: request.limit || 50,
            },
        ),
    );

    // Strategy 2: Try parsed terms as topic search (for multi-term queries)
    if (searchTerms.length > 1) {
        debug(`Also trying parsed terms as topics: ${searchTerms.join(", ")}`);

        // Create topic search for parsed terms
        const parsedTopicSearchGroup = kp.createTopicSearchTermGroup(
            searchTerms,
            request.exactMatch || false,
        );
        searchPromises.push(
            kp.searchConversationKnowledge(
                websiteCollection,
                parsedTopicSearchGroup,
                { ...baseWhenFilter, knowledgeType: "topic" as const },
                {
                    exactMatch: request.exactMatch || false,
                    maxKnowledgeMatches: request.limit || 50,
                },
            ),
        );

        // Also try action search
        const actionSearchGroup = kp.createOrTermGroup(
            ...searchTerms.map((term) => kp.createSearchTerm(term)),
        );
        searchPromises.push(
            kp.searchConversationKnowledge(
                websiteCollection,
                actionSearchGroup,
                { ...baseWhenFilter, knowledgeType: "action" as const },
                {
                    exactMatch: request.exactMatch || false,
                    maxKnowledgeMatches: request.limit || 50,
                },
            ),
        );
    }

    // Execute all searches in parallel
    const searchResults = await Promise.all(searchPromises);

    // Advanced result processing WITHOUT score filtering (aligned with entity search behavior)
    const results: website.Website[] = [];
    const processedMessages = new Set<number>();

    searchResults.forEach((searchResultMap) => {
        if (searchResultMap) {
            searchResultMap.forEach(
                (semanticRefResult: kp.SemanticRefSearchResult) => {
                    if (semanticRefResult.semanticRefMatches) {
                        semanticRefResult.semanticRefMatches.forEach(
                            (refMatch: kp.ScoredSemanticRefOrdinal) => {
                                const semanticRef =
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
                                        const docPart =
                                            websiteCollection.messages.get(
                                                messageOrdinal,
                                            );
                                        if (docPart) {
                                            results.push(docPart as any);
                                        }
                                    }
                                }
                            },
                        );
                    }
                },
            );
        }
    });

    // Consolidate results by URL to eliminate duplicates
    const deduplicatedResults = deduplicateByUrl(results);

    debug(
        `Advanced search found ${results.length} results (${deduplicatedResults.length} after deduplication)`,
    );
    return deduplicatedResults;
}

function buildEnhancedWhenFilter(
    request: SearchWebMemoriesRequest,
    detectedIntent: any,
): kp.WhenFilter {
    const whenFilter: any = {};

    // Date filtering from request
    if (request.dateFrom || request.dateTo) {
        whenFilter.dateRange = {
            start: request.dateFrom ? new Date(request.dateFrom) : new Date(0),
            end: request.dateTo ? new Date(request.dateTo) : new Date(),
        };
    }

    /* TODO: Revisit domain filter - this is currently filtering out too many results
    if (request.metadata?.domainFilter) {
        whenFilter.scopeDefiningTerms = kp.createOrTermGroup(
            kp.createSearchTerm(request.metadata.domainFilter, 1.0),
        );
    }
    */

    // Additional whenFilter from query enhancement
    if (request.metadata?.whenFilter) {
        Object.assign(whenFilter, request.metadata.whenFilter);
    }

    return whenFilter;
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
            // Keep sites without URL metadata (shouldn't happen but be safe)
            deduplicated.push(site);
        }
    }

    return deduplicated;
}

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

// Entity-based search function - Uses performEntitySearch directly
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
        `Starting performEntitySearch for entities: ${request.entities.join(", ")}`,
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

        // Use performEntitySearch directly - faster and more predictable
        const searchRequest: SearchWebMemoriesRequest = {
            query: request.entities.join(" OR "),
            searchScope: request.searchScope || "all_indexed",
            limit: request.maxResults || 10,
            generateAnswer: false,
            includeRelatedEntities: true,
            enableAdvancedSearch: false,
            exactMatch: false,
            minScore: 0.3,
        };

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
            `performEntitySearch found ${websites.length} results for entities: ${request.entities.join(", ")}`,
        );

        // Convert to expected response format
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
        console.error("Error in performEntitySearch:", error);
        return createErrorResponse(
            error instanceof Error ? error.message : "Entity search failed",
            startTime,
        );
    }
}

// Topic-based search function - Uses performTopicSearch directly
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
    debug(
        `Starting performTopicSearch for topics: ${request.topics.join(", ")}`,
    );

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for topic search",
                startTime,
            );
        }

        // Use performTopicSearch directly - faster and more predictable
        const searchRequest: SearchWebMemoriesRequest = {
            query: request.topics.join(" OR "),
            searchScope: request.searchScope || "all_indexed",
            limit: request.maxResults || 10,
            generateAnswer: false,
            includeRelatedEntities: true,
            enableAdvancedSearch: false,
            exactMatch: false,
            minScore: 0.25, // Lower threshold for topic matching
        };

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
            `performTopicSearch found ${websites.length} results for topics: ${request.topics.join(", ")}`,
        );

        // Convert to expected response format
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
        console.error("Error in performTopicSearch:", error);
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
