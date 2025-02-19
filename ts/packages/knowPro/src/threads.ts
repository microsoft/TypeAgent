// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRange } from "./dataFormat.js";
import {
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

/**
 * A Thread is a set of text ranges in a conversation
 */
export type Thread = {
    description: string;
    ranges: TextRange[];
};

export type ThreadIndex = number;

export type ScoredThreadIndex = {
    threadIndex: ThreadIndex;
    score: number;
};

export interface ITextToThreadIndexFuzzy {
    lookupThread(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[]>;
}

export class TextToThreadIndexFuzzy implements ITextToThreadIndexFuzzy {
    private embeddingIndex: TextEmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.embeddingIndex = new TextEmbeddingIndex(settings);
    }

    public async lookupThread(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[]> {
        const matches = await this.embeddingIndex.getIndexesOfNearest(
            text,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return { threadIndex: m.item, score: m.score };
        });
    }
}
