// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Import base types
import { ImportProgress, ImportError } from "./websiteImport.types";

/**
 * Folder import options for HTML folder import
 */
export interface FolderImportOptions {
    folderPath: string;
    extractContent?: boolean;
    enableIntelligentAnalysis?: boolean;
    enableActionDetection?: boolean;
    extractionMode?: "basic" | "content" | "actions" | "full";
    preserveStructure?: boolean;
    recursive?: boolean;
    fileTypes?: string[];
    limit?: number;
    maxFileSize?: number;
    skipHidden?: boolean;
}

/**
 * Folder import progress tracking
 */
export interface FolderImportProgress extends ImportProgress {
    currentFile?: string;
    filesFound: number;
    filesProcessed: number;
    failedFiles: string[];
    batchProgress?: {
        currentBatch: number;
        totalBatches: number;
    };
}

/**
 * Folder validation result
 */
export interface FolderValidationResult {
    isValid: boolean;
    folderExists: boolean;
    hasHtmlFiles: boolean;
    fileCount: number;
    totalSize: number;
    warnings: string[];
    errors: string[];
}

/**
 * Chrome extension message for folder import
 */
export interface ImportHtmlFolderMessage {
    type: "importHtmlFolder";
    parameters: {
        folderPath: string;
        options: FolderImportOptions;
        importId: string;
    };
}
