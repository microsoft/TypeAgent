// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IMessage, MessageIndex, TextLocation } from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import {
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

export type ScoredTextLocation = {
    score: number;
    textLocation: TextLocation;
};

export interface ITextToTextLocationIndexFuzzy {
    addTextLocation(text: string, textLocation: TextLocation): Promise<void>;
    addTextLocationsBatched(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
    ): Promise<void>;
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
    private embeddingIndex: TextEmbeddingIndex;

    constructor(settings: TextEmbeddingIndexSettings) {
        this.textLocations = [];
        this.embeddingIndex = new TextEmbeddingIndex(settings);
    }

    public async addTextLocation(
        text: string,
        textLocation: TextLocation,
    ): Promise<void> {
        await this.embeddingIndex.addText(text);
        this.textLocations.push(textLocation);
    }

    public async addTextLocationsBatched(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
    ): Promise<void> {
        await this.embeddingIndex.addTextBatch(
            textAndLocations.map((tl) => tl[0]),
            eventHandler,
        );
        this.textLocations.push(...textAndLocations.map((tl) => tl[1]));
    }

    public async lookupText(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]> {
        const matches = await this.embeddingIndex.getIndexesOfNearest(
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
): Promise<void> {
    for (let i = 0; i < messages.length; ++i) {
        const message = messages[i];
        let messageIndex = baseMessageIndex + i;
        let chunkBatch: [string, TextLocation][] = [];
        for (
            let chunkIndex = 0;
            chunkIndex < message.textChunks.length;
            ++chunkIndex
        ) {
            chunkBatch.push([
                message.textChunks[chunkIndex],
                { messageIndex, chunkIndex },
            ]);
        }
        await textLocationIndex.addTextLocationsBatched(
            chunkBatch,
            eventHandler,
        );
    }
}

export async function buildMessageIndex(
    messages: IMessage[],
    settings: TextEmbeddingIndexSettings,
    eventHandler?: IndexingEventHandlers,
) {
    const textLocationIndex = new TextToTextLocationIndexFuzzy(settings);
    await addMessagesToIndex(textLocationIndex, messages, 0, eventHandler);
    return textLocationIndex;
}
