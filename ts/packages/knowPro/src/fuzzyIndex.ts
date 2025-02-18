// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    NormalizedEmbedding,
    generateTextEmbeddingsWithRetry,
    generateEmbedding,
    ScoredItem,
    generateTextEmbeddings,
    indexesOfNearest,
    SimilarityType,
    indexesOfAllNearest,
    createTopNList,
} from "typeagent";
import {
    ITextEmbeddingIndexData,
    ITextEmbeddingDataItem,
} from "./secondaryIndexes.js";
import { openai, TextEmbeddingModel } from "aiclient";
import * as levenshtein from "fast-levenshtein";
import { createEmbeddingCache } from "knowledge-processor";

export class TextEmbeddingIndex {
    // Store two separate but equal sized arrays.
    // A array of text and an equivalent array of embeddings
    public textArray: string[];
    public embeddingArray: NormalizedEmbedding[];

    constructor(
        public settings: TextEmbeddingIndexSettings,
        data?: ITextEmbeddingIndexData,
    ) {
        this.textArray = [];
        this.embeddingArray = [];
        if (data !== undefined) {
            this.deserialize(data);
        }
    }

    public async add(texts: string | string[]): Promise<void> {
        if (Array.isArray(texts)) {
            const embeddings = await generateTextEmbeddingsWithRetry(
                this.settings.embeddingModel,
                texts,
            );
            for (let i = 0; i < texts.length; ++i) {
                this.addTextEmbedding(texts[i], embeddings[i]);
            }
        } else {
            const embedding = await generateEmbedding(
                this.settings.embeddingModel,
                texts,
            );
            this.addTextEmbedding(texts, embedding);
        }
    }

    public async getNearest(
        text: string | NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Promise<ScoredItem[]> {
        const textEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            text,
        );
        return this.indexesOfNearestText(textEmbedding, maxMatches, minScore);
    }

    public async getNearestMultiple(
        textArray: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<ScoredItem[][]> {
        const textEmbeddings = await generateTextEmbeddings(
            this.settings.embeddingModel,
            textArray,
        );
        const results = [];
        for (const embedding of textEmbeddings) {
            results.push(
                await this.getNearest(embedding, maxMatches, minScore),
            );
        }
        return results;
    }

    public async lookupEmbeddings(
        text: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<[string, NormalizedEmbedding][] | undefined> {
        const textEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            text,
        );
        let matches = this.indexesOfNearestText(
            textEmbedding,
            maxMatches,
            minScore,
        );
        return matches.map((m) => {
            return [this.textArray[m.item], this.embeddingArray[m.item]];
        });
    }

    public remove(text: string): boolean {
        const indexOf = this.textArray.indexOf(text);
        if (indexOf >= 0) {
            this.textArray.splice(indexOf, 1);
            this.embeddingArray.splice(indexOf, 1);
            return true;
        }
        return false;
    }

    public deserialize(data: ITextEmbeddingIndexData): void {
        if (data.embeddingData !== undefined) {
            for (const item of data.embeddingData) {
                this.addTextEmbedding(
                    item.text,
                    new Float32Array(item.embedding),
                );
            }
        }
    }

    public serialize(): ITextEmbeddingIndexData {
        const embeddingData: ITextEmbeddingDataItem[] = [];
        for (let i = 0; i < this.textArray.length; ++i) {
            embeddingData.push({
                text: this.textArray[i],
                embedding: Array.from<number>(this.embeddingArray[i]),
            });
        }
        return {
            embeddingData,
        };
    }

    private addTextEmbedding(text: string, embedding: NormalizedEmbedding) {
        this.textArray.push(text);
        this.embeddingArray.push(embedding);
    }

    private indexesOfNearestText(
        textEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): ScoredItem[] {
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        let matches: ScoredItem[];
        if (maxMatches && maxMatches > 0) {
            matches = indexesOfNearest(
                this.embeddingArray,
                textEmbedding,
                maxMatches,
                SimilarityType.Dot,
                minScore,
            );
        } else {
            matches = indexesOfAllNearest(
                this.embeddingArray,
                textEmbedding,
                SimilarityType.Dot,
                minScore,
            );
        }
        return matches;
    }
}
export type TextEmbeddingIndexSettings = {
    embeddingModel: TextEmbeddingModel;
    minScore: number;
    maxMatches?: number | undefined;
    retryMaxAttempts?: number;
    retryPauseMs?: number;
};

export function createTextEmbeddingIndexSettings(
    maxMatches = 100,
    minScore = 0.85,
): TextEmbeddingIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        minScore,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
    };
}

export class TextEditDistanceIndex {
    constructor(public textArray: string[]) {}

    public getNearest(
        text: string,
        maxMatches?: number,
        maxEditDistance?: number,
    ): Promise<ScoredItem<string>[]> {
        const matches = nearestNeighborEditDistance(
            this.textArray,
            text,
            maxMatches,
            maxEditDistance,
        );
        return Promise.resolve(matches);
    }

    public getNearestMultiple(
        textArray: string[],
        maxMatches?: number,
        maxEditDistance?: number,
    ): Promise<ScoredItem<string>[][]> {
        const matches = textArray.map((text) =>
            nearestNeighborEditDistance(
                this.textArray,
                text,
                maxMatches,
                maxEditDistance,
            ),
        );
        return Promise.resolve(matches);
    }
}

export function nearestNeighborEditDistance(
    textList: string[] | IterableIterator<string>,
    other: string,
    maxMatches?: number,
    maxEditDistance?: number,
): ScoredItem<string>[] {
    maxEditDistance ??= 0;
    if (maxMatches !== undefined && maxMatches > 0) {
        const matches = createTopNList<string>(maxMatches);
        for (const text of textList) {
            const distance: number = levenshtein.get(text, other);
            // We want to return those with an edit distance < than the min
            if (distance <= maxEditDistance) {
                matches.push(text, distance);
            }
        }
        return matches.byRank();
    } else {
        const matches: ScoredItem<string>[] = [];
        for (const text of textList) {
            const distance: number = levenshtein.get(text, other);
            if (distance <= maxEditDistance) {
                matches.push({ item: text, score: distance });
            }
        }
        matches.sort((x, y) => y.score! - x.score!);
        return matches;
    }
}
