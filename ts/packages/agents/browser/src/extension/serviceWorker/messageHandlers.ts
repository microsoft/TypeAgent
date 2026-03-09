// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getTabHTMLFragments, CompressionMode } from "./capture";
import { sendActionToAgent } from "./websocket";
import { BrowserContentDownloader } from "./contentDownloader.js";
import type { KnowledgeExtractionProgress } from "../interfaces/knowledgeExtraction.types";
import { broadcastEvent } from "./extensionEventHelpers";

// Store active extraction callbacks
export const knowledgeExtractionCallbacks = new Map<
    string,
    (progress: KnowledgeExtractionProgress) => void
>();

/**
 * Handle knowledge extraction progress updates from WebSocket
 */
export function handleKnowledgeExtractionProgress(
    extractionId: string,
    progress: KnowledgeExtractionProgress,
) {
    const callback = knowledgeExtractionCallbacks.get(extractionId);
    if (typeof callback === "function") {
        callback(progress);

        // Cleanup on completion
        if (progress.phase === "complete" || progress.phase === "error") {
            knowledgeExtractionCallbacks.delete(extractionId);
        }
    }
}

// Website Library Panel handlers
export async function handleImportWebsiteDataWithProgress(message: any) {
    const importId = message.importId;
    const totalItems = message.totalItems || 0;

    try {
        // Send initial progress update
        sendProgressToUI(importId, {
            importId,
            phase: "initializing",
            totalItems: totalItems,
            processedItems: 0,
            errors: [],
        });

        const startTime = Date.now();

        const result = await sendActionToAgent({
            actionName: "importWebsiteDataWithProgress",
            parameters: {
                source: message.parameters.source,
                type: message.parameters.type,
                limit: message.parameters.limit,
                days: message.parameters.days,
                folder: message.parameters.folder,
                mode: message.parameters.mode || "basic",
                maxConcurrent: message.parameters.maxConcurrent,
                contentTimeout: message.parameters.contentTimeout,
                importId: importId,
                totalItems: totalItems,
                progressCallback: true,
            },
        });

        // Send completion progress
        sendProgressToUI(importId, {
            importId,
            phase: "complete",
            totalItems: totalItems,
            processedItems: totalItems,
            errors: [],
        });

        return {
            success: !result.error,
            itemCount: result.itemCount || totalItems,
            error: result.error,
        };
    } catch (error) {
        console.error("Error importing website data:", error);

        // Send error progress to UI
        sendProgressToUI(importId, {
            importId,
            phase: "error",
            totalItems: totalItems,
            processedItems: 0,
            errors: [
                {
                    type: "processing",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                    timestamp: Date.now(),
                },
            ],
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export function sendProgressToUI(importId: string, progress: any) {
    // Ensure progress has required structure
    const structuredProgress = {
        importId: importId,
        phase: progress.phase || "processing",
        totalItems: progress.totalItems || 0,
        processedItems: progress.processedItems || 0,
        currentItem: progress.currentItem,
        errors: progress.errors || [],
        ...progress,
    };

    // Send to all connected library panels via runtime messaging
    try {
        chrome.runtime
            .sendMessage({
                type: "importProgress",
                importId,
                progress: structuredProgress,
            })
            .catch((error) => {
                // Handle case where no listeners are available
                console.log("No listeners for progress update:", error);
            });
    } catch (error) {
        console.error("Failed to send progress to UI:", error);
    }
}

export async function handleClearWebsiteLibrary() {
    try {
        await sendActionToAgent({
            actionName: "clearKnowledgeIndex",
            parameters: {},
        });

        return { success: true };
    } catch (error) {
        console.error("Error clearing website library:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleCancelImport(importId: string) {
    try {
        // Implementation would depend on how imports are tracked
        // For now, just return success
        return { success: true };
    } catch (error) {
        console.error("Error cancelling import:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// HTML Folder Import handlers
export async function handleImportHtmlFolder(message: any) {
    try {
        const { parameters } = message;
        const { folderPath, options, importId } = parameters;

        // Send action to backend agent using the new ImportHtmlFolder action
        const result = await sendActionToAgent({
            actionName: "importHtmlFolder",
            parameters: {
                folderPath,
                options: {
                    mode: options?.mode || "basic",
                    preserveStructure: options?.preserveStructure ?? true,
                    recursive: options?.recursive ?? true,
                    fileTypes: options?.fileTypes ?? [
                        ".html",
                        ".htm",
                        ".mhtml",
                    ],
                    limit: options?.limit,
                    maxFileSize: options?.maxFileSize,
                    skipHidden: options?.skipHidden ?? true,
                },
                importId,
            },
        });

        return {
            success: !result.error,
            itemCount: result.websiteCount || 0,
            importId: importId,
            duration: result.duration || 0,
            errors: result.errors || [],
            summary: {
                totalProcessed: result.websiteCount || 0,
                successfullyImported: result.websiteCount || 0,
                knowledgeExtracted: result.knowledgeCount || 0,
                entitiesFound: result.entityCount || 0,
                topicsIdentified: result.topicCount || 0,
                actionsDetected: result.actionCount || 0,
            },
        };
    } catch (error) {
        console.error("Folder import error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            importId: message.parameters?.importId || "unknown",
            itemCount: 0,
            errors: [(error as Error).message],
            summary: {
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

export async function handleGetFileImportProgress(importId: string) {
    try {
        // For now, return a basic progress response
        // In a full implementation, this would track actual import progress
        return {
            success: true,
            progress: {
                importId: importId,
                phase: "complete",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            },
        };
    } catch (error) {
        console.error("Error getting file import progress:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleCancelFileImport(importId: string) {
    try {
        // Implementation would depend on how file imports are tracked
        // For now, just return success
        return { success: true };
    } catch (error) {
        console.error("Error cancelling file import:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Enhanced search handlers
export async function handleSearchWebMemories(message: any) {
    try {
        const startTime = Date.now();

        // Use the new unified search action
        const result = await sendActionToAgent({
            actionName: "searchWebMemories",
            parameters: {
                query: message.parameters.query,
                generateAnswer: true, // Knowledge Library wants answers
                includeRelatedEntities: true,
                enableAdvancedSearch: true,
                limit: message.parameters.limit || 20,
                minScore: message.parameters.filters?.minRelevance || 0.3,
                ...message.parameters.filters,
            },
        });

        return {
            success: true,
            results: {
                websites: result.websites || [],
                summary: {
                    text: result.answer || "",
                    totalFound: result.websites?.length || 0,
                    searchTime:
                        result.summary?.searchTime || Date.now() - startTime,
                    sources: result.answerSources || [],
                    entities: result.relatedEntities || [],
                },
                query: message.parameters.query,
                filters: message.parameters.filters || {},
                topTopics: result.topTopics || [],
                suggestedFollowups: result.suggestedFollowups || [],
                relatedEntities: result.relatedEntities || [],
            },
        };
    } catch (error) {
        console.error("Error in unified search:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleGetSearchSuggestions(message: any) {
    try {
        // Get recent searches from storage for suggestions
        const storage = await chrome.storage.local.get(["searchHistory"]);
        const searchHistory = storage.searchHistory || [];

        const query = message.query.toLowerCase();
        const suggestions = searchHistory
            .filter((search: string) => search.toLowerCase().includes(query))
            .slice(0, message.limit || 5);

        return {
            success: true,
            suggestions: suggestions,
        };
    } catch (error) {
        console.error("Error getting search suggestions:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleSaveSearchHistory(message: any) {
    try {
        const storage = await chrome.storage.local.get(["searchHistory"]);
        const searchHistory = storage.searchHistory || [];

        // Add new search to beginning, remove duplicates, keep last 20
        const updatedHistory = [
            message.query,
            ...searchHistory.filter((s: string) => s !== message.query),
        ].slice(0, 20);

        await chrome.storage.local.set({
            searchHistory: updatedHistory,
        });

        return { success: true };
    } catch (error) {
        console.error("Error saving search history:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleGetSearchHistory() {
    try {
        const storage = await chrome.storage.local.get(["searchHistory"]);
        return {
            success: true,
            searches: storage.searchHistory || [],
        };
    } catch (error) {
        console.error("Error getting search history:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function handleGetSuggestedSearches() {
    try {
        // Get website stats to generate suggestions
        const statsResult = await sendActionToAgent({
            actionName: "getWebsiteStats",
            parameters: {
                groupBy: "domain",
                limit: 20,
            },
        });

        const suggestions = generateSuggestionsFromStats(
            statsResult.literalText ||
                statsResult.text ||
                statsResult.result ||
                "",
        );

        return {
            success: true,
            suggestions: suggestions,
        };
    } catch (error) {
        console.error("Error getting suggested searches:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Helper function to parse website stats from text response

// Helper functions for knowledge indexing
export async function indexPageContent(
    tab: chrome.tabs.Tab,
    showNotification: boolean = true,
    options: {
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
        mode?: "basic" | "content" | "actions" | "full";
        extractedKnowledge?: any;
    } = {},
): Promise<boolean> {
    try {
        let htmlFragments = null;
        let extractKnowledge = true;

        if (options.extractedKnowledge) {
            extractKnowledge = false;
        } else {
            htmlFragments = await getTabHTMLFragments(
                tab,
                CompressionMode.KnowledgeExtraction,
                false,
                true, // extract text
                false, // useTimestampIds
                true, // filterToReadingView - use reading view for indexing
                true, // keepMetaTags - preserve metadata for indexing context
            );
        }

        const parameters: any = {
            url: tab.url,
            title: tab.title,
            extractKnowledge: extractKnowledge,
            timestamp: new Date().toISOString(),
            quality: options.quality || "balanced",
            textOnly: options.textOnly || false,
            mode: options.mode || "content",
        };

        if (options.extractedKnowledge) {
            parameters.extractedKnowledge = options.extractedKnowledge;
        } else {
            parameters.htmlFragments = htmlFragments;
        }

        await sendActionToAgent({
            actionName: "indexWebPageContent",
            parameters: parameters,
        });

        if (showNotification) {
            chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({
                color: "#28a745",
                tabId: tab.id,
            });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "", tabId: tab.id });
            }, 3000);
        }

        return true;
    } catch (error) {
        console.error("Error indexing page content:", error);

        if (showNotification) {
            chrome.action.setBadgeText({ text: "✗", tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({
                color: "#dc3545",
                tabId: tab.id,
            });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "", tabId: tab.id });
            }, 3000);
        }

        return false;
    }
}

// Enhanced shouldIndexPage with more sophisticated checks
export async function shouldIndexPage(url: string): Promise<boolean> {
    const settings = await chrome.storage.sync.get([
        "autoIndexing",
        "excludeSensitiveSites",
        "indexOnlyTextContent",
    ]);

    if (!settings.autoIndexing) {
        return false;
    }

    // Check sensitive sites
    if (settings.excludeSensitiveSites) {
        const sensitivePatterns = [
            /banking/i,
            /bank\./i,
            /login/i,
            /signin/i,
            /auth/i,
            /healthcare/i,
            /medical/i,
            /patient/i,
            /health/i,
            /paypal/i,
            /payment/i,
            /checkout/i,
            /billing/i,
            /admin/i,
            /dashboard/i,
            /account/i,
            /profile/i,
        ];

        if (sensitivePatterns.some((pattern) => pattern.test(url))) {
            return false;
        }
    }

    // Don't index localhost, internal IPs, or file:// URLs
    if (
        url.includes("localhost") ||
        url.startsWith("file://") ||
        url.includes("127.0.0.1") ||
        url.includes("192.168.") ||
        url.includes(".local")
    ) {
        return false;
    }

    // Don't index media files or downloads
    const mediaExtensions =
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|exe|dmg|pkg|mp4|mp3|avi|mov|jpg|jpeg|png|gif|svg)$/i;
    if (mediaExtensions.test(url)) {
        return false;
    }

    return true;
}

// Index management handlers
export async function handleCheckIndexStatus() {
    try {
        const result = await sendActionToAgent({
            actionName: "getKnowledgeIndexStats",
            parameters: {},
        });

        // getKnowledgeIndexStats returns stats object directly when successful
        if (result && result.totalPages !== undefined) {
            return {
                success: true,
                exists: result.totalPages > 0,
            };
        } else {
            return {
                success: false,
                exists: false,
                error: result?.error || "Failed to get index stats",
            };
        }
    } catch (error) {
        console.error("Error checking index status:", error);
        return {
            success: false,
            exists: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export function generateSuggestionsFromStats(statsText: string): any {
    const suggestions = {
        recentFinds: [] as any[],
        popularDomains: [] as any[],
        exploreTopics: [] as any[],
    };

    try {
        const lines = statsText.split("\n");

        // Extract domain information for popular domains
        const domainLines = lines.filter(
            (line) =>
                line.includes(":") &&
                line.includes("sites") &&
                !line.includes("Total") &&
                !line.includes("Source"),
        );

        // Generate popular domain suggestions
        domainLines.slice(0, 3).forEach((line) => {
            const domainMatch = line.match(/^([^:]+):/);
            if (domainMatch) {
                const domain = domainMatch[1].trim();
                suggestions.popularDomains.push({
                    query: `site:${domain}`,
                    category: "Popular Domains",
                    description: `Search content from ${domain}`,
                    estimatedResults: parseInt(
                        line.match(/(\d+)\s*sites?/)?.[1] || "0",
                    ),
                });
            }
        });

        // Generate topic suggestions based on common patterns
        const topicSuggestions = [
            {
                query: "documentation",
                description: "Find technical documentation and guides",
                estimatedResults: 0,
            },
            {
                query: "tutorial",
                description: "Discover learning resources and tutorials",
                estimatedResults: 0,
            },
            {
                query: "github",
                description: "Explore your saved repositories and code",
                estimatedResults: 0,
            },
        ];

        suggestions.exploreTopics = topicSuggestions;

        // Generate recent finds suggestions
        const recentSuggestions = [
            {
                query: "last week",
                description: "Recently visited or bookmarked sites",
                estimatedResults: 0,
            },
            {
                query: "today",
                description: "Sites from today",
                estimatedResults: 0,
            },
        ];

        suggestions.recentFinds = recentSuggestions;
    } catch (error) {
        console.error("Error generating suggestions from stats:", error);
    }

    return suggestions;
}

// Content Download Adapter handler functions
let contentDownloader: BrowserContentDownloader | null = null;

/**
 * Get or create a content downloader instance
 */
function getContentDownloader(): BrowserContentDownloader {
    if (!contentDownloader) {
        contentDownloader = new BrowserContentDownloader();
    }
    return contentDownloader;
}

/**
 * Handle browser-based content download requests
 */
export async function handleDownloadContentWithBrowser(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();

        // Clamp timeout to safe range (min 1000 ms, max 10000 ms)
        const requestedTimeout = Number(message.options?.timeout);
        const safeTimeout =
            Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
                ? Math.min(requestedTimeout, 10000)
                : 3000; // fallback to 3 seconds if invalid

        const result = await downloader.downloadContent(message.url, {
            useAuthentication: message.options?.useAuthentication ?? true,
            timeout: safeTimeout,
            fallbackToFetch: message.options?.fallbackToFetch ?? true,
            waitForDynamic: message.options?.waitForDynamic ?? false,
            scrollBehavior:
                message.options?.scrollBehavior ?? "capture-initial",
            processing: message.options?.processing ?? {
                filterToReadingView: true,
                keepMetaTags: true,
                extractText: true,
            },
        });

        return result;
    } catch (error) {
        console.error("Error in handleDownloadContentWithBrowser:", error);
        return {
            success: false,
            method: "failed",
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
        };
    }
}

/**
 * Handle HTML content processing requests (for folder imports)
 */
export async function handleProcessHtmlContent(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();

        const result = await downloader.processHtmlContent(
            message.htmlContent,
            {
                filterToReadingView:
                    message.options?.filterToReadingView ?? true,
                keepMetaTags: message.options?.keepMetaTags ?? true,
                extractText: message.options?.extractText ?? true,
                preserveStructure: message.options?.preserveStructure ?? true,
                maxElements: message.options?.maxElements,
            },
        );

        return {
            success: true,
            data: result,
        };
    } catch (error) {
        console.error("Error in handleProcessHtmlContent:", error);
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "HTML processing failed",
        };
    }
}

/**
 * Handle offscreen document testing requests
 */
export async function handleTestOffscreenDocument(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();
        const status = downloader.getStatus();

        if (!status.available) {
            return {
                success: false,
                error: "Offscreen document API not available",
                status,
            };
        }

        // Test basic functionality with a simple page
        const testUrl = message.testUrl || "https://example.com";
        const result = await downloader.downloadContent(testUrl, {
            timeout: 10000,
            fallbackToFetch: false, // Force browser method for testing
            processing: {
                filterToReadingView: false,
                extractText: true,
            },
        });

        return {
            success: result.success,
            testUrl,
            method: result.method,
            contentLength: result.htmlContent?.length || 0,
            textLength: result.textContent?.length || 0,
            loadTime: result.metadata?.loadTime || 0,
            error: result.error,
            status,
        };
    } catch (error) {
        console.error("Error in handleTestOffscreenDocument:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Test failed",
            status: { available: false, method: "unknown", capabilities: [] },
        };
    }
}

// Entity-based search handlers - Preserves full entity graph data
export async function handleSearchByEntities(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for entity-based search
        const result = await sendActionToAgent({
            actionName: "searchByEntities",
            parameters: {
                entities: message.entities || [],
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
            },
        });

        // Preserve full response data for entity graph view
        return {
            success: true,
            // Core search results
            websites: result.websites || [],
            summary: result.summary || {
                totalFound: 0,
                searchTime: Date.now() - startTime,
                strategies: ["entity-direct"],
                confidence: 0,
            },
            // Entity graph specific data
            answer: result.answer || "Entity search completed",
            answerType: result.answerType || "direct",
            answerSources: result.answerSources || [],
            queryIntent: result.queryIntent || "discovery",
            relatedEntities: result.relatedEntities || [],
            suggestedFollowups: result.suggestedFollowups || [],
            topTopics: result.topTopics || [],
            // Legacy compatibility
            results: result.websites || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "entity-direct",
            entities: message.entities,
        };
    } catch (error) {
        console.error("Error in searchByEntities:", error);
        return {
            success: false,
            websites: [],
            results: [],
            summary: {
                totalFound: 0,
                searchTime: 0,
                strategies: ["entity-direct"],
                confidence: 0,
            },
            answer: "Entity search failed",
            answerType: "noAnswer",
            answerSources: [],
            queryIntent: "discovery",
            relatedEntities: [],
            suggestedFollowups: [],
            topTopics: [],
            error:
                error instanceof Error ? error.message : "Entity search failed",
            searchMethod: "entity-direct",
            entities: message.entities || [],
        };
    }
}

export async function handleSearchByTopics(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for topic-based search
        const result = await sendActionToAgent({
            actionName: "searchByTopics",
            parameters: {
                topics: message.topics || [],
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
            },
        });

        // Return complete response data needed for entity graph view
        return {
            success: true,
            websites: result.websites || [],
            summary: result.summary || {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: result.relatedEntities || [],
            topTopics: result.topTopics || [],
            answerSources: result.answerSources || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "topic-direct",
            searchScope: "all_indexed",
            topics: message.topics || [],
            contextualInfo: result.contextualInfo || {},
            metadata: result.metadata || {},
            suggestedFollowups: result.suggestedFollowups || [],
        };
    } catch (error) {
        console.error("Error in searchByTopics:", error);
        return {
            success: false,
            websites: [],
            summary: {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: [],
            topTopics: [],
            answerSources: [],
            searchTime: Date.now() - Date.now(),
            totalFound: 0,
            contextualInfo: {},
            metadata: {},
            suggestedFollowups: [],
            error:
                error instanceof Error ? error.message : "Topic search failed",
            searchMethod: "topic-direct",
            topics: message.topics || [],
        };
    }
}

export async function handleHybridSearch(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for hybrid search
        const result = await sendActionToAgent({
            actionName: "hybridSearch",
            parameters: {
                query: message.query || "",
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
                combineStrategies: true,
            },
        });

        // Return complete response data needed for entity graph view
        return {
            success: true,
            websites: result.websites || [],
            summary: result.summary || {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: result.relatedEntities || [],
            topTopics: result.topTopics || [],
            answerSources: result.answerSources || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "hybrid-direct",
            searchScope: "all_indexed",
            query: message.query || "",
            contextualInfo: result.contextualInfo || {},
            metadata: result.metadata || {},
            suggestedFollowups: result.suggestedFollowups || [],
        };
    } catch (error) {
        console.error("Error in hybridSearch:", error);
        return {
            success: false,
            websites: [],
            summary: {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: [],
            topTopics: [],
            answerSources: [],
            searchTime: Date.now() - Date.now(),
            totalFound: 0,
            contextualInfo: {},
            metadata: {},
            suggestedFollowups: [],
            error:
                error instanceof Error ? error.message : "Hybrid search failed",
            searchMethod: "hybrid-direct",
            query: message.query || "",
        };
    }
}

/**
 * Handle requests for hierarchical topic data
 */
export async function handleGetHierarchicalTopics(message: any): Promise<any> {
    try {
        console.log("Fetching hierarchical topics from agent...");
        const startTime = Date.now();

        // Send action to agent to get hierarchical topics
        const result = await sendActionToAgent({
            actionName: "getHierarchicalTopics",
            parameters: {
                centerTopic: message.parameters?.centerTopic,
                includeRelationships:
                    message.parameters?.includeRelationships ?? true,
                maxDepth: message.parameters?.maxDepth ?? 5,
                domain: message.parameters?.domain, // Optional domain filter
            },
        });

        console.log("Received hierarchical topics result:", result);

        if (result && result.success !== false) {
            return {
                success: true,
                topics: result.topics || [],
                relationships: result.relationships || [],
                centerTopic: message.parameters?.centerTopic || null,
                maxDepth: result.maxDepth || 0,
                metadata: {
                    totalTopics: (result.topics || []).length,
                    queryTime: Date.now() - startTime,
                    source: "hierarchical_storage",
                },
            };
        } else {
            console.warn(
                "No hierarchical topics found or agent returned error:",
                result?.error,
            );
            return {
                success: false,
                topics: [],
                relationships: [],
                centerTopic: null,
                maxDepth: 0,
                error: result?.error || "No hierarchical topics available",
                metadata: {
                    totalTopics: 0,
                    queryTime: Date.now() - startTime,
                    source: "hierarchical_storage",
                },
            };
        }
    } catch (error) {
        console.error("Error fetching hierarchical topics:", error);
        return {
            success: false,
            topics: [],
            relationships: [],
            centerTopic: null,
            maxDepth: 0,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch hierarchical topics",
            metadata: {
                totalTopics: 0,
                queryTime: 0,
                source: "hierarchical_storage",
            },
        };
    }
}

/**
 * Handle requests for topic metrics data
 */
export async function handleGetTopicMetrics(message: any): Promise<any> {
    try {
        console.log("Fetching topic metrics from agent...");

        const result = await sendActionToAgent({
            actionName: "getTopicMetrics",
            parameters: {
                topicId: message.parameters?.topicId,
            },
        });

        if (result && result.success !== false) {
            return {
                success: true,
                metrics: result.metrics || {},
            };
        } else {
            return {
                success: false,
                error: result?.error || "No topic metrics available",
            };
        }
    } catch (error) {
        console.error("Error fetching topic metrics:", error);
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch topic metrics",
        };
    }
}
