// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared HTML processing utilities for consistent processing across
 * different contexts (offscreen documents, content scripts, service workers)
 */

export interface ProcessedHtmlResult {
    html: string;
    text: string;
    metadata: {
        originalSize: number;
        processedSize: number;
        reductionRatio: number;
        elementsRemoved: number;
        processingMethod: string;
        processingTime: number;
    };
}

export interface HtmlProcessingOptions {
    filterToReadingView?: boolean;
    keepMetaTags?: boolean;
    extractText?: boolean;
    useTimestampIds?: boolean;
    preserveStructure?: boolean;
    maxElements?: number;
}

/**
 * Shared HTML processor that works in different browser contexts
 */
export class SharedHtmlProcessor {
    /**
     * Process HTML content with specified options
     */
    static async processHtmlContent(
        html: string,
        options: HtmlProcessingOptions = {},
    ): Promise<ProcessedHtmlResult> {
        const startTime = Date.now();
        const originalSize = html.length;
        let elementsRemoved = 0;

        try {
            // Parse HTML - works in both DOM and DOMParser contexts
            let doc: Document;
            if (typeof DOMParser !== "undefined") {
                // Browser context (offscreen, content script)
                const parser = new DOMParser();
                doc = parser.parseFromString(html, "text/html");
            } else if (typeof document !== "undefined") {
                // DOM context (content script)
                doc = document.implementation.createHTMLDocument();
                doc.documentElement.innerHTML = html;
            } else {
                // Fallback to basic string processing
                return this.basicStringProcessing(
                    html,
                    options,
                    startTime,
                    originalSize,
                );
            }

            // Apply readability filter if requested
            if (options.filterToReadingView) {
                elementsRemoved += this.applyReadabilityFilter(
                    doc,
                    options.keepMetaTags || false,
                );
            }

            // Limit elements if specified
            if (options.maxElements) {
                elementsRemoved += this.limitElements(doc, options.maxElements);
            }

            // Add timestamp IDs if requested
            if (options.useTimestampIds) {
                this.addTimestampIds(doc);
            }

            // Extract results
            const processedHtml = doc.documentElement.outerHTML;
            let textContent = "";

            if (options.extractText) {
                textContent = this.extractTextContent(doc);
            }

            const processedSize = processedHtml.length;
            const processingTime = Date.now() - startTime;

            return {
                html: processedHtml,
                text: textContent,
                metadata: {
                    originalSize,
                    processedSize,
                    reductionRatio:
                        (originalSize - processedSize) / originalSize,
                    elementsRemoved,
                    processingMethod: "dom",
                    processingTime,
                },
            };
        } catch (error) {
            console.warn(
                "DOM processing failed, falling back to string processing:",
                error,
            );
            return this.basicStringProcessing(
                html,
                options,
                startTime,
                originalSize,
            );
        }
    }

    /**
     * Apply readability filter to extract main content
     */
    private static applyReadabilityFilter(
        doc: Document,
        keepMetaTags: boolean,
    ): number {
        let elementsRemoved = 0;

        // Remove unnecessary elements
        const selectorsToRemove = [
            "script",
            "style",
            "noscript",
            "iframe",
            "nav",
            "header",
            "footer",
            "aside",
            ".advertisement",
            ".ads",
            ".sidebar",
            '[class*="cookie"]',
            '[class*="popup"]',
            '[class*="banner"]',
            '[class*="modal"]',
            '[class*="advertisement"]',
            '[class*="sponsor"]',
            '[role="banner"]',
            '[role="navigation"]',
            '[role="complementary"]',
            '[role="contentinfo"]',
            // Social media widgets
            ".social-share",
            ".social-buttons",
            ".fb-like",
            ".twitter-tweet",
            ".instagram-embed",
            // Comment sections
            ".comments",
            ".comment-section",
            "#disqus_thread",
            // Navigation and menus
            ".menu",
            ".nav",
            ".navigation",
            ".breadcrumb",
            // Ads and promotional content
            ".promo",
            ".promotion",
            ".sponsored",
            ".affiliate",
        ];

        selectorsToRemove.forEach((selector) => {
            try {
                const elements = doc.querySelectorAll(selector);
                elements.forEach((el) => {
                    el.remove();
                    elementsRemoved++;
                });
            } catch (error) {
                // Ignore invalid selectors
                console.warn(`Invalid selector: ${selector}`);
            }
        });

        // Remove meta tags if not requested
        if (!keepMetaTags) {
            doc.querySelectorAll("meta").forEach((el) => {
                el.remove();
                elementsRemoved++;
            });
        }

        // Remove empty elements
        const emptyElements = doc.querySelectorAll(
            "div:empty, span:empty, p:empty, section:empty",
        );
        emptyElements.forEach((el) => {
            el.remove();
            elementsRemoved++;
        });

        // Remove elements with very little text content
        const thinElements = doc.querySelectorAll("div, span, section");
        thinElements.forEach((el) => {
            const text = el.textContent?.trim() || "";
            if (
                text.length < 10 &&
                !el.querySelector("img, video, audio, canvas")
            ) {
                el.remove();
                elementsRemoved++;
            }
        });

        return elementsRemoved;
    }

    /**
     * Limit number of elements in document
     */
    private static limitElements(doc: Document, maxElements: number): number {
        const allElements = Array.from(doc.querySelectorAll("*"));

        if (allElements.length <= maxElements) {
            return 0;
        }

        // Keep most important elements
        const importantSelectors = [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "p",
            "article",
            "main",
            "section",
            "ul",
            "ol",
            "li",
            "table",
            "thead",
            "tbody",
            "tr",
            "td",
            "th",
            "blockquote",
            "pre",
            "code",
            "img",
            "figure",
            "figcaption",
        ];

        const importantElements = new Set();
        importantSelectors.forEach((selector) => {
            doc.querySelectorAll(selector).forEach((el) =>
                importantElements.add(el),
            );
        });

        // Remove excess elements, starting with least important
        let elementsToRemove = allElements.length - maxElements;
        let removed = 0;

        for (const element of allElements.reverse()) {
            if (elementsToRemove <= 0) break;

            if (!importantElements.has(element) && element.parentNode) {
                element.remove();
                elementsToRemove--;
                removed++;
            }
        }

        return removed;
    }

    /**
     * Add timestamp IDs to elements for tracking
     */
    private static addTimestampIds(doc: Document): void {
        const timestamp = Date.now();
        const elements = doc.querySelectorAll(
            "h1, h2, h3, h4, h5, h6, p, div, section, article",
        );

        elements.forEach((el, index) => {
            if (!el.id) {
                el.id = `ts_${timestamp}_${index}`;
            }
        });
    }

    /**
     * Extract text content from document
     */
    private static extractTextContent(doc: Document): string {
        // Try to get main content first
        const mainSelectors = [
            "main",
            "article",
            '[role="main"]',
            ".content",
            "#content",
        ];

        for (const selector of mainSelectors) {
            const mainEl = doc.querySelector(selector);
            if (mainEl) {
                return this.cleanTextContent(mainEl.textContent || "");
            }
        }

        // Fallback to body content
        const bodyText =
            doc.body?.textContent || doc.documentElement.textContent || "";
        return this.cleanTextContent(bodyText);
    }

    /**
     * Clean and normalize text content
     */
    private static cleanTextContent(text: string): string {
        return text
            .replace(/\s+/g, " ") // Normalize whitespace
            .replace(/\n\s*\n/g, "\n") // Remove empty lines
            .trim();
    }

    /**
     * Fallback string-based processing when DOM is not available
     */
    private static basicStringProcessing(
        html: string,
        options: HtmlProcessingOptions,
        startTime: number,
        originalSize: number,
    ): ProcessedHtmlResult {
        let processedHtml = html;
        let textContent = "";

        if (options.filterToReadingView) {
            processedHtml = this.basicReadabilityFilter(html);
        }

        if (options.extractText) {
            textContent = this.basicTextExtraction(processedHtml);
        }

        const processedSize = processedHtml.length;
        const processingTime = Date.now() - startTime;

        return {
            html: processedHtml,
            text: textContent,
            metadata: {
                originalSize,
                processedSize,
                reductionRatio: (originalSize - processedSize) / originalSize,
                elementsRemoved: 0, // Can't count with string processing
                processingMethod: "string",
                processingTime,
            },
        };
    }

    /**
     * Basic readability filter using regex patterns
     */
    private static basicReadabilityFilter(html: string): string {
        return (
            html
                // Remove scripts and styles
                .replace(
                    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                    "",
                )
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
                .replace(
                    /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi,
                    "",
                )

                // Remove navigation elements
                .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
                .replace(
                    /<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi,
                    "",
                )
                .replace(
                    /<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi,
                    "",
                )
                .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")

                // Remove common ad/widget patterns
                .replace(
                    /<div[^>]*class="[^"]*(?:ad|advertisement|sidebar|popup|modal|banner|cookie)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
                    "",
                )
                .replace(
                    /<div[^>]*id="[^"]*(?:ad|advertisement|sidebar|popup|modal|banner|cookie)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
                    "",
                )

                // Remove comments
                .replace(/<!--[\s\S]*?-->/g, "")

                // Clean up excessive whitespace
                .replace(/\n\s*\n\s*\n/g, "\n\n")
                .replace(/\s{3,}/g, " ")
        );
    }

    /**
     * Basic text extraction using regex
     */
    private static basicTextExtraction(html: string): string {
        return html
            .replace(/<[^>]*>/g, " ") // Remove all HTML tags
            .replace(/&[^;]+;/g, " ") // Remove HTML entities
            .replace(/\s+/g, " ") // Normalize whitespace
            .trim();
    }

    /**
     * Validate and normalize HTML processing options
     */
    static normalizeOptions(
        options: Partial<HtmlProcessingOptions> = {},
    ): HtmlProcessingOptions {
        return {
            filterToReadingView: options.filterToReadingView ?? false,
            keepMetaTags: options.keepMetaTags ?? false,
            extractText: options.extractText ?? false,
            useTimestampIds: options.useTimestampIds ?? false,
            preserveStructure: options.preserveStructure ?? true,
            maxElements: options.maxElements ?? undefined,
        };
    }

    /**
     * Get processing capabilities for the current context
     */
    static getCapabilities(): {
        domProcessing: boolean;
        textExtraction: boolean;
        readabilityFilter: boolean;
        timestampIds: boolean;
    } {
        return {
            domProcessing:
                typeof DOMParser !== "undefined" ||
                typeof document !== "undefined",
            textExtraction: true,
            readabilityFilter: true,
            timestampIds: typeof document !== "undefined",
        };
    }
}

/**
 * HTML Fragment utilities for consistent format across different sources
 */
export class HtmlFragmentUtils {
    /**
     * Normalize HTML fragments to consistent format
     */
    static normalizeHtmlFragments(
        source: "browser" | "file" | "url",
        processedContent: any,
        url?: string,
    ): Array<{
        frameId: number;
        content: string;
        text: string;
        metadata?: {
            source: string;
            processingMethod: string;
            url?: string;
            title?: string;
            timestamp: number;
            processingInfo?: {
                readabilityApplied: boolean;
                htmlReduced: boolean;
                textExtracted: boolean;
            };
        };
    }> {
        // Ensure consistent format regardless of source
        return [
            {
                frameId: 0, // Default for non-browser sources
                content:
                    processedContent.html ||
                    processedContent.processedHtml ||
                    processedContent.content ||
                    "",
                text:
                    processedContent.text || processedContent.textContent || "",
                metadata: {
                    source,
                    processingMethod:
                        processedContent.metadata?.processingMethod ||
                        "enhanced",
                    url:
                        url ||
                        processedContent.metadata?.url ||
                        processedContent.metadata?.filePath,
                    title: processedContent.metadata?.title,
                    timestamp: Date.now(),
                    processingInfo: {
                        readabilityApplied:
                            processedContent.metadata?.readabilityApplied ??
                            true,
                        htmlReduced:
                            processedContent.metadata?.htmlReduced ?? true,
                        textExtracted: !!(
                            processedContent.text ||
                            processedContent.textContent
                        ),
                    },
                },
            },
        ];
    }

    /**
     * Validate HTML fragment structure
     */
    static validateHtmlFragment(fragment: any): boolean {
        return !!(
            fragment &&
            typeof fragment === "object" &&
            fragment.content &&
            typeof fragment.content === "string" &&
            fragment.content.length > 0
        );
    }

    /**
     * Merge multiple HTML fragments into a single fragment
     */
    static mergeFragments(fragments: any[]): any {
        if (!fragments || fragments.length === 0) {
            return null;
        }

        if (fragments.length === 1) {
            return fragments[0];
        }

        const mergedContent = fragments.map((f) => f.content || "").join("\n");
        const mergedText = fragments.map((f) => f.text || "").join("\n");

        return {
            frameId: 0,
            content: mergedContent,
            text: mergedText,
            metadata: {
                source: "merged",
                processingMethod: "combined",
                timestamp: Date.now(),
                fragmentCount: fragments.length,
            },
        };
    }

    /**
     * Extract metadata from HTML fragment
     */
    static extractMetadata(fragment: any): {
        contentLength: number;
        textLength: number;
        hasImages: boolean;
        hasLinks: boolean;
        hasTables: boolean;
        estimatedReadingTime: number;
    } {
        const content = fragment.content || "";
        const text = fragment.text || "";

        return {
            contentLength: content.length,
            textLength: text.length,
            hasImages: /<img\b[^>]*>/i.test(content),
            hasLinks: /<a\b[^>]*href/i.test(content),
            hasTables: /<table\b[^>]*>/i.test(content),
            estimatedReadingTime: Math.max(
                1,
                Math.ceil(text.split(/\s+/).length / 200),
            ), // ~200 words per minute
        };
    }
}

/**
 * Performance monitoring for HTML processing
 */
export class HtmlProcessingMonitor {
    private static metrics: Array<{
        timestamp: number;
        processingMethod: string;
        originalSize: number;
        processedSize: number;
        processingTime: number;
        reductionRatio: number;
        source: string;
    }> = [];

    /**
     * Record processing metrics
     */
    static recordMetric(
        processingMethod: string,
        originalSize: number,
        processedSize: number,
        processingTime: number,
        source: string = "unknown",
    ): void {
        this.metrics.push({
            timestamp: Date.now(),
            processingMethod,
            originalSize,
            processedSize,
            processingTime,
            reductionRatio: (originalSize - processedSize) / originalSize,
            source,
        });

        // Keep only last 100 metrics
        if (this.metrics.length > 100) {
            this.metrics = this.metrics.slice(-100);
        }
    }

    /**
     * Get processing statistics
     */
    static getStatistics(timeWindow: number = 3600000): {
        totalProcessed: number;
        averageProcessingTime: number;
        averageReductionRatio: number;
        processingMethods: Record<string, number>;
        sources: Record<string, number>;
    } {
        const cutoff = Date.now() - timeWindow;
        const recentMetrics = this.metrics.filter((m) => m.timestamp > cutoff);

        if (recentMetrics.length === 0) {
            return {
                totalProcessed: 0,
                averageProcessingTime: 0,
                averageReductionRatio: 0,
                processingMethods: {},
                sources: {},
            };
        }

        const totalProcessingTime = recentMetrics.reduce(
            (sum, m) => sum + m.processingTime,
            0,
        );
        const totalReductionRatio = recentMetrics.reduce(
            (sum, m) => sum + m.reductionRatio,
            0,
        );

        const processingMethods: Record<string, number> = {};
        const sources: Record<string, number> = {};

        recentMetrics.forEach((m) => {
            processingMethods[m.processingMethod] =
                (processingMethods[m.processingMethod] || 0) + 1;
            sources[m.source] = (sources[m.source] || 0) + 1;
        });

        return {
            totalProcessed: recentMetrics.length,
            averageProcessingTime: totalProcessingTime / recentMetrics.length,
            averageReductionRatio: totalReductionRatio / recentMetrics.length,
            processingMethods,
            sources,
        };
    }

    /**
     * Clear metrics
     */
    static clearMetrics(): void {
        this.metrics = [];
    }
}
