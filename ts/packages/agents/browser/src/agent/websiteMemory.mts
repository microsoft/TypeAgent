// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    ImportWebsiteData,
    ImportHtmlFolder,
    SearchWebsites,
    GetWebsiteStats,
} from "./actionsSchema.mjs";
import * as website from "website-memory";
import * as kp from "knowpro";
import { openai as ai } from "aiclient";
import registerDebug from "debug";
import * as path from "path";
import {
    processHtmlBatch,
    ProcessingOptions,
    WebsiteData,
} from "./htmlProcessor.mjs";
import {
    enumerateHtmlFiles,
    readHtmlFile,
    validateHtmlFolder,
    getFileMetadata,
    createFileBatches,
    FolderOptions,
    DEFAULT_FOLDER_OPTIONS,
} from "./folderUtils.mjs";

export interface BrowserActionContext {
    browserControl?: any | undefined;
    webSocket?: any | undefined;
    webAgentChannels?: any | undefined;
    crossWordState?: any | undefined;
    browserConnector?: any | undefined;
    browserProcess?: any | undefined;
    tabTitleIndex?: any | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: any | undefined;
    index: website.IndexData | undefined;
}

const debug = registerDebug("typeagent:browser:website-memory");

/**
 * Resolve URL using website visit history (bookmarks, browser history)
 * This provides a more personalized alternative to web search
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
        // Use knowpro searchConversationKnowledge for semantic search
        const matches = await kp.searchConversationKnowledge(
            websiteCollection,
            // search group
            {
                booleanOp: "or", // Use OR to be more permissive
                terms: siteQueryToSearchTerms(site),
            },
            // when filter
            {
                // No specific knowledge type filter - search across all types
            },
            // options
            {
                exactMatch: false, // Allow fuzzy matching
            },
        );

        if (!matches || matches.size === 0) {
            debug(`No semantic matches found in history for query: '${site}'`);
            return undefined;
        }

        debug(`Found ${matches.size} semantic matches for: '${site}'`);
        debug(matches);

        const candidates: { url: string; score: number; metadata: any }[] = [];
        const processedMessages = new Set<number>();

        matches.forEach((match: kp.SemanticRefSearchResult) => {
            match.semanticRefMatches.forEach(
                (refMatch: kp.ScoredSemanticRefOrdinal) => {
                    if (refMatch.score >= 0.3) {
                        // Lower threshold for broader matching
                        const semanticRef: kp.SemanticRef | undefined =
                            websiteCollection.semanticRefs.get(
                                refMatch.semanticRefOrdinal,
                            );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;
                            if (
                                messageOrdinal !== undefined &&
                                !processedMessages.has(messageOrdinal)
                            ) {
                                processedMessages.add(messageOrdinal);

                                const website =
                                    websiteCollection.messages.get(
                                        messageOrdinal,
                                    );
                                if (website && website.metadata) {
                                    const metadata =
                                        website.metadata as website.WebsiteDocPartMeta;
                                    let totalScore = refMatch.score;

                                    // Apply additional scoring based on special patterns and recency
                                    totalScore += calculateWebsiteScore(
                                        [site],
                                        metadata,
                                    );

                                    candidates.push({
                                        url: metadata.url,
                                        score: totalScore,
                                        metadata: metadata,
                                    });
                                }
                            }
                        }
                    }
                },
            );
        });

        if (candidates.length === 0) {
            debug(`No qualifying candidates found for query: '${site}'`);
            return undefined;
        }

        // Sort by total score (highest first) and remove duplicates
        const uniqueCandidates = new Map<
            string,
            { url: string; score: number; metadata: any }
        >();
        candidates.forEach((candidate) => {
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
            `Found best match from history (score: ${bestMatch.score.toFixed(2)}): '${bestMatch.metadata.title || bestMatch.url}' -> ${bestMatch.url}`,
        );
        debug(
            `Match details: domain=${bestMatch.metadata.domain}, source=${bestMatch.metadata.websiteSource}`,
        );

        return bestMatch.url;
    } catch (error) {
        debug(`Error searching website history: ${error}`);
        return undefined;
    }
}

/**
 * Convert site query to knowpro search terms
 */
function siteQueryToSearchTerms(site: string): any[] {
    const terms: any[] = [];
    const siteQuery = site.toLowerCase().trim();

    // Add the main query as a search term
    terms.push({ term: { text: siteQuery } });

    // Add individual words if it's a multi-word query
    /*
    const words = siteQuery.split(/\s+/).filter((word) => word.length > 2);
    words.forEach((word) => {
        if (word !== siteQuery) {
            terms.push({ term: { text: word } });
        }
    });
*/

    return terms;
}

/**
 * Calculate additional scoring based on website metadata
 */
export function calculateWebsiteScore(
    searchFilters: string[],
    metadata: any,
): number {
    let score = 0;

    const title = metadata.title?.toLowerCase() || "";
    const domain = metadata.domain?.toLowerCase() || "";
    const url = metadata.url.toLowerCase();
    const folder = metadata.folder?.toLowerCase() || "";

    for (const filter of searchFilters) {
        const queryLower = filter.toLowerCase();

        // Direct domain matches get highest boost
        if (
            domain === queryLower ||
            domain === `www.${queryLower}` ||
            domain.endsWith(`.${queryLower}`)
        ) {
            score += 3.0;
        } else if (domain.includes(queryLower)) {
            score += 2.0;
        }

        if (title.includes(queryLower)) {
            score += 1.5;
        }

        if (url.includes(queryLower)) {
            score += 1.0;
        }

        if (
            metadata.websiteSource === "bookmark" &&
            folder.includes(queryLower)
        ) {
            score += 1.0;
        }

        // Recency bonus
        if (metadata.visitDate || metadata.bookmarkDate) {
            const visitDate = new Date(
                metadata.visitDate || metadata.bookmarkDate,
            );
            const daysSinceVisit =
                (Date.now() - visitDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceVisit < 7) score += 0.5;
            else if (daysSinceVisit < 30) score += 0.3;
        }

        // Frequency bonus
        if (metadata.visitCount && metadata.visitCount > 5) {
            score += Math.min(metadata.visitCount / 20, 0.5);
        }
    }

    return score;
}

/**
 * Find websites matching search criteria using enhanced search capabilities
 */
export async function findRequestedWebsites(
    searchFilters: string[],
    context: BrowserActionContext,
    exactMatch: boolean = false,
    minScore: number = 0.5,
): Promise<website.Website[]> {
    if (
        !context.websiteCollection ||
        context.websiteCollection.messages.length === 0
    ) {
        return [];
    }

    try {
        // Try enhanced search capabilities first
        if (searchFilters.length === 1 && !exactMatch) {
            const query = searchFilters[0];

            // Try hybrid search for single term queries
            try {
                const hybridResults =
                    await context.websiteCollection.hybridSearch(query);
                if (hybridResults.length > 0) {
                    debug(
                        `Found ${hybridResults.length} results using hybrid search`,
                    );
                    return hybridResults
                        .filter((result) => result.relevanceScore >= minScore)
                        .map((result) => result.website.toWebsite())
                        .slice(0, 20);
                }
            } catch (hybridError) {
                debug(`Hybrid search failed, falling back: ${hybridError}`);
            }
        }

        // Try entity search for proper nouns and specific terms
        if (searchFilters.some((filter) => /^[A-Z]/.test(filter))) {
            try {
                const entityResults =
                    await context.websiteCollection.searchByEntities(
                        searchFilters,
                    );
                if (entityResults.length > 0) {
                    debug(
                        `Found ${entityResults.length} results using entity search`,
                    );
                    return entityResults
                        .map((result) => result.toWebsite())
                        .slice(0, 20);
                }
            } catch (entityError) {
                debug(`Entity search failed, falling back: ${entityError}`);
            }
        }

        // Try topic search for conceptual terms
        try {
            const topicResults =
                await context.websiteCollection.searchByTopics(searchFilters);
            if (topicResults.length > 0) {
                debug(
                    `Found ${topicResults.length} results using topic search`,
                );
                return topicResults
                    .map((result) => result.toWebsite())
                    .slice(0, 20);
            }
        } catch (topicError) {
            debug(`Topic search failed, falling back: ${topicError}`);
        }

        // Fallback to original semantic search for backward compatibility
        debug(
            `Falling back to semantic search for filters: ${searchFilters.join(", ")}`,
        );
        const matches = await kp.searchConversationKnowledge(
            context.websiteCollection,
            // search group
            {
                booleanOp: "or", // Use OR to match any of the search filters
                terms: searchFiltersToSearchTerms(searchFilters),
            },
            // when filter
            {
                // No specific knowledge type filter - search across all types
            },
            // options
            {
                exactMatch: exactMatch,
            },
        );

        if (!matches || matches.size === 0) {
            debug(
                `No semantic matches found for search filters: ${searchFilters.join(", ")}`,
            );
            return [];
        }

        debug(
            `Found ${matches.size} semantic matches for search filters: ${searchFilters.join(", ")}`,
        );

        debug(matches);

        const results: { website: website.Website; score: number }[] = [];
        const processedMessages = new Set<number>();

        matches.forEach((match: kp.SemanticRefSearchResult) => {
            match.semanticRefMatches.forEach(
                (refMatch: kp.ScoredSemanticRefOrdinal) => {
                    if (refMatch.score >= minScore) {
                        const semanticRef: kp.SemanticRef | undefined =
                            context.websiteCollection!.semanticRefs.get(
                                refMatch.semanticRefOrdinal,
                            );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;
                            if (
                                messageOrdinal !== undefined &&
                                !processedMessages.has(messageOrdinal)
                            ) {
                                processedMessages.add(messageOrdinal);

                                const websiteData =
                                    context.websiteCollection!.messages.get(
                                        messageOrdinal,
                                    ) as any;
                                if (websiteData) {
                                    let totalScore = refMatch.score;

                                    // Apply additional scoring based on metadata matches
                                    totalScore += calculateWebsiteScore(
                                        searchFilters,
                                        websiteData.metadata,
                                    );

                                    results.push({
                                        website: websiteData,
                                        score: totalScore,
                                    });
                                }
                            }
                        }
                    }
                },
            );
        });

        // Sort by score (highest first) and remove duplicates
        const uniqueResults = new Map<
            string,
            { website: website.Website; score: number }
        >();
        results.forEach((result) => {
            const url = result.website.metadata.url;
            const existing = uniqueResults.get(url);
            if (!existing || result.score > existing.score) {
                uniqueResults.set(url, result);
            }
        });

        const sortedResults = Array.from(uniqueResults.values()).sort(
            (a, b) => b.score - a.score,
        );

        debug(
            `Filtered to ${sortedResults.length} unique websites after scoring`,
        );

        debug(sortedResults);

        return sortedResults.map((r) => r.website);
    } catch (error) {
        debug(`Error in semantic website search: ${error}`);
        // Fallback to empty results
        return [];
    }
}

/**
 * Convert search filters to knowpro search terms
 */
function searchFiltersToSearchTerms(filters: string[]): any[] {
    const terms: any[] = [];

    filters.forEach((filter) => {
        // Add the main filter as a search term
        terms.push({ term: { text: filter } });

        // Add individual words if it's a multi-word filter
        /*
        const words = filter
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);
        words.forEach((word) => {
            if (word !== filter.toLowerCase()) {
                terms.push({ term: { text: word } });
            }
        });
        */
    });

    return terms;
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
        if (displayProgress) {
            displayProgress("Importing website data...");
        }

        const {
            source,
            type,
            limit,
            days,
            folder,
            extractContent,
            enableIntelligentAnalysis,
            enableActionDetection,
            extractionMode,
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

        // Enhanced progress callback that uses both debug logging and display callback
        const progressCallback = (
            current: number,
            total: number,
            item: string,
        ) => {
            if (current % 100 === 0) {
                const message = `Importing... ${current}/${total}: ${item.substring(0, 50)}...`;
                debug(message);
                if (displayProgress) {
                    displayProgress(message);
                }
            }
        };

        // Build options object with only defined values
        const importOptions: any = {};
        if (limit !== undefined) importOptions.limit = limit;
        if (days !== undefined) importOptions.days = days;
        if (folder !== undefined) importOptions.folder = folder;

        // Add enhancement options
        if (extractContent !== undefined)
            importOptions.extractContent = extractContent;
        if (enableIntelligentAnalysis !== undefined)
            importOptions.enableIntelligentAnalysis = enableIntelligentAnalysis;
        if (enableActionDetection !== undefined)
            importOptions.enableActionDetection = enableActionDetection;
        if (extractionMode !== undefined)
            importOptions.extractionMode = extractionMode;
        if (maxConcurrent !== undefined)
            importOptions.maxConcurrent = maxConcurrent;
        if (contentTimeout !== undefined)
            importOptions.contentTimeout = contentTimeout;

        // Create chat model for intelligent analysis if enabled
        if (enableIntelligentAnalysis) {
            try {
                const apiSettings = ai.azureApiSettingsFromEnv(
                    ai.ModelType.Chat,
                    undefined,
                    undefined, // Use default model
                );
                importOptions.model = ai.createChatModel(
                    apiSettings,
                    undefined,
                    undefined,
                    ["website-analysis"],
                );
                debug("Created chat model for intelligent analysis");
            } catch (error) {
                debug(
                    "Failed to create chat model for intelligent analysis:",
                    error,
                );
                // Continue without intelligent analysis if model creation fails
            }
        }

        let websites;
        if (extractContent) {
            // Use enhanced import with content extraction
            websites = await website.importWebsitesWithContent(
                source,
                type,
                filePath,
                importOptions,
                progressCallback,
            );
        } else {
            // Use basic import for fast metadata-only import
            websites = await website.importWebsites(
                source,
                type,
                filePath,
                importOptions,
                progressCallback,
            );
        }

        if (!context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection =
                new website.WebsiteCollection();
        }

        context.agentContext.websiteCollection.addWebsites(websites);
        await context.agentContext.websiteCollection.buildIndex();

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
        if (displayProgress) {
            displayProgress("Validating folder and enumerating HTML files...");
        }

        const { folderPath, options = {}, importId } = parameters;
        const errors: any[] = [];
        let successCount = 0;

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

        if (displayProgress) {
            displayProgress(
                `Found ${htmlFiles.length} HTML files. Processing...`,
            );
        }

        // Ensure we have a website collection
        if (!context.agentContext.websiteCollection) {
            context.agentContext.websiteCollection =
                new website.WebsiteCollection();
        }

        // Process files in batches for better performance and progress reporting
        const batches = createFileBatches(htmlFiles, 10);
        const websiteDataResults: WebsiteData[] = [];

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

            if (displayProgress) {
                const progressPercent = Math.round(
                    (batchIndex / batches.length) * 100,
                );
                displayProgress(
                    `Processing batch ${batchIndex + 1}/${batches.length} (${progressPercent}%)`,
                );
            }

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

            // Process the batch using shared HTML processing
            try {
                const processingOptions: ProcessingOptions = {
                    extractContent: options.extractContent !== false,
                    extractionMode: options.extractionMode || "content",
                    enableIntelligentAnalysis:
                        options.enableIntelligentAnalysis || false,
                    enableActionDetection:
                        options.enableActionDetection || false,
                    maxConcurrent: 5,
                };

                const batchResults = await processHtmlBatch(
                    batchData,
                    processingOptions,
                    (current, total, item) => {
                        if (displayProgress && current % 2 === 0) {
                            displayProgress(
                                `Processing: ${path.basename(item)}`,
                            );
                        }
                    },
                );

                websiteDataResults.push(...batchResults);
                successCount += batchResults.length;
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

            await context.agentContext.websiteCollection.buildIndex();

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

        if (displayProgress) {
            displayProgress(
                `Folder import complete: ${successCount}/${htmlFiles.length} files processed successfully`,
            );
        }

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
                knowledgeExtracted: options?.enableIntelligentAnalysis
                    ? successCount
                    : 0,
                entitiesFound: 0, // Entities extraction would need different logic
                topicsIdentified: 0, // Topics extraction would need different logic
                actionsDetected: websiteDataResults.reduce(
                    (sum, data) =>
                        sum + (data.enhancedContent?.actions?.length || 0),
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
 * Import HTML files from local file system (ActionContext version for regular actions)
 */
/**
 * Helper function to convert HTML file data to website data format
 */
/**
 * Helper function to convert WebsiteData to Website format for collection storage
 */
function convertWebsiteDataToWebsite(data: WebsiteData): any {
    return {
        url: data.url,
        title: data.title,
        content: data.content,
        domain: data.domain,
        metadata: {
            ...data.metadata,
            url: data.url,
            title: data.title,
            domain: data.domain,
        },
        visitCount: data.visitCount,
        lastVisited: data.lastVisited,
        enhancedContent: data.enhancedContent,
    };
}

/**
 * Search through imported website data
 */
export async function searchWebsites(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<SearchWebsites>,
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

        context.actionIO.setDisplay("Searching websites...");

        const {
            originalUserRequest,
            //query,
            domain,
            pageType,
            source,
            limit = 10,
            minScore = 0.5,
        } = action.parameters;

        // Build search filters
        const searchFilters = [originalUserRequest];
        if (domain) searchFilters.push(domain);
        if (pageType) searchFilters.push(pageType);

        // Use the improved search function
        let matchedWebsites = await findRequestedWebsites(
            searchFilters,
            context.sessionContext.agentContext,
            false,
            minScore,
        );

        // Apply additional filters
        if (source) {
            matchedWebsites = matchedWebsites.filter(
                (site) => site.metadata.websiteSource === source,
            );
        }

        // Limit results
        matchedWebsites = matchedWebsites.slice(0, limit);

        if (matchedWebsites.length === 0) {
            return createActionResult(
                "No websites found matching the search criteria.",
            );
        }

        const resultText = matchedWebsites
            .map((site, i) => {
                const metadata = site.metadata;
                return `${i + 1}. ${metadata.title || metadata.url}\n   URL: ${metadata.url}\n   Domain: ${metadata.domain} | Type: ${metadata.pageType} | Source: ${metadata.websiteSource}\n`;
            })
            .join("\n");

        return createActionResult(
            `Found ${matchedWebsites.length} websites:\n\n${resultText}`,
        );
    } catch (error: any) {
        return createActionResult(
            `Failed to search websites: ${error.message}`,
            true,
        );
    }
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
