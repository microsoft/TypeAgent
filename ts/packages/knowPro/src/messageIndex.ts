// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { generateEmbeddingWithRetry, NormalizedEmbedding } from "typeagent";
import { MessageAccumulator } from "./collections.js";
import { TextEmbeddingIndexSettings } from "./fuzzyIndex.js";
import {
    IMessage,
    MessageOrdinal,
    IndexingEventHandlers,
    TextLocation,
    ListIndexingResult,
    ScoredMessageOrdinal,
    IConversation,
    IMessageTextIndex,
} from "./interfaces.js";
import {
    ITextToTextLocationIndexData,
    ScoredTextLocation,
    TextToTextLocationIndex,
} from "./textLocationIndex.js";

export type MessageTextIndexSettings = {
    embeddingIndexSettings: TextEmbeddingIndexSettings;
};

export interface IMessageTextIndexData {
    indexData?: ITextToTextLocationIndexData | undefined;
}

export interface IMessageTextEmbeddingIndex extends IMessageTextIndex {
    generateEmbedding(text: string): Promise<NormalizedEmbedding>;
    lookupInSubsetByEmbedding(
        textEmbedding: NormalizedEmbedding,
        ordinalsToSearch: MessageOrdinal[],
        maxMatches?: number,
        thresholdScore?: number,
    ): ScoredMessageOrdinal[];
}

export class MessageTextIndex implements IMessageTextEmbeddingIndex {
    public textLocationIndex: TextToTextLocationIndex;

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
        const baseMessageOrdinal: MessageOrdinal = this.size;
        const allChunks: [string, TextLocation][] = [];
        // Collect everything so we can batch efficiently
        for (let i = 0; i < messages.length; ++i) {
            const message = messages[i];
            let messageOrdinal = baseMessageOrdinal + i;
            for (
                let chunkOrdinal = 0;
                chunkOrdinal < message.textChunks.length;
                ++chunkOrdinal
            ) {
                allChunks.push([
                    message.textChunks[chunkOrdinal],
                    { messageOrdinal, chunkOrdinal },
                ]);
            }
        }
        return this.textLocationIndex.addTextLocations(allChunks, eventHandler);
    }

    public async lookupMessages(
        messageText: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageOrdinal[]> {
        maxMatches ??= this.settings.embeddingIndexSettings.maxMatches;
        thresholdScore ??= this.settings.embeddingIndexSettings.minScore;
        const scoredTextLocations = await this.textLocationIndex.lookupText(
            messageText,
            maxMatches,
            thresholdScore,
        );
        return this.toScoredMessageOrdinals(scoredTextLocations);
    }

    public async lookupMessagesInSubset(
        messageText: string,
        ordinalsToSearch: MessageOrdinal[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageOrdinal[]> {
        const scoredTextLocations =
            await this.textLocationIndex.lookupTextInSubset(
                messageText,
                ordinalsToSearch,
                maxMatches,
                thresholdScore,
            );
        return this.toScoredMessageOrdinals(scoredTextLocations);
    }

    public generateEmbedding(text: string): Promise<NormalizedEmbedding> {
        // Note: if you rename generateEmbedding, be sure to also fix isMessageTextEmbeddingIndex
        return generateEmbeddingWithRetry(
            this.settings.embeddingIndexSettings.embeddingModel,
            text,
        );
    }

    public lookupInSubsetByEmbedding(
        textEmbedding: NormalizedEmbedding,
        ordinalsToSearch: MessageOrdinal[],
        maxMatches?: number,
        thresholdScore?: number,
    ): ScoredMessageOrdinal[] {
        const scoredTextLocations =
            this.textLocationIndex.lookupInSubsetByEmbedding(
                textEmbedding,
                ordinalsToSearch,
                maxMatches,
                thresholdScore,
            );
        return this.toScoredMessageOrdinals(scoredTextLocations);
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

    // Since a message has multiple chunks, each of which is indexed individually, we can end up
    // with a message matching multiple times. The message accumulator dedupes those and also
    // supports smoothing the scores if needed
    private toScoredMessageOrdinals(
        scoredLocations: ScoredTextLocation[],
    ): ScoredMessageOrdinal[] {
        const messageMatches = new MessageAccumulator();
        messageMatches.addMessagesFromLocations(scoredLocations);
        return messageMatches.toScoredMessageOrdinals();
    }
}

export async function buildMessageIndex(
    conversation: IConversation,
    settings: MessageTextIndexSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<ListIndexingResult> {
    return addToMessageIndex(conversation, settings, 0, eventHandler);
}

export async function addToMessageIndex(
    conversation: IConversation,
    settings: MessageTextIndexSettings,
    startAtOrdinal: MessageOrdinal,
    eventHandler?: IndexingEventHandlers,
): Promise<ListIndexingResult> {
    if (conversation.secondaryIndexes) {
        conversation.secondaryIndexes.messageIndex ??= new MessageTextIndex(
            settings,
        );
        const messageIndex = conversation.secondaryIndexes.messageIndex;
        const messages =
            startAtOrdinal > 0
                ? conversation.messages.getSlice(
                      startAtOrdinal,
                      conversation.messages.length,
                  )
                : conversation.messages;
        if (messages.length > 0) {
            return messageIndex.addMessages(messages, eventHandler);
        }
    }
    return {
        numberCompleted: 0,
    };
}

export function isMessageTextEmbeddingIndex(
    messageIndex: IMessageTextIndex,
): messageIndex is IMessageTextEmbeddingIndex {
    const fn = typeof (messageIndex as any).generateEmbedding;
    return fn !== undefined;
}
