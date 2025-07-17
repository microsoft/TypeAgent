// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";
import { createContentService } from "./contentService.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:import-utils");

/**
 * URL fetching that tries browser download first, then falls back to standard fetch
 */
export async function urlFetch(
    url: string,
    sessionContext?: SessionContext<BrowserActionContext>,
): Promise<{
    htmlContent?: string;
    textContent?: string;
    method: string;
    error?: string;
}> {
    // Try browser-based download if available
    if (sessionContext) {
        try {
            debug(`Attempting enhanced download for: ${url}`);
            const downloader = createContentService(sessionContext);

            if (downloader.isBrowserAvailable()) {
                const result = await downloader.downloadContent(url, {
                    useAuthentication: true,
                    timeout: 30000,
                    fallbackToFetch: false, // Don't double-fallback
                });

                if (result.success) {
                    debug(`Enhanced download successful for: ${url}`);
                    return {
                        htmlContent: result.htmlContent,
                        textContent: result.textContent,
                        method: "browser-enhanced",
                    };
                }
            }
        } catch (error: any) {
            debug(
                `Enhanced download failed for ${url}: ${error?.message || "Unknown error"}`,
            );
            // Continue to fallback
        }
    }

    // Return failure - let the original system handle the fetch
    debug(`Enhanced download not available for: ${url}`);
    return {
        method: "enhanced-unavailable",
        error: "Browser-based download not available",
    };
}

/**
 * HTML processing for folder imports
 */
export async function htmlProcessing(
    htmlContent: string,
    filePath: string,
    sessionContext?: SessionContext<BrowserActionContext>,
): Promise<{
    processedHtml?: string;
    textContent?: string;
    method: string;
    error?: string;
}> {
    // Try browser-based processing if available
    if (sessionContext) {
        try {
            debug(`Attempting enhanced HTML processing for: ${filePath}`);
            const processor = createContentService(sessionContext);

            if (processor.isBrowserAvailable()) {
                const result = await processor.processHtmlContent(htmlContent, {
                    filterToReadingView: true,
                    keepMetaTags: true,
                    extractText: true,
                    preserveStructure: true,
                });

                if (result.success) {
                    debug(
                        `Enhanced HTML processing successful for: ${filePath}`,
                    );
                    return {
                        processedHtml: result.processedHtml,
                        textContent: result.textContent,
                        method: "browser-enhanced",
                    };
                }
            }
        } catch (error: any) {
            debug(
                `Enhanced HTML processing failed for ${filePath}: ${error?.message || "Unknown error"}`,
            );
            // Continue to fallback
        }
    }

    // Return failure - let the original system handle basic processing
    debug(`Enhanced HTML processing not available for: ${filePath}`);
    return {
        method: "enhanced-unavailable",
        error: "Browser-based HTML processing not available",
    };
}

/**
 * Check if processing is available
 */
export function isProcessingAvailable(
    sessionContext?: SessionContext<BrowserActionContext>,
): boolean {
    if (!sessionContext) return false;

    const wrapper = createContentService(sessionContext);
    return wrapper.isBrowserAvailable();
}

/**
 * Get status of processing capabilities
 */
export function getProcessingStatus(
    sessionContext?: SessionContext<BrowserActionContext>,
): {
    available: boolean;
    capabilities: string[];
    webSocketConnected: boolean;
} {
    if (!sessionContext) {
        return {
            available: false,
            capabilities: [],
            webSocketConnected: false,
        };
    }

    const wrapper = createContentService(sessionContext);
    const status = wrapper.getStatus();

    return {
        available: status.browserAvailable,
        capabilities: status.capabilities,
        webSocketConnected: status.webSocketConnected,
    };
}
