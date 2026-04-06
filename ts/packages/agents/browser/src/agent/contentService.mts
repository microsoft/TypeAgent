// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActions.mjs";
import { BrowserControl } from "../common/browserControl.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:content-service");

/**
 * Content downloading service that uses browser extension capabilities
 * This provides content downloading and processing without exposing implementation details
 */
export class ContentService {
    private browserControl: BrowserControl | undefined;

    constructor(sessionContext?: SessionContext<BrowserActionContext>) {
        const agentContext = sessionContext?.agentContext;
        if (agentContext?.externalBrowserControl) {
            this.browserControl = agentContext.externalBrowserControl.control;
            debug("Initialized with browser download capabilities");
        } else {
            debug("Initialized without browser capabilities");
        }
    }

    /**
     * Download content using browser extension
     */
    async downloadContent(url: string, options: any = {}): Promise<any> {
        if (!this.browserControl) {
            throw new Error("Browser control not available");
        }

        try {
            debug(`Downloading content for: ${url}`);

            const response = await this.browserControl.runBrowserAction(
                "downloadContentWithBrowser",
                {
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
                "browser",
            );

            if (response?.data && response.data.success) {
                debug(
                    `Download successful for: ${url} (${response.data.htmlContent?.length || 0} chars)`,
                );
                return {
                    success: true,
                    htmlContent: response.data.htmlContent,
                    textContent: response.data.textContent,
                    method: response.data.method || "browser",
                    metadata: response.data.metadata || {},
                };
            } else {
                throw new Error(
                    response?.data?.error ||
                        response?.error ||
                        "Browser download failed",
                );
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
        if (!this.browserControl) {
            throw new Error("Browser control not available");
        }

        try {
            debug(`Processing HTML content (${htmlContent.length} bytes)`);

            const response = await this.browserControl.runBrowserAction(
                "processHtmlContent",
                {
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
        return !!this.browserControl;
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
