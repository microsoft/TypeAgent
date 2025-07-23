// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";
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

export interface ParsedQuery {
    isQuestion: boolean;
    searchTerms: string[];
    intent: "question" | "discovery" | "mixed";
    extractedEntities: string[];
    temporalTerms: string[];
}

export interface SearchSummary {
    totalFound: number;
    searchTime: number;
    strategies: string[];
    confidence: number;
}

export interface SearchDebugContext {
    parsedQuery: ParsedQuery;
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
    parsedQuery?: ParsedQuery | undefined;
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
        parsedQuery: {} as ParsedQuery,
        searchStrategies: [],
        knowledgeMatchCount: 0,
        timing,
        intermediateFallbacks: [],
    };

    let enhancedRequest = request; // Declare outside try block

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

        // PHASE 1: Query parsing and understanding
        const parseStart = Date.now();
        const parsedQuery = await parseAndExpandQuery(
            enhancedRequest.query,
            context,
        );
        timing.parsing = Date.now() - parseStart + enhancementTime;
        debugContext.parsedQuery = parsedQuery;

        debug(
            `Parsed query intent: ${parsedQuery.intent}, isQuestion: ${parsedQuery.isQuestion}`,
        );

        // PHASE 2: Core search execution
        const searchStart = Date.now();
        let searchResults: website.Website[] = [];

        // Unified comprehensive search (replaces both advanced search and findRequestedWebsites)
        debugContext.searchStrategies.push("comprehensive-unified");
        searchResults = await performComprehensiveSearch(
            enhancedRequest,
            parsedQuery,
            context,
        );

        timing.search = Date.now() - searchStart;
        debug(
            `Found ${searchResults.length} results from comprehensive search`,
        );

        // PHASE 3: Apply discovery filters
        const processingStart = Date.now();
        let filteredResults = await applyDiscoveryFilters(
            searchResults,
            enhancedRequest,
        );

        // Apply sorting
        filteredResults = applySorting(filteredResults, enhancedRequest);

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
            queryIntent: detectedIntent?.intent.type || parsedQuery.intent,
            parsedQuery,
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
    parsedQuery: ParsedQuery,
    context: SessionContext<BrowserActionContext>,
): Promise<website.Website[]> {
    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection || websiteCollection.messages.length === 0) {
        return [];
    }

    debug(`Starting comprehensive search for query: "${request.query}"`);

    // Strategy 1: Advanced search (LLM-enhanced) if enabled
    if (request.enableAdvancedSearch) {
        try {
            const advancedResults = await performAdvancedSearch(
                request,
                parsedQuery,
                websiteCollection,
                context,
            );
            if (advancedResults.length > 0) {
                debug(
                    `Comprehensive search succeeded with advanced strategy: ${advancedResults.length} results`,
                );
                return advancedResults;
            }
        } catch (error) {
            debug(`Advanced search failed in comprehensive search: ${error}`);
        }
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
        const hybridResults = await websiteCollection.hybridSearch(
            request.query,
        );

        if (hybridResults.length > 0) {
            debug(`Found ${hybridResults.length} results using hybrid search`);
            return hybridResults
                .filter(
                    (result) =>
                        result.relevanceScore >= (request.minScore || 0.3),
                )
                .map((result) => result.website.toWebsite())
                .slice(0, request.limit || 20);
        }
        return [];
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
        const searchFilters = [request.query]; // Convert single query to filter array
        const entityResults =
            await websiteCollection.searchByEntities(searchFilters);

        if (entityResults.length > 0) {
            debug(`Found ${entityResults.length} results using entity search`);
            return entityResults
                .map((result) => result.toWebsite())
                .slice(0, request.limit || 20);
        }
        return [];
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
        const searchFilters = [request.query];
        const topicResults =
            await websiteCollection.searchByTopics(searchFilters);

        if (topicResults.length > 0) {
            debug(`Found ${topicResults.length} results using topic search`);
            return topicResults
                .map((result) => result.toWebsite())
                .slice(0, request.limit || 20);
        }
        return [];
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

async function parseAndExpandQuery(
    query: string,
    context: SessionContext<BrowserActionContext>,
): Promise<ParsedQuery> {
    const queryLower = query.toLowerCase().trim();

    // Detect if this is a question
    const questionIndicators = [
        "what",
        "how",
        "why",
        "when",
        "where",
        "who",
        "which",
        "is",
        "are",
        "can",
        "could",
        "should",
        "would",
        "do",
        "does",
        "did",
    ];
    const isQuestion = questionIndicators.some(
        (indicator) =>
            queryLower.startsWith(indicator + " ") || queryLower.includes("?"),
    );

    // Extract search terms (simplified)
    const searchTerms = [query];

    // Detect intent
    let intent: "question" | "discovery" | "mixed" = "discovery";
    if (isQuestion) {
        intent = "question";
    } else if (
        queryLower.includes("find") ||
        queryLower.includes("show") ||
        queryLower.includes("search")
    ) {
        intent = "mixed";
    }

    // Extract entities (simplified - could be enhanced with NLP)
    const extractedEntities: string[] = [];
    const capitalizedWords = query.match(/\b[A-Z][a-z]+\b/g) || [];
    extractedEntities.push(...capitalizedWords);

    // Extract temporal terms
    const temporalTerms: string[] = [];
    const temporalIndicators = [
        "today",
        "yesterday",
        "last week",
        "last month",
        "recently",
        "this year",
        "last year",
    ];
    temporalIndicators.forEach((term) => {
        if (queryLower.includes(term)) {
            temporalTerms.push(term);
        }
    });

    return {
        isQuestion,
        searchTerms,
        intent,
        extractedEntities,
        temporalTerms,
    };
}

async function performAdvancedSearch(
    request: SearchWebMemoriesRequest,
    parsedQuery: ParsedQuery,
    websiteCollection: website.WebsiteCollection,
    context: SessionContext<BrowserActionContext>,
): Promise<website.Website[]> {
    // Build sophisticated search expression
    const searchSelectExpr: kp.SearchSelectExpr = {
        searchTermGroup: {
            booleanOp: parsedQuery.isQuestion ? "and" : "or",
            terms: parsedQuery.searchTerms.map((term) => ({
                term: { text: term },
            })),
        },
        when: buildTemporalFilter(request, context),
    };

    debug(
        `Executing advanced search with expression: ${JSON.stringify(searchSelectExpr)}`,
    );

    // Execute knowpro semantic search
    const knowledgeMatches = await kp.searchConversationKnowledge(
        websiteCollection,
        searchSelectExpr.searchTermGroup,
        searchSelectExpr.when,
        { exactMatch: request.exactMatch || false },
    );

    if (!knowledgeMatches || knowledgeMatches.size === 0) {
        return [];
    }

    // Convert results to website format
    const results: website.Website[] = [];
    const processedMessages = new Set<number>();

    knowledgeMatches.forEach((match: kp.SemanticRefSearchResult) => {
        match.semanticRefMatches.forEach(
            (refMatch: kp.ScoredSemanticRefOrdinal) => {
                if (refMatch.score >= (request.minScore || 0.3)) {
                    const semanticRef = websiteCollection.semanticRefs.get(
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
                                websiteCollection.messages.get(messageOrdinal);
                            if (docPart) {
                                // Convert DocPart to Website-like object
                                const websiteObj = docPart as any;
                                results.push(websiteObj);
                            }
                        }
                    }
                }
            },
        );
    });

    debug(`Advanced search found ${results.length} results`);
    return results;
}

function buildTemporalFilter(
    request: SearchWebMemoriesRequest,
    context: SessionContext<BrowserActionContext>,
): kp.WhenFilter {
    // Return empty filter for now - could be enhanced with temporal logic
    return {};
}

async function applyDiscoveryFilters(
    results: website.Website[],
    request: SearchWebMemoriesRequest,
): Promise<website.Website[]> {
    // All discovery filtering is now handled by AI analysis
    // No manual filters to apply since domain, pageType, and source were removed
    return results;
}

function applySorting(
    results: website.Website[],
    request: SearchWebMemoriesRequest,
): website.Website[] {
    // All sorting is now handled by AI analysis and LLM-informed ranking
    // No manual sorting to apply since temporalSort and frequencySort were removed
    return results;
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
    const entities: Entity[] = [];
    const topicsSet = new Set<string>();

    for (const site of results.slice(0, 3)) {
        const knowledge = site.getKnowledge();
        if (knowledge?.entities) {
            for (const entity of knowledge.entities.slice(0, 3)) {
                entities.push({
                    name: entity.name,
                    type: Array.isArray(entity.type)
                        ? entity.type.join(", ")
                        : entity.type,
                    confidence: 0.7,
                });
            }
        }

        if (knowledge?.topics) {
            knowledge.topics.forEach((topic) => topicsSet.add(topic));
        }
    }

    return {
        entities,
        topics: Array.from(topicsSet).slice(0, 10),
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
    debug(`Starting performEntitySearch for entities: ${request.entities.join(", ")}`);

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for entity search",
                startTime
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

        const websites = await performEntitySearch(searchRequest, websiteCollection);

        if (!websites || websites.length === 0) {
            debug(`No results found for entities: ${request.entities.join(", ")}`);
            return createEmptyResponse(
                `No websites found containing entities: ${request.entities.join(", ")}`,
                startTime
            );
        }

        debug(`performEntitySearch found ${websites.length} results for entities: ${request.entities.join(", ")}`);

        // Convert to expected response format
        const websiteResults = convertToWebsiteResults(websites);
        const { entities, topics } = await extractKnowledgeFromResults(websites);

        return {
            websites: websiteResults,
            summary: {
                totalFound: websiteResults.length,
                searchTime: Date.now() - startTime,
                strategies: ["entity-direct"],
                confidence: websiteResults.length > 0 ? 0.9 : 0,
            },
            answer: websiteResults.length > 0 
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
            startTime
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
    debug(`Starting performTopicSearch for topics: ${request.topics.join(", ")}`);

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for topic search",
                startTime
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

        const websites = await performTopicSearch(searchRequest, websiteCollection);

        if (!websites || websites.length === 0) {
            debug(`No results found for topics: ${request.topics.join(", ")}`);
            return createEmptyResponse(
                `No websites found containing topics: ${request.topics.join(", ")}`,
                startTime
            );
        }

        debug(`performTopicSearch found ${websites.length} results for topics: ${request.topics.join(", ")}`);

        // Convert to expected response format
        const websiteResults = convertToWebsiteResults(websites);
        const { entities, topics } = await extractKnowledgeFromResults(websites);

        return {
            websites: websiteResults,
            summary: {
                totalFound: websiteResults.length,
                searchTime: Date.now() - startTime,
                strategies: ["topic-direct"],
                confidence: websiteResults.length > 0 ? 0.9 : 0,
            },
            answer: websiteResults.length > 0 
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
            startTime
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
        const queryWords = request.query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        const potentialEntities = queryWords.filter(word => /^[A-Z]/.test(request.query.split(" ").find(w => w.toLowerCase() === word) || ""));
        const potentialTopics = queryWords;

        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            debug("No website collection available");
            return createEmptyResponse(
                "No website data available for hybrid search",
                startTime
            );
        }

        // Run multiple search strategies in parallel using direct methods
        const [
            textSearchPromise,
            entitySearchPromise,
            topicSearchPromise
        ] = [
            // Standard text search
            searchWebMemories({
                query: request.query,
                searchScope: request.searchScope || "all_indexed",
                limit: Math.ceil((request.maxResults || 10) * 0.6),
                generateAnswer: true,
                includeRelatedEntities: true,
                enableAdvancedSearch: true,
                minScore: 0.4,
            }, context),
            
            // Direct entity-based search if we detected potential entities
            potentialEntities.length > 0 ? (async () => {
                try {
                    const entityResults = await websiteCollection.searchByEntities(potentialEntities);
                    return entityResults ? {
                        websites: convertToWebsiteResults(
                            entityResults.map(r => r.toWebsite()).slice(0, Math.ceil((request.maxResults || 10) * 0.3))
                        ),
                        summary: { strategies: ["entity-direct"] }
                    } : null;
                } catch (error) {
                    debug("Entity search failed in hybrid:", error);
                    return null;
                }
            })() : Promise.resolve(null),
            
            // Direct topic-based search
            potentialTopics.length > 0 ? (async () => {
                try {
                    const topicResults = await websiteCollection.searchByTopics(potentialTopics.slice(0, 3));
                    return topicResults ? {
                        websites: convertToWebsiteResults(
                            topicResults.map(r => r.toWebsite()).slice(0, Math.ceil((request.maxResults || 10) * 0.3))
                        ),
                        summary: { strategies: ["topic-direct"] }
                    } : null;
                } catch (error) {
                    debug("Topic search failed in hybrid:", error);
                    return null;
                }
            })() : Promise.resolve(null),
        ];

        const [textResult, entityResult, topicResult] = await Promise.all([
            textSearchPromise,
            entitySearchPromise,
            topicSearchPromise
        ]);

        // Combine and deduplicate results
        const allWebsites = new Map<string, WebsiteResult>();
        const strategies = ["hybrid"];

        // Add text search results (highest priority)
        textResult.websites.forEach(website => {
            allWebsites.set(website.url, {
                ...website,
                relevanceScore: website.relevanceScore * 1.0, // Full weight
            });
        });
        strategies.push(...textResult.summary.strategies);

        // Add entity search results (medium priority)
        if (entityResult && entityResult.websites) {
            entityResult.websites.forEach(website => {
                const existing = allWebsites.get(website.url);
                if (existing) {
                    // Boost score for multi-strategy matches
                    existing.relevanceScore = Math.min(1.0, existing.relevanceScore + 0.2);
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
            topicResult.websites.forEach(website => {
                const existing = allWebsites.get(website.url);
                if (existing) {
                    // Boost score for multi-strategy matches
                    existing.relevanceScore = Math.min(1.0, existing.relevanceScore + 0.15);
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

        debug(`Hybrid search completed: ${combinedWebsites.length} results from ${strategies.length} strategies`);

        // Use the best answer from text search, as it's most likely to be relevant
        const finalAnswer = textResult.answer || "Results found from multiple search strategies.";
        const finalSources = textResult.answerSources || [];

        return {
            websites: combinedWebsites,
            summary: {
                totalFound: combinedWebsites.length,
                searchTime: Date.now() - startTime,
                strategies: Array.from(new Set(strategies)),
                confidence: Math.min(1.0, combinedWebsites.length > 0 ? 0.8 : 0.2),
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
            startTime
        );
    }
}
