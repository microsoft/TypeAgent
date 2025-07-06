// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DocPart, docPartsFromHtml, importWebPage } from "conversation-memory";
import { Result, success, error } from "typechat";
import { WebsiteDocPart } from "./websiteDocPart.js";
import { WebsiteMeta, WebsiteVisitInfo } from "./websiteMeta.js";
import { ContentExtractor, ExtractionMode } from "./contentExtractor.js";
import { intelligentWebsiteChunking } from "./chunkingUtils.js";

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
 * Enhanced HTML import that combines website content extraction with conversation chunking
 */
export function enhancedDocPartsFromHtml(
    html: string,
    url: string,
    options: Partial<EnhancedImportOptions> = {}
): Promise<WebsiteDocPart[]> {
    const opts = { ...defaultEnhancedImportOptions, ...options };
    
    return processHtmlWithEnhancedCapabilities(html, url, opts);
}

/**
 * Enhanced website import that leverages both packages' strengths
 */
export async function enhancedWebsiteImport(
    visitInfo: WebsiteVisitInfo,
    content?: string,
    options: Partial<EnhancedImportOptions> = {}
): Promise<WebsiteDocPart[]> {
    const opts = { ...defaultEnhancedImportOptions, ...options };
    const websiteMeta = new WebsiteMeta(visitInfo);
    
    if (!content) {
        // No content case - create minimal WebsiteDocPart
        return [new WebsiteDocPart(websiteMeta, [])];
    }
    
    // Determine if content is HTML or plain text
    const isHtml = content.trim().startsWith('<') && content.includes('>');
    
    if (isHtml) {
        // Process HTML content with enhanced capabilities
        return await processHtmlWithEnhancedCapabilities(content, visitInfo.url, opts, websiteMeta);
    } else {
        // Process plain text with intelligent chunking
        return processPlainTextContent(content, websiteMeta, opts);
    }
}

/**
 * Enhanced web page import from URL
 */
export async function importWebPageEnhanced(
    url: string,
    options: Partial<EnhancedImportOptions> = {}
): Promise<Result<WebsiteDocPart[]>> {
    const opts = { ...defaultEnhancedImportOptions, ...options };
    
    try {
        // Use conversation package's importWebPage for URL fetching
        const docMemoryResult = await importWebPage(url, opts.maxCharsPerChunk);
        
        if (!docMemoryResult.success) {
            return docMemoryResult;
        }
        
        // Extract HTML for enhanced processing
        const contentExtractor = new ContentExtractor({
            timeout: opts.contentTimeout,
            enableActionDetection: opts.enableActionDetection,
        });
        
        const extractedContent = await contentExtractor.extractFromUrl(url, opts.extractionMode);
        
        if (!extractedContent.success || !extractedContent.pageContent) {
            // Fallback to basic conversion from DocMemory
            const websiteDocParts = convertDocPartsToWebsiteDocParts(
                docMemoryResult.data.messages.getAll() as DocPart[],
                url
            );
            return success(websiteDocParts);
        }
        
        // Create WebsiteVisitInfo from extracted content
        const visitInfo: WebsiteVisitInfo = {
            url,
            title: extractedContent.pageContent?.title || "Untitled",
            source: "history",
        };
        
        // Add optional properties if they exist
        if (extractedContent.pageContent) visitInfo.pageContent = extractedContent.pageContent;
        if (extractedContent.metaTags) visitInfo.metaTags = extractedContent.metaTags;
        if (extractedContent.structuredData) visitInfo.structuredData = extractedContent.structuredData;
        if (extractedContent.actions) visitInfo.extractedActions = extractedContent.actions;
        if (extractedContent.detectedActions) visitInfo.detectedActions = extractedContent.detectedActions;
        if (extractedContent.actionSummary) visitInfo.actionSummary = extractedContent.actionSummary;
        
        // Process with enhanced capabilities
        const websiteDocParts = await enhancedWebsiteImport(
            visitInfo,
            extractedContent.pageContent?.mainContent,
            options
        );
        
        return success(websiteDocParts);
        
    } catch (err) {
        return error(`Enhanced web page import failed: ${err}`);
    }
}

/**
 * Process HTML content with enhanced capabilities
 */
async function processHtmlWithEnhancedCapabilities(
    html: string,
    url: string,
    options: EnhancedImportOptions,
    existingMeta?: WebsiteMeta
): Promise<WebsiteDocPart[]> {
    try {
        // Extract rich content using website package capabilities
        const contentExtractor = new ContentExtractor({
            timeout: options.contentTimeout,
            enableActionDetection: options.enableActionDetection,
        });
        
        const extractedContent = await contentExtractor.extractFromHtml(html, options.extractionMode);
        
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
            if (extractedContent.pageContent) visitInfo.pageContent = extractedContent.pageContent;
            if (extractedContent.metaTags) visitInfo.metaTags = extractedContent.metaTags;
            if (extractedContent.structuredData) visitInfo.structuredData = extractedContent.structuredData;
            if (extractedContent.actions) visitInfo.extractedActions = extractedContent.actions;
            if (extractedContent.detectedActions) visitInfo.detectedActions = extractedContent.detectedActions;
            if (extractedContent.actionSummary) visitInfo.actionSummary = extractedContent.actionSummary;
            
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
            const chunkMeta = index === 0 ? websiteMeta : new WebsiteMeta({
                url,
                title: websiteMeta.title || "Untitled",
                source: websiteMeta.websiteSource,
            });
            
            return new WebsiteDocPart(
                chunkMeta,
                [chunk],
                [], // tags
                websiteMeta.visitDate || websiteMeta.bookmarkDate,
                websiteMeta.getKnowledge()
            );
        });
        
    } catch (err) {
        console.warn('Enhanced HTML processing failed, falling back to basic processing:', err);
        
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
    options: EnhancedImportOptions
): WebsiteDocPart[] {
    // Apply intelligent chunking to plain text
    const chunks = intelligentWebsiteChunking(content, {
        maxCharsPerChunk: options.maxCharsPerChunk,
        preserveStructure: options.preserveStructure,
        includeMetadata: true,
    });
    
    // Create WebsiteDocPart for each chunk
    return chunks.map((chunk, index) => {
        const chunkMeta = index === 0 ? websiteMeta : new WebsiteMeta({
            url: websiteMeta.url,
            title: websiteMeta.title || "Untitled",
            source: websiteMeta.websiteSource,
        });
        
        return new WebsiteDocPart(
            chunkMeta,
            [chunk],
            [],
            websiteMeta.visitDate || websiteMeta.bookmarkDate,
            websiteMeta.getKnowledge()
        );
    });
}

/**
 * Convert DocPart objects to WebsiteDocPart objects
 */
function convertDocPartsToWebsiteDocParts(
    docParts: DocPart[],
    url: string,
    existingMeta?: WebsiteMeta
): WebsiteDocPart[] {
    return docParts.map(docPart => {
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
            docPart.deletionInfo
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
    processingStartTime: number
): ImportQualityMetrics {
    const totalParts = websiteDocParts.length;
    const totalSize = websiteDocParts.reduce((sum, part) => 
        sum + part.textChunks.join('').length, 0);
    const averagePartSize = totalSize / totalParts;
    
    const partsWithMetadata = websiteDocParts.filter(part => 
        part.metadata.websiteMeta.url && part.metadata.websiteMeta.title
    ).length;
    const metadataPreservation = (partsWithMetadata / totalParts) * 100;
    
    const actionDetectionSuccess = websiteDocParts.some(part => 
        part.metadata.websiteMeta.detectedActions && 
        part.metadata.websiteMeta.detectedActions.length > 0
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
