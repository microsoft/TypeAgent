// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import {
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "../schema/knowledgeExtraction.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:knowledge:query");

/**
 * Retrieves indexed knowledge for a specific page URL
 */
export async function getPageIndexedKnowledge(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    knowledge?: EnhancedKnowledgeExtractionResult;
    error?: string;
}> {
    try {
        const memory = context.agentContext.browserMemoryService;
        if (memory === undefined) {
            return {
                isIndexed: false,
                error: "Durable browser memory is not available",
            };
        }
        const sourceKnowledge = await memory.getSourceKnowledge(parameters.url);
        if (sourceKnowledge === undefined) {
            return {
                isIndexed: false,
                error: "Page not found in index",
            };
        }
        const entities: Entity[] = sourceKnowledge.entities.map((entity) => ({
            name: entity.name,
            type: entity.types.join(", "),
            confidence: 0.8,
        }));
        const keyTopics = sourceKnowledge.topics.map((topic) => topic.name);
        const relationships: Relationship[] = sourceKnowledge.relationships.map(
            (item) => ({
                from: item.fromEntity,
                relationship: item.relationshipType,
                to: item.toEntity,
                confidence: 0.8,
            }),
        );
        return {
            isIndexed: true,
            knowledge: {
                title: sourceKnowledge.source.title,
                entities,
                relationships,
                keyTopics,
                detectedActions: [],
                suggestedQuestions: [],
                summary: `Retrieved indexed knowledge: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships.`,
                contentMetrics: { readingTime: 0, wordCount: 0 },
            },
        };
    } catch (error) {
        console.error("Error getting page indexed knowledge:", error);
        return {
            isIndexed: false,
            error: "Failed to retrieve indexed knowledge",
        };
    }
}

/**
 * Enhanced suggested questions using content analysis and DataFrames
 */
export async function generateSmartSuggestedQuestions(
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

    // Add history-oriented questions only when durable browser memory is available.
    if (context.agentContext.browserMemoryService !== undefined) {
        try {
            debug("Checking domain visit data for enhanced questions");

            if (domain) {
                questions.push(`When did I first visit ${domain}?`);
                questions.push(`What's my learning journey on ${domain}?`);
            }
            questions.push("When did I first encounter this information?");
            questions.push("What have I learned recently in this domain?");
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

    return questions.slice(0, 8); // Limit to most relevant questions
}

// Helper functions

/**
 * Extract domain from URL
 */
function extractDomainFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}
