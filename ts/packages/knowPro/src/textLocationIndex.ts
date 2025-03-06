// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ArrayIndexingResult,
    IMessage,
    MessageIndex,
    TextLocation,
} from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import {
    addTextBatchToEmbeddingIndex,
    addTextToEmbeddingIndex,
    EmbeddingIndex,
    indexOfNearestTextInIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

export type ScoredTextLocation = {
    score: number;
    textLocation: TextLocation;
};

export interface ITextToTextLocationIndexFuzzy {
    addTextLocation(
        text: string,
        textLocation: TextLocation,
    ): Promise<ArrayIndexingResult>;
    addTextLocationsBatched(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ArrayIndexingResult>;
    lookupText(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]>;

    serialize(): ITextToTextLocationIndexData;
    deserialize(data: ITextToTextLocationIndexData): void;
}

export interface ITextToTextLocationIndexData {
    textLocations: TextLocation[];
    embeddings: Float32Array[];
}

export class TextToTextLocationIndexFuzzy
    implements ITextToTextLocationIndexFuzzy
{
    private textLocations: TextLocation[];
    private embeddingIndex: EmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.textLocations = [];
        this.embeddingIndex = new EmbeddingIndex();
    }

    public async addTextLocation(
        text: string,
        textLocation: TextLocation,
    ): Promise<ArrayIndexingResult> {
        const result = await addTextToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            [text],
        );
        if (result.numberCompleted > 0) {
            this.textLocations.push(textLocation);
        }
        return result;
    }

    public async addTextLocationsBatched(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
        batchSize?: number,
    ): Promise<ArrayIndexingResult> {
        const result = await addTextBatchToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            textAndLocations.map((tl) => tl[0]),
            batchSize ?? this.settings.batchSize,
            eventHandler,
        );
        if (result.numberCompleted > 0) {
            textAndLocations =
                result.numberCompleted === textAndLocations.length
                    ? textAndLocations
                    : textAndLocations.slice(0, result.numberCompleted);
            this.textLocations.push(...textAndLocations.map((tl) => tl[1]));
        }
        return result;
    }

    public async lookupText(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]> {
        const matches = await indexOfNearestTextInIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            text,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return {
                textLocation: this.textLocations[m.item],
                score: m.score,
            };
        });
    }

    public serialize(): ITextToTextLocationIndexData {
        return {
            textLocations: this.textLocations,
            embeddings: this.embeddingIndex.serialize(),
        };
    }

    public deserialize(data: ITextToTextLocationIndexData): void {
        if (data.textLocations.length !== data.embeddings.length) {
            throw new Error(
                `TextToTextLocationIndexData corrupt. textLocation.length ${data.textLocations.length} != ${data.embeddings.length}`,
            );
        }
        this.textLocations = data.textLocations;
        this.embeddingIndex.deserialize(data.embeddings);
    }
}

export async function addMessagesToIndex(
    textLocationIndex: TextToTextLocationIndexFuzzy,
    messages: IMessage[],
    baseMessageIndex: MessageIndex,
    eventHandler?: IndexingEventHandlers,
    batchSize?: number,
): Promise<void> {
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
    // Todo: return an IndexingResult
    await textLocationIndex.addTextLocationsBatched(
        allChunks,
        eventHandler,
        batchSize,
    );
}

export async function buildMessageIndex(
    messages: IMessage[],
    settings: TextEmbeddingIndexSettings,
    eventHandler?: IndexingEventHandlers,
    batchSize?: number,
) {
    const textLocationIndex = new TextToTextLocationIndexFuzzy(settings);
    await addMessagesToIndex(
        textLocationIndex,
        messages,
        0,
        eventHandler,
        batchSize,
    );
    return textLocationIndex;
}
