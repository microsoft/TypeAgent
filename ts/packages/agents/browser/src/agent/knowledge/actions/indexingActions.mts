// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import * as website from "website-memory";
import { AIModelRequiredError } from "website-memory";
import { BrowserKnowledgeExtractor } from "../browserKnowledgeExtractor.mjs";
import {
    createExtractionInputsFromFragments,
    aggregateExtractionResults,
} from "./extractionActions.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:knowledge");

// Helper function to get actions from aggregated results
function getActionsFromAggregatedResults(aggregatedResults: any): any[] {
    // If we have contentActions, use them directly
    if (
        aggregatedResults.contentActions &&
        Array.isArray(aggregatedResults.contentActions) &&
        aggregatedResults.contentActions.length > 0
    ) {
        return aggregatedResults.contentActions;
    }

    // If we have relationships but no contentActions, convert relationships to actions
    if (
        aggregatedResults.relationships &&
        Array.isArray(aggregatedResults.relationships) &&
        aggregatedResults.relationships.length > 0
    ) {
        return aggregatedResults.relationships.map((relationship: any) => ({
            verbs: relationship.relationship
                ? relationship.relationship
                      .split(/[,\s]+/)
                      .filter((v: string) => v.trim().length > 0)
                : ["related to"],
            verbTense: "present" as "past" | "present" | "future",
            subjectEntityName: relationship.from || "none",
            objectEntityName: relationship.to || "none",
            indirectObjectEntityName: "none",
            params: [],
            confidence: relationship.confidence || 0.8,
        }));
    }

    return [];
}

// Helper function to check if a page exists in the index
function checkPageExistsInIndex(
    url: string,
    context: SessionContext<BrowserActionContext>,
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

// Helper function to check for indexing errors
function hasIndexingErrors(result: any): boolean {
    return !!(
        result?.semanticRefs?.error || result?.secondaryIndexResults?.error
    );
}

export async function indexWebPageContent(
    parameters: {
        url: string;
        title: string;
        htmlFragments?: any[];
        extractKnowledge: boolean;
        timestamp: string;
        textOnly?: boolean;
        mode?: "basic" | "content" | "full";
        extractedKnowledge?: any;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    indexed: boolean;
    knowledgeExtracted: boolean;
    entityCount: number;
}> {
    try {
        let aggregatedResults: any;
        let combinedTextContent = "";

        if (parameters.extractedKnowledge) {
            aggregatedResults = parameters.extractedKnowledge;
            combinedTextContent = aggregatedResults.summary || "";
        } else {
            // Create individual extraction inputs for each HTML fragment
            const extractionInputs = createExtractionInputsFromFragments(
                parameters.htmlFragments!,
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
            aggregatedResults = aggregateExtractionResults(extractionResults);

            // Create combined text content for website memory indexing
            combinedTextContent = extractionInputs
                .map((input) => input.textContent)
                .join("\n\n");
        }

        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: parameters.timestamp,
        };

        const websiteObj = website.importWebsiteVisit(
            visitInfo,
            combinedTextContent,
        );

        if (aggregatedResults && aggregatedResults.entities.length > 0) {
            // Set knowledge based on what the website-memory package expects
            websiteObj.knowledge = {
                entities: aggregatedResults.entities.map((entity: any) => ({
                    ...entity,
                    type: Array.isArray(entity.type)
                        ? entity.type
                        : [entity.type], // Ensure type is array
                })),
                topics: aggregatedResults.keyTopics || aggregatedResults.topics,
                actions: getActionsFromAggregatedResults(aggregatedResults),
                inverseActions: [], // Required property
            };
        }

        // Store detectedActions and actionSummary in metadata for retrieval
        if (
            aggregatedResults &&
            (aggregatedResults.detectedActions ||
                aggregatedResults.actionSummary)
        ) {
            websiteObj.metadata = websiteObj.metadata || {};

            if (
                aggregatedResults.detectedActions &&
                aggregatedResults.detectedActions.length > 0
            ) {
                websiteObj.metadata.detectedActions =
                    aggregatedResults.detectedActions;
            }

            if (aggregatedResults.actionSummary) {
                websiteObj.metadata.actionSummary =
                    aggregatedResults.actionSummary;
            }
        }

        if (context.agentContext.websiteCollection) {
            try {
                const isNewPage = !checkPageExistsInIndex(
                    parameters.url,
                    context,
                );

                if (isNewPage) {
                    const docPart =
                        website.WebsiteDocPart.fromWebsite(websiteObj);
                    const result =
                        await context.agentContext.websiteCollection.addWebsiteToIndex(
                            docPart,
                        );
                    if (hasIndexingErrors(result)) {
                        console.warn(
                            "Incremental indexing failed, falling back to full rebuild",
                        );
                        context.agentContext.websiteCollection.addWebsites([
                            websiteObj,
                        ]);
                        await context.agentContext.websiteCollection.buildIndex();
                    }
                } else {
                    const docPart =
                        website.WebsiteDocPart.fromWebsite(websiteObj);
                    const result =
                        await context.agentContext.websiteCollection.updateWebsiteInIndex(
                            parameters.url,
                            docPart,
                        );
                    if (hasIndexingErrors(result)) {
                        console.warn(
                            "Update indexing failed, falling back to full rebuild",
                        );
                        context.agentContext.websiteCollection.addWebsites([
                            websiteObj,
                        ]);
                        await context.agentContext.websiteCollection.buildIndex();
                    }
                }
            } catch (error) {
                console.warn(
                    "Indexing error, falling back to full rebuild:",
                    error,
                );
                context.agentContext.websiteCollection.addWebsites([
                    websiteObj,
                ]);
                await context.agentContext.websiteCollection.buildIndex();
            }

            try {
                if (context.agentContext.index?.path) {
                    await context.agentContext.websiteCollection.writeToFile(
                        context.agentContext.index.path,
                        "index",
                    );
                    debug(
                        `Saved updated website collection to ${context.agentContext.index.path}`,
                    );
                } else {
                    console.warn(
                        "No index path available, indexed page data not persisted to disk",
                    );
                }
            } catch (error) {
                console.error("Error persisting website collection:", error);
            }

            try {
                if (aggregatedResults.entities?.length > 0) {
                    await context.agentContext.websiteCollection.updateGraph([
                        websiteObj,
                    ]);
                    debug(
                        `Updated knowledge graph with ${aggregatedResults.entities.length} entities from ${parameters.url}`,
                    );
                } else {
                    debug(
                        `Skipped graph update for ${parameters.url} - no entities extracted`,
                    );
                }
            } catch (error) {
                console.warn(
                    "Failed to update knowledge graph incrementally:",
                    error,
                );
            }

            try {
                if (aggregatedResults.keyTopics?.length > 0 || aggregatedResults.topics?.length > 0) {
                    await context.agentContext.websiteCollection.updateHierarchicalTopics([
                        websiteObj,
                    ]);
                    debug(
                        `Updated hierarchical topics with ${aggregatedResults.keyTopics?.length || aggregatedResults.topics?.length || 0} topics from ${parameters.url}`,
                    );
                } else {
                    debug(
                        `Skipped hierarchical topics update for ${parameters.url} - no topics extracted`,
                    );
                }
            } catch (error) {
                console.warn(
                    "Failed to update hierarchical topics incrementally:",
                    error,
                );
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
