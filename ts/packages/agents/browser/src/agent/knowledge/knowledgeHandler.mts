// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { searchWebMemories } from "../searchWebMemories.mjs";
import * as website from "website-memory";
import {
    KnowledgeExtractionResult,
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "./schema/knowledgeExtraction.mjs";
import {
    RelationshipDiscovery,
    RelationshipResult,
} from "./relationshipDiscovery.js";
import {
    TemporalQueryProcessor,
    TemporalPattern,
} from "./temporalQueryProcessor.js";
import {
    ExtractionMode,
    ExtractionInput,
    AIModelRequiredError,
} from "website-memory";
import { BrowserKnowledgeExtractor } from "./browserKnowledgeExtractor.mjs";

// Helper function to convert HTML fragments to ExtractionInput objects
function createExtractionInputsFromFragments(
    htmlFragments: any[],
    url: string,
    title: string,
    source: "direct" | "index" | "bookmark" | "history" | "import",
    timestamp?: string,
): ExtractionInput[] {
    return htmlFragments
        .filter((fragment) => fragment.text && fragment.text.trim().length > 50) // Filter out empty/tiny fragments
        .map((fragment, index) => ({
            url: `${url}#iframe-${fragment.frameId || index}`, // Include frame context in URL
            title: `${title} (Frame ${fragment.frameId || index})`,
            htmlFragments: [fragment], // Keep individual fragment context
            textContent: fragment.text.trim(),
            source: source,
            ...(timestamp && { timestamp }), // Only include timestamp if it exists
            metadata: {
                frameId: fragment.frameId,
                isIframe: fragment.frameId !== 0, // Main frame is typically 0
            },
        }));
}

// Helper function to aggregate extraction results from multiple fragments
function aggregateExtractionResults(results: any[]): {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
    contentMetrics: any;
} {
    const allEntities: Entity[] = [];
    const allRelationships: Relationship[] = [];
    const allTopics: string[] = [];
    const allQuestions: string[] = [];
    const summaries: string[] = [];
    
    let totalWordCount = 0;
    let totalReadingTime = 0;

    for (const result of results) {
        if (result.knowledge) {
            // Collect entities with frame context
            if (result.knowledge.entities) {
                allEntities.push(...result.knowledge.entities);
            }
            
            // Collect relationships
            if (result.knowledge.relationships) {
                allRelationships.push(...result.knowledge.relationships);
            }
            
            // Collect topics
            if (result.knowledge.keyTopics) {
                allTopics.push(...result.knowledge.keyTopics);
            }
            
            // Collect questions
            if (result.knowledge.suggestedQuestions) {
                allQuestions.push(...result.knowledge.suggestedQuestions);
            }
            
            // Collect summaries
            if (result.knowledge.summary) {
                summaries.push(result.knowledge.summary);
            }
        }
        
        // Aggregate metrics
        if (result.contentMetrics) {
            totalWordCount += result.contentMetrics.wordCount || 0;
            totalReadingTime += result.contentMetrics.readingTime || 0;
        }
    }

    // Deduplicate entities by name and type
    const uniqueEntities = allEntities.filter((entity, index, arr) => 
        arr.findIndex(e => e.name === entity.name && e.type === entity.type) === index
    );

    // Deduplicate relationships 
    const uniqueRelationships = allRelationships.filter((rel, index, arr) => 
        arr.findIndex(r => r.from === rel.from && r.relationship === rel.relationship && r.to === rel.to) === index
    );

    // Deduplicate topics and questions
    const uniqueTopics = [...new Set(allTopics)];
    const uniqueQuestions = [...new Set(allQuestions)];

    return {
        entities: uniqueEntities,
        relationships: uniqueRelationships,
        keyTopics: uniqueTopics,
        suggestedQuestions: uniqueQuestions,
        summary: summaries.length > 1 
            ? `Multi-frame content summary:\n${summaries.map((s, i) => `Frame ${i + 1}: ${s}`).join('\n\n')}`
            : summaries[0] || "No content summary available.",
        contentMetrics: {
            wordCount: totalWordCount,
            readingTime: totalReadingTime,
        },
    };
}

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

        case "searchWebMemories":
            return await searchWebMemories(parameters, context);

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

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

        case "getTopDomains":
            return await getTopDomains(parameters, context);

        case "getActivityTrends":
            return await getActivityTrends(parameters, context);

        case "getPageIndexedKnowledge":
            return await getPageIndexedKnowledge(parameters, context);

        case "getDiscoverInsights":
            return await getDiscoverInsights(parameters, context);

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
    // Create individual extraction inputs for each HTML fragment
    const extractionInputs = createExtractionInputsFromFragments(
        parameters.htmlFragments,
        parameters.url,
        parameters.title,
        "direct",
    );

    if (extractionInputs.length === 0) {
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
        const extractionMode = parameters.mode || "content";
        const extractor = new BrowserKnowledgeExtractor(context);

        // Process each fragment individually using batch processing
        const extractionResults = await extractor.extractBatch(
            extractionInputs,
            extractionMode,
        );

        // Aggregate results from all fragments
        const aggregatedResults = aggregateExtractionResults(extractionResults);

        return {
            ...aggregatedResults,
            // Enhanced content data - commented out due to type compatibility issues
            // detectedActions: extractionResults.flatMap(r => r.detectedActions || []),
            // actionSummary: extractionResults.find(r => r.actionSummary)?.actionSummary,
        };
    } catch (error) {
        console.error("Error extracting knowledge from fragments:", error);
        throw error;
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
        // Create individual extraction inputs for each HTML fragment
        const extractionInputs = createExtractionInputsFromFragments(
            parameters.htmlFragments,
            parameters.url,
            parameters.title,
            "index",
            parameters.timestamp,
        );

        const extractionMode = parameters.mode || "content";
        const extractor = new BrowserKnowledgeExtractor(context);

        // Process each fragment individually using batch processing
        const extractionResults = await extractor.extractBatch(
            extractionInputs,
            extractionMode,
        );

        // Aggregate results for indexing
        const aggregatedResults = aggregateExtractionResults(extractionResults);
        
        // Create combined text content for website memory indexing
        const combinedTextContent = extractionInputs
            .map(input => input.textContent)
            .join("\n\n");

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

        const websiteObj = website.importWebsiteVisit(visitInfo, combinedTextContent);

        if (aggregatedResults && aggregatedResults.entities.length > 0) {
            // Set knowledge based on what the website-memory package expects
            websiteObj.knowledge = {
                entities: aggregatedResults.entities.map(entity => ({
                    ...entity,
                    type: Array.isArray(entity.type) ? entity.type : [entity.type], // Ensure type is array
                })),
                topics: aggregatedResults.keyTopics,
                actions: [], // Actions would need to be extracted separately if needed
                inverseActions: [], // Required property
            };
        }

        if (context.agentContext.websiteCollection) {
            if (parameters.extractKnowledge) {
                try {
                    const isNewPage = !checkPageExistsInIndex(parameters.url, context);
                    
                    if (isNewPage) {
                        const docPart = website.WebsiteDocPart.fromWebsite(websiteObj);
                        const result = await context.agentContext.websiteCollection.addWebsiteToIndex(docPart);
                        if (hasIndexingErrors(result)) {
                            console.warn("Incremental indexing failed, falling back to full rebuild");
                            context.agentContext.websiteCollection.addWebsites([websiteObj]);
                            await context.agentContext.websiteCollection.buildIndex();
                        }
                    } else {
                        const docPart = website.WebsiteDocPart.fromWebsite(websiteObj);
                        const result = await context.agentContext.websiteCollection.updateWebsiteInIndex(
                            parameters.url, 
                            docPart
                        );
                        if (hasIndexingErrors(result)) {
                            console.warn("Update indexing failed, falling back to full rebuild");
                            context.agentContext.websiteCollection.addWebsites([websiteObj]);
                            await context.agentContext.websiteCollection.buildIndex();
                        }
                    }
                } catch (error) {
                    console.warn("Indexing error, falling back to full rebuild:", error);
                    context.agentContext.websiteCollection.addWebsites([websiteObj]);
                    await context.agentContext.websiteCollection.buildIndex();
                }

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

        const entityCount = aggregatedResults.entities?.length || 0;

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

// Enhanced suggested questions using content analysis and DataFrames
async function generateSmartSuggestedQuestions(
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
            const now = new Date();
            const thresholds: { [key: string]: number } = {
                week: 7,
                month: 30,
                quarter: 90,
                year: 365,
            };
            const days = thresholds[parameters.timeframe] || 30;
            const threshold = new Date(
                now.getTime() - days * 24 * 60 * 60 * 1000,
            );

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

function checkPageExistsInIndex(
    url: string,
    context: SessionContext<BrowserActionContext>
): boolean {
    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            return false;
        }

        const websites = websiteCollection.messages.getAll();
        return websites.some((site: any) => site.metadata.url === url);
    } catch (error) {
        console.error("Error checking page existence:", error);
        return false;
    }
}

function hasIndexingErrors(result: any): boolean {
    return !!(result?.semanticRefs?.error || result?.secondaryIndexResults?.error);
}
