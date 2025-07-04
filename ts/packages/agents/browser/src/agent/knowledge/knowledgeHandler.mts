// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { findRequestedWebsites } from "../websiteMemory.mjs";
import * as website from "website-memory";
import {
    KnowledgeExtractionResult,
    Entity,
    Relationship,
    WebPageReference,
} from "./schema/knowledgeExtraction.mjs";


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

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

        case "exportKnowledgeData":
            return await exportKnowledgeData(parameters, context);

        case "importWebsiteData":
            // return importWebsiteData(parameters, context);

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
        quality?: "fast" | "balanced" | "deep";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<KnowledgeExtractionResult> {
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
        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: new Date().toISOString(),
            description: textContent.substring(0, 500),
        };

        const websiteObj = website.importWebsiteVisit(visitInfo, textContent);
        const knowledge = websiteObj.getKnowledge();
        
        const suggestedQuestions: string[] = [];
        if (parameters.suggestQuestions && knowledge) {
            suggestedQuestions.push(...await generateSuggestedQuestions(knowledge, textContent, parameters.title));
        }

        const entities: Entity[] = knowledge?.entities?.map(entity => ({
            name: entity.name,
            type: Array.isArray(entity.type) ? entity.type.join(", ") : entity.type,
            description: entity.facets?.find(f => f.name === "description")?.value as string,
            confidence: 0.8,
        })) || [];

        const keyTopics: string[] = knowledge?.topics || [];

        const relationships: Relationship[] = knowledge?.actions?.map(action => ({
            from: action.subjectEntityName || "unknown",
            relationship: action.verbs?.join(", ") || "related to",
            to: action.objectEntityName || "unknown",
            confidence: 0.7,
        })) || [];

        const summary = `Knowledge extracted from ${parameters.title}: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships found.`;

        return {
            entities,
            relationships,
            keyTopics,
            suggestedQuestions,
            summary,
        };
    } catch (error) {
        console.error("Error during knowledge extraction:", error);
        return {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "Error occurred during knowledge extraction.",
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
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
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

        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: parameters.timestamp,
        };

        visitInfo.pageType = website.determinePageType(parameters.url, parameters.title);
        const websiteObj = website.importWebsiteVisit(visitInfo, textContent);

        if (context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection.addWebsites([websiteObj]);
            
            if (parameters.extractKnowledge) {
                await context.agentContext.websiteCollection.buildIndex();
            }
        }

        const knowledge = websiteObj.getKnowledge();
        const entityCount = knowledge?.entities?.length || 0;

        return {
            indexed: true,
            knowledgeExtracted: parameters.extractKnowledge,
            entityCount,
        };
    } catch (error) {
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

        const answer = await generateAnswerFromResults(parameters.query, searchResults);

        const sources: WebPageReference[] = searchResults.slice(0, 5).map((website: any) => ({
            url: website.metadata.url,
            title: website.metadata.title || website.metadata.url,
            relevanceScore: 0.8,
            lastIndexed: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
        }));

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
            const knowledge = site.getKnowledge();
            if (knowledge) {
                totalEntities += knowledge.entities?.length || 0;
                totalRelationships += knowledge.actions?.length || 0;
            }

            const siteDate = site.metadata.visitDate || site.metadata.bookmarkDate;
            if (siteDate && (!lastIndexed || siteDate > lastIndexed)) {
                lastIndexed = siteDate;
            }
        }

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
        context.agentContext.websiteCollection = new website.WebsiteCollection();

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
        console.error("Error exporting knowledge data:", error);
        return {
            data: { error: "Export failed" },
            exportDate: new Date().toISOString(),
        };
    }
}

async function generateSuggestedQuestions(
    knowledge: any,
    content: string,
    title: string,
): Promise<string[]> {
    const questions: string[] = [];
    
    if (knowledge.entities && knowledge.entities.length > 0) {
        const mainEntity = knowledge.entities[0];
        questions.push(`What is ${mainEntity.name}?`);
        questions.push(`Tell me more about ${mainEntity.name}`);
    }
    
    if (knowledge.topics && knowledge.topics.length > 0) {
        const mainTopic = knowledge.topics[0];
        questions.push(`What else do I have about ${mainTopic}?`);
    }
    
    questions.push(`When did I first encounter this information?`);
    questions.push(`What other similar pages have I visited?`);
    questions.push(`Summarize the key points from this page`);
    questions.push(`What actions can I take based on this information?`);
    
    return questions.slice(0, 6);
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
    
    const context = results.slice(0, 3).map(site => {
        const knowledge = site.getKnowledge();
        const topics = knowledge?.topics?.slice(0, 3).join(", ") || "";
        return `${site.metadata.title}: ${topics}`;
    }).join("; ");

    const answer = `Based on your browsing history, I found ${resultCount} relevant result${resultCount > 1 ? 's' : ''} for "${query}". ` +
        `The most relevant appears to be "${topResult.metadata.title}" (${topResult.metadata.url}). ` +
        (context ? `Related topics include: ${context}. ` : "") +
        `You can explore these results for more detailed information.`;

    return answer;
}