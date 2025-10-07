// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActions.mjs";
import { ContentService } from "./contentService.mjs";
import * as website from "website-memory";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:content-extractor");

/**
 * ContentExtractor with browser capabilities that extends the base ContentExtractor
 * This provides browser-based downloading while maintaining full compatibility
 */
export class BrowserContentExtractor extends website.ContentExtractor {
    private contentService?: ContentService;

    constructor(
        config: any,
        sessionContext?: SessionContext<BrowserActionContext>,
    ) {
        super(config);

        if (sessionContext) {
            this.contentService = new ContentService(sessionContext);
            debug("Initialized with browser download capabilities");
        } else {
            debug("Initialized without browser capabilities");
        }
    }

    async extract(input: any, mode: any): Promise<any> {
        // If HTML content is already provided, use standard extraction
        if (input.htmlContent || input.htmlFragments) {
            debug("HTML content already provided, using standard extraction");
            return super.extract(input, mode);
        }

        // For URL-based extraction, try browser download first
        if (
            input.url &&
            this.contentService &&
            this.contentService.isBrowserAvailable()
        ) {
            try {
                debug(`Attempting browser download for: ${input.url}`);
                const downloadResult =
                    await this.contentService.downloadContent(input.url, {
                        useAuthentication: true,
                        timeout: (this as any).config?.timeout || 30000,
                        fallbackToFetch: false,
                    });

                if (downloadResult.success && downloadResult.htmlContent) {
                    debug(`Browser download successful for: ${input.url}`);

                    // Create enhanced input with downloaded content
                    const enhancedInput = {
                        ...input,
                        htmlContent: downloadResult.htmlContent,
                        textContent: downloadResult.textContent,
                    };

                    // Extract using base extractor with enhanced content
                    return super.extract(enhancedInput, mode);
                }
            } catch (error: any) {
                debug(
                    `Browser download failed for ${input.url}: ${error?.message || "Unknown error"}`,
                );
                // Fall through to standard extraction
            }
        }

        // Fallback to standard extraction
        debug(
            `Using standard extraction for: ${input.url || "direct content"}`,
        );
        return super.extract(input, mode);
    }

    /**
     * Check if browser capabilities are available
     */
    isBrowserAvailable(): boolean {
        return (
            !!this.contentService && this.contentService.isBrowserAvailable()
        );
    }
}
