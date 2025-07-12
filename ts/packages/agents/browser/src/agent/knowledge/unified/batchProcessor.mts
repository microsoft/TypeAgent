// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContentInput,
    BatchProgress,
    BatchError,
    EnhancedKnowledgeResult,
    UnifiedModeConfig,
} from "./types.mjs";

export class BatchProcessor {
    private modeConfig: UnifiedModeConfig;
    private results: EnhancedKnowledgeResult[] = [];
    private errors: BatchError[] = [];

    constructor(modeConfig: UnifiedModeConfig) {
        this.modeConfig = modeConfig;
    }

    async process(
        items: ContentInput[],
        processor: (item: ContentInput) => Promise<EnhancedKnowledgeResult>,
        progressCallback?: (progress: BatchProgress) => void,
    ): Promise<EnhancedKnowledgeResult[]> {
        const totalItems = items.length;
        let processedItems = 0;
        const batchSize = Math.min(
            this.modeConfig.maxConcurrentExtractions,
            10,
        );

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            const batchPromises = batch.map(async (item) => {
                try {
                    const result = await processor(item);
                    this.results.push(result);
                    processedItems++;

                    if (progressCallback) {
                        progressCallback({
                            total: totalItems,
                            processed: processedItems,
                            percentage: Math.round(
                                (processedItems / totalItems) * 100,
                            ),
                            currentItem: item.url,
                            errors: this.errors.length,
                            mode: this.modeConfig.mode,
                        });
                    }

                    return result;
                } catch (error) {
                    const batchError: BatchError = {
                        item,
                        error:
                            error instanceof Error
                                ? error
                                : new Error(String(error)),
                        timestamp: new Date().toISOString(),
                    };

                    this.errors.push(batchError);
                    processedItems++;

                    return null;
                }
            });

            await Promise.allSettled(batchPromises);

            if (i + batchSize < items.length && this.modeConfig.enableAI) {
                await this.delay(1000);
            }
        }

        return this.results.filter((result) => result !== null);
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getErrors(): BatchError[] {
        return this.errors;
    }
}
