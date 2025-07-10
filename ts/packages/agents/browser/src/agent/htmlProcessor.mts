// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared HTML processing module for consolidating HTML import logic
 * between bookmark/history import and HTML file import flows.
 */

import * as cheerio from "cheerio";
import {
    ContentExtractor,
    ExtractionMode,
    EnhancedContent,
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
    type EnhancedContentWithKnowledge,
    type KnowledgeExtractionMode,
} from "website-memory";

// Re-export types for consumers
export type {
    ExtractionMode,
    EnhancedContent,
    PageContent,
    MetaTagCollection,
    ImageInfo,
    LinkInfo,
    ActionInfo,
    StructuredDataCollection,
    EnhancedContentWithKnowledge,
    KnowledgeExtractionMode,
};

/**
 * Processing options for HTML content processing
 */
export interface ProcessingOptions {
    extractContent?: boolean;
    extractionMode?: ExtractionMode;
    enableIntelligentAnalysis?: boolean;
    enableActionDetection?: boolean;
    contentTimeout?: number;
    maxContentLength?: number;
    maxConcurrent?: number;
    userAgent?: string;
    knowledgeMode?: KnowledgeExtractionMode;
    maxCharsPerChunk?: number;
}

export interface ParsedHtmlContent {
    title: string;
    content: string;
    links: string[];
    images: string[];
    metadata: Record<string, any>;
    publishedDate?: Date;
    wordCount: number;
    readingTime: number;
}

export interface FileMetadata {
    filename: string;
    filePath: string;
    fileSize: number;
    lastModified: Date;
    fileUrl: string;
}

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
        importDate: string;
        lastModified: Date;
        publishedDate?: string;
        originalMetadata?: any;
        links?: string[];
        images?: ImageInfo[];
        preserveStructure?: boolean;
        [key: string]: any;
    };
    visitCount: number;
    lastVisited: Date;
    enhancedContent?: EnhancedContent;
}

export async function processHtmlContent(
    html: string,
    sourceIdentifier: string, // URL or file path
    options: ProcessingOptions = {},
    fileMetadata?: FileMetadata,
): Promise<WebsiteData> {
    const extractorOptions: any = {};
    if (options.contentTimeout !== undefined)
        extractorOptions.timeout = options.contentTimeout;
    if (options.userAgent !== undefined)
        extractorOptions.userAgent = options.userAgent;
    if (options.maxContentLength !== undefined)
        extractorOptions.maxContentLength = options.maxContentLength;
    if (options.enableActionDetection !== undefined)
        extractorOptions.enableActionDetection = options.enableActionDetection;
    if (options.enableIntelligentAnalysis !== undefined)
        extractorOptions.enableKnowledgeExtraction =
            options.enableIntelligentAnalysis;
    if (options.knowledgeMode !== undefined)
        extractorOptions.knowledgeMode = options.knowledgeMode;
    if (options.maxCharsPerChunk !== undefined)
        extractorOptions.maxCharsPerChunk = options.maxCharsPerChunk;

    const extractor = new ContentExtractor(extractorOptions);

    const enhancedContent = (await extractor.extractFromHtml(
        html,
        options.extractionMode || "content",
    )) as EnhancedContent;

    const parsedContent = await parseHtmlStructure(html);

    const publishedDate = await extractPublishedDate(html);

    const url = fileMetadata?.fileUrl || sourceIdentifier;
    const domain = extractDomainFromUrl(url);

    const websiteData: WebsiteData = {
        url,
        title:
            enhancedContent.pageContent?.title ||
            parsedContent.title ||
            fileMetadata?.filename ||
            "Untitled",
        content:
            enhancedContent.pageContent?.mainContent ||
            parsedContent.content ||
            "",
        domain,
        metadata: {
            websiteSource: fileMetadata ? "file_import" : "bookmark_import",
            url,
            title:
                enhancedContent.pageContent?.title ||
                parsedContent.title ||
                fileMetadata?.filename ||
                "Untitled",
            domain,
            pageType: determinePageType(enhancedContent, parsedContent),
            importDate: new Date().toISOString(),
            lastModified: fileMetadata?.lastModified || new Date(),
            originalMetadata: enhancedContent.metaTags,
            links:
                enhancedContent.pageContent?.links?.map((l) => l.href) ||
                parsedContent.links,
            images: enhancedContent.pageContent?.images || [],
            preserveStructure: true,
        },
        visitCount: 1,
        lastVisited: publishedDate || fileMetadata?.lastModified || new Date(),
        enhancedContent,
    };

    if (fileMetadata) {
        websiteData.metadata.filename = fileMetadata.filename;
        websiteData.metadata.fileSize = fileMetadata.fileSize;
        websiteData.metadata.filePath = fileMetadata.filePath;
    }

    if (publishedDate) {
        websiteData.metadata.publishedDate = publishedDate.toISOString();
        websiteData.lastVisited = publishedDate;
    }

    return websiteData;
}

export async function parseHtmlStructure(
    html: string,
): Promise<ParsedHtmlContent> {
    const $ = cheerio.load(html);

    const title = extractTitle($);
    const content = extractTextContent($);
    const links = extractLinks($);
    const images = extractImages($);
    const metadata = extractBasicMetadata($);
    const publishedDate = extractPublishedDateFromMeta($);

    const wordCount = calculateWordCount(content);
    const readingTime = calculateReadingTime(wordCount);

    const result: ParsedHtmlContent = {
        title: title || "Untitled",
        content,
        links,
        images,
        metadata,
        wordCount,
        readingTime,
    };

    if (publishedDate) {
        result.publishedDate = publishedDate;
    }

    return result;
}

export function extractTextContent($: cheerio.CheerioAPI): string {
    // Remove unwanted elements
    $(
        "script, style, nav, header, footer, aside, .nav, .navigation, .sidebar",
    ).remove();
    $('[class*="ad"], [id*="ad"], .advertisement, .ads').remove();
    $(".social-share, .share-buttons, .comments, .cookie-banner").remove();

    // Try semantic content selectors first
    const contentSelectors = [
        'main [role="main"]',
        "article",
        '[role="main"]',
        "main",
        ".content",
        ".main-content",
        ".post-content",
        ".entry-content",
        "#content",
        "#main-content",
    ];

    for (const selector of contentSelectors) {
        const content = $(selector);
        if (content.length > 0) {
            return cleanText(content.text());
        }
    }

    // Fallback: get body content with noise removal
    const bodyContent = $("body").clone();
    bodyContent.find("script, style, nav, header, footer, aside").remove();

    return cleanText(bodyContent.text());
}

/**
 * Extract title from HTML using multiple sources
 */
export function extractTitle($: cheerio.CheerioAPI): string {
    // Try different title sources in order of preference
    let title = $("title").first().text().trim();

    if (!title) {
        title = $('meta[property="og:title"]').attr("content") || "";
    }

    if (!title) {
        title = $("h1").first().text().trim();
    }

    return title || "Untitled";
}

/**
 * Extract basic metadata from HTML meta tags
 */
export function extractBasicMetadata(
    $: cheerio.CheerioAPI,
): Record<string, any> {
    const metadata: Record<string, any> = {};

    // Standard meta tags
    const description = $('meta[name="description"]').attr("content");
    if (description) metadata.description = description;

    const author = $('meta[name="author"]').attr("content");
    if (author) metadata.author = author;

    const keywords = $('meta[name="keywords"]').attr("content");
    if (keywords)
        metadata.keywords = keywords.split(",").map((k: string) => k.trim());

    // Open Graph tags
    const ogTitle = $('meta[property="og:title"]').attr("content");
    if (ogTitle) metadata.ogTitle = ogTitle;

    const ogDescription = $('meta[property="og:description"]').attr("content");
    if (ogDescription) metadata.ogDescription = ogDescription;

    const ogType = $('meta[property="og:type"]').attr("content");
    if (ogType) metadata.ogType = ogType;

    // Additional useful meta tags
    $("meta[name], meta[property]").each((_: number, element: any) => {
        const $meta = $(element);
        const name = $meta.attr("name") || $meta.attr("property");
        const content = $meta.attr("content");

        if (name && content && !metadata[name]) {
            metadata[name] = content;
        }
    });

    return metadata;
}

/**
 * Extract links from HTML
 */
export function extractLinks($: cheerio.CheerioAPI): string[] {
    const links: string[] = [];

    $("a[href]").each((_: number, element: any) => {
        const href = $(element).attr("href");
        if (
            href &&
            href.length > 0 &&
            !href.startsWith("#") &&
            !href.startsWith("javascript:") &&
            !href.startsWith("data:") &&
            !href.startsWith("vbscript:")
        ) {
            links.push(href);
        }
    });

    return [...new Set(links)]; // Remove duplicates
}

/**
 * Extract image sources from HTML
 */
export function extractImages($: cheerio.CheerioAPI): string[] {
    const images: string[] = [];

    $("img[src]").each((_: number, element: any) => {
        const src = $(element).attr("src");
        if (src && !src.startsWith("data:") && src.length > 5) {
            images.push(src);
        }
    });

    return [...new Set(images)]; // Remove duplicates
}

/**
 * Published date extraction with comprehensive meta tag support
 */
export async function extractPublishedDate(html: string): Promise<Date | null> {
    const $ = cheerio.load(html);
    return extractPublishedDateFromMeta($);
}

/**
 * Extract published date from meta tags using priority order
 */
export function extractPublishedDateFromMeta(
    $: cheerio.CheerioAPI,
): Date | null {
    const publishedDateSelectors = [
        // Primary sources
        'meta[name="published-date"]', // Custom published date
        'meta[property="article:published_time"]', // Open Graph Article
        'meta[name="date"]', // Generic date

        // Secondary sources
        'meta[name="DC.Date"]', // Dublin Core
        'meta[name="article:published_date"]', // Article metadata
        'meta[property="article:published"]', // Article variant

        // Fallback sources
        "time[pubdate]", // HTML5 pubdate
        "time[datetime]", // HTML5 datetime
        'meta[name="Last-Modified"]', // HTTP header equivalent
        'meta[name="created"]', // Created date
        'meta[property="article:modified_time"]', // Article modified time
    ];

    for (const selector of publishedDateSelectors) {
        const element = $(selector);
        if (element.length > 0) {
            const dateValue =
                element.attr("content") ||
                element.attr("datetime") ||
                element.text();

            if (dateValue) {
                const date = parsePublishedDateString(dateValue);
                if (date && !isNaN(date.getTime())) {
                    return date;
                }
            }
        }
    }

    return null;
}

/**
 * Parse published date string handling multiple formats
 */
export function parsePublishedDateString(dateString: string): Date | null {
    if (!dateString || typeof dateString !== "string") {
        return null;
    }

    // Clean up the date string
    const cleanDateString = dateString.trim();

    // Try standard JavaScript Date parsing first
    const date = new Date(cleanDateString);
    if (!isNaN(date.getTime())) {
        // Validate that the date is reasonable (not too far in future/past)
        const now = new Date();
        const hundredYearsAgo = new Date(now.getFullYear() - 100, 0, 1);
        const oneYearFromNow = new Date(now.getFullYear() + 1, 11, 31);

        if (date >= hundredYearsAgo && date <= oneYearFromNow) {
            return date;
        }
    }

    // Handle specific formats that JavaScript Date might not parse
    const formatPatterns = [
        // ISO formats (YYYY-MM-DD variants)
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
        // US formats (MM/DD/YYYY)
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        // European formats (DD.MM.YYYY)
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
        // Simple year only
        /^(\d{4})$/,
    ];

    for (const pattern of formatPatterns) {
        const match = cleanDateString.match(pattern);
        if (match) {
            let year: number, month: number, day: number;

            if (pattern === formatPatterns[0]) {
                // YYYY-MM-DD
                year = parseInt(match[1]);
                month = parseInt(match[2]) - 1; // JavaScript months are 0-based
                day = parseInt(match[3]);
            } else if (pattern === formatPatterns[1]) {
                // MM/DD/YYYY
                month = parseInt(match[1]) - 1;
                day = parseInt(match[2]);
                year = parseInt(match[3]);
            } else if (pattern === formatPatterns[2]) {
                // DD.MM.YYYY
                day = parseInt(match[1]);
                month = parseInt(match[2]) - 1;
                year = parseInt(match[3]);
            } else if (pattern === formatPatterns[3]) {
                // YYYY only
                year = parseInt(match[1]);
                month = 0;
                day = 1;
            } else {
                continue;
            }

            const parsedDate = new Date(year, month, day);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate;
            }
        }
    }

    return null;
}

/**
 * Clean text content by normalizing whitespace
 */
export function cleanText(text: string): string {
    return text
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim();
}

export function calculateWordCount(text: string): number {
    return text
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0).length;
}

export function calculateReadingTime(wordCount: number): number {
    // Average reading speed: 200-250 words per minute
    return Math.ceil(wordCount / 225);
}

export function extractDomainFromUrl(url: string): string {
    if (url.startsWith("file://") || !url.includes("://")) {
        return "local_files";
    }

    try {
        const urlObj = new URL(url);
        return urlObj.hostname || "unknown";
    } catch {
        return "local_files";
    }
}

export function determinePageType(
    enhancedContent: Partial<EnhancedContent>,
    parsedContent: ParsedHtmlContent,
): string {
    // Check for common page type indicators
    const title =
        enhancedContent.pageContent?.title || parsedContent.title || "";
    const content =
        enhancedContent.pageContent?.mainContent || parsedContent.content || "";
    const metaTags = enhancedContent.metaTags;

    // Check Open Graph type first
    if (metaTags?.ogType) {
        return metaTags.ogType;
    }

    // Analyze content patterns
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // News/article patterns
    if (
        titleLower.includes("news") ||
        titleLower.includes("article") ||
        contentLower.includes("published") ||
        contentLower.includes("author")
    ) {
        return "article";
    }

    // Blog patterns
    if (
        titleLower.includes("blog") ||
        contentLower.includes("posted by") ||
        contentLower.includes("written by")
    ) {
        return "blog";
    }

    // Documentation patterns
    if (
        titleLower.includes("documentation") ||
        titleLower.includes("docs") ||
        titleLower.includes("api") ||
        titleLower.includes("reference")
    ) {
        return "documentation";
    }

    // Product/commerce patterns
    if (
        titleLower.includes("product") ||
        titleLower.includes("buy") ||
        titleLower.includes("price") ||
        contentLower.includes("add to cart")
    ) {
        return "product";
    }

    // Default to general document
    return "document";
}

/**
 * Create file URL from file path
 */
export function createFileUrl(filePath: string): string {
    // Convert file path to file:// URL
    if (filePath.startsWith("file://")) {
        return filePath;
    }

    // Handle Windows paths
    if (filePath.includes("\\")) {
        // Convert backslashes to forward slashes
        const normalized = filePath.replace(/\\/g, "/");
        return `file:///${normalized}`;
    }

    // Handle Unix paths
    if (filePath.startsWith("/")) {
        return `file://${filePath}`;
    }

    // Relative path - make it absolute
    return `file:///${filePath}`;
}

/**
 * Enhanced metadata extraction using ContentExtractor's MetaTagCollection
 */
export async function extractMetadata(
    html: string,
): Promise<MetaTagCollection> {
    const $ = cheerio.load(html);

    const metaTags: MetaTagCollection = { custom: {} };

    // Standard meta tags
    const description = $('meta[name="description"]').attr("content");
    if (description) metaTags.description = description;

    const author = $('meta[name="author"]').attr("content");
    if (author) metaTags.author = author;

    // Keywords
    const keywordsContent = $('meta[name="keywords"]').attr("content");
    if (keywordsContent) {
        metaTags.keywords = keywordsContent
            .split(",")
            .map((k: string) => k.trim())
            .filter((k: string) => k.length > 0);
    }

    // Open Graph tags
    const ogTitle = $('meta[property="og:title"]').attr("content");
    if (ogTitle) metaTags.ogTitle = ogTitle;

    const ogDescription = $('meta[property="og:description"]').attr("content");
    if (ogDescription) metaTags.ogDescription = ogDescription;

    const ogType = $('meta[property="og:type"]').attr("content");
    if (ogType) metaTags.ogType = ogType;

    // Twitter Card tags
    const twitterCard = $('meta[name="twitter:card"]').attr("content");
    if (twitterCard) metaTags.twitterCard = twitterCard;

    // Custom meta tags
    $("meta[name], meta[property]").each((_: number, element: any) => {
        const $meta = $(element);
        const name = $meta.attr("name") || $meta.attr("property");
        const content = $meta.attr("content");

        if (
            name &&
            content &&
            !["description", "author", "keywords"].includes(name) &&
            !name.startsWith("og:") &&
            !name.startsWith("twitter:")
        ) {
            metaTags.custom[name] = content;
        }
    });

    return metaTags;
}

/**
 * Create website data from enhanced content (for bookmark import compatibility)
 */
export function createWebsiteDataFromContent(
    enhancedContent: EnhancedContent,
    url: string,
    sourceType: "bookmark" | "history" | "file" = "bookmark",
): WebsiteData {
    const domain = extractDomainFromUrl(url);
    const title = enhancedContent.pageContent?.title || "Untitled";
    const content = enhancedContent.pageContent?.mainContent || "";

    return {
        url,
        title,
        content,
        domain,
        metadata: {
            websiteSource:
                sourceType === "file" ? "file_import" : `${sourceType}_import`,
            url,
            title,
            domain,
            pageType: enhancedContent.metaTags?.ogType || "document",
            importDate: new Date().toISOString(),
            lastModified: new Date(),
            originalMetadata: enhancedContent.metaTags,
            links: enhancedContent.pageContent?.links?.map((l) => l.href) || [],
            images: enhancedContent.pageContent?.images || [],
            preserveStructure: true,
        },
        visitCount: 1,
        lastVisited: new Date(),
        enhancedContent,
    };
}

/**
 * Batch process HTML files with progress tracking
 */
export async function processHtmlBatch(
    htmlFiles: Array<{
        html: string;
        identifier: string;
        metadata?: FileMetadata;
    }>,
    options: ProcessingOptions = {},
    progressCallback?: (current: number, total: number, item: string) => void,
): Promise<WebsiteData[]> {
    const results: WebsiteData[] = [];
    const total = htmlFiles.length;

    for (let i = 0; i < htmlFiles.length; i++) {
        const file = htmlFiles[i];

        try {
            if (progressCallback && i % 5 === 0) {
                progressCallback(i + 1, total, file.identifier);
            }

            const websiteData = await processHtmlContent(
                file.html,
                file.identifier,
                options,
                file.metadata,
            );

            results.push(websiteData);
        } catch (error) {
            console.error(`Failed to process ${file.identifier}:`, error);
            // Continue with other files
        }
    }

    if (progressCallback) {
        progressCallback(total, total, "Completed");
    }

    return results;
}
