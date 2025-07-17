// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrossContextHtmlReducer } from "../../common/crossContextHtmlReducer.js";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import {
    ProcessedHtmlResult,
    ProcessingOptions,
    ProcessingMetadata,
} from "../offscreen/types.js";

/**
 * Legacy interface for backward compatibility
 */
export interface LegacyProcessedHtmlResult {
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

/**
 * Legacy interface for backward compatibility
 */
export interface LegacyHtmlProcessingOptions {
    filterToReadingView?: boolean;
    keepMetaTags?: boolean;
    extractText?: boolean;
    useTimestampIds?: boolean;
    preserveStructure?: boolean;
    maxElements?: number;
}

/**
 * Unified HTML processor that replaces SharedHtmlProcessor
 * Uses CrossContextHtmlReducer for consistent processing
 */
export class UnifiedHtmlProcessor {
    /**
     * Process HTML content with specified options (legacy interface)
     */
    static async processHtmlContent(
        html: string,
        options: LegacyHtmlProcessingOptions = {},
    ): Promise<LegacyProcessedHtmlResult> {
        const startTime = Date.now();
        const originalSize = html.length;
        let processedHtml = html;
        let elementsRemoved = 0;

        try {
            // Apply Readability filter if requested
            if (options.filterToReadingView) {
                processedHtml = await this.applyReadabilityFilter(
                    processedHtml,
                    options.keepMetaTags,
                );
            }

            // Apply HTML reduction if not preserving structure
            if (!options.preserveStructure) {
                const reducer = new CrossContextHtmlReducer();
                reducer.removeDivs = false;

                if (options.filterToReadingView && options.keepMetaTags) {
                    reducer.removeMetaTags = false;
                }

                processedHtml = reducer.reduce(processedHtml);
            }

            // Extract text if requested
            let text = "";
            if (options.extractText) {
                text = this.extractText(processedHtml);
            }

            const processedSize = processedHtml.length;
            const reductionRatio =
                originalSize > 0
                    ? (originalSize - processedSize) / originalSize
                    : 0;
            const processingTime = Date.now() - startTime;

            return {
                html: processedHtml,
                text,
                metadata: {
                    originalSize,
                    processedSize,
                    reductionRatio,
                    elementsRemoved,
                    processingMethod: options.filterToReadingView
                        ? "readability+reduction"
                        : "reduction",
                    processingTime,
                },
            };
        } catch (error) {
            console.error("Error processing HTML:", error);
            const processingTime = Date.now() - startTime;

            return {
                html,
                text: options.extractText ? this.extractText(html) : "",
                metadata: {
                    originalSize,
                    processedSize: originalSize,
                    reductionRatio: 0,
                    elementsRemoved: 0,
                    processingMethod: "error",
                    processingTime,
                },
            };
        }
    }

    /**
     * Apply readability filter to HTML content
     */
    private static async applyReadabilityFilter(
        html: string,
        keepMetaTags?: boolean,
    ): Promise<string> {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            if (!isProbablyReaderable(doc)) {
                console.warn(
                    "Document may not be suitable for readability extraction",
                );
            }

            const reader = new Readability(doc, {
                keepClasses: false,
                disableJSONLD: true,
            });

            const article = reader.parse();
            if (!article || !article.content) {
                console.warn(
                    "Readability failed to parse content, returning original",
                );
                return html;
            }

            if (keepMetaTags) {
                // Extract meta tags from original HTML
                const originalDoc = parser.parseFromString(html, "text/html");
                const metaTags = originalDoc.querySelectorAll("meta");

                // Parse the article content
                const articleDoc = parser.parseFromString(
                    article.content,
                    "text/html",
                );
                const head =
                    articleDoc.querySelector("head") ||
                    articleDoc.createElement("head");

                // Add meta tags to the article
                metaTags.forEach((meta) => {
                    if (meta instanceof HTMLMetaElement) {
                        head.appendChild(meta.cloneNode(true));
                    }
                });

                if (!articleDoc.querySelector("head")) {
                    articleDoc.documentElement.insertBefore(
                        head,
                        articleDoc.body,
                    );
                }

                return articleDoc.documentElement.outerHTML;
            }

            return article.content;
        } catch (error) {
            console.error("Error applying readability filter:", error);
            return html;
        }
    }

    /**
     * Extract text content from HTML
     */
    private static extractText(html: string): string {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            return doc.body?.textContent || doc.textContent || "";
        } catch (error) {
            console.error("Error extracting text:", error);
            return "";
        }
    }
}

/**
 * Simple HTML processing monitor for basic metrics
 */
export class HtmlProcessingMonitor {
    private static metrics: Array<{
        method: string;
        originalSize: number;
        processedSize: number;
        processingTime: number;
        context: string;
        timestamp: number;
    }> = [];

    static recordMetric(
        method: string,
        originalSize: number,
        processedSize: number,
        processingTime: number,
        context: string,
    ): void {
        this.metrics.push({
            method,
            originalSize,
            processedSize,
            processingTime,
            context,
            timestamp: Date.now(),
        });

        // Keep only last 100 metrics to avoid memory issues
        if (this.metrics.length > 100) {
            this.metrics = this.metrics.slice(-100);
        }
    }

    static getMetrics(): typeof this.metrics {
        return [...this.metrics];
    }

    static clearMetrics(): void {
        this.metrics = [];
    }
}
