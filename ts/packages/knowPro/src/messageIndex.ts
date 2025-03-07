// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { TextEmbeddingIndexSettings } from "./fuzzyIndex.js";
import {
    IMessage,
    MessageIndex,
    IndexingEventHandlers,
    TextLocation,
    ListIndexingResult,
    ScoredMessageIndex,
    IConversation,
    IMessageTextIndex,
} from "./interfaces.js";
import {
    ITextToTextLocationIndexData,
    TextToTextLocationIndex,
} from "./textLocationIndex.js";

export type MessageTextIndexSettings = {
    embeddingIndexSettings: TextEmbeddingIndexSettings;
};

export interface IMessageTextIndexData {
    indexData?: ITextToTextLocationIndexData | undefined;
}

export class MessageTextIndex implements IMessageTextIndex {
    private textLocationIndex: TextToTextLocationIndex;

    constructor(public settings: MessageTextIndexSettings) {
        this.textLocationIndex = new TextToTextLocationIndex(
            settings.embeddingIndexSettings,
        );
    }

    public get size(): number {
        return this.textLocationIndex.size;
    }

    public addMessages(
        messages: IMessage[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult> {
        const baseMessageIndex: MessageIndex = this.size;
        const allChunks: [string, TextLocation][] = [];
        // Collect everything so we can batch efficiently
        for (let i = 0; i < messages.length; ++i) {
            const message = messages[i];
            let messageIndex = baseMessageIndex + i;
            for (
                let chunkIndex = 0;
                chunkIndex < message.textChunks.length;
                ++chunkIndex
            ) {
                allChunks.push([
                    message.textChunks[chunkIndex],
                    { messageIndex, chunkIndex },
                ]);
            }
        }
        return this.textLocationIndex.addTextLocations(allChunks, eventHandler);
    }

    public async lookupMessages(
        messageText: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageIndex[]> {
        const scoredLocations = await this.textLocationIndex.lookupText(
            messageText,
            maxMatches,
            thresholdScore,
        );
        return scoredLocations.map((sl) => {
            return {
                messageIndex: sl.textLocation.messageIndex,
                score: sl.score,
            };
        });
    }

    public async lookupMessagesInSubset(
        messageText: string,
        indicesToSearch: MessageIndex[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageIndex[]> {
        const scoredLocations = await this.textLocationIndex.lookupTextInSubset(
            messageText,
            indicesToSearch,
            maxMatches,
            thresholdScore,
        );
        return scoredLocations.map((sl) => {
            return {
                messageIndex: sl.textLocation.messageIndex,
                score: sl.score,
            };
        });
    }

    public serialize(): IMessageTextIndexData {
        return {
            indexData: this.textLocationIndex.serialize(),
        };
    }

    public deserialize(data: IMessageTextIndexData): void {
        if (data.indexData) {
            this.textLocationIndex.clear();
            this.textLocationIndex.deserialize(data.indexData);
        }
    }
}

export async function buildMessageIndex(
    conversation: IConversation,
    settings: MessageTextIndexSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<ListIndexingResult> {
    if (conversation.secondaryIndexes) {
        conversation.secondaryIndexes.messageIndex ??= new MessageTextIndex(
            settings,
        );
        const messageIndex = conversation.secondaryIndexes.messageIndex;
        const messages = conversation.messages;
        return messageIndex.addMessages(messages, eventHandler);
    }
    return {
        numberCompleted: 0,
    };
}
