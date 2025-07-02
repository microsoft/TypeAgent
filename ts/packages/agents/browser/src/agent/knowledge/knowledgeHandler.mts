// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { createKnowledgeTranslator, KnowledgeAgent } from "./translator.mjs";

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

export interface WebPageReference {
    url: string;
    title: string;
    relevanceScore: number;
    lastIndexed: string;
}

// Simple in-memory storage for demonstration
const pageIndex = new Map<string, WebPageDocument>();

// Shared knowledge agent instance
let knowledgeAgent: KnowledgeAgent | undefined;

async function getKnowledgeAgent(): Promise<KnowledgeAgent> {
    if (!knowledgeAgent) {
        knowledgeAgent = await createKnowledgeTranslator("GPT_4_O");
    }
    return knowledgeAgent;
}

export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPage(context, parameters);

        case "indexWebPageContent":
            return await indexWebPageContent(context, parameters);

        case "queryWebKnowledge":
            return await queryWebKnowledge(context, parameters);

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(context, parameters);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(context, parameters);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(context, parameters);

        case "exportKnowledgeData":
            return await exportKnowledgeData(context, parameters);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}

async function extractKnowledgeFromPage(
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
    console.log(
        `Extracting knowledge from: ${parameters.title} (${parameters.url})`,
    );

    // Extract text content from HTML fragments using the text property
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
        // Use the real LLM translator
        const agent = await getKnowledgeAgent();
        const response = await agent.extractKnowledge(
            textContent,
            parameters.title,
            parameters.url,
            parameters.quality || "balanced",
            parameters.extractEntities,
            parameters.extractRelationships,
            parameters.suggestQuestions,
        );

        if (response.success && response.data) {
            console.log(
                `Knowledge extraction completed: ${response.data.entities.length} entities, ${response.data.relationships.length} relationships`,
            );
            return response.data;
        } else {
            console.error(
                "Knowledge extraction failed:",
                response.success ? "No data returned" : "Request failed",
            );
            return {
                entities: [],
                relationships: [],
                keyTopics: [],
                suggestedQuestions: [],
                summary:
                    "Knowledge extraction failed: " +
                    (response.success ? "No data returned" : "Request failed"),
            };
        }
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

async function indexWebPageContent(
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
    console.log(`Indexing web page: ${parameters.title} (${parameters.url})`);

    try {
        // Extract text content from HTML fragments using the text property
        const textContent = parameters.htmlFragments
            .map((fragment) => fragment.text || "")
            .join("\n\n");

        // Create page document
        const pageDoc: WebPageDocument = {
            url: parameters.url,
            title: parameters.title,
            content: textContent,
            htmlFragments: parameters.textOnly ? [] : parameters.htmlFragments,
            timestamp: parameters.timestamp,
            indexed: true,
            metadata: {
                quality: parameters.quality || "balanced",
                textOnly: parameters.textOnly || false,
                contentLength: textContent.length,
                entityCount: 0,
            },
        };

        // Store in simple in-memory storage
        pageIndex.set(pageDoc.url, pageDoc);

        let knowledgeExtracted = false;
        let entityCount = 0;

        // Extract knowledge if requested
        if (parameters.extractKnowledge && textContent.length > 100) {
            try {
                const knowledge = await extractKnowledgeFromPage(context, {
                    url: parameters.url,
                    title: parameters.title,
                    htmlFragments: parameters.htmlFragments,
                    extractEntities: true,
                    extractRelationships: true,
                    suggestQuestions: true,
                    quality: parameters.quality || "balanced",
                });

                pageDoc.knowledge = knowledge;
                entityCount = knowledge.entities.length;
                pageDoc.metadata!.entityCount = entityCount;
                knowledgeExtracted = true;

                // Update the document with knowledge
                pageIndex.set(pageDoc.url, pageDoc);
            } catch (error) {
                console.error(
                    "Knowledge extraction failed during indexing:",
                    error,
                );
            }
        }

        console.log(
            `Page indexed successfully: ${entityCount} entities extracted`,
        );

        return {
            indexed: true,
            knowledgeExtracted,
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

async function queryWebKnowledge(
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
    console.log(
        `Querying web knowledge: "${parameters.query}" (scope: ${parameters.searchScope})`,
    );

    try {
        let searchResults: WebPageDocument[] = [];

        // Determine search scope and retrieve relevant documents
        if (parameters.searchScope === "current_page" && parameters.url) {
            // Search only the current page
            const pageDoc = pageIndex.get(parameters.url);
            if (pageDoc) {
                searchResults = [pageDoc];
            }
        } else {
            // Search all indexed pages
            searchResults = searchIndexedPages(parameters.query, 10);
        }

        if (searchResults.length === 0) {
            return {
                answer: "No relevant information found in indexed web pages. Try browsing more content or enabling auto-indexing to build up your knowledge base.",
                sources: [],
                relatedEntities: [],
            };
        }

        // Extract relevant content from search results
        const relevantContent = searchResults.map((doc) => ({
            url: doc.url,
            title: doc.title,
            content: doc.content.substring(0, 2000), // Limit content length
            timestamp: doc.timestamp,
            entities: doc.knowledge?.entities || [],
            summary: doc.knowledge?.summary || "",
        }));

        // Extract related entities from all results
        const relatedEntities = extractRelatedEntities(
            searchResults,
            parameters.query,
        );

        // Generate answer using LLM
        const answer = await generateAnswer(
            context,
            parameters.query,
            relevantContent,
            relatedEntities,
        );

        // Create source references
        const sources: WebPageReference[] = searchResults.map((doc) => ({
            url: doc.url,
            title: doc.title,
            relevanceScore: calculateRelevance(doc.content, parameters.query),
            lastIndexed: doc.timestamp,
        }));

        console.log(
            `Knowledge query completed: ${sources.length} sources, ${relatedEntities.length} related entities`,
        );

        return {
            answer,
            sources,
            relatedEntities,
        };
    } catch (error) {
        console.error("Error querying web knowledge:", error);
        return {
            answer: "An error occurred while searching your knowledge base. Please try again or check your connection.",
            sources: [],
            relatedEntities: [],
        };
    }
}

async function checkPageIndexStatus(
    context: SessionContext<BrowserActionContext>,
    parameters: { url: string },
): Promise<{
    isIndexed: boolean;
    lastIndexed: string | null;
    entityCount: number;
}> {
    try {
        const document = pageIndex.get(parameters.url);

        if (document) {
            return {
                isIndexed: true,
                lastIndexed: document.timestamp,
                entityCount: document.metadata?.entityCount || 0,
            };
        } else {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
    } catch (error) {
        console.error("Error checking page index status:", error);
        return { isIndexed: false, lastIndexed: null, entityCount: 0 };
    }
}

async function getKnowledgeIndexStats(
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
        const documents = Array.from(pageIndex.values());

        let totalEntities = 0;
        let totalRelationships = 0;
        let lastIndexed: string | null = null;

        for (const doc of documents) {
            if (doc.knowledge) {
                totalEntities += doc.knowledge.entities.length;
                totalRelationships += doc.knowledge.relationships.length;
            }

            if (!lastIndexed || doc.timestamp > lastIndexed) {
                lastIndexed = doc.timestamp;
            }
        }

        // Calculate approximate size
        const totalContent = documents.reduce(
            (sum, doc) => sum + doc.content.length,
            0,
        );
        const indexSize = `${Math.round(totalContent / 1024)} KB`;

        return {
            totalPages: documents.length,
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

async function clearKnowledgeIndex(
    context: SessionContext<BrowserActionContext>,
    parameters: {},
): Promise<{ success: boolean; message: string }> {
    try {
        const itemsCleared = pageIndex.size;
        pageIndex.clear();

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

async function exportKnowledgeData(
    context: SessionContext<BrowserActionContext>,
    parameters: {},
): Promise<{ data: any; exportDate: string }> {
    try {
        const documents = Array.from(pageIndex.values());

        const exportData: any = {
            metadata: {
                exportDate: new Date().toISOString(),
                version: "1.0",
                totalPages: documents.length,
            },
            webPages: documents.map((doc) => ({
                url: doc.url,
                title: doc.title,
                timestamp: doc.timestamp,
                contentLength: doc.content.length,
                entityCount: doc.knowledge?.entities.length || 0,
                relationshipCount: doc.knowledge?.relationships.length || 0,
                keyTopics: doc.knowledge?.keyTopics || [],
            })),
            entities: documents.flatMap((doc) => doc.knowledge?.entities || []),
            relationships: documents.flatMap(
                (doc) => doc.knowledge?.relationships || [],
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

// Helper functions

function searchIndexedPages(query: string, limit: number): WebPageDocument[] {
    const allDocuments = Array.from(pageIndex.values());

    // Simple text-based search with relevance scoring
    const scoredDocs = allDocuments.map((doc) => ({
        document: doc,
        score: calculateRelevance(doc.content + " " + doc.title, query),
    }));

    // Sort by relevance and take top results
    return scoredDocs
        .filter((item) => item.score > 0.1) // Only include somewhat relevant results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.document);
}

function extractRelatedEntities(
    documents: WebPageDocument[],
    query: string,
): Entity[] {
    const allEntities: Entity[] = [];
    const queryLower = query.toLowerCase();

    for (const doc of documents) {
        if (doc.knowledge?.entities) {
            for (const entity of doc.knowledge.entities) {
                // Include entities that are related to the query
                if (
                    entity.name.toLowerCase().includes(queryLower) ||
                    queryLower.includes(entity.name.toLowerCase()) ||
                    entity.type.toLowerCase().includes(queryLower)
                ) {
                    allEntities.push(entity);
                }
            }
        }
    }

    // Remove duplicates and sort by confidence
    const uniqueEntities = allEntities.filter(
        (entity, index, self) =>
            index ===
            self.findIndex(
                (e) => e.name === entity.name && e.type === entity.type,
            ),
    );

    return uniqueEntities
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10); // Limit to top 10 related entities
}

async function generateAnswer(
    context: SessionContext<BrowserActionContext>,
    query: string,
    relevantContent: any[],
    relatedEntities: Entity[],
): Promise<string> {
    try {
        // Use the real LLM translator
        const agent = await getKnowledgeAgent();
        const response = await agent.answerQuery(
            query,
            relevantContent,
            relatedEntities,
        );
        return response;
    } catch (error) {
        console.error("Error generating answer:", error);
        return "I found relevant content but encountered an error while generating an answer. Please try rephrasing your question.";
    }
}

function calculateRelevance(content: string, query: string): number {
    // Simple relevance scoring based on keyword matches
    const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2);
    const contentLower = content.toLowerCase();

    let matches = 0;
    let totalWeight = 0;

    for (const word of queryWords) {
        const wordMatches = (contentLower.match(new RegExp(word, "g")) || [])
            .length;
        matches += wordMatches;
        totalWeight += 1;
    }

    if (totalWeight === 0) return 0;

    // Normalize score between 0 and 1
    const score = Math.min(1.0, matches / (queryWords.length * 3));
    return Math.round(score * 100) / 100; // Round to 2 decimal places
}
