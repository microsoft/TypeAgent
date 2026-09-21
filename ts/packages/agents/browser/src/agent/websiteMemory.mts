// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { GetWebsiteStats } from "./browserActionSchema.mjs";
import {
    ImportWebsiteData,
    ImportHtmlFolder,
} from "./knowledge/schema/knowledgeImport.mjs";
import { BrowserActionContext } from "./browserActions.mjs";
import {
    searchWebMemories,
    SearchWebMemoriesRequest,
} from "./durableWebSearch.mjs";
import * as website from "@typeagent/website-memory";
import registerDebug from "debug";
import {
    importProgressEvents,
    ImportProgressEvent,
} from "./import/importProgressEvents.mjs";
import {
    ImportStateManager,
    ImportState,
} from "./import/importStateManager.mjs";

function logStructuredProgress(
    current: number,
    total: number,
    description: string,
    phase: string = "processing",
    importContext?: {
        importId: string;
        type: "websiteImport" | "htmlFolderImport";
        url?: string;
        folderPath?: string;
    },
    summary?: {
        totalFiles?: number;
        totalProcessed: number;
        successfullyImported: number;
        knowledgeExtracted?: number;
        entitiesFound: number;
        topicsIdentified: number;
        actionsDetected: number;
    },
    itemDetails?: {
        url?: string;
        title?: string;
        filename?: string;
        currentAction?: string;
    },
    additionalData?: {
        graphBuildingPhase?:
            | "entities"
            | "relationships"
            | "topics"
            | "communities";
        entitiesProcessed?: number;
        relationshipsBuilt?: number;
        topicsHierarchized?: number;
        lastSavePoint?: number;
        nextSavePoint?: number;
        dataPersistedToDisk?: boolean;
        graphPersistedToDb?: boolean;
    },
) {
    if (importContext) {
        const progressEvent: ImportProgressEvent = {
            importId: importContext.importId,
            type: importContext.type,
            phase: phase as ImportProgressEvent["phase"],
            current,
            total,
            description,
            timestamp: Date.now(),
            source:
                importContext.type === "websiteImport" ? "website" : "folder",
            ...(importContext.url && { url: importContext.url }),
            ...(importContext.folderPath && {
                folderPath: importContext.folderPath,
            }),
            ...(summary && { summary }),
            ...(itemDetails && { itemDetails }),
            ...(additionalData && {
                graphBuildingPhase: additionalData.graphBuildingPhase,
                entitiesProcessed: additionalData.entitiesProcessed,
                relationshipsBuilt: additionalData.relationshipsBuilt,
                topicsHierarchized: additionalData.topicsHierarchized,
                lastSavePoint: additionalData.lastSavePoint,
                nextSavePoint: additionalData.nextSavePoint,
                dataPersistedToDisk: additionalData.dataPersistedToDisk,
                graphPersistedToDb: additionalData.graphPersistedToDb,
            }),
        };
        importProgressEvents.emitProgress(progressEvent);
    }

    function importPhaseForMemoryStage(
        stage: string | undefined,
    ): ImportProgressEvent["phase"] {
        switch (stage) {
            case "extracting-knowledge":
            case "embedding":
                return "extracting";
            case "building-indexes":
                return "graph-building";
            case "persisting":
            case "complete":
                return "persisting";
            default:
                return "processing";
        }
    }
}
import { WebsiteData } from "./htmlUtils.mjs";
import {
    enumerateHtmlFiles,
    readHtmlFile,
    validateHtmlFolder,
    getFileMetadata,
    createFileBatches,
    FolderOptions,
    DEFAULT_FOLDER_OPTIONS,
} from "./folderUtils.mjs";
import { processHtmlFolder } from "./websiteImport.mjs";
import { DirectFolderProcessor } from "./htmlProcessor.mjs";
import type { BrowserSourceKnowledge } from "./browserMemoryService.mjs";

const debug = registerDebug("typeagent:browser:website-memory");

/**
 * Resolve URL using website visit history (bookmarks, browser history)
 * This provides a more personalized alternative to web search
 *
 * Refactored to use searchWebMemories for consistent search behavior
 */
export async function resolveURLWithHistory(
    context: { agentContext: BrowserActionContext },
    site: string,
): Promise<string[] | undefined> {
    debug(`Attempting to resolve '${site}' using website visit history`);

    try {
        // Create SessionContext wrapper for searchWebMemories
        // Use minimal required fields - searchWebMemories only needs agentContext
        const sessionContext: SessionContext<BrowserActionContext> = {
            agentContext: context.agentContext,
            sessionStorage: undefined,
            instanceStorage: undefined,
            notify: () => {},
            beginAgentThread: () => {
                throw new Error(
                    "beginAgentThread is not supported on this minimal SessionContext stub",
                );
            },
            popupQuestion: async () => 0,
            toggleTransientAgent: async () => {},
            addDynamicAgent: async () => {},
            removeDynamicAgent: async () => {},
            forceCleanupDynamicAgent: async () => {},
            getSharedLocalHostPort: async () => 0,
            setLocalHostPort: (_port: number) => {},
            registerPort: (_role: string, _port: number) => ({
                release: () => {},
            }),
            sessionContextId: "websiteMemory-mock",
            currentConnectionId: undefined,
            indexes: async () => [],
            reloadAgentSchema: async () => {},
            notifyReadinessChanged: async () => {},
            notifyClientCountChanged: async () => {},
        };

        // Use searchWebMemories with URL resolution optimized parameters
        const searchRequest: SearchWebMemoriesRequest = {
            query: site,
            limit: 5, // Only need top 5 candidates for URL resolution
            minScore: 0.3, // Same threshold as before (lower for broader matching)
            exactMatch: false, // Allow fuzzy matching
            generateAnswer: false, // Don't need answers for URL resolution
            includeRelatedEntities: false, // Don't need entities for URL resolution
            enableAdvancedSearch: true, // Use enhanced search if available
            searchScope: "all_indexed",
            debug: false, // Keep false for production URL resolution
        };

        const response = await searchWebMemories(searchRequest, sessionContext);

        if (response.websites.length === 0) {
            debug(`No matches found for site: '${site}'`);
            return undefined;
        }

        debug(
            `Found ${response.websites.length} candidates from searchWebMemories for: '${site}'`,
        );

        // Use the built-in relevance scores from search results
        const scoredCandidates = response.websites.map((website) => ({
            url: website.url,
            score: website.relevanceScore, // Use native relevance scoring
            metadata: website,
        }));

        // Sort by relevance score and remove duplicates
        const uniqueCandidates = new Map<
            string,
            { url: string; score: number; metadata: any }
        >();
        scoredCandidates.forEach((candidate) => {
            const existing = uniqueCandidates.get(candidate.url);
            if (!existing || candidate.score > existing.score) {
                uniqueCandidates.set(candidate.url, candidate);
            }
        });

        const sortedCandidates = Array.from(uniqueCandidates.values()).sort(
            (a, b) => b.score - a.score,
        );

        // Take the best 3 matches above a reasonable threshold
        const topMatches = sortedCandidates
            .filter((c, index) => c.score >= 0.75 || index == 0)
            .slice(0, 3);
        topMatches.forEach((match) => {
            debug(
                `Found match from searchWebMemories (score: ${match.score.toFixed(2)}): '${match.metadata.title || match.url}' -> ${match.url}`,
            );
            debug(
                `Match details: domain=${match.metadata.domain}, source=${match.metadata.source}`,
            );
        });

        return topMatches.map((m) => m.url);
    } catch (error) {
        debug(
            `Error in resolveURLWithHistory using searchWebMemories: ${error}`,
        );
        return undefined;
    }
}

/**
 * Import website data from browser history or bookmarks
 */
export async function importWebsiteDataFromSession(
    parameters: ImportWebsiteData["parameters"] & {
        importId?: string;
        url?: string;
    },
    context: SessionContext<BrowserActionContext>,
) {
    const importContext: {
        importId: string;
        type: "websiteImport";
        url?: string;
    } = {
        importId: parameters.importId || `website-${Date.now()}`,
        type: "websiteImport" as const,
        ...(parameters.url && { url: parameters.url }),
    };
    const importId = importContext.importId;
    let importState: ImportState | undefined;
    let persistedDuringExtraction = false;

    try {
        const {
            source,
            type,
            limit,
            days,
            folder,
            mode,
            maxConcurrent,
            contentTimeout,
        } = parameters;

        logStructuredProgress(
            0,
            limit ?? 0,
            `Preparing ${type} import from ${source}`,
            "initializing",
            importContext,
        );
        const defaultPaths = website.getDefaultBrowserPaths();

        let filePath: string;
        if (source === "chrome") {
            filePath =
                type === "bookmarks"
                    ? defaultPaths.chrome.bookmarks
                    : defaultPaths.chrome.history;
        } else {
            filePath =
                type === "bookmarks"
                    ? defaultPaths.edge.bookmarks
                    : defaultPaths.edge.history;
        }

        const progressCallback = (
            current: number,
            total: number,
            item: string,
        ) => {
            const itemDetails: { url?: string; title?: string } = {};
            if (item.startsWith("http")) {
                itemDetails.url = item;
            } else {
                itemDetails.title = item;
            }

            logStructuredProgress(
                current,
                total,
                item,
                "processing",
                importContext,
                undefined,
                itemDetails,
            );
        };

        const extractionMode = mode || "basic";

        // Build options object with only defined values
        const importOptions: any = {};
        if (limit !== undefined) importOptions.limit = limit;
        if (days !== undefined) importOptions.days = days;
        if (folder !== undefined) importOptions.folder = folder;

        // Add extraction mode
        if (mode !== undefined) importOptions.mode = mode;
        if (maxConcurrent !== undefined)
            importOptions.maxConcurrent = maxConcurrent;
        if (contentTimeout !== undefined)
            importOptions.contentTimeout = contentTimeout;

        let websites: any[] = [];

        if (extractionMode === "basic") {
            // Basic mode: import metadata only, no content fetching or AI extraction
            websites = await website.importWebsites(
                source,
                type,
                filePath,
                importOptions,
                progressCallback,
            );
        } else {
            // LLM-based modes (content, full, etc.): fetch content and extract knowledge directly
            // First get basic metadata to know what to process
            const metadataWebsites = await website.importWebsites(
                source,
                type,
                filePath,
                { ...importOptions, mode: "basic" },
                progressCallback,
            );

            if (metadataWebsites.length > 0) {
                importState = {
                    importId,
                    totalWebsites: metadataWebsites.length,
                    processedWebsites: 0,
                    lastSavePoint: 0,
                    failedUrls: [],
                    startTime: Date.now(),
                    lastProgressTime: Date.now(),
                    extractionMode,
                    source,
                    type,
                    filePath,
                };
                await ImportStateManager.saveImportState(importState);
                logStructuredProgress(
                    0,
                    metadataWebsites.length,
                    `Fetching and extracting with ${extractionMode} mode`,
                    "extracting",
                    importContext,
                );

                logStructuredProgress(
                    0,
                    metadataWebsites.length,
                    "Fetching content from URLs",
                    "fetching",
                    importContext,
                );

                const htmlFetcher = new website.HtmlFetcher();
                const htmlProcessor = new DirectFolderProcessor();
                let persistedCount = 0;

                for (let i = 0; i < metadataWebsites.length; i++) {
                    const site = metadataWebsites[i];
                    const fetchResult = await htmlFetcher.fetchHtml(
                        site.metadata.url,
                        importOptions.contentTimeout || 10000,
                    );

                    if (fetchResult.html) {
                        try {
                            const reduced =
                                await htmlProcessor.processHtmlContent(
                                    fetchResult.html,
                                    site.metadata.url,
                                    { mode: "content" },
                                );
                            if (reduced.textContent.trim().length > 0) {
                                const completedWebsite: any = {
                                    ...site,
                                    textChunks: [reduced.textContent],
                                };
                                websites.push(completedWebsite);
                                const knowledge =
                                    await ingestWebsitesIntoMemoryService(
                                        [completedWebsite],
                                        extractionMode,
                                        context.agentContext,
                                        importContext,
                                        i,
                                        metadataWebsites.length,
                                        importOptions.maxCharsPerChunk,
                                    );
                                completedWebsite.knowledge = {
                                    entities: knowledge[0].entities,
                                    topics: knowledge[0].topics.map(
                                        (topic) => topic.name,
                                    ),
                                    actions: knowledge[0].relationships,
                                };
                                persistedDuringExtraction = true;
                                persistedCount++;
                                importState.processedWebsites = persistedCount;
                                importState.lastSavePoint = persistedCount;
                                importState.lastProgressTime = Date.now();
                                await ImportStateManager.saveImportState(
                                    importState,
                                );
                            }
                        } catch (error) {
                            debug(
                                `Failed to process HTML for ${site.metadata.url}:`,
                                error,
                            );
                            importState.failedUrls.push(site.metadata.url);
                        }
                    } else {
                        debug(
                            `Failed to fetch content for ${site.metadata.url}: ${fetchResult.error}`,
                        );

                        if (
                            fetchResult.error?.includes("404") ||
                            fetchResult.error?.includes("403") ||
                            fetchResult.error?.includes("410")
                        ) {
                            importState.failedUrls.push(site.metadata.url);
                        }
                    }

                    logStructuredProgress(
                        i + 1,
                        metadataWebsites.length,
                        `Processed ${i + 1}/${metadataWebsites.length} pages`,
                        "processing",
                        importContext,
                    );
                }
            }
        }

        // Set up periodic durable-ingestion checkpoints.
        const pendingWebsites = persistedDuringExtraction ? [] : websites;
        const chunkSize = Math.min(50, Math.ceil(pendingWebsites.length * 0.2));
        const savePoints = ImportStateManager.calculateSavePoints(
            websites.length,
        );
        let currentSavePointIndex = 0;

        // Initialize import state
        if (importState === undefined) {
            importState = {
                importId,
                totalWebsites: websites.length,
                processedWebsites: 0,
                lastSavePoint: 0,
                failedUrls: [],
                startTime: Date.now(),
                lastProgressTime: Date.now(),
                extractionMode,
                source,
                type,
                filePath,
            };
            await ImportStateManager.saveImportState(importState);
        }

        for (let i = 0; i < pendingWebsites.length; i += chunkSize) {
            const chunk = pendingWebsites.slice(i, i + chunkSize);
            const chunkIndex = Math.floor(i / chunkSize) + 1;
            const totalChunks = Math.ceil(websites.length / chunkSize);
            const processedCount = i + chunk.length;

            logStructuredProgress(
                processedCount,
                websites.length,
                `Persisting durable memory (chunk ${chunkIndex}/${totalChunks})`,
                "persisting",
                importContext,
                undefined, // summary
                undefined, // itemDetails
                {
                    graphBuildingPhase: "entities",
                    nextSavePoint: savePoints[currentSavePointIndex],
                    lastSavePoint: importState.lastSavePoint,
                },
            );

            const knowledge = await ingestWebsitesIntoMemoryService(
                chunk,
                extractionMode,
                context.agentContext,
                importContext,
                i,
                websites.length,
                importOptions.maxCharsPerChunk,
            );
            for (const [itemIndex, item] of chunk.entries()) {
                const itemKnowledge = knowledge[itemIndex];
                item.knowledge = {
                    entities: itemKnowledge.entities,
                    topics: itemKnowledge.topics.map((topic) => topic.name),
                    actions: itemKnowledge.relationships,
                };
            }

            // Check if we should save progress
            if (
                currentSavePointIndex < savePoints.length &&
                processedCount >= savePoints[currentSavePointIndex]
            ) {
                logStructuredProgress(
                    processedCount,
                    websites.length,
                    `Saving progress (${processedCount}/${websites.length} websites)`,
                    "persisting",
                    importContext,
                    undefined, // summary
                    undefined, // itemDetails
                    {
                        dataPersistedToDisk: false,
                        graphPersistedToDb: false,
                    },
                );

                try {
                    // Update import state
                    importState.processedWebsites = processedCount;
                    importState.lastSavePoint = processedCount;
                    importState.lastProgressTime = Date.now();
                    await ImportStateManager.saveImportState(importState);

                    logStructuredProgress(
                        processedCount,
                        websites.length,
                        `Progress saved (${processedCount}/${websites.length} websites)`,
                        "persisting",
                        importContext,
                        undefined, // summary
                        undefined, // itemDetails
                        {
                            dataPersistedToDisk: true,
                            graphPersistedToDb: true,
                            lastSavePoint: processedCount,
                        },
                    );

                    currentSavePointIndex++;
                } catch (error) {
                    debug(
                        `Failed to save progress at ${processedCount}: ${error}`,
                    );
                }
            }
        }

        debug(`Website import completed for ${websites.length} websites`);

        // Durable ingestion has already persisted every completed chunk.
        try {
            await ImportStateManager.deleteImportState(importId);
            debug(`Cleaned up import state for ${importId}`);
        } catch (error) {
            debug(`Failed to clean up import state: ${error}`);
        }

        // Calculate knowledge statistics for the completion event
        let totalEntities = 0;
        const uniqueTopics = new Set<string>();
        let totalActions = 0;

        websites.forEach((website) => {
            if (website.knowledge) {
                // Count entities
                if (website.knowledge.entities?.length > 0) {
                    totalEntities += website.knowledge.entities.length;
                }

                // Collect unique topics
                if (website.knowledge.topics?.length > 0) {
                    website.knowledge.topics.forEach((topic: string) => {
                        uniqueTopics.add(topic.toLowerCase().trim());
                    });
                }

                // Count actions
                if (website.knowledge.actions?.length > 0) {
                    totalActions += website.knowledge.actions.length;
                }
            }
        });

        const summaryStats = {
            totalProcessed: websites.length,
            successfullyImported: websites.length,
            entitiesFound: totalEntities,
            topicsIdentified: uniqueTopics.size,
            actionsDetected: totalActions,
        };

        // Send final completion event with summary
        logStructuredProgress(
            websites.length,
            websites.length,
            `Import complete - ${websites.length} items imported`,
            "complete",
            importContext,
            summaryStats,
        );

        return {
            success: true,
            message: `Successfully imported ${websites.length} ${type} from ${source}.`,
            itemCount: websites.length,
            summary: summaryStats,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message,
            message: `Failed to import website data: ${error.message}`,
        };
    }
}

/**
 * Import website data from browser history or bookmarks (ActionContext version for regular actions)
 */
export async function importWebsiteData(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<ImportWebsiteData>,
) {
    try {
        context.actionIO.setDisplay("Importing website data...");

        const result = await importWebsiteDataFromSession(
            action.parameters,
            context.sessionContext,
        );

        if (result.success) {
            return createActionResult(result.message);
        } else {
            return createActionResult(result.message, true);
        }
    } catch (error: any) {
        return createActionResult(
            `Failed to import website data: ${error.message}`,
            true,
        );
    }
}

/**
 * Import HTML files from local folder (SessionContext version for service worker calls)
 */
export async function importHtmlFolderFromSession(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    const importContext = {
        importId: parameters.importId || `folder-${Date.now()}`,
        type: "htmlFolderImport" as const,
        folderPath: parameters.folderPath,
    };

    const startTime = Date.now();

    const { folderPath, options = {}, importId } = parameters;

    try {
        logStructuredProgress(
            0,
            0,
            `Scanning folder: ${folderPath}`,
            "initializing",
            importContext,
        );
        const errors: any[] = [];
        let successCount = 0;

        const extractionMode = options.mode || "basic";

        // Validate folder path first
        const validation = await validateHtmlFolder(folderPath, options);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        if (validation.warning) {
            console.warn(`Warning: ${validation.warning}`);
        }

        // Enumerate HTML files in the folder
        const folderOptions: FolderOptions = {
            ...DEFAULT_FOLDER_OPTIONS,
            ...options,
        };

        const htmlFiles = await enumerateHtmlFiles(folderPath, folderOptions);

        if (htmlFiles.length === 0) {
            throw new Error(`No HTML files found in folder: ${folderPath}`);
        }

        logStructuredProgress(
            0,
            htmlFiles.length,
            `Found ${htmlFiles.length} files to import`,
            "initializing",
            importContext,
        );

        // Process files in batches for better performance and progress reporting
        const batches = createFileBatches(htmlFiles, 10);
        const websiteDataResults: WebsiteData[] = [];

        let totalProcessedFiles = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

            const firstFileInBatch = batch[0];
            const batchFilename = firstFileInBatch
                ? firstFileInBatch.split(/[\\/]/).pop()
                : undefined;

            const itemDetails: { filename?: string; currentAction?: string } = {
                currentAction: `batch ${batchIndex + 1}/${batches.length}`,
            };
            if (batchFilename) {
                itemDetails.filename = batchFilename;
            }

            logStructuredProgress(
                totalProcessedFiles,
                htmlFiles.length,
                batchFilename || `Batch ${batchIndex + 1}/${batches.length}`,
                "processing",
                importContext,
                undefined,
                itemDetails,
            );

            // Read and prepare batch data
            const batchData = [];
            for (const filePath of batch) {
                try {
                    const htmlContent = await readHtmlFile(filePath);
                    const fileMetadata = await getFileMetadata(filePath);

                    batchData.push({
                        html: htmlContent,
                        identifier: filePath,
                        metadata: fileMetadata,
                    });
                } catch (error: any) {
                    errors.push({
                        type: "file_read",
                        message: `Failed to read ${filePath}: ${error.message}`,
                        timestamp: Date.now(),
                    });
                    debug(`Error reading file ${filePath}:`, error);
                }
            }

            // Process the batch using enhanced HTML processing for consistency
            try {
                const batchResults = [];

                for (const item of batchData) {
                    try {
                        // Try HTML processing first
                        const enhancedResult = await processHtmlFolder(
                            item.html,
                            item.identifier,
                            context,
                        );

                        const input = {
                            url: `file://${item.identifier}`,
                            title: item.metadata.filename,
                            textContent: enhancedResult.text,
                        };

                        // Convert to WebsiteData format (simplified)
                        const websiteData: WebsiteData = {
                            url: input.url,
                            title: input.title,
                            content: enhancedResult.text,
                            domain: "file",
                            metadata: {
                                websiteSource: "file_import",
                                url: input.url,
                                title: input.title,
                                domain: "file",
                                pageType: "document",
                                importDate: new Date().toISOString(),
                                lastModified:
                                    item.metadata.lastModified || new Date(),
                                filename: item.metadata.filename,
                                filePath: item.identifier,
                                processingMethod:
                                    enhancedResult.processingMethod,
                            },
                            visitCount: 1,
                            lastVisited: new Date(),
                        };

                        batchResults.push(websiteData);
                    } catch (error: any) {
                        errors.push({
                            type: "file_processing",
                            message: `Failed to process ${item.identifier}: ${error.message}`,
                            timestamp: Date.now(),
                        });
                        debug(
                            `Error processing file ${item.identifier}:`,
                            error,
                        );
                    }
                }

                websiteDataResults.push(...batchResults);
                successCount += batchResults.length;
                totalProcessedFiles += batch.length;

                logStructuredProgress(
                    totalProcessedFiles,
                    htmlFiles.length,
                    `Completed batch ${batchIndex + 1}/${batches.length}`,
                    "processing",
                    importContext,
                );
            } catch (error: any) {
                errors.push({
                    type: "batch_processing",
                    message: `Failed to process batch ${batchIndex + 1}: ${error.message}`,
                    timestamp: Date.now(),
                });
                debug(`Error processing batch ${batchIndex + 1}:`, error);
            }
        }

        const importedEntities = new Set<string>();
        const importedTopics = new Set<string>();
        let importedRelationshipCount = 0;

        // Add all processed websites to the collection
        if (websiteDataResults.length > 0) {
            const websites = websiteDataResults.map((data) =>
                convertWebsiteDataToWebsite(data),
            );

            const chunkSize = Math.min(50, Math.ceil(websites.length * 0.2));

            for (let i = 0; i < websites.length; i += chunkSize) {
                const chunk = websites.slice(i, i + chunkSize);
                const chunkIndex = Math.floor(i / chunkSize) + 1;
                const totalChunks = Math.ceil(websites.length / chunkSize);

                logStructuredProgress(
                    i + chunk.length,
                    websites.length,
                    `Persisting durable memory (chunk ${chunkIndex}/${totalChunks})`,
                    "persisting",
                    importContext,
                );

                const knowledge = await ingestWebsitesIntoMemoryService(
                    chunk,
                    extractionMode,
                    context.agentContext,
                    importContext,
                    i,
                    websites.length,
                    options?.maxCharsPerChunk,
                );
                for (const itemKnowledge of knowledge) {
                    for (const entity of itemKnowledge.entities) {
                        importedEntities.add(entity.name.toLowerCase());
                    }
                    for (const topic of itemKnowledge.topics) {
                        importedTopics.add(topic.name.toLowerCase());
                    }
                    importedRelationshipCount +=
                        itemKnowledge.relationships.length;
                }
            }

            debug(`HTML file import completed for ${websites.length} files`);
        }

        const duration = Date.now() - startTime;

        const summaryStats = {
            totalFiles: htmlFiles.length,
            totalProcessed: htmlFiles.length,
            successfullyImported: successCount,
            knowledgeExtracted: options?.mode !== "basic" ? successCount : 0,
            entitiesFound: importedEntities.size,
            topicsIdentified: importedTopics.size,
            actionsDetected: importedRelationshipCount,
        };

        // Send final progress event with summary
        logStructuredProgress(
            htmlFiles.length,
            htmlFiles.length,
            `Import complete - ${successCount} successful`,
            "complete",
            importContext,
            summaryStats,
        );

        return {
            success: errors.length === 0,
            importId: importId,
            itemCount: successCount,
            duration,
            errors,
            summary: summaryStats,
        };
    } catch (error: any) {
        logStructuredProgress(0, 0, error.message, "error", importContext);
        return {
            success: false,
            importId: parameters.importId,
            itemCount: 0,
            duration: Date.now() - startTime,
            errors: [
                {
                    type: "processing",
                    message: error.message,
                    timestamp: Date.now(),
                },
            ],
            summary: {
                totalFiles: 0,
                totalProcessed: 0,
                successfullyImported: 0,
                knowledgeExtracted: 0,
                entitiesFound: 0,
                topicsIdentified: 0,
                actionsDetected: 0,
            },
        };
    }
}

/**
 * Import HTML files from local folder (ActionContext version for regular actions)
 */
export async function importHtmlFolder(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<ImportHtmlFolder>,
) {
    try {
        context.actionIO.setDisplay("Importing HTML folder...");

        const result = await importHtmlFolderFromSession(
            action.parameters,
            context.sessionContext,
        );

        if (result.success) {
            return createActionResult(
                `Successfully imported ${result.itemCount} HTML files from folder.`,
            );
        } else {
            const errorCount = result.errors.length;
            const message = `Folder import completed: ${result.itemCount} successful, ${errorCount} failed.`;
            return createActionResult(message, errorCount > 0);
        }
    } catch (error: any) {
        return createActionResult(
            `Failed to import HTML folder: ${error.message}`,
            true,
        );
    }
}

/**
 * Helper function to convert WebsiteData to Website format for collection storage
 */
function convertWebsiteDataToWebsite(data: WebsiteData): any {
    // Create a proper WebsiteVisitInfo object for WebsiteMeta
    const visitInfo: website.WebsiteVisitInfo = {
        url: data.url,
        title: data.title,
        domain: data.domain,
        source: data.metadata.websiteSource as
            | "bookmark"
            | "history"
            | "reading_list",
        visitDate: data.lastVisited
            ? data.lastVisited.toISOString()
            : new Date().toISOString(),
        description: data.content.substring(0, 500), // Use first 500 chars as description
        visitCount: data.visitCount || 1,
        lastVisitTime: data.lastVisited
            ? data.lastVisited.toISOString()
            : new Date().toISOString(),
    };

    // Add optional properties only if they exist
    if (data.metadata.pageType) {
        visitInfo.pageType = data.metadata.pageType;
    }

    // Create a proper WebsiteMeta instance
    const websiteMeta = new website.WebsiteMeta(visitInfo);

    // Create and return a Website instance using the proper constructor
    const websiteInstance = new website.Website(
        websiteMeta,
        data.content,
        [], // tags
        data.extractionResult?.knowledge, // knowledge from extraction
        undefined, // topicHierarchy
        undefined, // deletionInfo
        false, // isNew = false since content is already processed
    );

    return websiteInstance;
}

async function ingestWebsitesIntoMemoryService(
    websites: website.Website[],
    mode: website.ExtractionMode,
    agentContext: BrowserActionContext,
    importContext: {
        importId: string;
        type: "websiteImport" | "htmlFolderImport";
        url?: string;
        folderPath?: string;
    },
    offset: number,
    total: number,
    maxCharsPerChunk?: number,
): Promise<BrowserSourceKnowledge[]> {
    const memoryService = agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    const results: BrowserSourceKnowledge[] = [];
    for (const [index, item] of websites.entries()) {
        const knowledge = await memoryService.ingest(
            {
                url: item.metadata.url,
                title: item.metadata.title ?? item.metadata.url,
                markdown: item.textChunks.join("\n\n"),
                source: item.metadata.websiteSource,
                ...(item.metadata.domain === undefined
                    ? {}
                    : { domain: item.metadata.domain }),
                ...(item.metadata.pageType === undefined
                    ? {}
                    : { pageType: item.metadata.pageType }),
                ...(item.timestamp === undefined
                    ? {}
                    : { capturedAt: item.timestamp }),
                tags: item.tags,
            },
            mode,
            {
                ...(maxCharsPerChunk === undefined
                    ? {}
                    : { maxCharsPerChunk }),
                onProgress: (progress) =>
                    logStructuredProgress(
                        offset +
                            index +
                            progress.completed /
                                Math.max(progress.total ?? 1, 1),
                        total,
                        progress.message ??
                            `Indexing ${item.metadata.title ?? item.metadata.url}`,
                        importPhaseForMemoryStage(progress.stage),
                        importContext,
                        undefined,
                        {
                            url: item.metadata.url,
                            ...(item.metadata.title === undefined
                                ? {}
                                : { title: item.metadata.title }),
                            currentAction: "indexing",
                        },
                    ),
            },
        );
        results.push(knowledge);
        logStructuredProgress(
            offset + index + 1,
            total,
            `Stored ${item.metadata.title ?? item.metadata.url} in durable memory`,
            "persisting",
            importContext,
        );
    }
    return results;
}

/**
 * Get statistics about imported website data
 */
export async function getWebsiteStats(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<GetWebsiteStats>,
) {
    try {
        const memory = context.sessionContext.agentContext.browserMemoryService;
        if (memory === undefined) {
            return createActionResult(
                "Durable browser memory is not available.",
                true,
            );
        }
        const sources = await memory.listSources();
        if (sources.length === 0) {
            return createActionResult(
                "No website data available. Please import website data first.",
                true,
            );
        }

        const { groupBy = "domain", limit = 10 } = action.parameters || {};

        const stats: { [key: string]: number } = {};
        const totalCount = sources.length;

        for (const source of sources) {
            const metadata = source.metadata ?? {};
            let key: string;

            switch (groupBy) {
                case "domain":
                    key = String(metadata.domain || "unknown");
                    break;
                case "pageType":
                    key = String(metadata.pageType || "general");
                    break;
                case "source":
                    key = String(metadata.source || "unknown");
                    break;
                default:
                    key = String(metadata.domain || "unknown");
            }

            stats[key] = (stats[key] || 0) + 1;
        }

        // Sort by count and limit
        const sortedStats = Object.entries(stats)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit);

        let resultText = `Website Statistics (Total: ${totalCount} sites)\n\n`;
        resultText += `Top ${groupBy}s:\n`;

        for (const [key, count] of sortedStats) {
            const percentage = ((count / totalCount) * 100).toFixed(1);
            resultText += `  ${key}: ${count} sites (${percentage}%)\n`;
        }

        // Add some additional stats
        if (groupBy !== "source") {
            const sourceCounts = { bookmark: 0, history: 0, reading_list: 0 };
            for (const item of sources) {
                const source = item.metadata?.source;
                if (
                    source === "bookmark" ||
                    source === "history" ||
                    source === "reading_list"
                ) {
                    sourceCounts[source]++;
                }
            }
            resultText += `\nBy Source:\n`;
            for (const [source, count] of Object.entries(sourceCounts)) {
                if (count > 0) {
                    const percentage = ((count / totalCount) * 100).toFixed(1);
                    resultText += `  ${source}: ${count} sites (${percentage}%)\n`;
                }
            }
        }

        return createActionResult(resultText);
    } catch (error: any) {
        return createActionResult(
            `Failed to get website stats: ${error.message}`,
            true,
        );
    }
}
