// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    generateEmbeddingWithRetry,
    NormalizedEmbedding,
} from "@typeagent/agent-runtime";
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
    readonly size: number;
    readonly isEmbeddingEnabled?: boolean;
    generateEmbedding(text: string): Promise<NormalizedEmbedding>;
    lookupByEmbedding(
        textEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        thresholdScore?: number,
        predicate?: (messageOrdinal: MessageOrdinal) => boolean,
    ): ScoredMessageOrdinal[];
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

    /**
     * Number of messages in the index. A message can have several text
     * chunks, and each chunk is one entry in textLocationIndex.
     */
    public get size(): number {
        const chunkCount = this.textLocationIndex.size;
        return chunkCount > 0
            ? this.textLocationIndex.get(chunkCount - 1).messageOrdinal + 1
            : 0;
    }

    /**
     * True only when an embedding model is available. When false, message
     * semantic search is disabled and callers fall back to non-embedding
     * ranking (see isMessageTextEmbeddingIndex and search.ts).
     */
    public get isEmbeddingEnabled(): boolean {
        return (
            this.settings.embeddingIndexSettings.embeddingModel !== undefined
        );
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
            const messageOrdinal = baseMessageOrdinal + i;
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
                this.getChunkPositions(ordinalsToSearch),
                undefined,
                thresholdScore,
            );
        return this.toScoredMessageOrdinals(scoredTextLocations, maxMatches);
    }

    public generateEmbedding(text: string): Promise<NormalizedEmbedding> {
        // Note: if you rename generateEmbedding, be sure to also fix isMessageTextEmbeddingIndex
        const embeddingModel =
            this.settings.embeddingIndexSettings.embeddingModel;
        if (embeddingModel === undefined) {
            throw new Error(
                "Message text embedding index is disabled (no embedding model configured)",
            );
        }
        return generateEmbeddingWithRetry(embeddingModel, text);
    }

    public lookupByEmbedding(
        textEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        thresholdScore?: number,
        predicate?: (messageOrdinal: MessageOrdinal) => boolean,
    ): ScoredMessageOrdinal[] {
        // The text location index passes chunk positions to its predicate
        const chunkPredicate = predicate
            ? (chunkPos: number) =>
                  predicate(this.textLocationIndex.get(chunkPos).messageOrdinal)
            : undefined;
        const scoredTextLocations = this.textLocationIndex.lookupByEmbedding(
            textEmbedding,
            maxMatches,
            thresholdScore,
            chunkPredicate,
        );
        return this.toScoredMessageOrdinals(scoredTextLocations);
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
                this.getChunkPositions(ordinalsToSearch),
                undefined,
                thresholdScore,
            );
        return this.toScoredMessageOrdinals(scoredTextLocations, maxMatches);
    }

    // Subset lookups take message ordinals, but the embedding index is
    // addressed by chunk position. Return every chunk position of those messages.
    private getChunkPositions(messageOrdinals: MessageOrdinal[]): number[] {
        const wanted = new Set(messageOrdinals);
        const positions: number[] = [];
        for (let pos = 0; pos < this.textLocationIndex.size; ++pos) {
            if (wanted.has(this.textLocationIndex.get(pos).messageOrdinal)) {
                positions.push(pos);
            }
        }
        return positions;
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
    // Subset lookups rank every chunk and apply maxMatches here, per message,
    // so several chunks of one message cannot use up maxMatches.
    private toScoredMessageOrdinals(
        scoredLocations: ScoredTextLocation[],
        maxMatches?: number,
    ): ScoredMessageOrdinal[] {
        const messageMatches = new MessageAccumulator();
        messageMatches.addMessagesFromLocations(scoredLocations);
        const scored = messageMatches.toScoredMessageOrdinals();
        return maxMatches ? scored.slice(0, maxMatches) : scored;
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
    const result: ListIndexingResult = {
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
    const textIndex: IMessageTextEmbeddingIndex =
        messageIndex as IMessageTextEmbeddingIndex;
    return (
        textIndex.generateEmbedding !== undefined &&
        textIndex.lookupByEmbedding !== undefined &&
        textIndex.lookupInSubsetByEmbedding !== undefined &&
        (textIndex.isEmbeddingEnabled ?? true)
    );
}
