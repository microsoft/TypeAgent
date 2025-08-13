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
    ProgressCallback,
    SUPPORTED_FILE_TYPES,
    DEFAULT_MAX_FILE_SIZE,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_CONTENT_TIMEOUT,
} from "../interfaces/websiteImport.types";
import { ExtensionServiceBase } from "./extensionServiceBase";
import { createExtensionService } from "./knowledgeUtilities";

/**
 * Core import logic and data processing manager
 * Handles both web activity (browser data) and folder import operations
 */
export class WebsiteImportManager {
    private progressCallbacks: Map<string, ProgressCallback> = new Map();
    private activeImports: Map<string, boolean> = new Map();
    private extensionService: ExtensionServiceBase;

    constructor() {
        this.extensionService = createExtensionService();
    }

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

            // Initialize progress - simplified phases
            this.updateProgress(importId, {
                importId,
                phase: "initializing",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            });

            // Register progress callback with service
            const globalCallback = this.progressCallbacks.get("global");
            if (globalCallback) {
                this.extensionService.onImportProgress(importId, globalCallback);
            }

            // Use ExtensionServiceBase abstraction (works in both environments)
            const result = await this.sendToAgentWithErrorHandling(options, importId);

            const duration = Date.now() - startTime;

            return {
                success: true,
                importId,
                itemCount: result.itemCount || 0,
                duration,
                errors: [],
                summary: result.summary || this.createEmptySummary(),
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const enhancedError = this.analyzeAndEnhanceError(error, options);
            
            return {
                success: false,
                importId,
                itemCount: 0,
                duration,
                errors: [enhancedError],
                summary: this.createEmptySummary(),
            };
        } finally {
            this.activeImports.delete(importId);
            this.cleanupProgressCallback(importId);
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

            // Send folder import request using ExtensionServiceBase
            // The backend will handle folder enumeration and file processing
            const result = await this.extensionService.importHtmlFolder(
                options.folderPath,
                options,
                importId
            );

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

            // Send cancellation using ExtensionServiceBase
            try {
                await this.extensionService.cancelImport(importId);
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
        // Store callback for progress updates - use a specific key per import
        this.progressCallbacks.set("global", callback);
    }

    /**
     * Register progress update callback for a specific import
     */
    onProgressUpdateForImport(
        importId: string,
        callback: ProgressCallback,
    ): void {
        this.progressCallbacks.set(importId, callback);
    }

    /**
     * Cross-environment agent communication with enhanced error handling
     */
    private async sendToAgentWithErrorHandling(
        options: ImportOptions, 
        importId: string
    ): Promise<ImportResult> {
        try {
            // Use ExtensionServiceBase abstraction - works in both Chrome and Electron
            const result = await this.extensionService.importBrowserData(options, importId);
            
            return result;
        } catch (error) {
            console.error("Agent communication failed:", error);
            
            // Re-throw with enhanced error analysis
            throw error; // Error enhancement happens in analyzeAndEnhanceError
        }
    }

    /**
     * Enhanced error analysis with SQLite-specific guidance
     */
    private analyzeAndEnhanceError(error: any, options: ImportOptions): ImportError {
        const message = error?.message?.toLowerCase() || '';
        const browserName = options.source === 'chrome' ? 'Chrome' : 'Microsoft Edge';
        
        // SQLite database locked error (most common)
        if (message.includes('database is locked') || 
            message.includes('sqlite_busy') ||
            message.includes('cannot access')) {
            return {
                type: 'processing',
                message: `Cannot access ${browserName} ${options.type} while the browser is running.\n\nPlease:\n1. Close all ${browserName} windows completely\n2. Wait a few seconds for the browser to fully exit\n3. Try the import again\n\nIf the problem persists, restart your computer and try again.`,
                timestamp: Date.now(),
            };
        }
        
        // better-sqlite3 binary compatibility
        if (message.includes('not a valid sqlite database') || 
            message.includes('wrong architecture') ||
            message.includes('module not found') ||
            message.includes('better-sqlite3')) {
            return {
                type: 'processing',
                message: `Database driver compatibility issue detected.\n\nThe SQLite driver may need to be rebuilt for your system architecture.\n\nRun \`pnpm rebuild\` to rebuild the driver, then \`pnpm install\` to install it.`,
                timestamp: Date.now(),
            };
        }
        
        // File not found - browser not installed or different profile
        if (message.includes('no such file') || 
            message.includes('enoent') ||
            message.includes('not found')) {
            return {
                type: 'validation',
                message: `${browserName} data files not found.\n\nThis might mean:\n• ${browserName} is not installed on this system\n• ${browserName} uses a non-standard profile location\n• No ${options.type} data exists for this browser\n\nPlease verify ${browserName} is installed and has ${options.type} data to import.`,
                timestamp: Date.now(),
            };
        }
        
        // Permission denied
        if (message.includes('permission denied') || 
            message.includes('eacces')) {
            return {
                type: 'validation',
                message: `Permission denied accessing ${browserName} data.\n\nPlease ensure:\n• The application has permission to read browser data\n• ${browserName} is not running with elevated privileges\n• Your user account has access to the browser data directory`,
                timestamp: Date.now(),
            };
        }
        
        // Browser data corruption
        if (message.includes('malformed') || 
            message.includes('corrupt')) {
            return {
                type: 'processing',
                message: `${browserName} data files appear to be corrupted.\n\nTry:\n• Restarting ${browserName}\n• Running the browser's built-in repair tools\n• Importing again after the browser restart`,
                timestamp: Date.now(),
            };
        }
        
        // Extension/service communication issues
        if (message.includes('extension') || 
            message.includes('service worker') ||
            message.includes('runtime') ||
            message.includes('electronAPI')) {
            return {
                type: 'processing',
                message: `Communication error with the import service.\n\nTry:\n• Refreshing this page\n• Restarting the browser/application\n• Checking if the browser extension is enabled`,
                timestamp: Date.now(),
            };
        }
        
        // Generic error with context
        return {
            type: 'processing',
            message: error?.message || 'An unexpected error occurred during import',
            timestamp: Date.now(),
        };
    }

    /**
     * Clean up progress callback listeners
     */
    private cleanupProgressCallback(importId: string): void {
        const callback = this.progressCallbacks.get(importId);
        if (callback) {
            // Clean up environment-specific listeners
            if ((callback as any)._messageListener) {
                chrome?.runtime?.onMessage?.removeListener((callback as any)._messageListener);
            }
            if ((callback as any)._progressHandler && (callback as any)._importId) {
                // Electron cleanup
                if ((window as any).electronAPI?.unregisterImportProgressCallback) {
                    (window as any).electronAPI.unregisterImportProgressCallback((callback as any)._importId);
                }
            }
            this.progressCallbacks.delete(importId);
        }
    }

    private createEmptySummary(): ImportSummary {
        return {
            totalProcessed: 0,
            successfullyImported: 0,
            knowledgeExtracted: 0,
            entitiesFound: 0,
            topicsIdentified: 0,
            actionsDetected: 0,
        };
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

        if (options.mode && options.mode !== "basic") {
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


    // Private helper methods

    private generateImportId(): string {
        return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private updateProgress(importId: string, progress: ImportProgress): void {
        // Try specific import callback first, then fall back to global
        const specificCallback = this.progressCallbacks.get(importId);
        const globalCallback = this.progressCallbacks.get("global");

        const callback = specificCallback || globalCallback;
        if (callback) {
            callback(progress);
        }
    }

}
