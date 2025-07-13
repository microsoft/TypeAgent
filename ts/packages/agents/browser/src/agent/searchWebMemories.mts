// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";
import { findRequestedWebsites } from "./websiteMemory.mjs";
import * as website from "website-memory";
import * as kp from "knowpro";
import registerDebug from "debug";
import {
    Entity,
    WebPageReference,
} from "./knowledge/schema/knowledgeExtraction.mjs";
import {
    RelationshipDiscovery,
    RelationshipResult,
} from "./knowledge/relationshipDiscovery.js";
import {
    TemporalQueryProcessor,
    TemporalPattern,
} from "./knowledge/temporalQueryProcessor.js";

const debug = registerDebug("typeagent:browser:unified-search");

// Core interfaces for unified search
export interface SearchWebMemoriesRequest {
    query: string;
    searchScope?: "current_page" | "all_indexed" | undefined;
    
    // Discovery filters
    domain?: string | undefined;
    pageType?: string | undefined; 
    source?: "bookmark" | "history" | undefined;
    temporalSort?: "ascend" | "descend" | "none" | undefined;
    frequencySort?: "ascend" | "descend" | "none" | undefined;
    
    // Search configuration
    limit?: number | undefined;
    minScore?: number | undefined;
    exactMatch?: boolean | undefined;
    
    // Processing options (consumer controls cost)
    generateAnswer?: boolean | undefined;           // Default: true
    includeRelatedEntities?: boolean | undefined;   // Default: true  
    includeRelationships?: boolean | undefined;     // Default: false (expensive)
    enableAdvancedSearch?: boolean | undefined;     // Use advanced patterns
    
    // Advanced options
    knowledgeTopK?: number | undefined;
    chunking?: boolean | undefined;
    fastStop?: boolean | undefined;
    combineAnswers?: boolean | undefined;
    choices?: string | undefined;  // Multiple choice (semicolon separated)
    debug?: boolean | undefined;
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
    
    // Advanced results - when includeRelationships=true
    relationships?: RelationshipResult[] | undefined;
    temporalPatterns?: TemporalPattern[] | undefined;
    
    // Query understanding
    queryIntent?: "question" | "discovery" | "mixed" | undefined;
    parsedQuery?: ParsedQuery | undefined;
    suggestedFollowups?: string[] | undefined;
    
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

        // PHASE 1: Query parsing and understanding
        const parseStart = Date.now();
        const parsedQuery = await parseAndExpandQuery(request.query, context);
        timing.parsing = Date.now() - parseStart;
        debugContext.parsedQuery = parsedQuery;

        debug(`Parsed query intent: ${parsedQuery.intent}, isQuestion: ${parsedQuery.isQuestion}`);

        // PHASE 2: Core search execution
        const searchStart = Date.now();
        let searchResults: website.Website[] = [];
        
        // Strategy 1: Try advanced search if enabled
        if (request.enableAdvancedSearch) {
            try {
                debugContext.searchStrategies.push("advanced-semantic");
                searchResults = await performAdvancedSearch(
                    request,
                    parsedQuery,
                    websiteCollection,
                    context,
                );
                
                if (searchResults.length === 0) {
                    debugContext.intermediateFallbacks.push("advanced-semantic -> basic-semantic");
                }
            } catch (error) {
                debug(`Advanced search failed, falling back: ${error}`);
                debugContext.intermediateFallbacks.push("advanced-semantic -> fallback");
            }
        }

        // Strategy 2: Basic semantic search fallback
        if (searchResults.length === 0) {
            debugContext.searchStrategies.push("basic-semantic");
            searchResults = await findRequestedWebsites(
                [request.query],
                context.agentContext,
                request.exactMatch || false,
                request.minScore || 0.3,
            );
        }

        timing.search = Date.now() - searchStart;
        debug(`Found ${searchResults.length} results from search`);

        // PHASE 3: Apply discovery filters
        const processingStart = Date.now();
        let filteredResults = await applyDiscoveryFilters(searchResults, request);
        
        // Apply sorting
        filteredResults = applySorting(filteredResults, request);
        
        // Apply limit
        const limitedResults = filteredResults.slice(0, request.limit || 20);

        // Convert to website results format
        const websites = convertToWebsiteResults(limitedResults);

        // PHASE 4: Generate answer if requested
        let answer: string | undefined;
        let answerType: "direct" | "synthesized" | "noAnswer" | undefined;
        let answerSources: WebPageReference[] | undefined;
        let confidence: number | undefined;

        if (request.generateAnswer !== false && limitedResults.length > 0) {
            const answerResult = await generateAnswerFromResults(
                request.query,
                limitedResults,
                parsedQuery,
                request,
            );
            answer = answerResult.answer;
            answerType = answerResult.type;
            answerSources = answerResult.sources;
            confidence = answerResult.confidence;
        }

        // PHASE 5: Extract knowledge if requested
        let relatedEntities: Entity[] | undefined;
        let topTopics: string[] | undefined;

        if (request.includeRelatedEntities !== false && limitedResults.length > 0) {
            const knowledgeResult = await extractKnowledgeFromResults(limitedResults);
            relatedEntities = knowledgeResult.entities;
            topTopics = knowledgeResult.topics;
        }

        // PHASE 6: Discover relationships if requested
        let relationships: RelationshipResult[] | undefined;
        let temporalPatterns: TemporalPattern[] | undefined;

        if (request.includeRelationships && limitedResults.length > 0) {
            try {
                const relationshipDiscovery = new RelationshipDiscovery(context);
                const topResult = limitedResults[0];
                const knowledge = topResult.getKnowledge();
                relationships = await relationshipDiscovery.discoverRelationships(
                    topResult.metadata.url,
                    knowledge,
                    3,
                );
            } catch (error) {
                debug(`Relationship discovery failed: ${error}`);
            }
        }

        // PHASE 7: Temporal analysis if needed
        if (parsedQuery.temporalTerms.length > 0 && limitedResults.length > 1) {
            try {
                const temporalProcessor = new TemporalQueryProcessor(context);
                temporalPatterns = await temporalProcessor.analyzeTemporalPatterns(limitedResults);
            } catch (error) {
                debug(`Temporal analysis failed: ${error}`);
            }
        }

        timing.processing = Date.now() - processingStart;
        timing.total = Date.now() - startTime;

        // PHASE 8: Generate follow-up suggestions
        const suggestedFollowups = await generateFollowupSuggestions(
            request.query,
            websites,
            relatedEntities,
        );

        // Update debug context
        debugContext.knowledgeMatchCount = limitedResults.length;
        debugContext.timing = timing;

        // Build response
        const response: SearchWebMemoriesResponse = {
            websites,
            summary: {
                totalFound: filteredResults.length,
                searchTime: timing.total,
                strategies: debugContext.searchStrategies,
                confidence: confidence || 0.7,
            },
            queryIntent: parsedQuery.intent,
            parsedQuery,
            suggestedFollowups,
        };

        // Add optional components
        if (answer !== undefined) {
            response.answer = answer;
            response.answerType = answerType || undefined;
            response.answerSources = answerSources || undefined;
            response.confidence = confidence || undefined;
        }

        if (relatedEntities !== undefined) {
            response.relatedEntities = relatedEntities || undefined;
            response.topTopics = topTopics || undefined;
        }

        if (relationships !== undefined) {
            response.relationships = relationships;
        }

        if (temporalPatterns !== undefined) {
            response.temporalPatterns = temporalPatterns;
        }

        if (request.debug) {
            response.debugContext = debugContext;
        }

        debug(`Unified search completed in ${timing.total}ms with ${websites.length} results`);
        return response;

    } catch (error) {
        timing.total = Date.now() - startTime;
        debug(`Unified search failed: ${error}`);
        
        return createErrorResponse(
            error instanceof Error ? error.message : "Unknown search error",
            startTime,
            request.debug ? debugContext : undefined,
        );
    }
}

// Helper functions

async function parseAndExpandQuery(
    query: string,
    context: SessionContext<BrowserActionContext>,
): Promise<ParsedQuery> {
    const queryLower = query.toLowerCase().trim();
    
    // Detect if this is a question
    const questionIndicators = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'is', 'are', 'can', 'could', 'should', 'would', 'do', 'does', 'did'];
    const isQuestion = questionIndicators.some(indicator => 
        queryLower.startsWith(indicator + ' ') || queryLower.includes('?')
    );

    // Extract search terms (simplified)
    const searchTerms = [query];
    
    // Detect intent
    let intent: "question" | "discovery" | "mixed" = "discovery";
    if (isQuestion) {
        intent = "question";
    } else if (queryLower.includes('find') || queryLower.includes('show') || queryLower.includes('search')) {
        intent = "mixed";
    }

    // Extract entities (simplified - could be enhanced with NLP)
    const extractedEntities: string[] = [];
    const capitalizedWords = query.match(/\b[A-Z][a-z]+\b/g) || [];
    extractedEntities.push(...capitalizedWords);

    // Extract temporal terms
    const temporalTerms: string[] = [];
    const temporalIndicators = ['today', 'yesterday', 'last week', 'last month', 'recently', 'this year', 'last year'];
    temporalIndicators.forEach(term => {
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
            terms: parsedQuery.searchTerms.map(term => ({ term: { text: term } }))
        },
        when: buildTemporalFilter(request, context)
    };

    debug(`Executing advanced search with expression: ${JSON.stringify(searchSelectExpr)}`);

    // Execute knowpro semantic search
    const knowledgeMatches = await kp.searchConversationKnowledge(
        websiteCollection,
        searchSelectExpr.searchTermGroup, 
        searchSelectExpr.when,
        { exactMatch: request.exactMatch || false }
    );

    if (!knowledgeMatches || knowledgeMatches.size === 0) {
        return [];
    }

    // Convert results to website format
    const results: website.Website[] = [];
    const processedMessages = new Set<number>();

    knowledgeMatches.forEach((match: kp.SemanticRefSearchResult) => {
        match.semanticRefMatches.forEach((refMatch: kp.ScoredSemanticRefOrdinal) => {
            if (refMatch.score >= (request.minScore || 0.3)) {
                const semanticRef = websiteCollection.semanticRefs.get(refMatch.semanticRefOrdinal);
                if (semanticRef) {
                    const messageOrdinal = semanticRef.range.start.messageOrdinal;
                    if (messageOrdinal !== undefined && !processedMessages.has(messageOrdinal)) {
                        processedMessages.add(messageOrdinal);
                        const docPart = websiteCollection.messages.get(messageOrdinal);
                        if (docPart) {
                            // Convert DocPart to Website-like object
                            const websiteObj = docPart as any;
                            results.push(websiteObj);
                        }
                    }
                }
            }
        });
    });

    debug(`Advanced search found ${results.length} results`);
    return results;
}

function buildTemporalFilter(
    request: SearchWebMemoriesRequest,
    context: SessionContext<BrowserActionContext>
): kp.WhenFilter {
    // Return empty filter for now - could be enhanced with temporal logic
    return {};
}

async function applyDiscoveryFilters(
    results: website.Website[],
    request: SearchWebMemoriesRequest,
): Promise<website.Website[]> {
    let filtered = results;

    // Apply domain filter
    if (request.domain) {
        filtered = filtered.filter(site => {
            const metadata = site.metadata as any;
            return metadata.domain === request.domain;
        });
    }

    // Apply source filter
    if (request.source) {
        filtered = filtered.filter(site => {
            const metadata = site.metadata as any;
            return metadata.websiteSource === request.source;
        });
    }

    // Apply page type filter
    if (request.pageType) {
        filtered = filtered.filter(site => {
            const metadata = site.metadata as any;
            return metadata.pageType === request.pageType;
        });
    }

    return filtered;
}

function applySorting(
    results: website.Website[],
    request: SearchWebMemoriesRequest,
): website.Website[] {
    let sorted = [...results];

    // Apply temporal sorting
    if (request.temporalSort && request.temporalSort !== "none") {
        sorted.sort((a, b) => {
            const aMetadata = a.metadata as any;
            const bMetadata = b.metadata as any;
            
            const aDate = new Date(aMetadata.visitDate || aMetadata.bookmarkDate || 0);
            const bDate = new Date(bMetadata.visitDate || bMetadata.bookmarkDate || 0);
            
            return request.temporalSort === "ascend" 
                ? aDate.getTime() - bDate.getTime()
                : bDate.getTime() - aDate.getTime();
        });
    }

    // Apply frequency sorting  
    if (request.frequencySort && request.frequencySort !== "none") {
        sorted.sort((a, b) => {
            const aMetadata = a.metadata as any;
            const bMetadata = b.metadata as any;
            
            const aFreq = aMetadata.visitCount || 0;
            const bFreq = bMetadata.visitCount || 0;
            
            return request.frequencySort === "ascend" 
                ? aFreq - bFreq
                : bFreq - aFreq;
        });
    }

    return sorted;
}

function convertToWebsiteResults(websites: website.Website[]): WebsiteResult[] {
    return websites.map(site => {
        const metadata = site.metadata as any;
        return {
            url: metadata.url,
            title: metadata.title || metadata.url,
            domain: metadata.domain || "unknown",
            pageType: metadata.pageType || "general",
            source: metadata.websiteSource || "unknown",
            relevanceScore: 0.8, // Could be enhanced with actual scoring
            lastVisited: metadata.visitDate || metadata.bookmarkDate || undefined,
            snippet: extractSnippet(site),
        };
    });
}

function extractSnippet(website: website.Website): string {
    const textContent = website.textChunks?.join(" ") || "";
    return textContent.substring(0, 200) + (textContent.length > 200 ? "..." : "");
}

async function generateAnswerFromResults(
    query: string,
    results: website.Website[],
    parsedQuery: ParsedQuery,
    request: SearchWebMemoriesRequest,
): Promise<{
    answer: string;
    type: "direct" | "synthesized" | "noAnswer";
    sources: WebPageReference[];
    confidence: number;
}> {
    if (results.length === 0) {
        return {
            answer: "No relevant information found for your query.",
            type: "noAnswer",
            sources: [],
            confidence: 0,
        };
    }

    const topResult = results[0];
    const metadata = topResult.metadata as any;
    
    // Generate contextual answer
    let answer = "";
    if (parsedQuery.isQuestion) {
        answer = `Based on your browsing history, I found ${results.length} relevant result${results.length > 1 ? "s" : ""} for "${query}". `;
        answer += `The most relevant appears to be "${metadata.title}" (${metadata.url}). `;
        
        // Add knowledge context if available
        const knowledge = topResult.getKnowledge();
        if (knowledge?.topics && knowledge.topics.length > 0) {
            answer += `This content covers topics including: ${knowledge.topics.slice(0, 3).join(", ")}. `;
        }
    } else {
        answer = `Found ${results.length} website${results.length > 1 ? "s" : ""} matching "${query}". `;
        answer += `Top result: "${metadata.title}" from ${metadata.domain}. `;
    }

    // Extract sources
    const sources: WebPageReference[] = results.slice(0, 5).map(site => {
        const meta = site.metadata as any;
        return {
            url: meta.url,
            title: meta.title || meta.url,
            relevanceScore: 0.8,
            lastIndexed: meta.visitDate || meta.bookmarkDate || new Date().toISOString(),
        };
    });

    return {
        answer,
        type: "synthesized",
        sources,
        confidence: Math.min(0.9, 0.5 + (results.length * 0.1)),
    };
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
                    type: Array.isArray(entity.type) ? entity.type.join(", ") : entity.type,
                    confidence: 0.7,
                });
            }
        }

        if (knowledge?.topics) {
            knowledge.topics.forEach(topic => topicsSet.add(topic));
        }
    }

    return {
        entities,
        topics: Array.from(topicsSet).slice(0, 10),
    };
}

async function generateFollowupSuggestions(
    query: string,
    websites: WebsiteResult[],
    entities?: Entity[],
): Promise<string[]> {
    const suggestions: string[] = [];

    // Domain-based suggestions
    if (websites.length > 0) {
        const topDomain = websites[0].domain;
        suggestions.push(`More from ${topDomain}`);
    }

    // Entity-based suggestions
    if (entities && entities.length > 0) {
        const topEntity = entities[0].name;
        suggestions.push(`Learn more about ${topEntity}`);
    }

    // Temporal suggestions
    suggestions.push(`Recent content about ${query}`);
    suggestions.push(`Related topics to ${query}`);

    return suggestions.slice(0, 4);
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
