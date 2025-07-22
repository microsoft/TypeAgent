// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    GetWebsiteStats,
} from "./actionsSchema.mjs";
import {
    ImportWebsiteData,
    ImportHtmlFolder,
} from "./knowledge/schema/knowledgeImport.mjs";
import { BrowserActionContext } from "./actionHandler.mjs";
import {
    searchWebMemories,
    SearchWebMemoriesRequest,
} from "./searchWebMemories.mjs";
import * as website from "website-memory";
import * as kpLib from "knowledge-processor";
import { openai as ai } from "aiclient";
import registerDebug from "debug";
import * as path from "path";

/**
 * Helper function to log structured progress for reliable parsing
 */
function logStructuredProgress(
    current: number,
    total: number,
    description: string,
    phase: string = "processing",
    displayProgress?: (message: string) => void,
) {
    const progressData = {
        type: "PROGRESS_UPDATE",
        current: current,
        total: total,
        description: description,
        phase: phase,
        timestamp: Date.now(),
    };

    const progressMessage = `PROGRESS_JSON:${JSON.stringify(progressData)}`;

    if (displayProgress) {
        displayProgress(progressMessage);
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
import {
    ExtractionInput,
    BatchProgress,
    AIModelRequiredError,
} from "website-memory";
import { BrowserKnowledgeExtractor } from "./knowledge/browserKnowledgeExtractor.mjs";

import {
    createContentExtractor,
    logProcessingStatus,
    processHtmlFolder,
} from "./websiteImport.mjs";

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
): Promise<string | undefined> {
    debug(`Attempting to resolve '${site}' using website visit history`);

    const websiteCollection = context.agentContext.websiteCollection;
    if (!websiteCollection || websiteCollection.messages.length === 0) {
        debug("No website collection available or empty");
        return undefined;
    }

    try {
        // Create SessionContext wrapper for searchWebMemories
        // Use minimal required fields - searchWebMemories only needs agentContext
        const sessionContext: SessionContext<BrowserActionContext> = {
            agentContext: context.agentContext,
            sessionStorage: undefined,
            instanceStorage: undefined,
            notify: () => {},
            popupQuestion: async () => 0,
            toggleTransientAgent: async () => {},
            addDynamicAgent: async () => {},
            removeDynamicAgent: async () => {},
            getSharedLocalHostPort: async () => 0,
            indexes: async () => [],
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

        const bestMatch = sortedCandidates[0];

        debug(
            `Found best match from searchWebMemories (score: ${bestMatch.score.toFixed(2)}): '${bestMatch.metadata.title || bestMatch.url}' -> ${bestMatch.url}`,
        );
        debug(
            `Match details: domain=${bestMatch.metadata.domain}, source=${bestMatch.metadata.source}`,
        );

        return bestMatch.url;
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
    parameters: ImportWebsiteData["parameters"],
    context: SessionContext<BrowserActionContext>,
    displayProgress?: (message: string) => void,
) {
    try {
        logStructuredProgress(
            0,
            0,
            "Starting website data import",
            "initializing",
            displayProgress,
        );

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

        // Enhanced progress callback that uses structured JSON logging
        const progressCallback = (
            current: number,
            total: number,
            item: string,
        ) => {
            logStructuredProgress(
                current,
                total,
                item,
                "processing",
                displayProgress,
            );
        };

        const extractionMode = mode || "basic";

        // Log processing status for debugging
        logProcessingStatus(context);

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

        // For AI-enabled modes, validate AI availability before starting import
        if (extractionMode !== "basic") {
            try {
                const extractor = new BrowserKnowledgeExtractor(context);
                // This will throw AIModelRequiredError if AI model is not available
                await extractor.extractKnowledge(
                    {
                        url: "test://validation",
                        title: "Validation Test",
                        textContent: "test content for validation",
                        source: "direct",
                    },
                    extractionMode,
                );
            } catch (error) {
                if (error instanceof AIModelRequiredError) {
                    throw new Error(
                        `Cannot import with ${extractionMode} mode: ${error.message}`,
                    );
                }
            }
        }

        // Create AI model for intelligent analysis if AI mode is enabled
        if (extractionMode !== "basic") {
            try {
                const apiSettings = ai.azureApiSettingsFromEnv(
                    ai.ModelType.Chat,
                    undefined,
                    undefined, // Use default model
                );
                const chatModel = ai.createChatModel(
                    apiSettings,
                    undefined,
                    undefined,
                    ["website-analysis"],
                );

                // Create knowledge extractor for ContentExtractor
                importOptions.knowledgeExtractor =
                    kpLib.conversation.createKnowledgeExtractor(chatModel);

                debug(
                    "Created chat model and knowledge extractor for intelligent analysis",
                );
            } catch (error) {
                debug(
                    "Failed to create chat model for intelligent analysis:",
                    error,
                );
                throw new Error(
                    `Cannot import with ${extractionMode} mode: AI model required but not available`,
                );
            }
        }

        // Import websites using basic import first to get metadata
        let websites: any[] = await website.importWebsites(
            source,
            type,
            filePath,
            importOptions,
            progressCallback,
        );

        // Enhance with HTML content fetching and AI analysis for non-basic modes
        if (extractionMode !== "basic" && websites.length > 0) {
            logStructuredProgress(
                0,
                websites.length,
                "Starting content fetching and AI analysis",
                "extracting",
                displayProgress,
            );

            // Create inputs that will trigger HTML fetching in ContentExtractor
            const contentInputs: ExtractionInput[] = websites.map((site) => ({
                url: site.metadata.url,
                title: site.metadata.title || site.metadata.url,
                // NO textContent or htmlContent - let ContentExtractor fetch HTML
                source: type === "bookmarks" ? "bookmark" : "history",
                timestamp:
                    site.metadata.visitDate || site.metadata.bookmarkDate,
            }));

            try {
                // Create ContentExtractor with AI model
                const extractor = createContentExtractor(
                    {
                        mode: extractionMode,
                        knowledgeExtractor: importOptions.knowledgeExtractor,
                        timeout: importOptions.contentTimeout || 10000,
                        maxConcurrentExtractions:
                            importOptions.maxConcurrent || 5,
                    },
                    context,
                );

                // Use BatchProcessor for efficient processing
                const batchProcessor = new website.BatchProcessor(extractor);

                const enhancedProgressCallback = (progress: BatchProgress) => {
                    const phase =
                        progress.processed <= progress.total * 0.6
                            ? "fetching"
                            : "extracting";
                    const description = `${progress.processed <= progress.total * 0.6 ? "Fetching content" : "Analyzing with AI"} (${progress.percentage}%)`;
                    logStructuredProgress(
                        progress.processed,
                        progress.total,
                        description,
                        phase,
                        displayProgress,
                    );
                };

                const enhancedResults = await batchProcessor.processBatch(
                    contentInputs,
                    extractionMode,
                    enhancedProgressCallback,
                );

                // Apply results back to websites
                enhancedResults.forEach((result, index) => {
                    if (websites[index] && result.knowledge) {
                        websites[index].knowledge = result.knowledge;

                        // Update textChunks with actual fetched content
                        if (result.pageContent?.mainContent) {
                            websites[index].textChunks = [
                                result.pageContent.mainContent,
                            ];
                        }
                    }
                });

                if (displayProgress) {
                    logStructuredProgress(
                        enhancedResults.length,
                        enhancedResults.length,
                        `Enhanced ${enhancedResults.length} items with ${extractionMode} mode extraction`,
                        "complete",
                        displayProgress,
                    );
                }
            } catch (error) {
                if (error instanceof AIModelRequiredError) {
                    throw error;
                }
                console.warn(
                    "Enhanced extraction failed, using basic import:",
                    error,
                );
            }
        }

        if (!context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection =
                new website.WebsiteCollection();
        }

        context.agentContext.websiteCollection.addWebsites(websites);

        try {
            await context.agentContext.websiteCollection.addToIndex();
        } catch (error) {
            debug(
                `Incremental indexing failed, falling back to full rebuild: ${error}`,
            );
            await context.agentContext.websiteCollection.buildIndex();
        }

        // Update entity graph with new websites using entity processing service
        try {
            debug("Processing entities for imported websites...");
            const { getEntityProcessingService } = await import(
                "./knowledge/entityProcessingService.mjs"
            );
            const entityProcessor = getEntityProcessingService();
            await entityProcessor.processWebsites(
                websites,
                context.agentContext.websiteCollection,
            );
            debug(
                `Entity processing completed for ${websites.length} websites`,
            );
        } catch (error) {
            debug("Entity processing failed:", error);
            // Don't fail the import if entity processing fails
        }

        // Persist the website collection to disk
        try {
            if (context.agentContext.index?.path) {
                await context.agentContext.websiteCollection.writeToFile(
                    context.agentContext.index.path,
                    "index",
                );
                debug(
                    `Saved website collection to ${context.agentContext.index.path}`,
                );
            } else {
                debug("No index path available, website data not persisted");
            }
        } catch (error) {
            debug(`Failed to save website collection: ${error}`);
        }

        return {
            success: true,
            message: `Successfully imported ${websites.length} ${type} from ${source}.`,
            itemCount: websites.length,
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

        // Use the session-based function and pass actionIO.setDisplay for progress reporting
        const result = await importWebsiteDataFromSession(
            action.parameters,
            context.sessionContext,
            context.actionIO.setDisplay,
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
    displayProgress?: (message: string) => void,
): Promise<any> {
    const startTime = Date.now();

    try {
        logStructuredProgress(
            0,
            0,
            "Validating folder and enumerating HTML files",
            "initializing",
            displayProgress,
        );

        const { folderPath, options = {}, importId } = parameters;
        const errors: any[] = [];
        let successCount = 0;

        const extractionMode = options.mode || "basic";

        // Initialize import options for folder processing
        let importOptions: any = {};

        // For AI-enabled modes, validate AI availability before starting import
        if (extractionMode !== "basic") {
            try {
                // Create and validate the knowledge extractor (same logic as BrowserKnowledgeExtractor)
                const apiSettings = ai.azureApiSettingsFromEnv(
                    ai.ModelType.Chat,
                );
                const languageModel = ai.createChatModel(apiSettings);
                const knowledgeExtractor =
                    kpLib.conversation.createKnowledgeExtractor(languageModel);

                // Validate that the knowledge extractor works by testing extraction
                const testResult = await knowledgeExtractor.extract(
                    "test content for validation",
                );
                if (!testResult) {
                    throw new Error("Knowledge extractor validation failed");
                }

                // Store the validated knowledge extractor in import options
                importOptions.knowledgeExtractor = knowledgeExtractor;
            } catch (error) {
                if (error instanceof AIModelRequiredError) {
                    throw new Error(
                        `Cannot import HTML folder with ${extractionMode} mode: ${error.message}`,
                    );
                } else {
                    throw new Error(
                        `AI model initialization failed for ${extractionMode} mode: ${(error as Error).message}. Please check AI model configuration or use 'basic' mode.`,
                    );
                }
            }
        }

        // Validate folder path first
        const validation = await validateHtmlFolder(folderPath, options);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        if (validation.warning && displayProgress) {
            displayProgress(`Warning: ${validation.warning}`);
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
            `Found ${htmlFiles.length} HTML files`,
            "initializing",
            displayProgress,
        );

        // Send initial progress update with total count
        logStructuredProgress(
            0,
            htmlFiles.length,
            "Starting import",
            "processing",
            displayProgress,
        );

        // Ensure we have a website collection
        if (!context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection =
                new website.WebsiteCollection();
        }

        // Process files in batches for better performance and progress reporting
        const batches = createFileBatches(htmlFiles, 10);
        const websiteDataResults: WebsiteData[] = [];

        let totalProcessedFiles = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

            logStructuredProgress(
                totalProcessedFiles,
                htmlFiles.length,
                `Processing batch ${batchIndex + 1}/${batches.length}`,
                "processing",
                displayProgress,
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
                        if (displayProgress) {
                            displayProgress(
                                `Processing: ${path.basename(item.identifier)}`,
                            );
                        }

                        // Try HTML processing first
                        const enhancedResult = await processHtmlFolder(
                            item.html,
                            item.identifier,
                            context,
                        );

                        // Create extraction input with processed content
                        const input: ExtractionInput = {
                            url: `file://${item.identifier}`,
                            title: item.metadata.filename,
                            htmlContent: enhancedResult.html,
                            textContent: enhancedResult.text,
                            source: "import",
                        };

                        // Use extractor for consistent processing
                        const extractor = createContentExtractor(
                            {
                                mode: extractionMode,
                                knowledgeExtractor:
                                    importOptions.knowledgeExtractor,
                            },
                            context,
                        );

                        const extractionResult = await extractor.extract(
                            input,
                            extractionMode,
                        );

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
                            extractionResult: extractionResult,
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

                // Update progress after processing batch
                logStructuredProgress(
                    totalProcessedFiles,
                    htmlFiles.length,
                    `Completed batch ${batchIndex + 1}/${batches.length}`,
                    "processing",
                    displayProgress,
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

        // Add all processed websites to the collection
        if (websiteDataResults.length > 0) {
            const websites = websiteDataResults.map((data) =>
                convertWebsiteDataToWebsite(data),
            );
            context.agentContext.websiteCollection.addWebsites(websites);

            try {
                await context.agentContext.websiteCollection.addToIndex();
            } catch (error) {
                debug(
                    `Incremental indexing failed, falling back to full rebuild: ${error}`,
                );
                await context.agentContext.websiteCollection.buildIndex();
            }

            // Process entities for imported HTML files
            try {
                debug("Processing entities for imported HTML files...");
                const { getEntityProcessingService } = await import(
                    "./knowledge/entityProcessingService.mjs"
                );
                const entityProcessor = getEntityProcessingService();
                await entityProcessor.processWebsites(
                    websites,
                    context.agentContext.websiteCollection,
                );
                debug(
                    `Entity processing completed for ${websites.length} HTML files`,
                );
            } catch (error) {
                debug("Entity processing failed:", error);
                // Don't fail the import if entity processing fails
            }

            try {
                if (context.agentContext.index?.path) {
                    await context.agentContext.websiteCollection.writeToFile(
                        context.agentContext.index.path,
                        "index",
                    );
                    debug(
                        `Saved website collection with ${successCount} new files to ${context.agentContext.index.path}`,
                    );
                } else {
                    debug(
                        "No index path available, HTML folder data not persisted",
                    );
                }
            } catch (error) {
                debug(`Failed to save website collection: ${error}`);
                errors.push({
                    type: "persistence",
                    message: `Failed to save data: ${(error as Error).message}`,
                    timestamp: Date.now(),
                });
            }
        }

        const duration = Date.now() - startTime;

        logStructuredProgress(
            htmlFiles.length,
            htmlFiles.length,
            `Import complete - ${successCount} successful`,
            "complete",
            displayProgress,
        );

        return {
            success: errors.length === 0,
            importId: importId,
            itemCount: successCount,
            duration,
            errors,
            summary: {
                totalFiles: htmlFiles.length,
                totalProcessed: htmlFiles.length,
                successfullyImported: successCount,
                knowledgeExtracted:
                    options?.mode !== "basic" ? successCount : 0,
                entitiesFound: 0, // Entities extraction would need different logic
                topicsIdentified: 0, // Topics extraction would need different logic
                actionsDetected: websiteDataResults.reduce(
                    (sum, data) =>
                        sum +
                        (data.extractionResult?.detectedActions?.length || 0),
                    0,
                ),
            },
        };
    } catch (error: any) {
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

        // Use the session-based function and pass actionIO.setDisplay for progress reporting
        const result = await importHtmlFolderFromSession(
            action.parameters,
            context.sessionContext,
            context.actionIO.setDisplay,
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
        undefined, // deletionInfo
        false, // isNew = false since content is already processed
    );

    return websiteInstance;
}

/**
 * Get statistics about imported website data
 */
export async function getWebsiteStats(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<GetWebsiteStats>,
) {
    try {
        const websiteCollection =
            context.sessionContext.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createActionResult(
                "No website data available. Please import website data first.",
                true,
            );
        }

        const { groupBy = "domain", limit = 10 } = action.parameters || {};
        const websites = websiteCollection.messages.getAll();

        let stats: { [key: string]: number } = {};
        let totalCount = websites.length;

        for (const site of websites) {
            const metadata = site.metadata as website.WebsiteDocPartMeta;
            let key: string;

            switch (groupBy) {
                case "domain":
                    key = metadata.domain || "unknown";
                    break;
                case "pageType":
                    key = metadata.pageType || "general";
                    break;
                case "source":
                    key = metadata.websiteSource;
                    break;
                default:
                    key = metadata.domain || "unknown";
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
            for (const site of websites) {
                sourceCounts[
                    (site.metadata as website.WebsiteDocPartMeta).websiteSource
                ]++;
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
