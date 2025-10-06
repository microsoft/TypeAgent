// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    OffscreenMessage,
    MessageResponse,
    DownloadOptions,
    ProcessingOptions,
    ProcessedHtmlResult,
    ContentMetadata,
    ProcessingMetadata,
} from "./types.js";
import {
    UnifiedHtmlProcessor,
    HtmlProcessingMonitor,
    LegacyProcessedHtmlResult,
    LegacyHtmlProcessingOptions,
} from "../shared/unifiedHtmlProcessor.js";

/**
 * Content processor for offscreen document
 * Handles URL downloading and HTML processing with full DOM access
 */
export class OffscreenContentProcessor {
    private readonly maxLoadTime: number = 45000;
    private currentlyProcessing: boolean = false;
    private processedCount: number = 0;
    private readonly logElement: HTMLElement;
    private readonly statusElement: HTMLElement;
    private readonly processingStatusElement: HTMLElement;
    private readonly lastActivityElement: HTMLElement;
    private readonly processedCountElement: HTMLElement;
    private readonly currentUrlElement: HTMLElement;

    constructor() {
        this.logElement = document.getElementById("log")!;
        this.statusElement = document.getElementById("status")!;
        this.processingStatusElement =
            document.getElementById("processingStatus")!;
        this.lastActivityElement = document.getElementById("lastActivity")!;
        this.processedCountElement = document.getElementById("processedCount")!;
        this.currentUrlElement = document.getElementById("currentUrl")!;

        this.setupMessageHandler();
        this.updateUI("ready", "Content processor initialized");
        this.log("info", "OffscreenContentProcessor initialized");
    }

    /**
     * Setup message handling for offscreen document
     */
    private setupMessageHandler(): void {
        chrome.runtime.onMessage.addListener(
            (message: OffscreenMessage, sender, sendResponse) => {
                // Only handle messages targeted to offscreen
                if ((message as any).target !== "offscreen") return false;

                this.log("info", `Received message: ${message.type}`);

                switch (message.type) {
                    case "downloadContent":
                        this.handleDownloadContent(message)
                            .then(sendResponse)
                            .catch((error) => {
                                this.log(
                                    "error",
                                    `Download failed: ${error?.message || "Unknown error"}`,
                                );
                                sendResponse({
                                    success: false,
                                    error: error?.message || "Download failed",
                                    messageId: message.messageId || "",
                                });
                            });
                        return true; // Async response

                    case "processHtmlContent":
                        this.handleProcessHtmlContent(message)
                            .then(sendResponse)
                            .catch((error) => {
                                this.log(
                                    "error",
                                    `Processing failed: ${error?.message || "Unknown error"}`,
                                );
                                sendResponse({
                                    success: false,
                                    error:
                                        error?.message ||
                                        "HTML processing failed",
                                    messageId: message.messageId || "",
                                });
                            });
                        return true; // Async response

                    case "ping":
                        this.log("info", "Ping received");
                        sendResponse({
                            success: true,
                            data: "pong",
                            messageId: message.messageId || "",
                        });
                        break;

                    default:
                        this.log(
                            "warn",
                            `Unknown message type: ${message.type}`,
                        );
                        sendResponse({
                            success: false,
                            error: `Unknown message type: ${message.type}`,
                            messageId: message.messageId || "",
                        });
                        break;
                }

                return false;
            },
        );
    }

    /**
     * Handle URL download and processing
     */
    private async handleDownloadContent(
        message: OffscreenMessage,
    ): Promise<MessageResponse> {
        if (this.currentlyProcessing) {
            throw new Error("Already processing another request");
        }

        this.currentlyProcessing = true;
        this.updateUI("processing", `Downloading: ${message.url}`);
        const startTime = Date.now();

        try {
            const result = await this.processUrl(
                message.url!,
                (message.options as DownloadOptions) || {},
            );

            this.processedCount++;
            this.updateProcessedCount();
            this.updateUI("ready", "Download completed successfully");

            return {
                success: true,
                data: result,
                messageId: message.messageId || "",
                metadata: {
                    processingTime: Date.now() - startTime,
                },
            };
        } finally {
            this.currentlyProcessing = false;
        }
    }

    /**
     * Handle HTML content processing
     */
    private async handleProcessHtmlContent(
        message: OffscreenMessage,
    ): Promise<MessageResponse> {
        if (this.currentlyProcessing) {
            throw new Error("Already processing another request");
        }

        this.currentlyProcessing = true;
        this.updateUI("processing", "Processing HTML content");
        const startTime = Date.now();

        try {
            const result = await this.processHtmlContent(
                message.htmlContent!,
                (message.options as ProcessingOptions) || {},
            );

            this.processedCount++;
            this.updateProcessedCount();
            this.updateUI("ready", "HTML processing completed");

            return {
                success: true,
                data: result,
                messageId: message.messageId || "",
                metadata: {
                    processingTime: Date.now() - startTime,
                },
            };
        } finally {
            this.currentlyProcessing = false;
        }
    }

    /**
     * Process URL by using fetch + DOM parsing (cross-origin compatible)
     */
    async processUrl(url: string, options: DownloadOptions): Promise<any> {
        const loadStartTime = Date.now();
        this.log("info", `Starting URL processing: ${url}`);

        try {
            this.currentUrlElement.textContent = url;

            this.log("info", `Fetching content from ${url}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                options.timeout || this.maxLoadTime,
            );

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const htmlContent = await response.text();
            this.log("info", `Fetched ${htmlContent.length} bytes`);

            this.log("info", "Processing HTML with DOM...");
            const processed = await this.processHtmlContent(
                htmlContent,
                options.processing || {
                    filterToReadingView: true,
                    keepMetaTags: true,
                    extractText: true,
                },
            );

            const result = {
                processedHtml: processed.processedHtml || "",
                textContent: processed.textContent || "",
                metadata: {
                    finalUrl: response.url,
                    title: this.extractTitleFromHtml(htmlContent),
                    loadTime: Date.now() - loadStartTime,
                    processingMethod: "offscreen" as const,
                    contentLength: processed.processedHtml?.length || 0,
                } as ContentMetadata,
            };

            this.log(
                "info",
                `URL processing completed successfully (${result.metadata.contentLength} bytes)`,
            );
            return result;
        } catch (error: any) {
            this.log(
                "error",
                `URL processing failed: ${error?.message || "Unknown error"}`,
            );
            throw new Error(
                `URL processing failed: ${error?.message || "Unknown error"}`,
            );
        }
    }

    /**
     * Extract title from raw HTML
     */
    private extractTitleFromHtml(html: string): string {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : "";
    }

    /**
     * Process HTML content directly
     */
    async processHtmlContent(
        html: string,
        options: ProcessingOptions,
    ): Promise<ProcessedHtmlResult> {
        const processingStartTime = Date.now();
        const originalSize = html.length;
        this.log("info", `Processing HTML content (${originalSize} bytes)`);

        try {
            // Use unified HTML processor for consistent processing
            const result = await UnifiedHtmlProcessor.processHtmlContent(html, {
                filterToReadingView: options.filterToReadingView ?? false,
                keepMetaTags: options.keepMetaTags ?? false,
                extractText: options.extractText ?? false,
                useTimestampIds: options.useTimestampIds ?? false,
                preserveStructure: options.preserveStructure ?? true,
                maxElements: options.maxElements ?? undefined,
            });

            // Record processing metrics
            HtmlProcessingMonitor.recordMetric(
                result.metadata.processingMethod,
                result.metadata.originalSize,
                result.metadata.processedSize,
                result.metadata.processingTime,
                "offscreen",
            );

            const processedHtmlResult: ProcessedHtmlResult = {
                success: true,
                processedHtml: result.html,
                textContent: result.text,
                metadata: {
                    processingMethod: "offscreen",
                    processingTime: Date.now() - processingStartTime,
                    originalSize: result.metadata.originalSize,
                    processedSize: result.metadata.processedSize,
                    reductionRatio: result.metadata.reductionRatio,
                    elementsRemoved: result.metadata.elementsRemoved,
                    timestamp: Date.now(),
                } as ProcessingMetadata,
            };

            this.log(
                "info",
                `HTML processing completed (${Math.round(result.metadata.reductionRatio * 100)}% reduction)`,
            );
            return processedHtmlResult;
        } catch (error: any) {
            this.log(
                "error",
                `HTML processing failed: ${error?.message || "Unknown error"}`,
            );
            return {
                success: false,
                error: `HTML processing failed: ${error?.message || "Unknown error"}`,
            };
        }
    }

    /**
     * Apply readability filter to extract main content
     */
    private async applyReadabilityFilter(
        doc: Document,
        keepMetaTags: boolean,
    ): Promise<Document> {
        // Clone document to avoid modifying original
        const clonedDoc = doc.cloneNode(true) as Document;

        // Remove unnecessary elements
        const selectorsToRemove = [
            "script",
            "style",
            "noscript",
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
            '[role="banner"]',
            '[role="navigation"]',
            '[role="complementary"]',
            '[role="contentinfo"]',
        ];

        let elementsRemoved = 0;
        selectorsToRemove.forEach((selector) => {
            const elements = clonedDoc.querySelectorAll(selector);
            elements.forEach((el) => {
                el.remove();
                elementsRemoved++;
            });
        });

        // Remove meta tags if not requested
        if (!keepMetaTags) {
            clonedDoc.querySelectorAll("meta").forEach((el) => {
                el.remove();
                elementsRemoved++;
            });
        }

        // Remove empty elements
        const emptyElements = clonedDoc.querySelectorAll(
            "div:empty, span:empty, p:empty",
        );
        emptyElements.forEach((el) => {
            el.remove();
            elementsRemoved++;
        });

        this.log(
            "info",
            `Readability filter removed ${elementsRemoved} elements`,
        );
        return clonedDoc;
    }

    /**
     * Limit number of elements in document
     */
    private limitElements(doc: Document, maxElements: number): Document {
        const allElements = Array.from(doc.querySelectorAll("*"));

        if (allElements.length <= maxElements) {
            this.log(
                "info",
                `Element count (${allElements.length}) within limit (${maxElements})`,
            );
            return doc;
        }

        // Keep most important elements (headings, paragraphs, etc.)
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

        this.log(
            "info",
            `Limited elements: removed ${removed}, kept ${maxElements}`,
        );
        return doc;
    }

    /**
     * Update UI status
     */
    private updateUI(
        status: "ready" | "processing" | "error",
        message: string,
    ): void {
        this.statusElement.className = `status ${status}`;
        this.statusElement.textContent = message;
        this.processingStatusElement.textContent =
            status === "processing" ? "Processing" : "Idle";
        this.lastActivityElement.textContent = new Date().toLocaleTimeString();
    }

    /**
     * Update processed count display
     */
    private updateProcessedCount(): void {
        this.processedCountElement.textContent = this.processedCount.toString();
    }

    /**
     * Log message to UI and console
     */
    private log(level: "info" | "warn" | "error", message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement("div");
        logEntry.className = `log-entry ${level}`;
        logEntry.textContent = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

        this.logElement.appendChild(logEntry);
        this.logElement.scrollTop = this.logElement.scrollHeight;

        // Also log to console
        console[level](`[OffscreenContentProcessor] ${message}`);

        // Keep only last 100 log entries
        const entries = this.logElement.children;
        if (entries.length > 100) {
            entries[0].remove();
        }
    }

    /**
     * Utility delay function
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Initialize the content processor when the offscreen document loads
if (typeof window !== "undefined" && window.document) {
    document.addEventListener("DOMContentLoaded", () => {
        new OffscreenContentProcessor();
    });
}
