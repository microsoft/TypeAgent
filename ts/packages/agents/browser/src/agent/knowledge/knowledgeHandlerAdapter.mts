// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import {
    findRequestedWebsites,
} from "../websiteMemory.mjs";
import * as website from "website-memory";

// Legacy interfaces from knowledgeHandler for backward compatibility
export interface KnowledgeExtractionResult {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
}

export interface Entity {
    name: string;
    type: string;
    description?: string;
    confidence: number;
}

export interface Relationship {
    from: string;
    relationship: string;
    to: string;
    confidence: number;
}

export interface WebPageReference {
    url: string;
    title: string;
    relevanceScore: number;
    lastIndexed: string;
}

/**
 * Adapter layer to route old knowledgeHandler API calls to websiteMemory
 * This maintains backward compatibility during the migration
 */
export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    console.log(`[ADAPTER] Routing knowledge action: ${actionName}`);
    
    switch (actionName) {
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPageAdapter(context, parameters);

        case "indexWebPageContent":
            return await indexWebPageContentAdapter(context, parameters);

        case "queryWebKnowledge":
            return await queryWebKnowledgeAdapter(context, parameters);

        case "checkPageIndexStatus":
            return await checkPageIndexStatusAdapter(context, parameters);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStatsAdapter(context, parameters);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndexAdapter(context, parameters);

        case "exportKnowledgeData":
            return await exportKnowledgeDataAdapter(context, parameters);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}

/**
 * Adapter for extractKnowledgeFromPage -> enhanced website knowledge extraction
 */
async function extractKnowledgeFromPageAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractEntities: boolean;
        extractRelationships: boolean;
        suggestQuestions: boolean;
        quality?: "fast" | "balanced" | "deep" | undefined;
    },
): Promise<KnowledgeExtractionResult> {
    console.log(`[ADAPTER] Extracting knowledge from: ${parameters.title} (${parameters.url})`);

    // Extract text content from HTML fragments
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
        };
    }

    try {
        // Create a temporary website object for knowledge extraction
        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history", // Temporary classification
            visitDate: new Date().toISOString(),
            description: textContent.substring(0, 500), // Use first 500 chars as description
        };

        const websiteObj = website.importWebsiteVisit(visitInfo, textContent);
        
        // Extract knowledge using websiteMemory's built-in capabilities
        const knowledge = websiteObj.getKnowledge();
        
        // Generate suggested questions if requested
        const suggestedQuestions: string[] = [];
        if (parameters.suggestQuestions && knowledge) {
            suggestedQuestions.push(...await generateSuggestedQuestions(knowledge, textContent, parameters.title));
        }

        // Transform websiteMemory knowledge format to legacy format
        const entities: Entity[] = knowledge?.entities?.map(entity => ({
            name: entity.name,
            type: Array.isArray(entity.type) ? entity.type.join(", ") : entity.type,
            description: entity.facets?.find(f => f.name === "description")?.value as string,
            confidence: 0.8, // Default confidence since websiteMemory doesn't provide this
        })) || [];

        const keyTopics: string[] = knowledge?.topics || [];

        // Extract relationships from actions (websiteMemory represents relationships as actions)
        const relationships: Relationship[] = knowledge?.actions?.map(action => ({
            from: action.subjectEntityName || "unknown",
            relationship: action.verbs?.join(", ") || "related to",
            to: action.objectEntityName || "unknown",
            confidence: 0.7,
        })) || [];

        const summary = `Knowledge extracted from ${parameters.title}: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships found.`;

        console.log(`[ADAPTER] Knowledge extraction completed: ${entities.length} entities, ${relationships.length} relationships`);

        return {
            entities,
            relationships,
            keyTopics,
            suggestedQuestions,
            summary,
        };
    } catch (error) {
        console.error("[ADAPTER] Error during knowledge extraction:", error);
        return {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "Error occurred during knowledge extraction.",
        };
    }
}

/**
 * Adapter for indexWebPageContent -> add website to collection with knowledge
 */
async function indexWebPageContentAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractKnowledge: boolean;
        timestamp: string;
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
    },
): Promise<{
    indexed: boolean;
    knowledgeExtracted: boolean;
    entityCount: number;
}> {
    console.log(`[ADAPTER] Indexing web page: ${parameters.title} (${parameters.url})`);

    try {
        // Extract text content
        const textContent = parameters.htmlFragments
            .map((fragment) => fragment.text || "")
            .join("\n\n");

        // Create website visit info
        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: parameters.timestamp,
        };

        // Determine page type based on content
        visitInfo.pageType = website.determinePageType(parameters.url, parameters.title);

        // Create website object
        const websiteObj = website.importWebsiteVisit(visitInfo, textContent);

        // Add to website collection if it exists
        if (context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection.addWebsites([websiteObj]);
            
            // Build index if requested
            if (parameters.extractKnowledge) {
                await context.agentContext.websiteCollection.buildIndex();
            }
        }

        // Get knowledge for entity count
        const knowledge = websiteObj.getKnowledge();
        const entityCount = knowledge?.entities?.length || 0;

        console.log(`[ADAPTER] Page indexed successfully: ${entityCount} entities extracted`);

        return {
            indexed: true,
            knowledgeExtracted: parameters.extractKnowledge,
            entityCount,
        };
    } catch (error) {
        console.error("[ADAPTER] Error indexing page content:", error);
        return {
            indexed: false,
            knowledgeExtracted: false,
            entityCount: 0,
        };
    }
}

/**
 * Adapter for queryWebKnowledge -> semantic search with answer generation
 */
async function queryWebKnowledgeAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {
        query: string;
        url?: string;
        searchScope: "current_page" | "all_indexed";
    },
): Promise<{
    answer: string;
    sources: WebPageReference[];
    relatedEntities: Entity[];
}> {
    console.log(`[ADAPTER] Querying web knowledge: "${parameters.query}" (scope: ${parameters.searchScope})`);

    try {
        const websiteCollection = context.agentContext.websiteCollection;
        
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return {
                answer: "No website data available. Please import website data first using the library panel.",
                sources: [],
                relatedEntities: [],
            };
        }

        // Use websiteMemory's semantic search
        const searchResults = await findRequestedWebsites(
            [parameters.query],
            context.agentContext,
            false, // not exact match
            0.3,   // lower minimum score for broader results
        );

        if (searchResults.length === 0) {
            return {
                answer: "No relevant information found in your website knowledge base. Try browsing more content or importing your browser history/bookmarks.",
                sources: [],
                relatedEntities: [],
            };
        }

        // Generate answer from search results
        const answer = await generateAnswerFromResults(parameters.query, searchResults);

        // Create source references
        const sources: WebPageReference[] = searchResults.slice(0, 5).map((website: any) => ({
            url: website.metadata.url,
            title: website.metadata.title || website.metadata.url,
            relevanceScore: 0.8, // Default relevance
            lastIndexed: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
        }));

        // Extract related entities
        const relatedEntities: Entity[] = [];
        for (const site of searchResults.slice(0, 3)) {
            const knowledge = site.getKnowledge();
            if (knowledge?.entities) {
                for (const entity of knowledge.entities.slice(0, 3)) {
                    relatedEntities.push({
                        name: entity.name,
                        type: Array.isArray(entity.type) ? entity.type.join(", ") : entity.type,
                        confidence: 0.7,
                    });
                }
            }
        }

        console.log(`[ADAPTER] Knowledge query completed: ${sources.length} sources, ${relatedEntities.length} related entities`);

        return {
            answer,
            sources,
            relatedEntities,
        };
    } catch (error) {
        console.error("[ADAPTER] Error querying web knowledge:", error);
        return {
            answer: "An error occurred while searching your knowledge base. Please try again.",
            sources: [],
            relatedEntities: [],
        };
    }
}

/**
 * Adapter for checkPageIndexStatus -> check if URL exists in collection
 */
async function checkPageIndexStatusAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: { url: string },
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

        // Find website by URL
        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find((site: any) => site.metadata.url === parameters.url);

        if (foundWebsite) {
            const knowledge = foundWebsite.getKnowledge();
            return {
                isIndexed: true,
                lastIndexed: foundWebsite.metadata.visitDate || foundWebsite.metadata.bookmarkDate || null,
                entityCount: knowledge?.entities?.length || 0,
            };
        } else {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
    } catch (error) {
        console.error("[ADAPTER] Error checking page index status:", error);
        return { isIndexed: false, lastIndexed: null, entityCount: 0 };
    }
}

/**
 * Adapter for getKnowledgeIndexStats -> get website collection statistics
 */
async function getKnowledgeIndexStatsAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {},
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
            const knowledge = site.getKnowledge();
            if (knowledge) {
                totalEntities += knowledge.entities?.length || 0;
                totalRelationships += knowledge.actions?.length || 0; // Using actions as relationships
            }

            const siteDate = site.metadata.visitDate || site.metadata.bookmarkDate;
            if (siteDate && (!lastIndexed || siteDate > lastIndexed)) {
                lastIndexed = siteDate;
            }
        }

        // Estimate index size
        const totalContent = websites.reduce((sum: number, site: any) => 
            sum + (site.textChunks?.join("").length || 0), 0);
        const indexSize = `${Math.round(totalContent / 1024)} KB`;

        return {
            totalPages: websites.length,
            totalEntities,
            totalRelationships,
            lastIndexed: lastIndexed || "Never",
            indexSize,
        };
    } catch (error) {
        console.error("[ADAPTER] Error getting knowledge index stats:", error);
        return {
            totalPages: 0,
            totalEntities: 0,
            totalRelationships: 0,
            lastIndexed: "Error",
            indexSize: "Unknown",
        };
    }
}

/**
 * Adapter for clearKnowledgeIndex -> clear website collection
 */
async function clearKnowledgeIndexAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {},
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
        
        // Create new empty collection
        context.agentContext.websiteCollection = new website.WebsiteCollection();

        return {
            success: true,
            message: `Successfully cleared ${itemsCleared} items from knowledge index.`,
        };
    } catch (error) {
        console.error("[ADAPTER] Error clearing knowledge index:", error);
        return {
            success: false,
            message: "Failed to clear knowledge index. Please try again.",
        };
    }
}

/**
 * Adapter for exportKnowledgeData -> export website collection data
 */
async function exportKnowledgeDataAdapter(
    context: SessionContext<BrowserActionContext>,
    parameters: {},
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
                version: "2.0", // Updated version for websiteMemory format
                totalPages: websites.length,
            },
            webPages: websites.map((site: any) => {
                const knowledge = site.getKnowledge();
                return {
                    url: site.metadata.url,
                    title: site.metadata.title,
                    timestamp: site.metadata.visitDate || site.metadata.bookmarkDate,
                    contentLength: site.textChunks?.join("").length || 0,
                    entityCount: knowledge?.entities?.length || 0,
                    relationshipCount: knowledge?.actions?.length || 0,
                    keyTopics: knowledge?.topics || [],
                    pageType: site.metadata.pageType,
                    source: site.metadata.websiteSource,
                };
            }),
            entities: websites.flatMap((site: any) => site.getKnowledge()?.entities || []),
            relationships: websites.flatMap((site: any) => site.getKnowledge()?.actions || []),
        };

        return {
            data: exportData,
            exportDate: new Date().toISOString(),
        };
    } catch (error) {
        console.error("[ADAPTER] Error exporting knowledge data:", error);
        return {
            data: { error: "Export failed" },
            exportDate: new Date().toISOString(),
        };
    }
}

// Helper Functions

/**
 * Generate suggested questions based on extracted knowledge
 */
async function generateSuggestedQuestions(
    knowledge: any,
    content: string,
    title: string,
): Promise<string[]> {
    const questions: string[] = [];
    
    // Content-based questions
    if (knowledge.entities && knowledge.entities.length > 0) {
        const mainEntity = knowledge.entities[0];
        questions.push(`What is ${mainEntity.name}?`);
        questions.push(`Tell me more about ${mainEntity.name}`);
    }
    
    // Topic-based questions
    if (knowledge.topics && knowledge.topics.length > 0) {
        const mainTopic = knowledge.topics[0];
        questions.push(`What else do I have about ${mainTopic}?`);
    }
    
    // Temporal questions
    questions.push(`When did I first encounter this information?`);
    questions.push(`What other similar pages have I visited?`);
    
    // Generic helpful questions
    questions.push(`Summarize the key points from this page`);
    questions.push(`What actions can I take based on this information?`);
    
    return questions.slice(0, 6); // Limit to 6 questions
}

/**
 * Generate answer from search results
 */
async function generateAnswerFromResults(
    query: string,
    results: any[], // Using any[] to avoid type issues
): Promise<string> {
    if (results.length === 0) {
        return "No relevant information found for your query.";
    }

    const topResult = results[0];
    const resultCount = results.length;
    
    // Build context from top results
    const context = results.slice(0, 3).map(site => {
        const knowledge = site.getKnowledge();
        const topics = knowledge?.topics?.slice(0, 3).join(", ") || "";
        return `${site.metadata.title}: ${topics}`;
    }).join("; ");

    // Generate a contextual answer
    const answer = `Based on your browsing history, I found ${resultCount} relevant result${resultCount > 1 ? 's' : ''} for "${query}". ` +
        `The most relevant appears to be "${topResult.metadata.title}" (${topResult.metadata.url}). ` +
        (context ? `Related topics include: ${context}. ` : "") +
        `You can explore these results for more detailed information.`;

    return answer;
}
