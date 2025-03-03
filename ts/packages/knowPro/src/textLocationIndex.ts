// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextLocation } from "./interfaces.js";
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
