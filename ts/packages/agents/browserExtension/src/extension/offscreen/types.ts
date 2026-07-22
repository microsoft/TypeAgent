// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core interfaces for Content Download Adapter
 */

/**
 * Main interface for content downloading across different methods
 */
export interface ContentDownloadAdapter {
    downloadContent(
        url: string,
        options?: DownloadOptions,
    ): Promise<ContentDownloadResult>;
}

/**
 * Configuration options for content downloading
 */
export interface DownloadOptions {
    /** Use browser context for authentication and JavaScript execution */
    useAuthentication?: boolean;
    /** Maximum time to wait for download/processing (ms) */
    timeout?: number;
    /** Whether to fallback to fetch() if browser download fails */
    fallbackToFetch?: boolean;
    /** Custom user agent string */
    userAgent?: string;
    /** Wait for dynamic content to load */
    waitForDynamic?: boolean;
    /** Scroll behavior for dynamic content */
    scrollBehavior?: "none" | "capture-initial" | "scroll-to-bottom";
    /** Processing options */
    processing?: ProcessingOptions;
}

/**
 * Result of content download operation
 */
export interface ContentDownloadResult {
    /** Whether the download was successful */
    success: boolean;
    /** The downloaded and processed HTML content */
    htmlContent?: string;
    /** The extracted text content */
    textContent?: string;
    /** Method used for downloading */
    method: "browser" | "fetch" | "failed";
    /** Error message if download failed */
    error?: string;
    /** Additional metadata about the download */
    metadata?: ContentMetadata;
}

/**
 * Metadata about downloaded content
 */
export interface ContentMetadata {
    /** Final URL after redirects */
    finalUrl: string;
    /** HTTP status code (for fetch method) */
    statusCode?: number;
    /** Response headers */
    headers?: Record<string, string>;
    /** Time taken to download and process (ms) */
    loadTime: number;
    /** Page title */
    title?: string;
    /** Content length in bytes */
    contentLength?: number;
    /** Processing method used */
    processingMethod?: "offscreen" | "content-script" | "basic";
}

/**
 * Options for HTML processing
 */
export interface ProcessingOptions {
    /** Apply readability filter to extract main content */
    filterToReadingView?: boolean;
    /** Preserve meta tags during processing */
    keepMetaTags?: boolean;
    /** Extract plain text content */
    extractText?: boolean;
    /** Add timestamp IDs to elements */
    useTimestampIds?: boolean;
    /** Preserve document structure */
    preserveStructure?: boolean;
    /** Maximum number of elements to keep */
    maxElements?: number;
}

/**
 * Result of HTML processing
 */
export interface ProcessedHtmlResult {
    /** Whether processing was successful */
    success: boolean;
    /** Processed HTML content */
    processedHtml?: string;
    /** Extracted text content */
    textContent?: string;
    /** Processing metadata */
    metadata?: ProcessingMetadata;
    /** Error message if processing failed */
    error?: string;
}

/**
 * Metadata about HTML processing
 */
export interface ProcessingMetadata {
    /** Method used for processing */
    processingMethod: "offscreen" | "content-script" | "basic" | "fallback";
    /** Time taken to process (ms) */
    processingTime: number;
    /** Original content size */
    originalSize: number;
    /** Processed content size */
    processedSize: number;
    /** Reduction ratio */
    reductionRatio: number;
    /** Number of elements removed */
    elementsRemoved?: number;
    /** Processing timestamp */
    timestamp: number;
}

/**
 * Messages for service worker communication
 */
export interface ServiceWorkerMessage {
    type:
        | "downloadContentWithBrowser"
        | "processHtmlContent"
        | "createOffscreenDocument";
    url?: string;
    htmlContent?: string;
    options?: DownloadOptions | ProcessingOptions;
    target?: "offscreen" | "content-script";
    messageId?: string;
}

/**
 * Messages for offscreen document communication
 */
export interface OffscreenMessage {
    type: "downloadContent" | "processHtmlContent" | "ping";
    url?: string;
    htmlContent?: string;
    filePath?: string;
    options?: DownloadOptions | ProcessingOptions;
    messageId?: string;
}

/**
 * Response format for all message types
 */
export interface MessageResponse {
    success: boolean;
    data?: any;
    error?: string;
    messageId: string;
    metadata?: any;
}

/**
 * Standardized HTML fragment format
 */
export interface HTMLFragment {
    /** Frame ID (0 for non-browser sources) */
    frameId: number;
    /** Processed HTML content */
    content: string;
    /** Extracted text content */
    text: string;
    /** Fragment metadata */
    metadata?: FragmentMetadata;
}

/**
 * Metadata for HTML fragments
 */
export interface FragmentMetadata {
    /** Source of the content */
    source: "browser" | "file" | "url";
    /** Processing method used */
    processingMethod: "enhanced" | "basic" | "fallback";
    /** Original URL or file path */
    url?: string;
    /** Page or file title */
    title?: string;
    /** Processing timestamp */
    timestamp: number;
    /** Additional processing info */
    processingInfo?: {
        readabilityApplied: boolean;
        htmlReduced: boolean;
        textExtracted: boolean;
    };
}

/**
 * Error codes for content download operations
 */
export enum ContentDownloadErrorCode {
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT",
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
    INVALID_URL = "INVALID_URL",
    CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE",
    PROCESSING_FAILED = "PROCESSING_FAILED",
    OFFSCREEN_UNAVAILABLE = "OFFSCREEN_UNAVAILABLE",
    CONCURRENT_LIMIT_EXCEEDED = "CONCURRENT_LIMIT_EXCEEDED",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Structured error information
 */
export interface ContentDownloadError {
    code: ContentDownloadErrorCode;
    message: string;
    details?: any;
    retryable: boolean;
    suggestedAction?: string;
}
