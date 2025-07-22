// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";
import { createContentService } from "./contentService.mjs";
import { BrowserContentExtractor } from "./browserContentExtractor.mjs";
import { DirectFolderProcessor } from "./htmlProcessor.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:website-import");

/**
 * Website import that adds browser-based downloading capability
 * This module provides drop-in replacements for standard import functions
 */

/**
 * Content extractor that attempts browser-based downloading
 * Factory function that returns appropriate extractor based on capabilities
 */
export function createContentExtractor(
    config: any,
    sessionContext?: SessionContext<BrowserActionContext>,
) {
    // Always return BrowserContentExtractor which gracefully falls back to standard behavior
    // when browser capabilities are not available
    return new BrowserContentExtractor(config, sessionContext);
}

/**
 * HTML processing for folder imports using simple direct processing
 * This eliminates browser communication for better performance
 */
export async function processHtmlFolder(
    htmlContent: string,
    filePath: string,
    sessionContext?: SessionContext<BrowserActionContext>,
): Promise<{ html: string; text: string; processingMethod: string }> {
    try {
        // Use simple direct processing instead of browser communication
        debug(`Processing HTML with simple direct processor for: ${filePath}`);
        const directProcessor = new DirectFolderProcessor();

        const result = await directProcessor.processHtmlContent(
            htmlContent,
            filePath,
            {
                mode: "content",
                contentTimeout: 30000,
            },
        );

        debug(
            `Direct processing completed for ${filePath}: ${result.metadata.processingMethod} (${Math.round(result.metadata.reductionRatio * 100)}% reduction)`,
        );

        return {
            html: result.processedHtml,
            text: result.textContent,
            processingMethod: result.metadata.processingMethod,
        };
    } catch (error: any) {
        debug(
            `Direct processing failed for ${filePath}, falling back to browser processing:`,
            error?.message,
        );

        // Fallback to browser-based processing if available
        if (sessionContext) {
            const processor = createContentService(sessionContext);

            if (processor.isBrowserAvailable()) {
                try {
                    debug(
                        `Attempting browser-based HTML processing for: ${filePath}`,
                    );
                    const result = await processor.processHtmlContent(
                        htmlContent,
                        {
                            filterToReadingView: true,
                            keepMetaTags: true,
                            extractText: true,
                            preserveStructure: true,
                        },
                    );

                    if (result.success) {
                        debug(
                            `Browser-based HTML processing successful for: ${filePath}`,
                        );
                        return {
                            html: result.processedHtml,
                            text: result.textContent,
                            processingMethod: "browser-enhanced",
                        };
                    }
                } catch (error: any) {
                    debug(
                        `Browser-based HTML processing failed for ${filePath}: ${error?.message || "Unknown error"}`,
                    );
                    // Fall through to basic processing
                }
            }
        }

        // Fallback to basic processing
        debug(`Using basic HTML processing for: ${filePath}`);
        return {
            html: htmlContent,
            text: extractBasicText(htmlContent),
            processingMethod: "basic",
        };
    }
}

/**
 * Basic text extraction as fallback
 */
function extractBasicText(html: string): string {
    return html
        .replace(/<[^>]*>/g, " ") // Remove HTML tags
        .replace(/&[^;]+;/g, " ") // Remove HTML entities
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();
}

/**
 * Check if processing is available for the given context
 */
export function isProcessingAvailable(
    sessionContext?: SessionContext<BrowserActionContext>,
): boolean {
    if (!sessionContext) return false;

    const extractor = new BrowserContentExtractor({}, sessionContext);
    return extractor.isBrowserAvailable();
}

/**
 * Get detailed status of processing capabilities
 */
export function getProcessingStatus(
    sessionContext?: SessionContext<BrowserActionContext>,
): {
    available: boolean;
    capabilities: string[];
    webSocketConnected: boolean;
    recommendation: string;
} {
    if (!sessionContext) {
        return {
            available: false,
            capabilities: [],
            webSocketConnected: false,
            recommendation: "No session context provided",
        };
    }

    const extractor = new BrowserContentExtractor({}, sessionContext);
    const status = extractor.getBrowserStatus();

    return {
        available: status.available,
        capabilities: status.capabilities,
        webSocketConnected: status.webSocketConnected,
        recommendation: status.available
            ? "Processing available - authentication and dynamic content supported"
            : "Standard processing only - browser extension not connected",
    };
}

/**
 * Log processing status for debugging
 */
export function logProcessingStatus(
    sessionContext?: SessionContext<BrowserActionContext>,
): void {
    const status = getProcessingStatus(sessionContext);
    debug("Processing status:", {
        available: status.available,
        capabilities: status.capabilities,
        webSocketConnected: status.webSocketConnected,
        recommendation: status.recommendation,
    });
}
