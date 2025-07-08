// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ImportOptions,
    FolderImportOptions,
    FolderImportProgress,
    ImportResult,
    ImportProgress,
    ImportError,
    ImportSummary,
    ValidationResult,
    BrowserBookmark,
    BrowserHistoryItem,
    ProcessedData,
    ProgressCallback,
    SUPPORTED_FILE_TYPES,
    DEFAULT_MAX_FILE_SIZE,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_CONTENT_TIMEOUT,
} from "../interfaces/websiteImport.types";

/**
 * Core import logic and data processing manager
 * Handles both web activity (browser data) and folder import operations
 */
export class WebsiteImportManager {
    private progressCallbacks: Map<string, ProgressCallback> = new Map();
    private activeImports: Map<string, boolean> = new Map();

    /**
     * Start web activity import (browser bookmarks/history)
     */
    async startWebActivityImport(
        options: ImportOptions,
    ): Promise<ImportResult> {
        const importId = this.generateImportId();
        const startTime = Date.now();

        try {
            // Validate options
            const validation = this.validateImportOptions(options);
            if (!validation.isValid) {
                throw new Error(
                    `Invalid import options: ${validation.errors.join(", ")}`,
                );
            }

            this.activeImports.set(importId, true);

            // Initialize progress tracking
            this.updateProgress(importId, {
                importId,
                phase: "initializing",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            });

            // Get browser data with options applied
            this.updateProgress(importId, {
                importId,
                phase: "fetching",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            });

            const browserData = await this.getBrowserDataWithOptions(options);

            this.updateProgress(importId, {
                importId,
                phase: "processing",
                totalItems: browserData.length,
                processedItems: 0,
                errors: [],
            });

            // Preprocess browser data
            const processedData = this.preprocessBrowserData(
                browserData,
                options,
            );

            // Send to service worker for further processing
            const result = await this.sendToServiceWorker({
                type: "importWebsiteDataWithProgress",
                parameters: options,
                importId,
            });

            const duration = Date.now() - startTime;

            return {
                success: true,
                importId,
                itemCount: processedData.length,
                duration,
                errors: [],
                summary: {
                    totalProcessed: processedData.length,
                    successfullyImported: processedData.length,
                    knowledgeExtracted: 0, // Will be updated by service worker
                    entitiesFound: 0,
                    topicsIdentified: 0,
                    actionsDetected: 0,
                },
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const importError: ImportError = {
                type: "processing",
                message:
                    error instanceof Error ? error.message : "Unknown error",
                timestamp: Date.now(),
            };

            return {
                success: false,
                importId,
                itemCount: 0,
                duration,
                errors: [importError],
                summary: {
                    totalProcessed: 0,
                    successfullyImported: 0,
                    knowledgeExtracted: 0,
                    entitiesFound: 0,
                    topicsIdentified: 0,
                    actionsDetected: 0,
                },
            };
        } finally {
            this.activeImports.delete(importId);
        }
    }

    /**
     * Start folder import (HTML folder)
     */
    async startFolderImport(
        options: FolderImportOptions,
    ): Promise<ImportResult> {
        const importId = this.generateImportId();
        const startTime = Date.now();

        try {
            // Validate options
            const validation = this.validateFolderImportOptions(options);
            if (!validation.isValid) {
                throw new Error(
                    `Invalid folder import options: ${validation.errors.join(", ")}`,
                );
            }

            this.activeImports.set(importId, true);

            // Initialize progress tracking
            this.updateProgress(importId, {
                importId,
                phase: "initializing",
                totalItems: 0, // Will be updated once folder is enumerated
                processedItems: 0,
                errors: [],
            });

            // Send folder import request directly to service worker
            // The backend will handle folder enumeration and file processing
            const result = await this.sendToServiceWorker({
                type: "importHtmlFolder",
                parameters: {
                    folderPath: options.folderPath,
                    options,
                    importId,
                },
            });

            const duration = Date.now() - startTime;

            return {
                success: result.success || false,
                importId,
                itemCount: result.itemCount || 0,
                duration,
                errors: result.errors || [],
                summary: result.summary || {
                    totalProcessed: 0,
                    successfullyImported: 0,
                    knowledgeExtracted: 0,
                    entitiesFound: 0,
                    topicsIdentified: 0,
                    actionsDetected: 0,
                },
            };
        } catch (error) {
            const duration = Date.now() - startTime;

            // Provide more specific error messages for folder import
            let errorType:
                | "validation"
                | "network"
                | "processing"
                | "extraction" = "processing";
            let errorMessage = "Unknown error occurred during folder import";

            if (error instanceof Error) {
                const message = error.message;

                if (
                    message.includes("folder") ||
                    message.includes("path") ||
                    message.includes("directory")
                ) {
                    errorType = "validation";
                    errorMessage = `Folder access error: ${message}`;
                } else if (
                    message.includes("permission") ||
                    message.includes("access")
                ) {
                    errorType = "validation";
                    errorMessage = `Permission denied: Unable to access the specified folder. Please check folder permissions.`;
                } else if (
                    message.includes("not found") ||
                    message.includes("does not exist")
                ) {
                    errorType = "validation";
                    errorMessage = `Folder not found: The specified folder path does not exist.`;
                } else if (
                    message.includes("HTML") ||
                    message.includes("file")
                ) {
                    errorType = "processing";
                    errorMessage = `File processing error: ${message}`;
                } else {
                    errorMessage = message;
                }
            }

            const importError: ImportError = {
                type: errorType,
                message: errorMessage,
                timestamp: Date.now(),
            };

            return {
                success: false,
                importId,
                itemCount: 0,
                duration,
                errors: [importError],
                summary: {
                    totalProcessed: 0,
                    successfullyImported: 0,
                    knowledgeExtracted: 0,
                    entitiesFound: 0,
                    topicsIdentified: 0,
                    actionsDetected: 0,
                },
            };
        } finally {
            this.activeImports.delete(importId);
        }
    }

    /**
     * Cancel an active import operation
     */
    async cancelImport(importId: string): Promise<void> {
        if (this.activeImports.has(importId)) {
            this.activeImports.set(importId, false);

            // Send cancellation to service worker
            try {
                await chrome.runtime.sendMessage({
                    type: "cancelImport",
                    importId,
                });
            } catch (error) {
                console.error(`Failed to cancel import ${importId}:`, error);
            }
        }
    }

    /**
     * Get progress for an active import
     */
    async getImportProgress(importId: string): Promise<ImportProgress | null> {
        // Progress is tracked via callbacks in this implementation
        // This method could be extended to query service worker for progress
        return null;
    }

    /**
     * Register progress update callback
     */
    onProgressUpdate(callback: ProgressCallback): void {
        // Store callback for progress updates
        // In a full implementation, this would be tied to specific import operations
        this.progressCallbacks.set("global", callback);
    }

    /**
     * Get browser data (Chrome/Edge bookmarks or history)
     */
    async getBrowserData(
        source: "chrome" | "edge",
        type: "bookmarks" | "history",
    ): Promise<any[]> {
        try {
            if (type === "bookmarks") {
                return await this.getBrowserBookmarks(source);
            } else {
                return await this.getBrowserHistory(source);
            }
        } catch (error) {
            console.error(`Failed to get ${source} ${type}:`, error);
            throw new Error(
                `Unable to access ${source} ${type}. Please check permissions.`,
            );
        }
    }

    /**
     * Get browser data with import options applied
     */
    async getBrowserDataWithOptions(options: ImportOptions): Promise<any[]> {
        try {
            let data: any[];

            if (options.type === "bookmarks") {
                const bookmarks =
                    await this.getBrowserBookmarksWithOptions(options);
                data = bookmarks;
            } else {
                const history =
                    await this.getBrowserHistoryWithOptions(options);
                data = history;
            }

            // Apply limit if specified
            if (options.limit && options.limit > 0) {
                data = data.slice(0, options.limit);
            }

            return data;
        } catch (error) {
            console.error(
                `Failed to get ${options.source} ${options.type} with options:`,
                error,
            );
            throw error;
        }
    }

    /**
     * Get bookmarks with filtering options
     */
    private async getBrowserBookmarksWithOptions(
        options: ImportOptions,
    ): Promise<BrowserBookmark[]> {
        try {
            if (typeof chrome !== "undefined" && chrome.bookmarks) {
                const bookmarks = await chrome.bookmarks.getTree();
                const flattened = this.flattenBookmarks(
                    bookmarks,
                    options.folder,
                );
                return flattened;
            }
        } catch (error) {
            console.error("Failed to get bookmarks:", error);
            if (error instanceof Error) {
                if (error.message.includes("permissions")) {
                    throw new Error(
                        "Permission denied. Please enable bookmark access in extension settings.",
                    );
                }
                throw new Error(
                    `Failed to access ${options.source} bookmarks: ${error.message}`,
                );
            }
        }
        throw new Error(
            `${options.source} bookmarks not available or permission denied.`,
        );
    }

    /**
     * Get history with date filtering options
     */
    private async getBrowserHistoryWithOptions(
        options: ImportOptions,
    ): Promise<BrowserHistoryItem[]> {
        try {
            if (typeof chrome !== "undefined" && chrome.history) {
                const daysBack = options.days || 30;
                const startTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;
                const maxResults = options.limit || 10000;

                const historyItems = await chrome.history.search({
                    text: "",
                    startTime: startTime,
                    maxResults: Math.min(maxResults, 100000), // Chrome API limit
                });

                return historyItems.map((item) => ({
                    id: item.id || "",
                    url: item.url || "",
                    title: item.title,
                    visitCount: item.visitCount,
                    typedCount: item.typedCount,
                    lastVisitTime: item.lastVisitTime,
                }));
            }
        } catch (error) {
            console.error("Failed to get history:", error);
            if (error instanceof Error) {
                if (error.message.includes("permissions")) {
                    throw new Error(
                        "Permission denied. Please enable history access in extension settings.",
                    );
                }
                throw new Error(
                    `Failed to access ${options.source} history: ${error.message}`,
                );
            }
        }
        throw new Error(
            `${options.source} history not available or permission denied.`,
        );
    }

    /**
     * Validate import options
     */
    validateImportOptions(options: ImportOptions): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate required fields
        if (!options.source) {
            errors.push("Source browser is required");
        } else if (!["chrome", "edge"].includes(options.source)) {
            errors.push('Source must be either "chrome" or "edge"');
        }

        if (!options.type) {
            errors.push("Import type is required");
        } else if (!["bookmarks", "history"].includes(options.type)) {
            errors.push('Type must be either "bookmarks" or "history"');
        }

        // Validate optional fields
        if (options.limit && (options.limit < 1 || options.limit > 50000)) {
            warnings.push("Limit should be between 1 and 50,000");
        }

        if (options.days && (options.days < 1 || options.days > 365)) {
            warnings.push("Days should be between 1 and 365");
        }

        if (
            options.maxConcurrent &&
            (options.maxConcurrent < 1 || options.maxConcurrent > 20)
        ) {
            warnings.push("Max concurrent should be between 1 and 20");
        }

        if (
            options.contentTimeout &&
            (options.contentTimeout < 5000 || options.contentTimeout > 120000)
        ) {
            warnings.push(
                "Content timeout should be between 5 and 120 seconds",
            );
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Validate folder import options
     */
    validateFolderImportOptions(
        options: FolderImportOptions,
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate folder path
        if (!options.folderPath || !options.folderPath.trim()) {
            errors.push(
                "Folder path is required. Please specify a valid folder path containing HTML files.",
            );
        } else {
            const folderPath = options.folderPath.trim();

            // Basic path validation
            if (folderPath.length > 260) {
                errors.push(
                    "Folder path is too long (maximum 260 characters). Please use a shorter path.",
                );
            }

            // Check for invalid characters
            const invalidChars = /[<>"|?*]/;
            if (invalidChars.test(folderPath)) {
                errors.push(
                    'Folder path contains invalid characters (<>"|?*). Please use a valid folder path.',
                );
            }

            // Check for proper path format
            const windowsPathPattern = /^[A-Za-z]:[\\\/]/;
            const unixPathPattern = /^[\/~]/;
            const relativePathPattern = /^[^\/\\:*?"<>|]/;

            if (
                !windowsPathPattern.test(folderPath) &&
                !unixPathPattern.test(folderPath) &&
                !relativePathPattern.test(folderPath)
            ) {
                warnings.push(
                    "Path format may not be valid for your operating system. Please verify the path.",
                );
            }
        }

        // Validate numeric options
        if (options.limit !== undefined) {
            if (options.limit < 1 || options.limit > 10000) {
                errors.push("File limit must be between 1 and 10,000 files.");
            } else if (options.limit > 1000) {
                warnings.push(
                    "Large file limits may impact performance. Consider processing folders in smaller batches.",
                );
            }
        }

        if (options.maxFileSize !== undefined) {
            if (
                options.maxFileSize < 1024 ||
                options.maxFileSize > 500 * 1024 * 1024
            ) {
                errors.push("Maximum file size must be between 1KB and 500MB.");
            } else if (options.maxFileSize > 50 * 1024 * 1024) {
                warnings.push(
                    "Large file size limits may impact memory usage during import.",
                );
            }
        }

        // Validate file types
        if (options.fileTypes && options.fileTypes.length > 0) {
            const invalidTypes = options.fileTypes.filter(
                (type) => !SUPPORTED_FILE_TYPES.includes(type as any),
            );
            if (invalidTypes.length > 0) {
                errors.push(
                    `Unsupported file types: ${invalidTypes.join(", ")}`,
                );
            }
        }

        // Provide warnings for potentially slow operations
        if (options.recursive && options.limit && options.limit > 1000) {
            warnings.push(
                "Large recursive imports may take a long time to complete",
            );
        }

        if (options.enableIntelligentAnalysis) {
            warnings.push(
                "AI analysis will increase processing time significantly",
            );
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Preprocess browser data before sending to service worker
     */
    preprocessBrowserData(
        data: any[],
        options: ImportOptions,
    ): ProcessedData[] {
        const results: ProcessedData[] = [];

        for (const item of data) {
            try {
                let processedItem: ProcessedData;

                if (options.type === "bookmarks") {
                    const bookmark = item as BrowserBookmark;
                    processedItem = {
                        url: bookmark.url,
                        title: bookmark.title,
                        domain: this.extractDomain(bookmark.url),
                        source: "bookmarks",
                        lastVisited: bookmark.dateAdded
                            ? new Date(bookmark.dateAdded).toISOString()
                            : undefined,
                        metadata: {
                            id: bookmark.id,
                            parentId: bookmark.parentId,
                            index: bookmark.index,
                        },
                    };
                } else {
                    const historyItem = item as BrowserHistoryItem;
                    processedItem = {
                        url: historyItem.url,
                        title: historyItem.title || "",
                        domain: this.extractDomain(historyItem.url),
                        source: "history",
                        visitCount: historyItem.visitCount,
                        lastVisited: historyItem.lastVisitTime
                            ? new Date(historyItem.lastVisitTime).toISOString()
                            : undefined,
                        metadata: {
                            id: historyItem.id,
                            typedCount: historyItem.typedCount,
                        },
                    };
                }

                results.push(processedItem);
            } catch (error) {
                console.error("Failed to preprocess item:", error);
                // Continue with other items
            }
        }

        return results;
    }

    // Private helper methods

    private generateImportId(): string {
        return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private updateProgress(importId: string, progress: ImportProgress): void {
        const callback = this.progressCallbacks.get("global");
        if (callback) {
            callback(progress);
        }
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return "unknown";
        }
    }

    private async getBrowserBookmarks(
        source: "chrome" | "edge",
    ): Promise<BrowserBookmark[]> {
        try {
            if (typeof chrome !== "undefined" && chrome.bookmarks) {
                const bookmarks = await chrome.bookmarks.getTree();
                const flattened = this.flattenBookmarks(bookmarks);

                // Apply folder filtering if specified in current options
                // This would be enhanced to accept folder parameter
                return flattened;
            }
        } catch (error) {
            console.error("Failed to get bookmarks:", error);
            if (error instanceof Error) {
                if (error.message.includes("permissions")) {
                    throw new Error(
                        "Permission denied. Please enable bookmark access in extension settings.",
                    );
                }
                throw new Error(
                    `Failed to access ${source} bookmarks: ${error.message}`,
                );
            }
        }
        throw new Error(
            `${source} bookmarks not available or permission denied.`,
        );
    }

    private async getBrowserHistory(
        source: "chrome" | "edge",
    ): Promise<BrowserHistoryItem[]> {
        try {
            if (typeof chrome !== "undefined" && chrome.history) {
                // Default to last 30 days if not specified
                const daysBack = 30;
                const startTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;

                const historyItems = await chrome.history.search({
                    text: "",
                    startTime: startTime,
                    maxResults: 10000,
                });

                return historyItems.map((item) => ({
                    id: item.id || "",
                    url: item.url || "",
                    title: item.title,
                    visitCount: item.visitCount,
                    typedCount: item.typedCount,
                    lastVisitTime: item.lastVisitTime,
                }));
            }
        } catch (error) {
            console.error("Failed to get history:", error);
            if (error instanceof Error) {
                if (error.message.includes("permissions")) {
                    throw new Error(
                        "Permission denied. Please enable history access in extension settings.",
                    );
                }
                throw new Error(
                    `Failed to access ${source} history: ${error.message}`,
                );
            }
        }
        throw new Error(
            `${source} history not available or permission denied.`,
        );
    }

    private flattenBookmarks(
        bookmarks: chrome.bookmarks.BookmarkTreeNode[],
        folderFilter?: string,
    ): BrowserBookmark[] {
        const result: BrowserBookmark[] = [];

        const flatten = (
            nodes: chrome.bookmarks.BookmarkTreeNode[],
            currentPath: string = "",
        ) => {
            for (const node of nodes) {
                const nodePath = currentPath
                    ? `${currentPath}/${node.title}`
                    : node.title;

                if (node.url) {
                    // Only include if folder filter matches or no filter specified
                    if (
                        !folderFilter ||
                        nodePath
                            .toLowerCase()
                            .includes(folderFilter.toLowerCase())
                    ) {
                        result.push({
                            id: node.id,
                            title: node.title,
                            url: node.url,
                            dateAdded: node.dateAdded,
                            parentId: node.parentId,
                            index: node.index,
                        });
                    }
                }

                if (node.children) {
                    flatten(node.children, nodePath);
                }
            }
        };

        flatten(bookmarks);
        return result;
    }

    private async sendToServiceWorker(message: any): Promise<any> {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            console.error("Failed to send message to service worker:", error);
            throw new Error("Failed to communicate with service worker");
        }
    }
}
