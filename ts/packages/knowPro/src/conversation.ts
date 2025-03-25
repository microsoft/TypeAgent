// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import { IConversation, DateRange } from "./interfaces.js";
import { ConversationIndex } from "./conversationIndex.js";
import {
    buildTransientSecondaryIndexes,
    ConversationSecondaryIndexes,
    IConversationDataWithIndexes,
} from "./secondaryIndexes.js";
import { openai, TextEmbeddingModel } from "aiclient";
import {
    TextEmbeddingIndexSettings,
    createTextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { MessageTextIndexSettings } from "./messageIndex.js";
import { RelatedTermIndexSettings } from "./relatedTermsIndex.js";

export type ConversationSettings = {
    relatedTermIndexSettings: RelatedTermIndexSettings;
    threadSettings: TextEmbeddingIndexSettings;
    messageTextIndexSettings: MessageTextIndexSettings;
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

export async function createConversationFromData(
    data: IConversationDataWithIndexes,
    conversationSettings: ConversationSettings,
): Promise<IConversation> {
    const conversation: IConversation = {
        nameTag: data.nameTag,
        tags: data.tags,
        messages: data.messages,
        semanticRefs: data.semanticRefs,
        semanticRefIndex: data.semanticIndexData
            ? new ConversationIndex(data.semanticIndexData)
            : undefined,
    };
    const secondaryIndexes = new ConversationSecondaryIndexes(
        conversationSettings,
    );
    conversation.secondaryIndexes = secondaryIndexes;
    if (data.relatedTermsIndexData) {
        secondaryIndexes.termToRelatedTermsIndex.deserialize(
            data.relatedTermsIndexData,
        );
    }
    if (data.messageIndexData) {
        secondaryIndexes.messageIndex!.deserialize(data.messageIndexData);
    }
    await buildTransientSecondaryIndexes(conversation, conversationSettings);
    return conversation;
}
