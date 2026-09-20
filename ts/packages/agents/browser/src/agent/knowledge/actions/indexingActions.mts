// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import * as website from "@typeagent/website-memory";
import { createExtractionInputsFromFragments } from "./extractionActions.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:knowledge");

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
        let combinedTextContent = "";

        if (parameters.extractedKnowledge) {
            combinedTextContent = parameters.extractedKnowledge.summary || "";
        } else {
            const extractionInputs = createExtractionInputsFromFragments(
                parameters.htmlFragments!,
                parameters.url,
                parameters.title,
                "index",
                parameters.timestamp,
            );
            combinedTextContent = extractionInputs
                .map((input) => input.textContent)
                .join("\n\n");
        }

        const memoryService = context.agentContext.browserMemoryService;
        if (memoryService === undefined) {
            throw new Error("Durable browser memory is not available");
        }
        await memoryService.ingest(
            {
                url: parameters.url,
                title: parameters.title,
                markdown: combinedTextContent,
                source: "current-page",
                capturedAt: parameters.timestamp,
            },
            parameters.mode ?? "content",
        );
        debug(`Stored current page in durable memory: ${parameters.url}`);

        const source = await memoryService.getSource(parameters.url);
        const graph = await memoryService.getKnowledgeGraph();
        const entityCount =
            source === undefined
                ? 0
                : graph.entities.filter((entity) =>
                      entity.sourceIds.includes(source.sourceId),
                  ).length;

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

export async function checkPageIndexStatus(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    lastIndexed: string | null;
    entityCount: number;
}> {
    try {
        const memoryService = context.agentContext.browserMemoryService;
        if (memoryService === undefined) {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
        const source = await memoryService.getSource(parameters.url);
        if (source === undefined) {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
        const revision = source.revisions.find(
            (candidate) => candidate.revisionId === source.activeRevisionId,
        );
        const graph = await memoryService.getKnowledgeGraph();
        return {
            isIndexed: true,
            lastIndexed: revision?.indexedAt ?? revision?.capturedAt ?? null,
            entityCount: graph.entities.filter((entity) =>
                entity.sourceIds.includes(source.sourceId),
            ).length,
        };
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
