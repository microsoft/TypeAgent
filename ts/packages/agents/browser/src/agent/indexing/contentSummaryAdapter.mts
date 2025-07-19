// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { ExtractionMode } from "website-memory";
import registerDebug from "debug";
import { PageSummary } from "./schema/summarization.mjs";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
const debug = registerDebug("typeagent:browser:indexing");

function getSchemaFileContents(fileName: string): string {
    const packageRoot = path.join("..", "..", "..");

    return fs.readFileSync(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/indexing/schema", fileName),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

/**
 * ContentSummaryAdapter enhances knowledge extraction with page summarization.
 * Follows the same pattern as ActionDetectionAdapter for consistency.
 *
 * Inserts summarization step in the HTML→text→knowledge pipeline:
 * HTML Content → Text Extraction → SUMMARIZATION → Knowledge Processing
 */
export class ContentSummaryAdapter {
    private summaryTranslator: TypeChatJsonTranslator<PageSummary> | null =
        null;
    private isInitialized: boolean = false;

    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("summarization.mts");
    }

    /**
     * Main entry point: Enhance text content with summarization for specified mode
     */
    async enhanceWithSummary(
        textContent: string,
        mode: ExtractionMode,
        options: {
            maxInputLength?: number;
            targetSummaryLength?: number;
            includeKeyPoints?: boolean;
            // Context enhancement options
            url?: string;
            title?: string;
            bookmarkFolder?: string;
            includeContextInEnhancedText?: boolean;
        } = {},
    ): Promise<{
        enhancedText: string;
        summaryData?: PageSummary;
        processingTime?: number;
    }> {
        const startTime = Date.now();

        try {
            // Only process summary mode - same pattern as ActionDetectionAdapter
            if (mode !== ("summary" as ExtractionMode)) {
                return {
                    enhancedText: textContent,
                    processingTime: Date.now() - startTime,
                };
            }

            // Skip if content is too short or empty
            if (!textContent || textContent.length < 200) {
                console.log(
                    "Content too short for summarization, using original text",
                );
                return {
                    enhancedText: textContent,
                    processingTime: Date.now() - startTime,
                };
            }

            // Initialize translator if needed
            await this.ensureInitialized();

            if (!this.summaryTranslator) {
                console.warn(
                    "Summary translator not available, using original text",
                );
                return {
                    enhancedText: textContent,
                    processingTime: Date.now() - startTime,
                };
            }

            // Optimize content length for processing
            const maxLength = options.maxInputLength || 8000;
            const contentToSummarize =
                textContent.length > maxLength
                    ? this.smartTruncate(textContent, maxLength)
                    : textContent;

            debug(
                `Processing summarization for ${contentToSummarize.length} characters`,
            );

            // Create and execute summary prompt
            const prompt = this.createSummaryPrompt(
                contentToSummarize,
                options,
            );
            debug(
                `🤖 SUBMITTING SUMMARY REQUEST: ${contentToSummarize.length} chars to AI model`,
            );

            const result = await this.summaryTranslator.translate(prompt);

            if (!result.success) {
                debug("❌ SUMMARY GENERATION FAILED:", result.message);
                return {
                    enhancedText: textContent,
                    processingTime: Date.now() - startTime,
                };
            }

            const summaryData = result.data;
            debug(
                `📊 SUMMARY STATS: ${summaryData.keyPoints.length} key points, ${summaryData.entities.length} entities, ${summaryData.topics.length} topics`,
            );

            // Create enhanced text that combines summary with structured information and context
            const enhancedText = this.createEnhancedText(
                summaryData,
                textContent,
                options,
            );

            return {
                enhancedText,
                summaryData,
                processingTime: Date.now() - startTime,
            };
        } catch (error) {
            console.error("Error in content summarization:", error);
            return {
                enhancedText: textContent,
                processingTime: Date.now() - startTime,
            };
        }
    }

    /**
     * Initialize summary translator with lazy loading and error handling
     * Following ActionDetectionAdapter pattern
     */
    async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Use same model initialization as browser agent
            const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
            const languageModel = ai.createChatModel(apiSettings);

            // Create TypeScript schema validator
            const validator = createTypeScriptJsonValidator<PageSummary>(
                this.schemaText,
                "PageSummary",
            );

            this.summaryTranslator = createJsonTranslator(
                languageModel,
                validator,
            );

            this.isInitialized = true;
            debug("Content summary adapter initialized successfully");
        } catch (error) {
            console.warn(
                "Failed to initialize content summary adapter:",
                error,
            );
            this.summaryTranslator = null;
            this.isInitialized = true; // Mark as attempted to avoid retries
        }
    }

    /**
     * Create enhanced text that combines summary with key extracted information and context
     */
    private createEnhancedText(
        summaryData: PageSummary,
        originalText: string,
        options: {
            url?: string;
            title?: string;
            bookmarkFolder?: string;
            includeContextInEnhancedText?: boolean;
        } = {},
    ): string {
        const parts = [];

        // Add context information if requested and available
        if (options.includeContextInEnhancedText !== false) {
            // Default to true
            if (options.url) {
                parts.push(`URL: ${options.url}`);
            }

            if (options.title) {
                parts.push(`Page Title: ${options.title}`);
            }

            if (options.bookmarkFolder) {
                // Parse folder hierarchy if it contains separators
                const folderHierarchy = this.parseFolderHierarchy(
                    options.bookmarkFolder,
                );
                parts.push(`Bookmark Location: ${folderHierarchy}`);
            }
        }

        // Add summary information
        parts.push(`Summary: ${summaryData.summary}`);
        parts.push(`Content Type: ${summaryData.contentType}`);
        parts.push(`User Intent: ${summaryData.intent}`);

        if (summaryData.keyPoints.length > 0) {
            parts.push(`Key Points: ${summaryData.keyPoints.join("; ")}`);
        }

        if (summaryData.topics.length > 0) {
            parts.push(`Main Topics: ${summaryData.topics.join(", ")}`);
        }

        if (summaryData.entities.length > 0) {
            parts.push(`Entities: ${summaryData.entities.join(", ")}`);
        }

        // Include truncated original text for additional context
        const contextLength = Math.min(2000, originalText.length * 0.3);
        if (originalText.length > contextLength) {
            parts.push(
                `Additional Context: ${originalText.substring(0, contextLength)}...`,
            );
        } else {
            parts.push(`Original Content: ${originalText}`);
        }

        return parts.join("\n\n");
    }

    /**
     * Parse folder hierarchy from bookmark folder string
     */
    private parseFolderHierarchy(folderPath: string): string {
        if (!folderPath) return folderPath;

        // Handle common folder separators and create readable hierarchy
        const separators = ["/", "\\", ">", "|", " > "];
        let hierarchy = folderPath;

        // Find which separator is used
        for (const sep of separators) {
            if (folderPath.includes(sep)) {
                const parts = folderPath
                    .split(sep)
                    .map((part) => part.trim())
                    .filter((part) => part.length > 0);
                if (parts.length > 1) {
                    hierarchy = parts.join(" → ");
                    break;
                }
            }
        }

        return hierarchy;
    }

    /**
     * Create summarization prompt with TypeAgent style
     */
    private createSummaryPrompt(
        textContent: string,
        options: {
            targetSummaryLength?: number;
            includeKeyPoints?: boolean;
        } = {},
    ): string {
        const prompt = `
You are an expert at creating concise, informative summaries of web content.
Generate a SINGLE "PageSummary" response using the typescript schema below.

'''
${this.schemaText}
'''

Analyze and summarize the following content:

${textContent}`;

        return prompt;
    }

    /**
     * Smart truncation that tries to find good breaking points
     */
    private smartTruncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;

        // Try to find a good breaking point (end of sentence/paragraph)
        const truncated = text.substring(0, maxLength);
        const lastSentence = truncated.lastIndexOf(".");
        const lastParagraph = truncated.lastIndexOf("\n\n");

        const breakPoint = Math.max(lastSentence, lastParagraph);

        // Use break point if it's not too far back (at least 70% of max length)
        return breakPoint > maxLength * 0.7
            ? truncated.substring(0, breakPoint + 1)
            : truncated + "...";
    }

    /**
     * Check if content summarization is available
     */
    isAvailable(): boolean {
        return this.isInitialized && this.summaryTranslator !== null;
    }

    /**
     * Get summary of content summarization capabilities
     */
    getCapabilities() {
        return {
            available: this.isAvailable(),
            supportedModes: ["summary"],
            features: [
                "Content Summarization",
                "Key Point Extraction",
                "Entity Identification",
                "Topic Classification",
                "Content Type Detection",
                "Intent Analysis",
            ],
            aiModelRequired: true,
        };
    }
}
