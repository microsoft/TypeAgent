// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import { IConversation, DateRange } from "./interfaces.js";
import { ChatModel, openai, TextEmbeddingModel } from "aiclient";
import {
    TextEmbeddingIndexSettings,
    createTextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { MessageTextIndexSettings } from "./messageIndex.js";
import { RelatedTermIndexSettings } from "./relatedTermsIndex.js";
import {
    createKnowledgeModel,
    SemanticRefIndexSettings,
} from "./conversationIndex.js";
import { conversation as kpLib } from "knowledge-processor";

export type ConversationSettings = {
    relatedTermIndexSettings: RelatedTermIndexSettings;
    threadSettings: TextEmbeddingIndexSettings;
    messageTextIndexSettings: MessageTextIndexSettings;
    semanticRefIndexSettings: SemanticRefIndexSettings;
};

export function createConversationSettings(
    embeddingModel?: TextEmbeddingModel | undefined,
    embeddingSize?: number,
): ConversationSettings {
    embeddingModel ??= openai.createEmbeddingModel();
    embeddingSize ??= 1536;
    const minCosineSimilarity = 0.85;
    return {
        relatedTermIndexSettings: {
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                embeddingModel,
                embeddingSize,
                minCosineSimilarity,
                50,
            ),
        },
        threadSettings: createTextEmbeddingIndexSettings(
            embeddingModel,
            embeddingSize,
            minCosineSimilarity,
        ),
        messageTextIndexSettings: {
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                embeddingModel,
                embeddingSize,
                minCosineSimilarity,
            ),
        },
        semanticRefIndexSettings: {
            batchSize: 4,
        },
    };
}

/**
 * Returns the time range for a conversation: the timestamps of the first and last messages
 * If messages have no timestamps (which are optional), returns undefined
 * @param conversation
 * @returns {DateRange}
 */
export function getTimeRangeForConversation(
    conversation: IConversation,
): DateRange | undefined {
    const messages = conversation.messages;
    const start = messages[0].timestamp;
    const end = messages[messages.length - 1].timestamp;
    if (start !== undefined) {
        return {
            start: new Date(start),
            end: end ? new Date(end) : undefined,
        };
    }
    return undefined;
}

export function getTimeRangePromptSectionForConversation(
    conversation: IConversation,
): PromptSection[] {
    const timeRange = getTimeRangeForConversation(conversation);
    if (timeRange) {
        return [
            {
                role: "system",
                content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.start} to ${timeRange.end}"`,
            },
        ];
    }
    return [];
}
/**
 * Create a knowledge extractor using the given Chat Model
 * @param chatModel
 * @returns
 */

export function createKnowledgeExtractor(
    chatModel?: ChatModel,
): kpLib.KnowledgeExtractor {
    chatModel ??= createKnowledgeModel();
    const extractor = kpLib.createKnowledgeExtractor(chatModel, {
        maxContextLength: 4096,
        /**
         * This should *ALWAYS* be false.
         * Merging is handled during indexing:
         */
        mergeActionKnowledge: false,
    });
    return extractor;
}
