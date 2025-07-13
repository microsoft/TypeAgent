// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebsiteDocPart } from "./websiteDocPart.js";
import { WebsiteMeta, WebsiteVisitInfo } from "./websiteMeta.js";
import { ExtractionMode } from "./contentExtractor.js";
import { 
    ContentExtractor,
    ExtractionInput
} from "./extraction/index.js";
import { intelligentWebsiteChunking } from "./chunkingUtils.js";
import type { ImportProgressCallback } from "./importWebsites.js";
import { conversation as kpLib } from "knowledge-processor";

/**
 * Enhanced HTML import options that combine website and conversation capabilities
 */
export interface EnhancedImportOptions {
    maxCharsPerChunk: number;
    preserveStructure: boolean;
    extractionMode: ExtractionMode;
    contentTimeout: number;
    
    // NEW: AI model for knowledge extraction
    knowledgeExtractor?: kpLib.KnowledgeExtractor;
}

/**
 * Default options for enhanced import
 */
export const defaultEnhancedImportOptions: EnhancedImportOptions = {
    maxCharsPerChunk: 2000,
    preserveStructure: true,
    extractionMode: "content",
    contentTimeout: 10000,
};

/**
 * Enhanced website import that leverages both packages' strengths
 */
export async function enhancedWebsiteImport(
    visitInfo: WebsiteVisitInfo,
    content?: string,
    options: Partial<EnhancedImportOptions & { knowledgeExtractor?: kpLib.KnowledgeExtractor }> = {},
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
    options?: Partial<EnhancedImportOptions & { knowledgeExtractor?: kpLib.KnowledgeExtractor }>,
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
        // Extract rich content using unified extraction system
        const extractorConfig: any = {
            mode: options.extractionMode,
            timeout: options.contentTimeout
        };
        
        // Only add knowledgeExtractor if it's provided
        if (options.knowledgeExtractor) {
            extractorConfig.knowledgeExtractor = options.knowledgeExtractor;
        }
        
        const contentExtractor = new ContentExtractor(extractorConfig);

        const input: ExtractionInput = {
            url,
            title: existingMeta?.title || url,
            htmlContent: html,
            source: "import",
            timestamp: new Date().toISOString()
        };
        
        const result = await contentExtractor.extract(input, options.extractionMode);

        // Create or enhance WebsiteMeta with extracted content
        let websiteMeta: WebsiteMeta;
        if (existingMeta) {
            websiteMeta = existingMeta;
            // Enhance existing metadata with extracted content
            if (result.pageContent) {
                websiteMeta.pageContent = result.pageContent;
            }
            if (result.metaTags) {
                websiteMeta.metaTags = result.metaTags;
            }
            if (result.detectedActions) {
                websiteMeta.detectedActions = result.detectedActions;
            }
        } else {
            // Create new WebsiteMeta from extracted content
            const visitInfo: WebsiteVisitInfo = {
                url,
                title: result.pageContent?.title || "Untitled",
                source: "history",
            };

            // Add optional properties if they exist
            if (result.pageContent)
                visitInfo.pageContent = result.pageContent;
            if (result.metaTags)
                visitInfo.metaTags = result.metaTags;
            if (result.structuredData)
                visitInfo.structuredData = result.structuredData;
            if (result.actions)
                visitInfo.extractedActions = result.actions;
            if (result.detectedActions)
                visitInfo.detectedActions = result.detectedActions;
            if (result.actionSummary)
                visitInfo.actionSummary = result.actionSummary;

            websiteMeta = new WebsiteMeta(visitInfo);
        }

        // Use main content for chunking
        const mainContent = result.pageContent?.mainContent || html;

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
            "Enhanced HTML processing failed, falling back to basic extraction:",
            err,
        );

        // Fallback to basic mode with unified ContentExtractor
        try {
            const basicExtractor = new ContentExtractor({ mode: "basic" });
            const basicInput: ExtractionInput = {
                url,
                title: existingMeta?.title || url,
                htmlContent: html,
                source: "import",
                timestamp: new Date().toISOString()
            };
            
            const basicResult = await basicExtractor.extract(basicInput, "basic");
            
            // Create minimal WebsiteMeta from basic extraction
            const basicMeta = existingMeta || new WebsiteMeta({
                url,
                title: basicResult.pageContent?.title || url,
                source: "history"
            });
            
            if (basicResult.pageContent) {
                basicMeta.pageContent = basicResult.pageContent;
            }
            
            // Apply chunking to basic content
            const mainContent = basicResult.pageContent?.mainContent || html;
            const chunks = intelligentWebsiteChunking(mainContent, {
                maxCharsPerChunk: options.maxCharsPerChunk,
                preserveStructure: options.preserveStructure,
                includeMetadata: true,
            });
            
            return chunks.map((chunk, index) => {
                return new WebsiteDocPart(
                    basicMeta,
                    [chunk],
                    [],
                    basicMeta.visitDate || basicMeta.bookmarkDate,
                    basicMeta.getKnowledge(),
                );
            });
        } catch (basicError) {
            console.error("Basic extraction also failed:", basicError);
            // Return minimal result if everything fails
            const fallbackMeta = existingMeta || new WebsiteMeta({
                url,
                title: url,
                source: "history"
            });
            return [new WebsiteDocPart(fallbackMeta, [])];
        }
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
