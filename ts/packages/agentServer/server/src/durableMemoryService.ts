// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import {
    FileMemoryService,
    createKnowProCorpusIndex,
} from "@typeagent/memory-service";

export function createDurableMemoryService(
    rootDirectory: string,
): FileMemoryService {
    return new FileMemoryService(rootDirectory, {
        indexFactory: (corpusId, indexDirectory) =>
            createKnowProCorpusIndex(corpusId, indexDirectory, () => {
                const settings = createDocMemorySettings(
                    64,
                    undefined,
                    openai.createChatModel(
                        openai.GPT_5_6_LUNA,
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
            }),
    });
}
