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
import { BrowserActionContext } from "../browserActions.mjs";
import { conversation as kpLib } from "knowledge-processor";
import { openai as ai } from "aiclient";
import { ActionDetectionAdapter } from "./actionDetectionAdapter.mjs";
import { ContentSummaryAdapter } from "../indexing/contentSummaryAdapter.mjs";

/**
 * Browser Knowledge Extractor that delegates to the website-memory package
 */
export class BrowserKnowledgeExtractor {
    private contentExtractor: ContentExtractor;
    private batchProcessor: BatchProcessor;
    private actionDetectionAdapter: ActionDetectionAdapter;
    private contentSummaryAdapter: ContentSummaryAdapter;

    constructor(context: SessionContext<BrowserActionContext>) {
        // Create knowledge extractor from session context
        let knowledgeExtractor: kpLib.KnowledgeExtractor | undefined;
        try {
            // Use GPT_4_O_MINI endpoint for website knowledge extraction to improve performance
            const apiSettings = ai.azureApiSettingsFromEnv(
                ai.ModelType.Chat,
                undefined,
                "GPT_4_O_MINI",
            );
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

        // Initialize action detection adapter
        this.actionDetectionAdapter = new ActionDetectionAdapter();

        // Initialize content summary adapter
        this.contentSummaryAdapter = new ContentSummaryAdapter();

        // Ensure content summary adapter is ready for summary mode
        this.contentSummaryAdapter.ensureInitialized().catch((error) => {
            console.warn(
                "Content summary adapter initialization failed:",
                error,
            );
        });
    }

    /**
     * Extract knowledge using the simplified extraction API
     */
    async extractKnowledge(
        content: ExtractionInput,
        mode: ExtractionMode = "content",
    ) {
        try {
            // For summary mode, prepare the content with summarized text
            if (
                mode === ("summary" as ExtractionMode) &&
                this.contentSummaryAdapter.isAvailable()
            ) {
                content = await this.prepareSummarizedContent(content);
            }

            // Simple delegation - mode automatically determines AI usage and knowledge strategy
            return await this.contentExtractor.extract(content, mode, {
                processingMode: "realtime", // Browser agent uses real-time for user feedback
            });
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
            // Get base extraction results from website-memory
            const options: any = {
                processingMode: "realtime", // Browser batch uses real-time for progress
            };
            if (progressCallback) {
                options.progressCallback = progressCallback;
            }
            
            const extractionResults = await this.batchProcessor.processBatch(
                contents,
                mode,
                options,
            );

            // Add enhanced action detection for appropriate modes
            if (mode === "full") {
                await this.enhanceWithActionDetection(
                    extractionResults,
                    contents,
                    mode,
                );
            }

            return extractionResults;
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

    async extractBatchWithEvents(
        contents: ExtractionInput[],
        mode: ExtractionMode = "content",
        progressListener: (progress: any) => Promise<void>,
        maxConcurrent?: number,
    ): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const progressQueue: Promise<void>[] = [];
            let isProcessing = false;

            const handleProgress = async (progress: any) => {
                const progressPromise = progressListener(progress);
                progressQueue.push(progressPromise);

                if (!isProcessing) {
                    isProcessing = true;
                    while (progressQueue.length > 0) {
                        const promise = progressQueue.shift()!;
                        await promise;
                    }
                    isProcessing = false;
                }
            };

            this.batchProcessor.on("progress", handleProgress);

            this.batchProcessor.on("complete", async (results: any[]) => {
                await Promise.all(progressQueue);
                this.batchProcessor.removeAllListeners();

                try {
                    if (mode === "full") {
                        await this.enhanceWithActionDetection(
                            results,
                            contents,
                            mode,
                        );
                    }
                    resolve(results);
                } catch (error) {
                    reject(error);
                }
            });

            this.batchProcessor
                .processBatchWithEvents(contents, mode)
                .catch(reject);
        });
    }

    /**
     * Enhance extraction results with action detection from discovery agent
     */
    private async enhanceWithActionDetection(
        extractionResults: any[],
        contents: ExtractionInput[],
        mode: ExtractionMode,
    ): Promise<void> {
        try {
            console.log(
                `Enhancing ${extractionResults.length} results with action detection`,
            );
            if (extractionResults.length !== contents.length) {
                throw new Error(
                    `Mismatch in input lenght. extractionResults has length ${extractionResults.length}  while content has lenght ${contents.length}.`,
                );
            }

            for (let i = 0; i < extractionResults.length; i++) {
                const result = extractionResults[i];
                const targetContent = contents[i];

                // Check if this content has HTML fragments for action detection
                if (
                    targetContent.htmlFragments &&
                    targetContent.htmlFragments.length > 0
                ) {
                    console.log(
                        `Processing action detection for result with ${targetContent.htmlFragments.length} fragments`,
                    );

                    // Use action detection adapter to get enhanced actions
                    const detectedActions =
                        await this.actionDetectionAdapter.detectActions(
                            targetContent.htmlFragments,
                            mode,
                        );

                    // Add detected actions to the result
                    if (detectedActions && detectedActions.length > 0) {
                        result.detectedActions = detectedActions;
                        console.log(
                            `Added ${detectedActions.length} detected actions to result`,
                        );

                        // Create action summary
                        const actionTypes = [
                            ...new Set(detectedActions.map((a) => a.type)),
                        ];
                        const highConfidenceActions = detectedActions.filter(
                            (a) => a.confidence > 0.8,
                        ).length;
                        const actionDistribution = detectedActions.reduce(
                            (acc: any, action) => {
                                acc[action.type] = (acc[action.type] || 0) + 1;
                                return acc;
                            },
                            {},
                        );

                        result.actionSummary = {
                            totalActions: detectedActions.length,
                            actionTypes,
                            highConfidenceActions,
                            actionDistribution,
                        };
                    } else {
                        console.log("No actions detected for this result");
                        result.detectedActions = [];
                    }
                } else {
                    console.log(
                        "No HTML fragments available for action detection",
                    );
                    result.detectedActions = [];
                }
            }

            console.log("Action detection enhancement complete");
        } catch (error) {
            console.warn("Action detection enhancement failed:", error);
            // Don't fail the entire extraction - just skip action detection
            for (const result of extractionResults) {
                if (!result.detectedActions) {
                    result.detectedActions = [];
                }
            }
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

    /**
     * Get action detection capabilities and status
     */
    getActionDetectionCapabilities() {
        return this.actionDetectionAdapter.getCapabilities();
    }

    /**
     * Check if action detection is available
     */
    isActionDetectionAvailable(): boolean {
        return this.actionDetectionAdapter.isActionDetectionAvailable();
    }

    /**
     * Prepare content with summarized text for summary mode
     * This replaces the main content with an AI-generated summary before knowledge extraction
     */
    private async prepareSummarizedContent(
        content: ExtractionInput,
    ): Promise<ExtractionInput> {
        try {
            console.log("Preparing summarized content for summary mode...");

            // Get text content from the original input
            const textContent = this.prepareTextFromInput(content);

            if (!textContent || textContent.length < 200) {
                console.log(
                    "Insufficient text content for summarization, using original content",
                );
                return content;
            }

            const startTime = Date.now();

            // Apply summary enhancement with context information
            const enhancementOptions: any = {
                url: content.url,
                title: content.title,
                includeContextInEnhancedText: true,
            };

            const bookmarkFolder = this.extractBookmarkFolder(content);
            if (bookmarkFolder) {
                enhancementOptions.bookmarkFolder = bookmarkFolder;
            }

            const { enhancedText, summaryData, processingTime } =
                await this.contentSummaryAdapter.enhanceWithSummary(
                    textContent,
                    "summary" as ExtractionMode,
                    enhancementOptions,
                );

            if (enhancedText && enhancedText !== textContent) {
                console.log(
                    `Summary generated in ${processingTime}ms, replacing main content...`,
                );

                // Create a new content object with summarized text replacing the main content
                const summarizedContent: ExtractionInput = {
                    ...content,
                    textContent: enhancedText,
                    summaryData,
                    summaryProcessingTime: processingTime,
                } as any;

                console.log(
                    `Content preparation completed in ${Date.now() - startTime}ms total`,
                );

                return summarizedContent;
            } else {
                console.log(
                    "No enhanced text generated, using original content",
                );
                return content;
            }
        } catch (error) {
            console.warn("Summary content preparation failed:", error);
            // Return original content as fallback
            return content;
        }
    }

    /**
     * Extract bookmark folder information from content input
     */
    private extractBookmarkFolder(
        content: ExtractionInput,
    ): string | undefined {
        // Check if content has folder information
        if ((content as any).folder) {
            return (content as any).folder;
        }

        // Could also extract from URL path for some cases
        if (content.url) {
            try {
                const url = new URL(content.url);
                // For some bookmark systems, folder info might be in URL parameters
                const folderParam =
                    url.searchParams.get("folder") ||
                    url.searchParams.get("path");
                if (folderParam) {
                    return folderParam;
                }
            } catch {
                // Invalid URL, continue without folder info
            }
        }

        return undefined;
    }

    /**
     * Prepare text content from extraction input for summarization
     */
    private prepareTextFromInput(content: ExtractionInput): string {
        const parts: string[] = [];

        // Add title
        if (content.title) {
            parts.push(`Title: ${content.title}`);
        }

        // Add main text content
        if (content.textContent) {
            parts.push(content.textContent);
        }

        // If we have HTML fragments, extract text from them
        if (content.htmlFragments && content.htmlFragments.length > 0) {
            const fragmentTexts = content.htmlFragments
                .map((fragment: any) => {
                    if (typeof fragment === "string") {
                        return fragment;
                    } else if (fragment.content) {
                        return fragment.content;
                    } else if (fragment.textContent) {
                        return fragment.textContent;
                    }
                    return "";
                })
                .filter((text: string) => text && text.length > 0);

            if (fragmentTexts.length > 0) {
                parts.push(fragmentTexts.join("\n\n"));
            }
        }

        return parts.join("\n\n").trim();
    }
}
