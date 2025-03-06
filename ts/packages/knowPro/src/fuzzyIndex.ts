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
import { ArrayIndexingResult, IndexingEventHandlers } from "./interfaces.js";
import { error, Result, success } from "typechat";

export class EmbeddingIndex {
    private embeddings: NormalizedEmbedding[];

    constructor(embeddings?: NormalizedEmbedding[]) {
        this.embeddings = embeddings ?? [];
    }

    public get size(): number {
        return this.embeddings.length;
    }

    public push(embeddings: NormalizedEmbedding | NormalizedEmbedding[]): void {
        if (Array.isArray(embeddings)) {
            this.embeddings.push(...embeddings);
        } else {
            this.embeddings.push(embeddings);
        }
    }

    public insertAt(
        index: number,
        embeddings: NormalizedEmbedding | NormalizedEmbedding[],
    ): void {
        if (Array.isArray(embeddings)) {
            this.embeddings.splice(index, 0, ...embeddings);
        } else {
            this.embeddings.splice(index, 0, embeddings);
        }
    }

    public get(pos: number): NormalizedEmbedding {
        return this.embeddings[pos];
    }

    public getIndexesOfNearest(
        embedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Scored[] {
        return this.indexesOfNearest(embedding, maxMatches, minScore);
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

    private indexesOfNearest(
        embedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Scored[] {
        let matches: Scored[];
        if (maxMatches && maxMatches > 0) {
            matches = indexesOfNearest(
                this.embeddings,
                embedding,
                maxMatches,
                SimilarityType.Dot,
                minScore,
            );
        } else {
            matches = indexesOfAllNearest(
                this.embeddings,
                embedding,
                SimilarityType.Dot,
                minScore,
            );
        }
        return matches;
    }
}

export async function generateTextEmbeddingsForIndex(
    embeddingModel: TextEmbeddingModel,
    texts: string | string[],
): Promise<Result<NormalizedEmbedding[]>> {
    try {
        let embeddings: NormalizedEmbedding[];
        const textsToEmbed = Array.isArray(texts) ? texts : [texts];
        embeddings = await generateTextEmbeddingsWithRetry(
            embeddingModel,
            textsToEmbed,
        );
        return success(embeddings);
    } catch (ex) {
        return error(`generateTExtEmbeddingsForIndex failed: ${ex}`);
    }
}

export async function addTextToEmbeddingIndex(
    embeddingIndex: EmbeddingIndex,
    embeddingModel: TextEmbeddingModel,
    textToIndex: string[],
): Promise<ArrayIndexingResult> {
    let result: ArrayIndexingResult = { numberCompleted: 0 };
    const embeddingResult = await generateTextEmbeddingsForIndex(
        embeddingModel,
        textToIndex,
    );
    if (embeddingResult.success) {
        embeddingIndex.push(embeddingResult.data);
        result.numberCompleted = textToIndex.length;
    } else {
        result.error = embeddingResult.message;
    }
    return result;
}

export async function addTextBatchToEmbeddingIndex(
    embeddingIndex: EmbeddingIndex,
    embeddingModel: TextEmbeddingModel,
    textToIndex: string[],
    batchSize: number,
    eventHandler?: IndexingEventHandlers,
): Promise<ArrayIndexingResult> {
    let result: ArrayIndexingResult = { numberCompleted: 0 };
    for (const batch of getIndexingBatches(textToIndex, batchSize)) {
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
        const batchResult = await generateTextEmbeddingsForIndex(
            embeddingModel,
            batch.values,
        );
        if (!batchResult.success) {
            result.error = batchResult.message;
            break;
        }
        embeddingIndex.push(batchResult.data);
        result.numberCompleted = batch.startAt + batch.values.length;
    }
    return result;
}

export async function indexOfNearestTextInIndex(
    embeddingIndex: EmbeddingIndex,
    embeddingModel: TextEmbeddingModel,
    text: string,
    maxMatches?: number,
    minScore?: number,
): Promise<Scored[]> {
    const textEmbedding = await generateEmbedding(embeddingModel, text);
    return embeddingIndex.getIndexesOfNearest(
        textEmbedding,
        maxMatches,
        minScore,
    );
}

export async function indexesOfNearestTextBatchInIndex(
    embeddingIndex: EmbeddingIndex,
    embeddingModel: TextEmbeddingModel,
    textArray: string[],
    maxMatches?: number,
    minScore?: number,
): Promise<Scored[][]> {
    const textEmbeddings = await generateTextEmbeddings(
        embeddingModel,
        textArray,
    );
    const results = [];
    for (const embedding of textEmbeddings) {
        results.push(
            embeddingIndex.getIndexesOfNearest(embedding, maxMatches, minScore),
        );
    }
    return results;
}

export class TextEmbeddingIndex {
    private embeddingIndex: EmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.embeddingIndex = new EmbeddingIndex();
    }

    public get size(): number {
        return this.embeddingIndex.size;
    }

    /**
     * Convert text into embeddings and add them to the internal index.
     * This can throw
     * @param textToIndex
     */
    public async addText(
        textToIndex: string | string[],
    ): Promise<ArrayIndexingResult> {
        return addTextToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            Array.isArray(textToIndex) ? textToIndex : [textToIndex],
        );
    }

    /**
     * Add text to the index in batches
     * @param textToIndex
     * @param eventHandler
     * @param batchSize
     * @returns Returns the index of the last item in textToIndex which was successfully completed
     */
    public async addTextBatch(
        textToIndex: string[],
        eventHandler?: IndexingEventHandlers,
        batchSize?: number,
    ): Promise<ArrayIndexingResult> {
        return addTextBatchToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            textToIndex,
            batchSize ?? this.settings.batchSize,
            eventHandler,
        );
    }

    public get(pos: number): NormalizedEmbedding {
        return this.embeddingIndex.get(pos);
    }

    public async getIndexesOfNearest(
        text: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Scored[]> {
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        return indexOfNearestTextInIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            text,
            maxMatches,
            minScore,
        );
    }

    public async getIndexesOfNearestMultiple(
        textBatch: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<Scored[][]> {
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        return indexesOfNearestTextBatchInIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            textBatch,
            maxMatches,
            minScore,
        );
    }

    public removeAt(pos: number): void {
        this.embeddingIndex.removeAt(pos);
    }

    public clear(): void {
        this.embeddingIndex.clear();
    }

    public serialize(): Float32Array[] {
        return this.embeddingIndex.serialize();
    }

    public deserialize(embeddings: Float32Array[]): void {
        this.embeddingIndex.deserialize(embeddings);
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
