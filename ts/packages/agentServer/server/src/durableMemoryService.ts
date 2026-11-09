// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
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
    return new FileMemoryService(rootDirectory, {
        ...getConfiguredMemoryViewOptions(),
        ...getConfiguredViewModelOptions(),
        ...(onTopicDecisionReceipt ? { onTopicDecisionReceipt } : {}),
        indexSettingsFactory: () => {
            const settings = createDocMemorySettings(
                64,
                undefined,
                openai.createChatModel(
                    openai.GPT_6_LUNA,
                    undefined,
                    undefined,
                    ["website-knowledge", "durable-index"],
                ),
            );
            settings.conversationSettings.semanticRefIndexSettings.batchSize = 8;
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
            if (relatedTermEmbeddingSettings !== undefined) {
                relatedTermEmbeddingSettings.batchSize = 64;
            }
            settings.conversationSettings.messageTextIndexSettings.embeddingIndexSettings.batchSize = 64;
            return settings;
        },
    });
}
