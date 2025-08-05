// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContentDownloadAdapter,
    ContentDownloadResult,
    DownloadOptions,
    ProcessingOptions,
    OffscreenMessage,
    MessageResponse,
    ContentDownloadErrorCode,
} from "../offscreen/types.js";

/**
 * Browser-based content downloader that uses offscreen documents
 * for enhanced downloading with authentication and JavaScript support
 */
export class BrowserContentDownloader implements ContentDownloadAdapter {
    private offscreenCreated: boolean = false;
    private readonly maxRetries: number = 3;
    private readonly defaultTimeout: number = 30000;
    private readonly maxTimeout: number = 60000;

    /**
     * Sanitize and clamp the timeout value to a safe range
     */
    private sanitizeTimeout(timeout: any): number {
        let t = Number(timeout);
        if (!Number.isFinite(t) || t <= 0) {
            return this.defaultTimeout;
        }
        return Math.min(t, this.maxTimeout);
    }

    /**
     * Download content using browser context with authentication support
     */
    async downloadContent(
        url: string,
        options: DownloadOptions = {},
    ): Promise<ContentDownloadResult> {
        const startTime = Date.now();

        try {
            return await this.downloadUsingBrowser(url, options);
        } catch (error: any) {
            // Try fallback if enabled
            if (options.fallbackToFetch) {
                console.warn(
                    `Browser download failed, falling back to fetch: ${error?.message || "Unknown error"}`,
                );
                return await this.downloadUsingFetch(url, options);
            }

            return {
                success: false,
                method: "failed",
                error: error?.message || "Download failed",
                metadata: {
                    finalUrl: url,
                    loadTime: Date.now() - startTime,
                    processingMethod: "basic",
                },
            };
        }
    }

    /**
     * Download content using browser context with authentication support
     */
    private async downloadUsingBrowser(
        url: string,
        options: DownloadOptions = {},
    ): Promise<ContentDownloadResult> {
        const startTime = Date.now();
        let attempt = 0;

        while (attempt < this.maxRetries) {
            try {
                // Ensure offscreen document is available
                await this.ensureOffscreenDocument();

                // Send download request to offscreen
                const result = await this.sendToOffscreen(
                    {
                        type: "downloadContent",
                        url,
                        options: {
                            timeout: options.timeout || this.defaultTimeout,
                            waitForDynamic: options.waitForDynamic || false,
                            scrollBehavior:
                                options.scrollBehavior || "capture-initial",
                            processing: options.processing || {
                                filterToReadingView: true,
                                keepMetaTags: true,
                                extractText: true,
                            },
                        },
                    },
                    options.timeout || this.defaultTimeout,
                );

                if (result.success) {
                    return {
                        success: true,
                        htmlContent: result.data.processedHtml,
                        textContent: result.data.textContent,
                        method: "browser",
                        metadata: {
                            ...result.data.metadata,
                            loadTime: Date.now() - startTime,
                        },
                    };
                } else {
                    throw new Error(
                        result.error || "Unknown browser download error",
                    );
                }
            } catch (error: any) {
                attempt++;
                console.warn(
                    `Browser download attempt ${attempt} failed:`,
                    error?.message || "Unknown error",
                );

                if (attempt >= this.maxRetries) {
                    throw new Error(
                        `Browser download failed after ${this.maxRetries} attempts: ${error?.message || "Unknown error"}`,
                    );
                }

                // Wait before retry with exponential backoff
                await this.delay(1000 * Math.pow(2, attempt - 1));
            }
        }

        throw new Error("Max retries exceeded");
    }

    /**
     * Fallback to standard fetch method
     */
    private async downloadUsingFetch(
        url: string,
        options: DownloadOptions,
    ): Promise<ContentDownloadResult> {
        const startTime = Date.now();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                this.sanitizeTimeout(options.timeout),
            );

            const response = await fetch(url, {
                headers: {
                    "User-Agent": options.userAgent || "TypeAgent/1.0",
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const htmlContent = await response.text();

            // Apply basic processing if options specified
            let processedHtml = htmlContent;
            let textContent = "";

            if (
                options.processing?.filterToReadingView ||
                options.processing?.extractText
            ) {
                const processed = await this.basicHtmlProcessing(
                    htmlContent,
                    options.processing,
                );
                processedHtml = processed.html;
                textContent = processed.text;
            }

            return {
                success: true,
                htmlContent: processedHtml,
                textContent,
                method: "fetch",
                metadata: {
                    finalUrl: response.url,
                    statusCode: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    loadTime: Date.now() - startTime,
                    contentLength: htmlContent.length,
                    processingMethod: "basic",
                },
            };
        } catch (error: any) {
            return {
                success: false,
                method: "failed",
                error: `Fetch failed: ${error?.message || "Unknown error"}`,
                metadata: {
                    finalUrl: url,
                    loadTime: Date.now() - startTime,
                    processingMethod: "basic",
                },
            };
        }
    }

    /**
     * Ensure offscreen document is created and ready
     */
    private async ensureOffscreenDocument(): Promise<void> {
        if (!this.offscreenCreated) {
            try {
                // Check if offscreen document already exists
                const existingContexts = await (
                    chrome.runtime as any
                ).getContexts({
                    contextTypes: ["OFFSCREEN_DOCUMENT"],
                });

                if (existingContexts.length === 0) {
                    await (chrome as any).offscreen.createDocument({
                        url: "offscreen/offscreen.html",
                        reasons: ["DOM_PARSER"] as any,
                        justification:
                            "Process HTML content with DOM access for enhanced import functionality",
                    });

                    // Wait a moment for the document to initialize
                    await this.delay(1000);
                }

                this.offscreenCreated = true;

                // Test communication with offscreen document
                await this.pingOffscreen();
            } catch (error: any) {
                this.offscreenCreated = false;
                throw new Error(
                    `Failed to create offscreen document: ${error?.message || "Offscreen API not available"}`,
                );
            }
        }
    }

    /**
     * Send message to offscreen document with timeout
     */
    private async sendToOffscreen(
        message: OffscreenMessage,
        timeout: number = 30000,
    ): Promise<MessageResponse> {
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error("Offscreen communication timeout"));
            }, this.sanitizeTimeout(timeout));

            chrome.runtime
                .sendMessage({
                    ...message,
                    target: "offscreen",
                    messageId,
                })
                .then((response: MessageResponse) => {
                    clearTimeout(timeoutId);
                    if (response) {
                        resolve(response);
                    } else {
                        reject(
                            new Error("No response from offscreen document"),
                        );
                    }
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * Test offscreen document connectivity
     */
    private async pingOffscreen(): Promise<void> {
        try {
            const response = await this.sendToOffscreen({ type: "ping" }, 5000);
            if (!response.success) {
                throw new Error("Offscreen document not responding");
            }
        } catch (error: any) {
            throw new Error(
                `Offscreen document communication failed: ${error?.message || "Communication failed"}`,
            );
        }
    }

    /**
     * Basic HTML processing without DOM (fallback)
     */
    private async basicHtmlProcessing(
        html: string,
        options: ProcessingOptions = {},
    ): Promise<{ html: string; text: string }> {
        let processedHtml = html;
        let textContent = "";

        if (options.extractText) {
            // Extract text content
            textContent = this.extractTextContent(processedHtml);
        }

        return { html: processedHtml, text: textContent };
    }

    /**
     * Extract text content using basic regex
     */
    private extractTextContent(html: string): string {
        return html
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    /**
     * Process HTML content directly (for folder imports)
     */
    async processHtmlContent(
        htmlContent: string,
        options: ProcessingOptions = {},
    ): Promise<any> {
        try {
            await this.ensureOffscreenDocument();

            const result = await this.sendToOffscreen(
                {
                    type: "processHtmlContent",
                    htmlContent,
                    options,
                },
                30000,
            ); // Fixed timeout instead of using options.timeout

            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || "HTML processing failed");
            }
        } catch (error: any) {
            // Fallback to basic processing
            console.warn(
                `Offscreen HTML processing failed, using fallback: ${error?.message || "Processing failed"}`,
            );
            return await this.basicHtmlProcessing(htmlContent, options);
        }
    }

    /**
     * Clean up offscreen document
     */
    async cleanup(): Promise<void> {
        if (this.offscreenCreated) {
            try {
                await (chrome as any).offscreen.closeDocument();
                this.offscreenCreated = false;
            } catch (error: any) {
                console.warn(
                    "Failed to close offscreen document:",
                    error?.message || "Unknown error",
                );
            }
        }
    }

    /**
     * Get adapter status and capabilities
     */
    getStatus(): {
        available: boolean;
        method: string;
        capabilities: string[];
    } {
        return {
            available:
                typeof chrome !== "undefined" && !!(chrome as any).offscreen,
            method: "browser",
            capabilities: [
                "authentication",
                "javascript-execution",
                "dynamic-content",
                "readability-filtering",
                "text-extraction",
            ],
        };
    }

    /**
     * Utility delay function
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Create a browser content download adapter for use in extension context
 */
export function createBrowserContentDownloader(): BrowserContentDownloader {
    return new BrowserContentDownloader();
}
