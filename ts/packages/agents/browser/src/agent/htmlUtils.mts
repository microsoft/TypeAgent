// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Agent-side HTML processing utilities using CrossContextHtmlReducer
 * Replaces the legacy htmlProcessor.mts functionality
 */

import { createNodeHtmlReducer } from "../common/crossContextHtmlReducer.js";
import {
    ContentExtractor,
    ExtractionInput,
    ExtractionResult,
    ExtractionMode,
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
} from "website-memory";

// Re-export types for consumers
export type {
    ExtractionMode,
    ExtractionResult,
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
};

/**
 * Processing options for HTML content processing
 */
export interface ProcessingOptions {
    mode?: ExtractionMode;
    contentTimeout?: number;
    maxContentLength?: number;
    maxConcurrent?: number;
    userAgent?: string;
    maxCharsPerChunk?: number;
    knowledgeExtractor?: any; // AI model for knowledge extraction
}

/**
 * Parsed HTML content interface
 */
export interface ParsedHtmlContent {
    title: string;
    content: string;
    url: string;
    metadata: Record<string, any>;
}

/**
 * File metadata interface
 */
export interface FileMetadata {
    filename: string;
    fileSize: number;
    lastModified: Date;
    filepath: string;
}

/**
 * Website data interface
 */
export interface WebsiteData {
    url: string;
    title: string;
    content: string;
    domain: string;
    metadata: {
        websiteSource: string;
        url: string;
        title: string;
        domain: string;
        pageType?: string;
        filename?: string;
        fileSize?: number;
        filePath?: string;
        importDate: string;
        lastModified: Date;
        publishedDate?: string;
        originalMetadata?: any;
        links?: string[];
        images?: ImageInfo[];
        actions?: ActionInfo[];
        structuredData?: StructuredDataCollection;
        metaTags?: MetaTagCollection;
        preserveStructure?: boolean;
        enhancedProcessing?: any;
        [key: string]: any;
    };
    visitCount: number;
    lastVisited: Date;
    extractionResult?: ExtractionResult;
}

/**
 * Process HTML content using CrossContextHtmlReducer and website-memory
 */
export async function processHtmlContent(
    html: string,
    sourceIdentifier: string, // URL or file path
    options: ProcessingOptions = {},
    fileMetadata?: FileMetadata,
): Promise<WebsiteData> {
    const config: any = {
        mode: options.mode || "content",
    };

    // Only add optional properties if they have values
    if (options.contentTimeout !== undefined)
        config.timeout = options.contentTimeout;
    if (options.maxContentLength !== undefined)
        config.maxContentLength = options.maxContentLength;
    if (options.knowledgeExtractor)
        config.knowledgeExtractor = options.knowledgeExtractor;
    if (options.maxConcurrent !== undefined)
        config.maxConcurrent = options.maxConcurrent;
    if (options.userAgent) config.userAgent = options.userAgent;

    const extractor = new ContentExtractor(config);

    try {
        // Pre-process HTML with Node-optimized reducer for consistent processing
        const reducer = await createNodeHtmlReducer();
        const processedHtml = reducer.reduce(html);

        // Create input for website-memory extraction
        const input: ExtractionInput = {
            url: sourceIdentifier.startsWith("http") ? sourceIdentifier : `file://${sourceIdentifier}`,
            title: "Unknown", // Will be extracted from content
            htmlContent: processedHtml,
            source: sourceIdentifier.startsWith("http") ? "direct" : "import",
        };

        // Extract content using website-memory
        const result = await extractor.extract(input, options.mode || "content");

        if (!result || !result.pageContent) {
            throw new Error("Failed to extract content from HTML");
        }

        // Extract domain from URL or use filename
        let domain: string;
        if (sourceIdentifier.startsWith("http")) {
            try {
                domain = new URL(sourceIdentifier).hostname || "unknown";
            } catch {
                domain = "unknown";
            }
        } else {
            domain = "local";
        }

        // Create WebsiteData from extraction result
        const websiteData: WebsiteData = {
            url: sourceIdentifier,
            title: (result.pageContent.title || "Untitled") as string,
            content: result.pageContent.mainContent || "",
            domain,
            visitCount: 0,
            lastVisited: new Date(),
            extractionResult: result,
            metadata: {
                websiteSource: sourceIdentifier.startsWith("http") ? "web" : "file",
                url: sourceIdentifier,
                title: (result.pageContent.title || "Untitled") as string,
                domain,
                importDate: new Date().toISOString(),
                lastModified: fileMetadata?.lastModified || new Date(),
                originalMetadata: result,
                links: result.pageContent.links?.map((link: any) => link.href).filter(Boolean) || [],
                images: result.pageContent.images || [],
                actions: result.actions || [],
            },
        };

        // Add optional properties only if they exist
        if (fileMetadata?.filename) websiteData.metadata.filename = fileMetadata.filename;
        if (fileMetadata?.fileSize) websiteData.metadata.fileSize = fileMetadata.fileSize;
        if (result.structuredData) websiteData.metadata.structuredData = result.structuredData;
        if (result.metaTags) websiteData.metadata.metaTags = result.metaTags;

        return websiteData;
    } catch (error) {
        console.error("Error processing HTML content:", error);
        throw error;
    }
}

/**
 * Create WebsiteData from basic HTML content
 */
export function createWebsiteData(
    url: string,
    title: string,
    content: string,
    metadata: Partial<WebsiteData["metadata"]> = {}
): WebsiteData {
    const domain = url.startsWith("http") ? new URL(url).hostname : "local";
    
    return {
        url,
        title,
        content,
        domain,
        visitCount: 0,
        lastVisited: new Date(),
        metadata: {
            websiteSource: url.startsWith("http") ? "web" : "file",
            url,
            title,
            domain,
            importDate: new Date().toISOString(),
            lastModified: new Date(),
            ...metadata,
        },
    };
}

/**
 * Process HTML content with enhanced extraction
 */
export async function processHtmlContentEnhanced(
    html: string,
    sourceIdentifier: string,
    options: ProcessingOptions = {},
    fileMetadata?: FileMetadata,
): Promise<{
    websiteData: WebsiteData;
    extractionResult: ExtractionResult;
}> {
    const config: any = {
        mode: options.mode || "content",
    };

    if (options.contentTimeout !== undefined)
        config.timeout = options.contentTimeout;
    if (options.maxContentLength !== undefined)
        config.maxContentLength = options.maxContentLength;
    if (options.knowledgeExtractor)
        config.knowledgeExtractor = options.knowledgeExtractor;
    if (options.maxConcurrent !== undefined)
        config.maxConcurrent = options.maxConcurrent;
    if (options.userAgent) config.userAgent = options.userAgent;

    const extractor = new ContentExtractor(config);

    try {
        // Pre-process HTML with Node-optimized reducer
        const reducer = await createNodeHtmlReducer();
        const processedHtml = reducer.reduce(html);

        // Create input for website-memory extraction
        const input: ExtractionInput = {
            url: sourceIdentifier.startsWith("http") ? sourceIdentifier : `file://${sourceIdentifier}`,
            title: "Unknown", // Will be extracted from content
            htmlContent: processedHtml,
            source: sourceIdentifier.startsWith("http") ? "direct" : "import",
        };

        // Extract content using website-memory
        const extractionResult = await extractor.extract(input, options.mode || "content");

        if (!extractionResult || !extractionResult.pageContent) {
            throw new Error("Failed to extract content from HTML");
        }

        // Extract domain from URL or use filename
        let domain: string;
        if (sourceIdentifier.startsWith("http")) {
            try {
                domain = new URL(sourceIdentifier).hostname || "unknown";
            } catch {
                domain = "unknown";
            }
        } else {
            domain = "local";
        }

        // Create WebsiteData from extraction result
        const websiteData: WebsiteData = {
            url: sourceIdentifier,
            title: (extractionResult.pageContent.title || "Untitled") as string,
            content: extractionResult.pageContent.mainContent || "",
            domain,
            visitCount: 0,
            lastVisited: new Date(),
            extractionResult: extractionResult,
            metadata: {
                websiteSource: sourceIdentifier.startsWith("http") ? "web" : "file",
                url: sourceIdentifier,
                title: (extractionResult.pageContent.title || "Untitled") as string,
                domain,
                importDate: new Date().toISOString(),
                lastModified: fileMetadata?.lastModified || new Date(),
                originalMetadata: extractionResult,
                links: extractionResult.pageContent.links?.map((link: any) => link.href).filter(Boolean) || [],
                images: extractionResult.pageContent.images || [],
                actions: extractionResult.actions || [],
            },
        };

        // Add optional properties only if they exist
        if (fileMetadata?.filename) websiteData.metadata.filename = fileMetadata.filename;
        if (fileMetadata?.fileSize) websiteData.metadata.fileSize = fileMetadata.fileSize;
        if (extractionResult.structuredData) websiteData.metadata.structuredData = extractionResult.structuredData;
        if (extractionResult.metaTags) websiteData.metadata.metaTags = extractionResult.metaTags;

        return {
            websiteData,
            extractionResult,
        };
    } catch (error) {
        console.error("Error processing HTML content:", error);
        throw error;
    }
}

/**
 * Parse HTML content into structured format
 */
export async function parseHtmlContent(html: string, url: string): Promise<ParsedHtmlContent> {
    try {
        // Use Node-optimized reducer for HTML processing
        const reducer = await createNodeHtmlReducer();
        const processedHtml = reducer.reduce(html);

        // Extract title from HTML
        const titleMatch = processedHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "Untitled";

        // Extract text content
        const textContent = processedHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

        return {
            title,
            content: textContent,
            url,
            metadata: {
                processedHtml,
                originalLength: html.length,
                processedLength: processedHtml.length,
            },
        };
    } catch (error) {
        console.error("Error parsing HTML content:", error);
        return {
            title: "Untitled",
            content: html,
            url,
            metadata: { error: (error as Error).message },
        };
    }
}

// Note: processHtmlContentEnhanced is already defined above
