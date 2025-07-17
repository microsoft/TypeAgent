// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";
import { BrowserConnector } from "./browserConnector.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:content-service");

/**
 * Content downloading service that uses browser extension capabilities
 * This provides content downloading and processing without exposing implementation details
 */
export class ContentService {
    private browserConnector: BrowserConnector | undefined;
    private sessionContext: SessionContext<BrowserActionContext> | undefined;

    constructor(sessionContext?: SessionContext<BrowserActionContext>) {
        this.sessionContext = sessionContext;

        if (sessionContext) {
            this.browserConnector = new BrowserConnector(sessionContext);
            debug("Initialized with browser download capabilities");
        } else {
            debug("Initialized without browser capabilities");
        }
    }

    /**
     * Download content using browser extension
     */
    async downloadContent(url: string, options: any = {}): Promise<any> {
        if (!this.browserConnector) {
            throw new Error("Browser connector not available");
        }

        try {
            debug(`Downloading content for: ${url}`);

            const downloadAction = {
                actionName: "downloadContentWithBrowser",
                parameters: {
                    url: url,
                    options: {
                        useAuthentication: options.useAuthentication ?? true,
                        timeout: options.timeout ?? 30000,
                        fallbackToFetch: options.fallbackToFetch ?? true,
                        waitForDynamic: options.waitForDynamic ?? false,
                        scrollBehavior:
                            options.scrollBehavior ?? "capture-initial",
                        processing: {
                            filterToReadingView: true,
                            keepMetaTags: true,
                            extractText: true,
                        },
                    },
                },
            };

            const response = await this.browserConnector.sendActionToBrowser(
                downloadAction,
                "browser",
            );

            if (response && response.success) {
                debug(
                    `Download successful for: ${url} (${response.htmlContent?.length || 0} chars)`,
                );
                return {
                    success: true,
                    htmlContent: response.htmlContent,
                    textContent: response.textContent,
                    method: response.method || "browser",
                    metadata: response.metadata || {},
                };
            } else {
                throw new Error(response?.error || "Browser download failed");
            }
        } catch (error: any) {
            debug(`Download error for ${url}:`, error);
            throw error;
        }
    }

    /**
     * Process HTML content using browser extension
     */
    async processHtmlContent(
        htmlContent: string,
        options: any = {},
    ): Promise<any> {
        if (!this.browserConnector) {
            throw new Error("Browser connector not available");
        }

        try {
            debug(`Processing HTML content (${htmlContent.length} bytes)`);

            const processAction = {
                actionName: "processHtmlContent",
                parameters: {
                    htmlContent: htmlContent,
                    options: {
                        filterToReadingView:
                            options.filterToReadingView !== false,
                        keepMetaTags: options.keepMetaTags !== false,
                        extractText: options.extractText !== false,
                        preserveStructure: options.preserveStructure !== false,
                        maxElements: options.maxElements,
                    },
                },
            };

            const response = await this.browserConnector.sendActionToBrowser(
                processAction,
                "browser",
            );

            if (response && response.success) {
                debug(`HTML processing successful`);
                return {
                    success: true,
                    processedHtml: response.data.processedHtml || htmlContent,
                    textContent: response.data.textContent || "",
                    metadata: response.data.metadata || {},
                };
            } else {
                throw new Error(response?.error || "HTML processing failed");
            }
        } catch (error: any) {
            debug(`HTML processing error:`, error);
            throw error;
        }
    }

    /**
     * Check if browser capabilities are available
     */
    isBrowserAvailable(): boolean {
        return (
            !!this.browserConnector &&
            !!this.sessionContext?.agentContext.webSocket
        );
    }

    /**
     * Get status of browser capabilities
     */
    getStatus(): {
        browserAvailable: boolean;
        webSocketConnected: boolean;
        capabilities: string[];
    } {
        const webSocketConnected =
            !!this.sessionContext?.agentContext.webSocket;
        const browserAvailable = this.isBrowserAvailable();

        return {
            browserAvailable,
            webSocketConnected,
            capabilities: browserAvailable
                ? [
                      "content-download",
                      "html-processing",
                      "authentication",
                      "dynamic-content",
                  ]
                : [],
        };
    }
}

/**
 * Factory function to create content service
 */
export function createContentService(
    sessionContext?: SessionContext<BrowserActionContext>,
): ContentService {
    return new ContentService(sessionContext);
}
