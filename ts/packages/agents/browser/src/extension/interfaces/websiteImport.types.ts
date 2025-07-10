// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Website Import Type Definitions
 * Shared interfaces for both web activity and file import functionality
 */

// Base import options for browser data (bookmarks/history)
export interface ImportOptions {
    source: "chrome" | "edge";
    type: "bookmarks" | "history";
    limit?: number;
    days?: number;
    folder?: string;
    extractContent?: boolean;
    enableIntelligentAnalysis?: boolean;
    enableActionDetection?: boolean;
    extractionMode?: "basic" | "content" | "actions" | "full";
    maxConcurrent?: number;
    contentTimeout?: number;
}

// Folder import specific options
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

// Progress tracking for imports
export interface ImportProgress {
    importId: string;
    phase:
        | "initializing"
        | "fetching"
        | "processing"
        | "extracting"
        | "complete"
        | "error";
    totalItems: number;
    processedItems: number;
    currentItem?: string;
    estimatedTimeRemaining?: number;
    errors: ImportError[];
}

// Extended progress for folder imports
export interface FolderImportProgress extends ImportProgress {
    currentFile?: string;
    filesProcessed: number;
    totalFiles: number;
    failedFiles: string[];
    folderPath: string;
}

// Import operation results
export interface ImportResult {
    success: boolean;
    importId: string;
    itemCount: number;
    duration: number;
    errors: ImportError[];
    summary: ImportSummary;
}

// Error information
export interface ImportError {
    type: "validation" | "network" | "processing" | "extraction";
    message: string;
    url?: string;
    timestamp: number;
}

// Summary statistics
export interface ImportSummary {
    totalProcessed: number;
    successfullyImported: number;
    knowledgeExtracted: number;
    entitiesFound: number;
    topicsIdentified: number;
    actionsDetected: number;
}

// Validation results
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// Folder validation results
export interface FolderValidationResult extends ValidationResult {
    folderPath?: string;
    fileCount?: number;
    estimatedSize?: number;
}

// Browser data structures
export interface BrowserBookmark {
    id: string;
    title: string;
    url: string;
    dateAdded?: number;
    parentId?: string;
    index?: number;
    children?: BrowserBookmark[];
}

export interface BrowserHistoryItem {
    id: string;
    url: string;
    title?: string;
    visitCount?: number;
    typedCount?: number;
    lastVisitTime?: number;
}

// Processed data structures
export interface ProcessedData {
    url: string;
    title: string;
    domain: string;
    source: "bookmarks" | "history";
    visitCount?: number;
    lastVisited?: string;
    extractedContent?: string;
    metadata: Record<string, any>;
}

// HTML parsing results
export interface ParsedHtmlData {
    title?: string;
    content: string;
    links: string[];
    images: string[];
    metadata: Record<string, any>;
}

// Content extraction results
export interface ExtractedContent {
    text: string;
    title?: string;
    description?: string;
    keywords?: string[];
    language?: string;
    publishDate?: string;
    author?: string;
}

// Import event callback types
export type ProgressCallback = (progress: ImportProgress) => void;
export type CompletionCallback = (result: ImportResult) => void;
export type ErrorCallback = (error: ImportError) => void;

// Chrome extension message types
export interface ImportWebsiteDataMessage {
    type: "importWebsiteDataWithProgress";
    parameters: ImportOptions;
    importId: string;
}

export interface ImportHtmlFolderMessage {
    type: "importHtmlFolder";
    parameters: {
        folderPath: string;
        options: FolderImportOptions;
        importId: string;
    };
}

export interface ProcessedHtmlFile {
    name: string;
    content: string;
    metadata: {
        title?: string;
        url?: string;
        lastModified?: number;
        size: number;
    };
    extractedData: {
        text: string;
        links: string[];
        images: string[];
        metadata: Record<string, any>;
    };
}

// Constants
export const SUPPORTED_FILE_TYPES = [".html", ".htm", ".mhtml"] as const;
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const DEFAULT_MAX_CONCURRENT = 5;
export const DEFAULT_CONTENT_TIMEOUT = 30000; // 30 seconds

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

// Re-export folder import types
export * from "./folderImport.types";
