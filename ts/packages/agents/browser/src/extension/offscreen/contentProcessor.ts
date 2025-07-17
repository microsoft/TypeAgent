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
    SharedHtmlProcessor,
    HtmlProcessingMonitor,
} from "../shared/htmlProcessor.js";

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
     * Process URL by loading it in offscreen document
     */
    async processUrl(url: string, options: DownloadOptions): Promise<any> {
        const loadStartTime = Date.now();
        this.log("info", `Starting URL processing: ${url}`);

        try {
            // Update current URL display
            this.currentUrlElement.textContent = url;

            // Navigate to URL
            this.log("info", "Navigating to URL...");
            window.location.href = url;

            // Wait for page load with timeout
            this.log("info", "Waiting for page load...");
            await this.waitForPageLoad(options.timeout || this.maxLoadTime);

            // Wait for dynamic content if requested
            if (options.waitForDynamic) {
                this.log("info", "Waiting for dynamic content...");
                await this.waitForDynamicContent(
                    options.scrollBehavior || "capture-initial",
                );
            }

            // Extract and process HTML
            this.log("info", "Extracting HTML fragments...");
            const processed = await this.extractHTMLFragments(
                options.processing || {
                    filterToReadingView: true,
                    keepMetaTags: true,
                    extractText: true,
                },
            );

            const result = {
                processedHtml: processed.html,
                textContent: processed.text,
                metadata: {
                    finalUrl: window.location.href,
                    title: document.title,
                    loadTime: Date.now() - loadStartTime,
                    processingMethod: "offscreen" as const,
                    contentLength: processed.html.length,
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
            // Use shared HTML processor for consistent processing
            const result = await SharedHtmlProcessor.processHtmlContent(html, {
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
     * Wait for page to load completely
     */
    private async waitForPageLoad(timeout: number): Promise<void> {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkComplete = () => {
                const elapsed = Date.now() - startTime;

                if (document.readyState === "complete") {
                    this.log("info", `Page loaded in ${elapsed}ms`);
                    resolve();
                } else if (elapsed > timeout) {
                    this.log("error", `Page load timeout after ${timeout}ms`);
                    reject(new Error(`Page load timeout after ${timeout}ms`));
                } else {
                    setTimeout(checkComplete, 100);
                }
            };

            // Start checking immediately
            checkComplete();

            // Also listen for load event
            window.addEventListener(
                "load",
                () => {
                    this.log("info", "Load event fired");
                    resolve();
                },
                { once: true },
            );
        });
    }

    /**
     * Wait for dynamic content to load
     */
    private async waitForDynamicContent(scrollBehavior: string): Promise<void> {
        this.log("info", `Waiting for dynamic content (${scrollBehavior})`);

        // Wait for initial JavaScript execution
        await this.delay(2000);

        if (scrollBehavior === "scroll-to-bottom") {
            // Scroll to bottom to trigger lazy loading
            await this.scrollToBottom();
        } else if (scrollBehavior === "capture-initial") {
            // Just wait a bit more for initial dynamic content
            await this.delay(3000);
        }
    }

    /**
     * Scroll to bottom of page to trigger dynamic content
     */
    private async scrollToBottom(): Promise<void> {
        let previousHeight = 0;
        let currentHeight = document.body.scrollHeight;
        let stableCount = 0;

        this.log("info", "Starting scroll to bottom for dynamic content");

        while (stableCount < 3) {
            // Consider stable after 3 consistent measurements
            window.scrollTo(0, currentHeight);
            await this.delay(1000); // Wait for content to load

            previousHeight = currentHeight;
            currentHeight = document.body.scrollHeight;

            if (currentHeight === previousHeight) {
                stableCount++;
            } else {
                stableCount = 0;
                this.log("info", `Page height changed: ${currentHeight}px`);
            }

            // Prevent infinite scrolling
            if (currentHeight > 50000) {
                // 50,000px limit
                this.log("warn", "Scroll limit reached (50,000px)");
                break;
            }
        }

        // Scroll back to top
        window.scrollTo(0, 0);
        this.log("info", "Scroll to bottom completed");
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
     * Extract HTML fragments in consistent format
     */
    private async extractHTMLFragments(
        options: ProcessingOptions,
    ): Promise<{ html: string; text: string }> {
        const currentHtml = document.documentElement.outerHTML;

        // Use shared HTML processor for consistent processing
        const result = await SharedHtmlProcessor.processHtmlContent(
            currentHtml,
            {
                filterToReadingView: options.filterToReadingView ?? false,
                keepMetaTags: options.keepMetaTags ?? false,
                extractText: options.extractText ?? false,
                useTimestampIds: options.useTimestampIds ?? false,
                preserveStructure: options.preserveStructure ?? true,
                maxElements: options.maxElements ?? undefined,
            },
        );

        // Record processing metrics
        HtmlProcessingMonitor.recordMetric(
            result.metadata.processingMethod,
            result.metadata.originalSize,
            result.metadata.processedSize,
            result.metadata.processingTime,
            "offscreen-live",
        );

        return {
            html: result.html,
            text: result.text,
        };
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
