// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { createLimiter } from "@typeagent/common-utils";
import {
    FileMemoryService,
    getConfiguredMemoryViewOptions,
    type TopicDecisionReceipt,
} from "@typeagent/memory-service";
import { getConfiguredViewModelOptions } from "./viewModelOptions.js";

export function createDurableMemoryService(
    rootDirectory: string,
    onTopicDecisionReceipt?: (receipt: TopicDecisionReceipt) => void,
): FileMemoryService {
    const embeddingBatchSize = getConfiguredMemoryEmbeddingBatchSize();
    const extractionWindowSize = getConfiguredMemoryExtractionWindowSize();
    return new FileMemoryService(rootDirectory, {
        ...getConfiguredMemoryViewOptions(),
        ...getConfiguredViewModelOptions(),
        ...(onTopicDecisionReceipt ? { onTopicDecisionReceipt } : {}),
        indexSettingsFactory: () =>
            createDurableMemoryIndexSettings(
                64,
                embeddingBatchSize,
                extractionWindowSize,
            ),
    });
}

export function getConfiguredMemoryEmbeddingBatchSize(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): 64 | 256 {
    const value = environment.TYPEAGENT_MEMORY_EMBEDDING_BATCH_SIZE;
    if (value === undefined || value === "64") return 64;
    if (value === "256") return 256;
    throw new Error("Memory embedding batch size must be 64 or 256.");
}

export function createDurableMemoryIndexSettings(
    embeddingCacheSize = 64,
    embeddingBatchSize: 64 | 256 = 64,
    extractionWindowSize: 8 | 16 = 8,
) {
    const settings = createDocMemorySettings(
        embeddingCacheSize,
        undefined,
        openai.createChatModel(openai.GPT_6_LUNA, undefined, undefined, [
            "website-knowledge",
            "durable-index",
        ]),
    );
    configureDurableMemoryExtractionWindow(
        settings.conversationSettings.semanticRefIndexSettings,
        extractionWindowSize,
    );
    settings.conversationSettings.semanticRefIndexSettings.knowledgeValidator =
        (knowledgeType, knowledge) =>
            knowledgeType !== "entity" ||
            !("type" in knowledge) ||
            !knowledge.type.some((type) =>
                ["link", "url"].includes(type.toLowerCase()),
            );
    const relatedTermEmbeddingSettings =
        settings.conversationSettings.relatedTermIndexSettings
            .embeddingIndexSettings;
    for (const embeddingSettings of [
        relatedTermEmbeddingSettings,
        settings.conversationSettings.messageTextIndexSettings
            .embeddingIndexSettings,
    ]) {
        if (embeddingSettings === undefined) continue;
        if (
            embeddingBatchSize === 256 &&
            (embeddingSettings.embeddingModel?.maxBatchSize ?? 0) < 256
        ) {
            throw new Error(
                "Experimental memory embedding batches require a declared provider capacity of at least 256.",
            );
        }
        embeddingSettings.batchSize = embeddingBatchSize;
    }
    return settings;
}

export function getConfiguredMemoryExtractionWindowSize(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): 8 | 16 {
    const value = environment.TYPEAGENT_MEMORY_EXTRACTION_WINDOW_SIZE;
    if (value === undefined || value === "8") return 8;
    if (value === "16") return 16;
    throw new Error("Memory extraction window size must be 8 or 16.");
}

export function configureDurableMemoryExtractionWindow(
    settings: ReturnType<
        typeof createDocMemorySettings
    >["conversationSettings"]["semanticRefIndexSettings"],
    windowSize: 8 | 16,
): void {
    if (windowSize === 16) {
        const extractor = settings.knowledgeExtractor;
        if (extractor === undefined) {
            throw new Error(
                "Experimental memory extraction windows require an explicit knowledge extractor.",
            );
        }
        const limit = createLimiter(8);
        settings.knowledgeExtractor = {
            ...extractor,
            settings: extractor.settings,
            extract: (...args) => limit(() => extractor.extract(...args)),
            extractWithRetry: (...args) =>
                limit(() => extractor.extractWithRetry(...args)),
        };
    }
    settings.batchSize = windowSize;
}
