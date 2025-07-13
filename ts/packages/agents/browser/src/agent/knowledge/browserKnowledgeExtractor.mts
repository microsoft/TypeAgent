// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContentExtractor,
    BatchProcessor,
    ExtractionMode,
    ExtractionInput,
    BatchProgress,
    AIModelRequiredError,
    AIExtractionFailedError,
} from "website-memory";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { conversation as kpLib } from "knowledge-processor";
import { openai as ai } from "aiclient";

/**
 * Browser Knowledge Extractor that delegates to the website-memory package
  */
export class BrowserKnowledgeExtractor {
    private contentExtractor: ContentExtractor;
    private batchProcessor: BatchProcessor;

    constructor(context: SessionContext<BrowserActionContext>) {
        // Create knowledge extractor from session context (similar to old unified system)
        let knowledgeExtractor: kpLib.KnowledgeExtractor | undefined;
        try {
            const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
            const languageModel = ai.createChatModel(apiSettings);
            knowledgeExtractor = kpLib.createKnowledgeExtractor(languageModel);
        } catch (error) {
            console.warn("AI model initialization failed:", error);
            // knowledgeExtractor remains undefined - will cause AI modes to fail appropriately
        }

        const config: any = {
            mode: "content", // Default mode
        };

        if (knowledgeExtractor) {
            config.knowledgeExtractor = knowledgeExtractor;
        }

        this.contentExtractor = new ContentExtractor(config);
        this.batchProcessor = new BatchProcessor(this.contentExtractor);
    }

    /**
     * Extract knowledge using the simplified extraction API
     */
    async extractKnowledge(
        content: ExtractionInput,
        mode: ExtractionMode = "content",
    ) {
        try {
            // Simple delegation - mode automatically determines AI usage and knowledge strategy
            return await this.contentExtractor.extract(content, mode);
        } catch (error) {
            if (
                error instanceof AIModelRequiredError ||
                error instanceof AIExtractionFailedError
            ) {
                // Re-throw AI errors with context
                throw new Error(
                    `Browser knowledge extraction failed: ${error.message}. ` +
                        `Consider using 'basic' mode for non-AI extraction.`,
                );
            }
            throw error;
        }
    }

    /**
     * Extract knowledge from multiple items using batch processing
     */
    async extractBatch(
        contents: ExtractionInput[],
        mode: ExtractionMode = "content",
        progressCallback?: (progress: BatchProgress) => void,
    ) {
        try {
            return await this.batchProcessor.processBatch(
                contents,
                mode,
                progressCallback,
            );
        } catch (error) {
            if (
                error instanceof AIModelRequiredError ||
                error instanceof AIExtractionFailedError
            ) {
                throw new Error(
                    `Browser batch extraction failed: ${error.message}. ` +
                        `Consider using 'basic' mode for non-AI extraction.`,
                );
            }
            throw error;
        }
    }

    /**
     * Get the capabilities of a specific extraction mode
     */
    getModeCapabilities(mode: ExtractionMode) {
        return this.contentExtractor.getModeCapabilities(mode);
    }

    /**
     * Check if the extractor is configured for a specific mode
     */
    isConfiguredForMode(mode: ExtractionMode): boolean {
        return this.contentExtractor.isConfiguredForMode(mode);
    }
}
