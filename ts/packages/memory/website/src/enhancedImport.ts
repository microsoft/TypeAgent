// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DocPart, docPartsFromHtml } from "conversation-memory";
import { WebsiteDocPart } from "./websiteDocPart.js";
import { WebsiteMeta, WebsiteVisitInfo } from "./websiteMeta.js";
import { ContentExtractor, ExtractionMode } from "./contentExtractor.js";
import { intelligentWebsiteChunking } from "./chunkingUtils.js";
import type { ImportProgressCallback } from "./importWebsites.js";

/**
 * Enhanced HTML import options that combine website and conversation capabilities
 */
export interface EnhancedImportOptions {
    maxCharsPerChunk: number;
    preserveStructure: boolean;
    extractionMode: ExtractionMode;
    enableActionDetection: boolean;
    contentTimeout: number;
}

/**
 * Default options for enhanced import
 */
export const defaultEnhancedImportOptions: EnhancedImportOptions = {
    maxCharsPerChunk: 2000,
    preserveStructure: true,
    extractionMode: "content",
    enableActionDetection: true,
    contentTimeout: 10000,
};

/**
 * Enhanced website import that leverages both packages' strengths
 */
export async function enhancedWebsiteImport(
    visitInfo: WebsiteVisitInfo,
    content?: string,
    options: Partial<EnhancedImportOptions> = {},
): Promise<WebsiteDocPart[]> {
    const opts = { ...defaultEnhancedImportOptions, ...options };
    const websiteMeta = new WebsiteMeta(visitInfo);

    if (!content) {
        // No content case - create minimal WebsiteDocPart
        return [new WebsiteDocPart(websiteMeta, [])];
    }

    // Determine if content is HTML or plain text
    const isHtml = content.trim().startsWith("<") && content.includes(">");

    if (isHtml) {
        // Process HTML content with enhanced capabilities
        return await processHtmlWithEnhancedCapabilities(
            content,
            visitInfo.url,
            opts,
            websiteMeta,
        );
    } else {
        // Process plain text with intelligent chunking
        return processPlainTextContent(content, websiteMeta, opts);
    }
}

/**
 * Enhanced browser import that uses intelligent chunking and improved content processing
 */
export async function importWebsitesEnhanced(
    source: "chrome" | "edge",
    type: "bookmarks" | "history",
    filePath: string,
    options?: Partial<EnhancedImportOptions & any>,
    progressCallback?: ImportProgressCallback,
): Promise<WebsiteDocPart[]> {
    // Import using existing browser import logic to get Website objects
    const { importWebsites } = await import("./importWebsites.js");
    const websites = await importWebsites(
        source,
        type,
        filePath,
        options,
        progressCallback,
    );

    // Convert Website objects to WebsiteDocPart using enhanced processing
    const websiteDocParts: WebsiteDocPart[] = [];
    const enhancedOptions = { ...defaultEnhancedImportOptions, ...options };

    for (let i = 0; i < websites.length; i++) {
        const website = websites[i];

        try {
            // Create WebsiteVisitInfo from existing Website
            const visitInfo: WebsiteVisitInfo = {
                url: website.metadata.url,
                title: website.metadata.title || "Untitled",
                source: website.metadata.websiteSource,
            };

            // Add optional properties if they exist
            if (website.metadata.domain)
                visitInfo.domain = website.metadata.domain;
            if (website.metadata.visitDate)
                visitInfo.visitDate = website.metadata.visitDate;
            if (website.metadata.bookmarkDate)
                visitInfo.bookmarkDate = website.metadata.bookmarkDate;
            if (website.metadata.folder)
                visitInfo.folder = website.metadata.folder;
            if (website.metadata.pageType)
                visitInfo.pageType = website.metadata.pageType;
            if (website.metadata.keywords)
                visitInfo.keywords = website.metadata.keywords;
            if (website.metadata.description)
                visitInfo.description = website.metadata.description;
            if (website.metadata.favicon)
                visitInfo.favicon = website.metadata.favicon;
            if (website.metadata.visitCount)
                visitInfo.visitCount = website.metadata.visitCount;
            if (website.metadata.lastVisitTime)
                visitInfo.lastVisitTime = website.metadata.lastVisitTime;
            if (website.metadata.typedCount)
                visitInfo.typedCount = website.metadata.typedCount;
            if (website.metadata.pageContent)
                visitInfo.pageContent = website.metadata.pageContent;
            if (website.metadata.metaTags)
                visitInfo.metaTags = website.metadata.metaTags;
            if (website.metadata.structuredData)
                visitInfo.structuredData = website.metadata.structuredData;
            if (website.metadata.extractedActions)
                visitInfo.extractedActions = website.metadata.extractedActions;
            if (website.metadata.detectedActions)
                visitInfo.detectedActions = website.metadata.detectedActions;
            if (website.metadata.actionSummary)
                visitInfo.actionSummary = website.metadata.actionSummary;

            // Get the main content from the website
            const mainContent = website.textChunks.join("\n\n");

            // Use enhanced import processing
            const docParts = await enhancedWebsiteImport(
                visitInfo,
                mainContent,
                enhancedOptions,
            );
            websiteDocParts.push(...docParts);

            // Update progress if callback provided
            if (progressCallback) {
                progressCallback(
                    i + 1,
                    websites.length,
                    `Processing ${website.metadata.title || website.metadata.url}`,
                );
            }
        } catch (error) {
            console.warn(
                `Enhanced processing failed for ${website.metadata.url}, using fallback:`,
                error,
            );

            // Fallback: convert directly to WebsiteDocPart
            const fallbackDocPart = WebsiteDocPart.fromWebsite(website);
            websiteDocParts.push(fallbackDocPart);
        }
    }

    return websiteDocParts;
}

/**
 * Process HTML content with enhanced capabilities
 */
async function processHtmlWithEnhancedCapabilities(
    html: string,
    url: string,
    options: EnhancedImportOptions,
    existingMeta?: WebsiteMeta,
): Promise<WebsiteDocPart[]> {
    try {
        // Extract rich content using website package capabilities
        const contentExtractor = new ContentExtractor({
            timeout: options.contentTimeout,
            enableActionDetection: options.enableActionDetection,
        });

        const extractedContent = await contentExtractor.extractFromHtml(
            html,
            options.extractionMode,
        );

        // Create or enhance WebsiteMeta with extracted content
        let websiteMeta: WebsiteMeta;
        if (existingMeta) {
            websiteMeta = existingMeta;
            // Enhance existing metadata with extracted content
            if (extractedContent.pageContent) {
                websiteMeta.pageContent = extractedContent.pageContent;
            }
            if (extractedContent.metaTags) {
                websiteMeta.metaTags = extractedContent.metaTags;
            }
            if (extractedContent.detectedActions) {
                websiteMeta.detectedActions = extractedContent.detectedActions;
            }
        } else {
            // Create new WebsiteMeta from extracted content
            const visitInfo: WebsiteVisitInfo = {
                url,
                title: extractedContent.pageContent?.title || "Untitled",
                source: "history",
            };

            // Add optional properties if they exist
            if (extractedContent.pageContent)
                visitInfo.pageContent = extractedContent.pageContent;
            if (extractedContent.metaTags)
                visitInfo.metaTags = extractedContent.metaTags;
            if (extractedContent.structuredData)
                visitInfo.structuredData = extractedContent.structuredData;
            if (extractedContent.actions)
                visitInfo.extractedActions = extractedContent.actions;
            if (extractedContent.detectedActions)
                visitInfo.detectedActions = extractedContent.detectedActions;
            if (extractedContent.actionSummary)
                visitInfo.actionSummary = extractedContent.actionSummary;

            websiteMeta = new WebsiteMeta(visitInfo);
        }

        // Use main content for chunking
        const mainContent = extractedContent.pageContent?.mainContent || html;

        // Apply intelligent chunking
        const chunks = intelligentWebsiteChunking(mainContent, {
            maxCharsPerChunk: options.maxCharsPerChunk,
            preserveStructure: options.preserveStructure,
            includeMetadata: true,
        });

        // Create WebsiteDocPart for each chunk
        return chunks.map((chunk, index) => {
            const chunkMeta =
                index === 0
                    ? websiteMeta
                    : new WebsiteMeta({
                          url,
                          title: websiteMeta.title || "Untitled",
                          source: websiteMeta.websiteSource,
                      });

            return new WebsiteDocPart(
                chunkMeta,
                [chunk],
                [], // tags
                websiteMeta.visitDate || websiteMeta.bookmarkDate,
                websiteMeta.getKnowledge(),
            );
        });
    } catch (err) {
        console.warn(
            "Enhanced HTML processing failed, falling back to basic processing:",
            err,
        );

        // Fallback to conversation package's basic HTML processing
        const docParts = docPartsFromHtml(html, options.maxCharsPerChunk, url);
        return convertDocPartsToWebsiteDocParts(docParts, url, existingMeta);
    }
}

/**
 * Process plain text content with intelligent chunking
 */
function processPlainTextContent(
    content: string,
    websiteMeta: WebsiteMeta,
    options: EnhancedImportOptions,
): WebsiteDocPart[] {
    // Apply intelligent chunking to plain text
    const chunks = intelligentWebsiteChunking(content, {
        maxCharsPerChunk: options.maxCharsPerChunk,
        preserveStructure: options.preserveStructure,
        includeMetadata: true,
    });

    // Create WebsiteDocPart for each chunk
    return chunks.map((chunk, index) => {
        const chunkMeta =
            index === 0
                ? websiteMeta
                : new WebsiteMeta({
                      url: websiteMeta.url,
                      title: websiteMeta.title || "Untitled",
                      source: websiteMeta.websiteSource,
                  });

        return new WebsiteDocPart(
            chunkMeta,
            [chunk],
            [],
            websiteMeta.visitDate || websiteMeta.bookmarkDate,
            websiteMeta.getKnowledge(),
        );
    });
}

/**
 * Convert DocPart objects to WebsiteDocPart objects
 */
function convertDocPartsToWebsiteDocParts(
    docParts: DocPart[],
    url: string,
    existingMeta?: WebsiteMeta,
): WebsiteDocPart[] {
    return docParts.map((docPart) => {
        let websiteMeta: WebsiteMeta;

        if (existingMeta) {
            websiteMeta = existingMeta;
        } else {
            // Create minimal WebsiteMeta from DocPart
            const visitInfo: WebsiteVisitInfo = {
                url: docPart.metadata.sourceUrl || url,
                title: "Imported Content",
                source: "history",
            };
            websiteMeta = new WebsiteMeta(visitInfo);
        }

        return new WebsiteDocPart(
            websiteMeta,
            docPart.textChunks,
            docPart.tags,
            docPart.timestamp,
            docPart.knowledge,
            docPart.deletionInfo,
        );
    });
}

/**
 * Analyze import quality for testing and optimization
 */
export interface ImportQualityMetrics {
    totalParts: number;
    averagePartSize: number;
    metadataPreservation: number; // percentage
    actionDetectionSuccess: boolean;
    processingTime: number;
}

export function analyzeImportQuality(
    websiteDocParts: WebsiteDocPart[],
    processingStartTime: number,
): ImportQualityMetrics {
    const totalParts = websiteDocParts.length;
    const totalSize = websiteDocParts.reduce(
        (sum, part) => sum + part.textChunks.join("").length,
        0,
    );
    const averagePartSize = totalSize / totalParts;

    const partsWithMetadata = websiteDocParts.filter(
        (part) =>
            part.metadata.websiteMeta.url && part.metadata.websiteMeta.title,
    ).length;
    const metadataPreservation = (partsWithMetadata / totalParts) * 100;

    const actionDetectionSuccess = websiteDocParts.some(
        (part) =>
            part.metadata.websiteMeta.detectedActions &&
            part.metadata.websiteMeta.detectedActions.length > 0,
    );

    const processingTime = Date.now() - processingStartTime;

    return {
        totalParts,
        averagePartSize,
        metadataPreservation,
        actionDetectionSuccess,
        processingTime,
    };
}
