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
import { getMessageBatches } from "./message.js";

export type MessageTextIndexSettings = {
    embeddingIndexSettings: TextEmbeddingIndexSettings;
    batchSize?: number | number;
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
        messages: Iterable<IMessage>,
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult> {
        const baseMessageOrdinal: MessageOrdinal = this.size;
        const allChunks: [string, TextLocation][] = [];
        // Collect everything so we can batch efficiently
        let i = 0;
        for (const message of messages) {
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
            ++i;
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
    batchSize: number = 8,
): Promise<ListIndexingResult> {
    return addToMessageIndex(
        conversation,
        settings,
        0,
        eventHandler,
        batchSize,
    );
}

export async function addToMessageIndex(
    conversation: IConversation,
    settings: MessageTextIndexSettings,
    startAtOrdinal: MessageOrdinal,
    eventHandler?: IndexingEventHandlers,
    batchSize: number = 8,
): Promise<ListIndexingResult> {
    let result: ListIndexingResult = {
        numberCompleted: 0,
    };
    if (conversation.secondaryIndexes) {
        conversation.secondaryIndexes.messageIndex ??= new MessageTextIndex(
            settings,
        );
        const messageIndex = conversation.secondaryIndexes.messageIndex;
        for (const messageBatch of getMessageBatches(
            conversation,
            startAtOrdinal,
            batchSize,
        )) {
            const batchResult = await messageIndex.addMessages(
                messageBatch.value,
                eventHandler,
            );
            result.numberCompleted += batchResult.numberCompleted;
            result.error = batchResult.error;
            if (result.error) {
                break;
            }
        }
    }
    return result;
}

export function isMessageTextEmbeddingIndex(
    messageIndex: IMessageTextIndex,
): messageIndex is IMessageTextEmbeddingIndex {
    const fn = typeof (messageIndex as any).generateEmbedding;
    return fn !== undefined;
}
