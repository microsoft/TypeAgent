// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextLocation } from "./dataFormat.js";
import {
    addTextToEmbeddingIndex,
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
        batchSize: number,
        progressCallback?: (batch: string[], batchStartAt: number) => boolean,
    ): Promise<void> {
        await addTextToEmbeddingIndex(
            this.embeddingIndex,
            textAndLocations.map((tl) => tl[0]),
            batchSize,
            progressCallback,
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
}
