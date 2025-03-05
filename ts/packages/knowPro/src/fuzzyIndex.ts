// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    NormalizedEmbedding,
    generateTextEmbeddingsWithRetry,
    generateEmbedding,
    generateTextEmbeddings,
    indexesOfNearest,
    SimilarityType,
    indexesOfAllNearest,
    createTopNList,
} from "typeagent";
import { openai, TextEmbeddingModel } from "aiclient";
import * as levenshtein from "fast-levenshtein";
import { createEmbeddingCache } from "knowledge-processor";
import { Scored } from "./common.js";
import { IndexingEventHandlers } from "./interfaces.js";

export class TextEmbeddingIndex {
    private embeddings: NormalizedEmbedding[];

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.embeddings = [];
    }

    public get size(): number {
        return this.embeddings.length;
    }

    public async addText(texts: string | string[]): Promise<void> {
        if (Array.isArray(texts)) {
            const embeddings = await generateTextEmbeddingsWithRetry(
                this.settings.embeddingModel,
                texts,
            );
            this.embeddings.push(...embeddings);
        } else {
            const embedding = await generateEmbedding(
                this.settings.embeddingModel,
                texts,
            );
            this.embeddings.push(embedding);
        }
    }

    public async addTextBatch(
        textToIndex: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<void> {
        for (const batch of getIndexingBatches(
            textToIndex,
            this.settings.batchSize,
        )) {
            if (
                eventHandler?.onEmbeddingsCreated &&
                !eventHandler.onEmbeddingsCreated(
                    textToIndex,
                    batch.values,
                    batch.startAt,
                )
            ) {
                break;
            }
            await this.addText(batch.values);
        }
    }

    public get(pos: number): NormalizedEmbedding {
        return this.embeddings[pos];
    }

    public add(embedding: NormalizedEmbedding): void {
        this.embeddings.push(embedding);
    }

    public async getIndexesOfNearest(
        text: string | NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Scored[]> {
        const textEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            text,
        );
        return this.indexesOfNearestText(textEmbedding, maxMatches, minScore);
    }

    public async getIndexesOfNearestMultiple(
        textArray: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<Scored[][]> {
        const textEmbeddings = await generateTextEmbeddings(
            this.settings.embeddingModel,
            textArray,
        );
        const results = [];
        for (const embedding of textEmbeddings) {
            results.push(
                await this.getIndexesOfNearest(embedding, maxMatches, minScore),
            );
        }
        return results;
    }

    public removeAt(pos: number): void {
        this.embeddings.splice(pos, 1);
    }

    public clear(): void {
        this.embeddings = [];
    }

    public serialize(): Float32Array[] {
        return this.embeddings;
    }

    public deserialize(embeddings: Float32Array[]): void {
        this.embeddings = embeddings;
    }

    private indexesOfNearestText(
        textEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Scored[] {
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        let matches: Scored[];
        if (maxMatches && maxMatches > 0) {
            matches = indexesOfNearest(
                this.embeddings,
                textEmbedding,
                maxMatches,
                SimilarityType.Dot,
                minScore,
            );
        } else {
            matches = indexesOfAllNearest(
                this.embeddings,
                textEmbedding,
                SimilarityType.Dot,
                minScore,
            );
        }
        return matches;
    }
}

export function serializeEmbedding(embedding: NormalizedEmbedding): number[] {
    return Array.from<number>(embedding);
}

export function deserializeEmbedding(array: number[]): NormalizedEmbedding {
    return new Float32Array(array);
}

export type TextEmbeddingIndexSettings = {
    embeddingModel: TextEmbeddingModel;
    embeddingSize: number;
    minScore: number;
    maxMatches?: number | undefined;
    retryMaxAttempts?: number;
    retryPauseMs?: number;
    batchSize: number;
};

export function createTextEmbeddingIndexSettings(
    minScore = 0.85,
): TextEmbeddingIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        embeddingSize: 1536,
        minScore,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
        batchSize: 8,
    };
}

export class TextEditDistanceIndex {
    constructor(public textArray: string[] = []) {}

    public getNearest(
        text: string,
        maxMatches?: number,
        maxEditDistance?: number,
    ): Promise<Scored<string>[]> {
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
    ): Promise<Scored<string>[][]> {
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
): Scored<string>[] {
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
        const matches: Scored<string>[] = [];
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

type TextIndexingBatch = {
    startAt: number;
    values: string[];
};

function* getIndexingBatches(
    array: string[],
    size: number,
): IterableIterator<TextIndexingBatch> {
    for (let i = 0; i < array.length; i += size) {
        const batch = array.slice(i, i + size);
        if (batch.length === 0) {
            break;
        }
        yield { startAt: i, values: batch };
    }
}

export function serializeEmbeddings(embeddings: NormalizedEmbedding[]): Buffer {
    const buffers = embeddings.map((e) => Buffer.from(e.buffer));
    return Buffer.concat(buffers);
}

export function deserializeEmbeddings(
    buffer: Buffer,
    embeddingSize: number,
): NormalizedEmbedding[] {
    const embeddings: NormalizedEmbedding[] = [];
    const embeddingByteCount = Float32Array.BYTES_PER_ELEMENT * embeddingSize;
    for (
        let startAt = 0;
        startAt < buffer.length;
        startAt += embeddingByteCount
    ) {
        const sliceStartAt = buffer.byteOffset + startAt;
        const embedding = new Float32Array(
            buffer.buffer.slice(
                sliceStartAt,
                sliceStartAt + embeddingByteCount,
            ),
        );
        embeddings.push(embedding);
    }
    return embeddings;
}
