// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { findRequestedWebsites } from "../websiteMemory.mjs";
import * as website from "website-memory";
import {
    KnowledgeExtractionResult,
    EnhancedKnowledgeExtractionResult,
    EnhancedQueryRequest,
    EnhancedQueryResponse,
    QuerySuggestion,
    Entity,
    Relationship,
    WebPageReference,
} from "./schema/knowledgeExtraction.mjs";
import {
    RelationshipDiscovery,
    RelationshipResult,
} from "./relationshipDiscovery.js";
import {
    TemporalQueryProcessor,
    TemporalQuery,
    TemporalPattern,
} from "./temporalQueryProcessor.js";
import {
    ExtractionMode,
    ExtractionInput,
    AIModelRequiredError,
} from "website-memory";
import { BrowserKnowledgeExtractor } from "./browserKnowledgeExtractor.mjs";

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

export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPage(parameters, context);

        case "indexWebPageContent":
            return await indexWebPageContent(parameters, context);

        case "queryWebKnowledge":
            return await queryWebKnowledge(parameters, context);

        case "queryWebKnowledgeEnhanced":
            return await queryWebKnowledgeEnhanced(parameters, context);

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

        case "exportKnowledgeData":
            return await exportKnowledgeData(parameters, context);

        case "discoverRelationships":
            return await discoverRelationships(parameters, context);

        case "analyzeTemporalPatterns":
            return await analyzeTemporalPatterns(parameters, context);

        case "generateTemporalSuggestions":
            return await generateTemporalSuggestions(parameters, context);

        case "getExtractionAnalytics":
            return await getExtractionAnalytics(parameters, context);

        case "generateQualityReport":
            return await generateQualityReport(parameters, context);

        case "getPageQualityMetrics":
            return await getPageQualityMetrics(parameters, context);

        case "checkAIModelStatus":
            return await checkAIModelStatus(parameters, context);

        case "getRecentKnowledgeItems":
            return await getRecentKnowledgeItems(parameters, context);

        case "getPageIndexedKnowledge":
            return await getPageIndexedKnowledge(parameters, context);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}

export async function extractKnowledgeFromPage(
    parameters: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractEntities: boolean;
        extractRelationships: boolean;
        suggestQuestions: boolean;
        mode?: "basic" | "content" | "actions" | "full";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedKnowledgeExtractionResult> {
    const textContent = parameters.htmlFragments
        .map((fragment) => fragment.text || "")
        .join("\n\n")
        .trim();

    if (!textContent || textContent.length < 100) {
        return {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "Insufficient content to extract knowledge.",
            contentMetrics: {
                readingTime: 0,
                wordCount: 0,
            },
        };
    }

    try {
        const unifiedMode = parameters.mode || "content";

        const extractor = new BrowserKnowledgeExtractor(context);

        const contentInput: ExtractionInput = {
            url: parameters.url,
            title: parameters.title,
            htmlFragments: parameters.htmlFragments,
            textContent: textContent,
            source: "direct",
        };

        const extractionResult = await extractor.extractKnowledge(
            contentInput,
            unifiedMode,
        );
        const knowledge = extractionResult.knowledge;

        const entities: Entity[] =
            knowledge.entities?.map((entity: any) => ({
                name: entity.name,
                type: Array.isArray(entity.type)
                    ? entity.type.join(", ")
                    : entity.type,
                description: entity.facets?.find(
                    (f: any) => f.name === "description",
                )?.value as string,
                confidence: extractionResult.qualityMetrics.confidence,
            })) || [];

        const keyTopics: string[] = knowledge.topics || [];

        const relationships: Relationship[] =
            knowledge.actions?.map((action: any) => ({
                from: action.subjectEntityName || "unknown",
                relationship: action.verbs?.join(", ") || "related to",
                to: action.objectEntityName || "unknown",
                confidence: extractionResult.qualityMetrics.confidence,
            })) || [];

        const suggestedQuestions: string[] = [];
        if (parameters.suggestQuestions && knowledge) {
            suggestedQuestions.push(
                ...(await generateSmartSuggestedQuestions(
                    knowledge,
                    null,
                    parameters.url,
                    context,
                )),
            );
        }

        const summary = `Knowledge extracted using ${unifiedMode} mode: ${extractionResult.qualityMetrics.entityCount} entities, ${extractionResult.qualityMetrics.topicCount} topics, ${extractionResult.qualityMetrics.actionCount} actions found. Quality: ${Math.round(extractionResult.qualityMetrics.confidence * 100)}% confidence.`;

        const contentMetrics = {
            readingTime: Math.ceil(textContent.split(/\s+/).length / 225),
            wordCount: textContent.split(/\s+/).length,
        };

        return {
            entities,
            relationships,
            keyTopics,
            suggestedQuestions,
            summary,
            contentMetrics,
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            throw error;
        }

        console.error("Error during knowledge extraction:", error);
        return {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "Error occurred during knowledge extraction.",
            contentMetrics: {
                readingTime: 0,
                wordCount: 0,
            },
        };
    }
}

export async function indexWebPageContent(
    parameters: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractKnowledge: boolean;
        timestamp: string;
        textOnly?: boolean;
        mode?: "basic" | "content" | "actions" | "full";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    indexed: boolean;
    knowledgeExtracted: boolean;
    entityCount: number;
}> {
    try {
        const textContent = parameters.htmlFragments
            .map((fragment) => fragment.text || "")
            .join("\n\n");

        const unifiedMode = parameters.mode || "content";

        const extractor = new BrowserKnowledgeExtractor(context);

        const contentInput: ExtractionInput = {
            url: parameters.url,
            title: parameters.title,
            htmlFragments: parameters.htmlFragments,
            textContent: textContent,
            source: "index",
            timestamp: parameters.timestamp,
        };

        const extractionResult = await extractor.extractKnowledge(
            contentInput,
            unifiedMode,
        );

        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: parameters.timestamp,
        };

        visitInfo.pageType = website.determinePageType(
            parameters.url,
            parameters.title,
        );

        const websiteObj = website.importWebsiteVisit(visitInfo, textContent);

        if (extractionResult.knowledge) {
            websiteObj.knowledge = extractionResult.knowledge;
        }

        if (context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection.addWebsites([websiteObj]);

            if (parameters.extractKnowledge) {
                await context.agentContext.websiteCollection.buildIndex();

                // Persist the updated collection to disk
                try {
                    if (context.agentContext.index?.path) {
                        await context.agentContext.websiteCollection.writeToFile(
                            context.agentContext.index.path,
                            "index",
                        );
                        console.log(
                            `Saved updated website collection to ${context.agentContext.index.path}`,
                        );
                    } else {
                        console.warn(
                            "No index path available, indexed page data not persisted to disk",
                        );
                    }
                } catch (error) {
                    console.error(
                        "Error persisting website collection:",
                        error,
                    );
                }
            }
        }

        const entityCount = extractionResult.qualityMetrics.entityCount;

        return {
            indexed: true,
            knowledgeExtracted: parameters.extractKnowledge,
            entityCount,
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            throw error;
        }

        console.error("Error indexing page content:", error);
        return {
            indexed: false,
            knowledgeExtracted: false,
            entityCount: 0,
        };
    }
}

export async function queryWebKnowledge(
    parameters: {
        query: string;
        url?: string;
        searchScope: "current_page" | "all_indexed";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    answer: string;
    sources: WebPageReference[];
    relatedEntities: Entity[];
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return {
                answer: "No website data available. Please import website data first using the library panel.",
                sources: [],
                relatedEntities: [],
            };
        }

        const searchResults = await findRequestedWebsites(
            [parameters.query],
            context.agentContext,
            false,
            0.3,
        );

        if (searchResults.length === 0) {
            return {
                answer: "No relevant information found in your website knowledge base. Try browsing more content or importing your browser history/bookmarks.",
                sources: [],
                relatedEntities: [],
            };
        }

        const answer = await generateAnswerFromResults(
            parameters.query,
            searchResults,
        );

        const sources: WebPageReference[] = searchResults
            .slice(0, 5)
            .map((website: any) => ({
                url: website.metadata.url,
                title: website.metadata.title || website.metadata.url,
                relevanceScore: 0.8,
                lastIndexed:
                    website.metadata.visitDate ||
                    website.metadata.bookmarkDate ||
                    new Date().toISOString(),
            }));

        const relatedEntities: Entity[] = [];
        for (const site of searchResults.slice(0, 3)) {
            const knowledge = site.getKnowledge();
            if (knowledge?.entities) {
                for (const entity of knowledge.entities.slice(0, 3)) {
                    relatedEntities.push({
                        name: entity.name,
                        type: Array.isArray(entity.type)
                            ? entity.type.join(", ")
                            : entity.type,
                        confidence: 0.7,
                    });
                }
            }
        }

        return {
            answer,
            sources,
            relatedEntities,
        };
    } catch (error) {
        console.error("Error querying web knowledge:", error);
        return {
            answer: "An error occurred while searching your knowledge base. Please try again.",
            sources: [],
            relatedEntities: [],
        };
    }
}

export async function checkPageIndexStatus(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    lastIndexed: string | null;
    entityCount: number;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (foundWebsite) {
            const knowledge = foundWebsite.getKnowledge();
            const metadata =
                foundWebsite.metadata as website.WebsiteDocPartMeta;
            return {
                isIndexed: true,
                lastIndexed:
                    metadata.visitDate || metadata.bookmarkDate || null,
                entityCount: knowledge?.entities?.length || 0,
            };
        } else {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
    } catch (error) {
        console.error("Error checking page index status:", error);
        return { isIndexed: false, lastIndexed: null, entityCount: 0 };
    }
}

export async function getKnowledgeIndexStats(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    totalPages: number;
    totalEntities: number;
    totalRelationships: number;
    lastIndexed: string;
    indexSize: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                totalPages: 0,
                totalEntities: 0,
                totalRelationships: 0,
                lastIndexed: "Never",
                indexSize: "0 KB",
            };
        }

        const websites = websiteCollection.messages.getAll();
        let totalEntities = 0;
        let totalRelationships = 0;
        let lastIndexed: string | null = null;

        for (const site of websites) {
            try {
                const knowledge = site.getKnowledge();
                if (knowledge) {
                    totalEntities += knowledge.entities?.length || 0;
                    totalRelationships += knowledge.actions?.length || 0;
                }
            } catch (error) {
                console.warn("Error getting knowledge for site:", error);
                // Continue processing other sites
            }

            const metadata = site.metadata as website.WebsiteDocPartMeta;

            const siteDate = metadata?.visitDate || metadata?.bookmarkDate;
            if (siteDate && (!lastIndexed || siteDate > lastIndexed)) {
                lastIndexed = siteDate;
            }
        }

        const totalContent = websites.reduce(
            (sum: number, site: any) =>
                sum + (site.textChunks?.join("").length || 0),
            0,
        );
        const indexSize = `${Math.round(totalContent / 1024)} KB`;

        return {
            totalPages: websites.length,
            totalEntities,
            totalRelationships,
            lastIndexed: lastIndexed || "Never",
            indexSize,
        };
    } catch (error) {
        console.error("Error getting knowledge index stats:", error);
        return {
            totalPages: 0,
            totalEntities: 0,
            totalRelationships: 0,
            lastIndexed: "Error",
            indexSize: "Unknown",
        };
    }
}

export async function clearKnowledgeIndex(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{ success: boolean; message: string }> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                message: "No website collection found to clear.",
            };
        }

        const itemsCleared = websiteCollection.messages.length;
        context.agentContext.websiteCollection =
            new website.WebsiteCollection();

        return {
            success: true,
            message: `Successfully cleared ${itemsCleared} items from knowledge index.`,
        };
    } catch (error) {
        console.error("Error clearing knowledge index:", error);
        return {
            success: false,
            message: "Failed to clear knowledge index. Please try again.",
        };
    }
}

export async function exportKnowledgeData(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{ data: any; exportDate: string }> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                data: { error: "No website collection found to export" },
                exportDate: new Date().toISOString(),
            };
        }

        const websites = websiteCollection.messages.getAll();

        const exportData: any = {
            metadata: {
                exportDate: new Date().toISOString(),
                version: "2.0",
                totalPages: websites.length,
            },
            webPages: websites.map((site: any) => {
                const knowledge = site.getKnowledge();
                return {
                    url: site.metadata.url,
                    title: site.metadata.title,
                    timestamp:
                        site.metadata.visitDate || site.metadata.bookmarkDate,
                    contentLength: site.textChunks?.join("").length || 0,
                    entityCount: knowledge?.entities?.length || 0,
                    relationshipCount: knowledge?.actions?.length || 0,
                    keyTopics: knowledge?.topics || [],
                    pageType: site.metadata.pageType,
                    source: site.metadata.websiteSource,
                };
            }),
            entities: websites.flatMap(
                (site: any) => site.getKnowledge()?.entities || [],
            ),
            relationships: websites.flatMap(
                (site: any) => site.getKnowledge()?.actions || [],
            ),
        };

        return {
            data: exportData,
            exportDate: new Date().toISOString(),
        };
    } catch (error) {
        console.error("Error exporting knowledge data:", error);
        return {
            data: { error: "Export failed" },
            exportDate: new Date().toISOString(),
        };
    }
}

async function generateAnswerFromResults(
    query: string,
    results: any[],
): Promise<string> {
    if (results.length === 0) {
        return "No relevant information found for your query.";
    }

    const topResult = results[0];
    const resultCount = results.length;

    const context = results
        .slice(0, 3)
        .map((site) => {
            const knowledge = site.getKnowledge();
            const topics = knowledge?.topics?.slice(0, 3).join(", ") || "";
            return `${site.metadata.title}: ${topics}`;
        })
        .join("; ");

    const answer =
        `Based on your browsing history, I found ${resultCount} relevant result${resultCount > 1 ? "s" : ""} for "${query}". ` +
        `The most relevant appears to be "${topResult.metadata.title}" (${topResult.metadata.url}). ` +
        (context ? `Related topics include: ${context}. ` : "") +
        `You can explore these results for more detailed information.`;

    return answer;
}

// Enhanced suggested questions using content analysis and DataFrames
async function generateSmartSuggestedQuestions(
    knowledge: any,
    enhancedContent: any,
    url: string,
    context: SessionContext<BrowserActionContext>,
): Promise<string[]> {
    const questions: string[] = [];
    const domain = extractDomainFromUrl(url);

    // Content-specific questions based on enhanced content
    if (enhancedContent?.pageContent) {
        if (enhancedContent.pageContent.readingTime > 10) {
            questions.push("What are the key points from this long article?");
        }
    }

    // Use DataFrames for context-aware questions
    const websiteCollection = context.agentContext.websiteCollection;
    if (websiteCollection && websiteCollection.visitFrequency) {
        try {
            // Domain visit history - simplified approach for now
            console.log("Checking domain visit data for enhanced questions");

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

// Extract domain from URL
function extractDomainFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

// Cross-page intelligence functions
export async function discoverRelationships(
    parameters: {
        url: string;
        knowledge: any;
        maxResults?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    relationships: RelationshipResult[];
    totalFound: number;
}> {
    try {
        const relationshipDiscovery = new RelationshipDiscovery(context);

        const relationships = await relationshipDiscovery.discoverRelationships(
            parameters.url,
            parameters.knowledge,
            parameters.maxResults || 10,
        );

        return {
            success: true,
            relationships,
            totalFound: relationships.reduce(
                (sum, result) => sum + result.relatedPages.length,
                0,
            ),
        };
    } catch (error) {
        console.error("Error discovering relationships:", error);
        return {
            success: false,
            relationships: [],
            totalFound: 0,
        };
    }
}

// === ENHANCED QUERY PROCESSING ===

export async function queryWebKnowledgeEnhanced(
    parameters: EnhancedQueryRequest,
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedQueryResponse> {
    const startTime = Date.now();

    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createEmptyEnhancedResponse(
                "No website data available. Please import website data first using the library panel.",
                startTime,
            );
        }

        // Build enhanced search terms
        const searchTerms = buildEnhancedSearchTerms(
            parameters.query,
            parameters.filters,
        );

        // Process temporal aspects of the query
        const temporalProcessor = new TemporalQueryProcessor(context);
        const temporalQuery = temporalProcessor.parseTemporalQuery(
            parameters.query,
        );
        let temporalFilters: string[] = [];

        // Apply temporal filtering if temporal terms were detected
        if (temporalQuery.extractedTimeTerms.length > 0) {
            temporalFilters = await temporalProcessor.applyTemporalFiltering(
                temporalQuery,
                websiteCollection,
            );
        }

        // Apply metadata filters using available data
        let filteredSources: string[] = [];
        if (parameters.filters) {
            filteredSources = await applyMetadataFilters(
                parameters.filters,
                websiteCollection,
            );
        }

        // Combine temporal and metadata filters
        if (temporalFilters.length > 0) {
            if (filteredSources.length > 0) {
                // Intersection of both filters
                filteredSources = filteredSources.filter((url) =>
                    temporalFilters.includes(url),
                );
            } else {
                // Use only temporal filters
                filteredSources = temporalFilters;
            }
        }

        // Perform semantic search with KnowPro
        const searchResults = await findRequestedWebsites(
            searchTerms,
            context.agentContext,
            false,
            0.3,
        );

        // Filter results by metadata if applicable
        const filteredResults =
            filteredSources.length > 0
                ? searchResults.filter((result) =>
                      filteredSources.includes(result.metadata.url),
                  )
                : searchResults;

        // Limit results
        const limitedResults = filteredResults.slice(
            0,
            parameters.maxResults || 10,
        );

        // Generate enhanced answer
        const answer = await generateEnhancedAnswer(
            parameters.query,
            limitedResults,
            parameters.filters,
            temporalQuery,
        );

        // Extract sources and related entities
        const sources = extractEnhancedSources(limitedResults);
        const relatedEntities =
            extractRelatedEntitiesFromResults(limitedResults);

        // Generate query suggestions
        const suggestions = await generateQuerySuggestions(
            parameters,
            limitedResults,
            websiteCollection,
            temporalQuery,
        );

        // Discover relationships for top results if requested
        let relationships: any[] = [];
        let temporalPatterns: TemporalPattern[] = [];

        if (
            limitedResults.length > 0 &&
            parameters.searchScope !== "current_page"
        ) {
            try {
                const relationshipDiscovery = new RelationshipDiscovery(
                    context,
                );
                const topResult = limitedResults[0];
                const knowledge = topResult.getKnowledge();
                relationships =
                    await relationshipDiscovery.discoverRelationships(
                        topResult.metadata.url,
                        knowledge,
                        3,
                    );
            } catch (error) {
                console.warn(
                    "Error discovering relationships for query results:",
                    error,
                );
            }
        }

        // Analyze temporal patterns if this is a temporal query
        if (
            temporalQuery.extractedTimeTerms.length > 0 &&
            limitedResults.length > 1
        ) {
            try {
                temporalPatterns =
                    await temporalProcessor.analyzeTemporalPatterns(
                        limitedResults,
                    );
            } catch (error) {
                console.warn("Error analyzing temporal patterns:", error);
            }
        }

        const processingTime = Date.now() - startTime;

        return {
            answer,
            sources,
            relatedEntities,
            relationships,
            temporalPatterns,
            metadata: {
                totalFound: filteredResults.length,
                searchScope: parameters.searchScope,
                filtersApplied: getAppliedFilters(parameters.filters),
                suggestions,
                processingTime,
                temporalQuery:
                    temporalQuery.extractedTimeTerms.length > 0
                        ? {
                              timeframe: temporalQuery.timeframe,
                              queryType: temporalQuery.queryType,
                              extractedTimeTerms:
                                  temporalQuery.extractedTimeTerms,
                          }
                        : undefined,
            },
        };
    } catch (error) {
        console.error("Error in enhanced query processing:", error);
        return createErrorEnhancedResponse(
            error instanceof Error ? error.message : "Unknown error",
            startTime,
        );
    }
}

// Helper functions for enhanced querying
async function applyMetadataFilters(
    filters: any,
    websiteCollection: any,
): Promise<string[]> {
    const filteredUrls: string[] = [];

    try {
        const websites = websiteCollection.messages.getAll();

        for (const website of websites) {
            let includeWebsite = true;

            // Domain filtering
            if (filters.domain) {
                const websiteDomain = extractDomainFromUrl(
                    website.metadata.url,
                );
                if (websiteDomain !== filters.domain) {
                    includeWebsite = false;
                }
            }

            // Time range filtering
            if (filters.timeRange && website.metadata.visitDate) {
                const visitDate = new Date(website.metadata.visitDate);
                const threshold = getTimeRangeThreshold(filters.timeRange);
                if (visitDate < threshold) {
                    includeWebsite = false;
                }
            }

            if (includeWebsite) {
                filteredUrls.push(website.metadata.url);
            }
        }
    } catch (error) {
        console.warn("Error applying metadata filters:", error);
    }

    return filteredUrls;
}

function buildEnhancedSearchTerms(query: string, filters?: any): string[] {
    const terms = [query];

    // Add filter-based search terms

    return terms;
}

async function generateQuerySuggestions(
    request: EnhancedQueryRequest,
    results: any[],
    websiteCollection: any,
    temporalQuery?: TemporalQuery,
): Promise<QuerySuggestion[]> {
    const suggestions: QuerySuggestion[] = [];

    // Refinement suggestions
    if (results.length > 10) {
        suggestions.push({
            type: "refinement",
            query: request.query,
            explanation: "Too many results. Try adding filters to narrow down.",
            filters: { timeRange: "month" },
        });
    }

    // Expansion suggestions
    if (results.length < 3) {
        suggestions.push({
            type: "expansion",
            query: request.query,
            explanation:
                "Few results found. Try removing filters or using broader terms.",
            filters: {},
        });
    }

    // Enhanced temporal suggestions based on query type
    if (!temporalQuery || temporalQuery.extractedTimeTerms.length === 0) {
        // Add temporal context if not already present
        suggestions.push({
            type: "temporal",
            query: `${request.query} from last month`,
            explanation: "See recent content on this topic",
            filters: { timeRange: "month" },
        });

        suggestions.push({
            type: "temporal",
            query: `What did I learn about ${request.query} recently?`,
            explanation: "Focus on learning progression",
            filters: { timeRange: "week" },
        });
    } else {
        // Suggest different timeframes for temporal queries
        const currentTimeframe = temporalQuery.timeframe;
        if (currentTimeframe !== "week") {
            suggestions.push({
                type: "temporal",
                query: request.query.replace(
                    /last \w+|this \w+|recent|recently/gi,
                    "last week",
                ),
                explanation: "Focus on more recent activity",
                filters: { timeRange: "week" },
            });
        }
        if (currentTimeframe !== "year") {
            suggestions.push({
                type: "temporal",
                query: request.query.replace(
                    /last \w+|this \w+|recent|recently/gi,
                    "last year",
                ),
                explanation: "See longer-term patterns",
                filters: { timeRange: "year" },
            });
        }
    }

    // Related topic suggestions
    if (results.length > 0) {
        const topResult = results[0];
        const knowledge = topResult.getKnowledge();
        if (knowledge?.topics && knowledge.topics.length > 0) {
            const relatedTopic = knowledge.topics[0];
            suggestions.push({
                type: "related",
                query: relatedTopic,
                explanation: `Explore related topic: ${relatedTopic}`,
                filters: {},
            });
        }
    }

    return suggestions.slice(0, 4);
}

async function generateEnhancedAnswer(
    query: string,
    results: any[],
    filters?: any,
    temporalQuery?: TemporalQuery,
): Promise<string> {
    if (results.length === 0) {
        let message = `No results found for "${query}".`;
        if (filters && Object.keys(filters).length > 0) {
            message += " Try removing some filters to broaden your search.";
        } else {
            message +=
                " Try using different search terms or browse more content to expand your knowledge base.";
        }
        return message;
    }

    const topResult = results[0];
    const resultCount = results.length;

    let answer = `Found ${resultCount} result${resultCount > 1 ? "s" : ""} for "${query}". `;

    // Add temporal context if this is a temporal query
    if (temporalQuery && temporalQuery.extractedTimeTerms.length > 0) {
        const timeContext = temporalQuery.extractedTimeTerms.join(", ");
        answer += `Time context: ${timeContext}. `;

        // Add query type context
        if (temporalQuery.queryType !== "visited") {
            answer += `Focus: ${temporalQuery.queryType} content. `;
        }
    }

    // Add filter context
    if (filters && Object.keys(filters).length > 0) {
        const appliedFilters = getAppliedFilters(filters);
        if (appliedFilters.length > 0) {
            answer += `Filtered by: ${appliedFilters.join(", ")}. `;
        }
    }

    // Add top result information
    answer += `The most relevant appears to be "${topResult.metadata.title}" (${topResult.metadata.url}). `;

    // Add content context
    const knowledge = topResult.getKnowledge();
    if (knowledge?.topics && knowledge.topics.length > 0) {
        answer += `Topics include: ${knowledge.topics.slice(0, 3).join(", ")}. `;
    }

    return answer;
}

function extractEnhancedSources(results: any[]): WebPageReference[] {
    return results.slice(0, 5).map((website: any) => ({
        url: website.metadata.url,
        title: website.metadata.title || website.metadata.url,
        relevanceScore: 0.8,
        lastIndexed:
            website.metadata.visitDate ||
            website.metadata.bookmarkDate ||
            new Date().toISOString(),
    }));
}

function extractRelatedEntitiesFromResults(results: any[]): Entity[] {
    const entities: Entity[] = [];
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
    }
    return entities;
}

function getTimeRangeThreshold(timeRange: string): Date {
    const now = new Date();
    const thresholds: { [key: string]: number } = {
        week: 7,
        month: 30,
        quarter: 90,
        year: 365,
    };

    const days = thresholds[timeRange] || 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function getAppliedFilters(filters?: any): string[] {
    if (!filters) return [];

    const applied: string[] = [];
    if (filters.contentType)
        applied.push(`Content Type: ${filters.contentType}`);
    if (filters.timeRange) applied.push(`Time Range: ${filters.timeRange}`);
    if (filters.domain) applied.push(`Domain: ${filters.domain}`);

    return applied;
}

function createEmptyEnhancedResponse(
    message: string,
    startTime: number,
): EnhancedQueryResponse {
    return {
        answer: message,
        sources: [],
        relatedEntities: [],
        relationships: [],
        temporalPatterns: [],
        metadata: {
            totalFound: 0,
            searchScope: "all_indexed",
            filtersApplied: [],
            suggestions: [],
            processingTime: Date.now() - startTime,
        },
    };
}

function createErrorEnhancedResponse(
    error: string,
    startTime: number,
): EnhancedQueryResponse {
    return {
        answer: `Error occurred during search: ${error}`,
        sources: [],
        relatedEntities: [],
        relationships: [],
        temporalPatterns: [],
        metadata: {
            totalFound: 0,
            searchScope: "all_indexed",
            filtersApplied: [],
            suggestions: [],
            processingTime: Date.now() - startTime,
        },
    };
}

// === TEMPORAL ANALYSIS FUNCTIONS ===

export async function analyzeTemporalPatterns(
    parameters: {
        query?: string;
        timeframe?: "week" | "month" | "quarter" | "year";
        maxResults?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    patterns: TemporalPattern[];
    totalAnalyzed: number;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return {
                success: false,
                patterns: [],
                totalAnalyzed: 0,
            };
        }

        const temporalProcessor = new TemporalQueryProcessor(context);
        const websites = websiteCollection.messages.getAll();

        // Filter by timeframe if specified
        let filteredWebsites = websites;
        if (parameters.timeframe) {
            const threshold = getTimeRangeThreshold(parameters.timeframe);
            filteredWebsites = websites.filter((site: any) => {
                const visitDate =
                    site.metadata.visitDate || site.metadata.bookmarkDate;
                return visitDate && new Date(visitDate) >= threshold;
            });
        }

        const patterns =
            await temporalProcessor.analyzeTemporalPatterns(filteredWebsites);
        const limitedPatterns = patterns.slice(0, parameters.maxResults || 10);

        return {
            success: true,
            patterns: limitedPatterns,
            totalAnalyzed: filteredWebsites.length,
        };
    } catch (error) {
        console.error("Error analyzing temporal patterns:", error);
        return {
            success: false,
            patterns: [],
            totalAnalyzed: 0,
        };
    }
}

export async function generateTemporalSuggestions(
    parameters: {
        maxSuggestions?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    suggestions: string[];
    contextInfo: {
        recentActivityDays: number;
        uniqueDomains: number;
        uniqueTopics: number;
    };
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return {
                success: false,
                suggestions: [
                    "What have I been learning lately?",
                    "Show me this week's discoveries",
                    "Display my recent browsing timeline",
                ],
                contextInfo: {
                    recentActivityDays: 0,
                    uniqueDomains: 0,
                    uniqueTopics: 0,
                },
            };
        }

        const temporalProcessor = new TemporalQueryProcessor(context);
        const suggestions =
            await temporalProcessor.generateTemporalSuggestions(
                websiteCollection,
            );

        // Calculate context info
        const websites = websiteCollection.messages.getAll();
        const recentThreshold = new Date();
        recentThreshold.setDate(recentThreshold.getDate() - 7);

        const recentSites = websites.filter((site: any) => {
            const visitDate =
                site.metadata.visitDate || site.metadata.bookmarkDate;
            return visitDate && new Date(visitDate) >= recentThreshold;
        });

        const uniqueDomains = new Set(
            recentSites.map((site: any) => {
                try {
                    return new URL(site.metadata.url).hostname;
                } catch {
                    return site.metadata.url;
                }
            }),
        ).size;

        const uniqueTopics = new Set();
        recentSites.forEach((site: any) => {
            const knowledge = site.getKnowledge();
            if (knowledge?.topics) {
                knowledge.topics.forEach((topic: string) =>
                    uniqueTopics.add(topic),
                );
            }
        });

        return {
            success: true,
            suggestions: suggestions.slice(0, parameters.maxSuggestions || 8),
            contextInfo: {
                recentActivityDays: 7,
                uniqueDomains,
                uniqueTopics: uniqueTopics.size,
            },
        };
    } catch (error) {
        console.error("Error generating temporal suggestions:", error);
        return {
            success: false,
            suggestions: [],
            contextInfo: {
                recentActivityDays: 0,
                uniqueDomains: 0,
                uniqueTopics: 0,
            },
        };
    }
}

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
                    full: 0
                }
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
                    poor: 0
                }
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

export async function checkAIModelStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    version?: string;
    endpoint?: string;
    error?: string;
}> {
    try {
        const extractor = new BrowserKnowledgeExtractor(context);

        // Test AI availability with a simple extraction
        await extractor.extractKnowledge(
            {
                url: "test://ai-check",
                title: "AI Availability Test",
                textContent: "test content for AI availability check",
                source: "direct",
            },
            "content",
        );

        return {
            available: true,
            version: "available",
            endpoint: "configured",
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            return {
                available: false,
                error: error.message,
            };
        }

        return {
            available: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown AI model error",
        };
    }
}

export async function getRecentKnowledgeItems(
    parameters: {
        limit?: number;
        type?: "entities" | "topics" | "both";
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
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                topics: [],
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;
        const type = parameters.type || "both";

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
                    (type === "entities" || type === "both") &&
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
                if (
                    (type === "topics" || type === "both") &&
                    knowledge.topics
                ) {
                    for (const topic of knowledge.topics) {
                        recentTopics.push({
                            name: topic,
                            fromPage: pageTitle,
                            extractedAt: extractedAt,
                        });
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

        return {
            entities: uniqueEntities,
            topics: uniqueTopics,
            success: true,
        };
    } catch (error) {
        console.error("Error getting recent knowledge items:", error);
        return {
            entities: [],
            topics: [],
            success: false,
        };
    }
}

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
                        entities: [],
                        relationships: [],
                        keyTopics: [],
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

            const relationships: Relationship[] =
                knowledge.actions?.map((action) => ({
                    from: action.subjectEntityName || "unknown",
                    relationship: action.verbs?.join(", ") || "related to",
                    to: action.objectEntityName || "unknown",
                    confidence: 0.8, // Default confidence for indexed content
                })) || [];

            // Generate contextual questions for indexed content
            const suggestedQuestions: string[] =
                await generateSmartSuggestedQuestions(
                    knowledge,
                    null,
                    parameters.url,
                    context,
                );

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
                    entities,
                    relationships,
                    keyTopics,
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
                    entities: [],
                    relationships: [],
                    keyTopics: [],
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
