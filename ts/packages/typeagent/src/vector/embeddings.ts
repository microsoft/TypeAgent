// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vector from "./vector.js";
import { ScoredItem } from "../memory.js";

export type Embedding = Float32Array;
/**
 * A normalized embedding has unit length.
 * This lets us use Dot Products instead of Cosine Similarity in nearest neighbor searches
 */
export type NormalizedEmbedding = Float32Array;

export enum SimilarityType {
    Cosine, // Note: Use Dot if working with Normalized Embeddings
    Dot,
}

/**
 * Converts the given vector into a NormalizedEmbedding
 * @param src source vector
 * @returns a normalized embedding
 */
export function createNormalized(src: vector.Vector): NormalizedEmbedding {
    const embedding = new Float32Array(src);
    vector.normalizeInPlace(embedding);
    return embedding;
}

/**
 * Returns the similarity between x and y
 * @param x
 * @param y
 * @param type
 * @returns
 */
export function similarity(
    x: Embedding,
    y: Embedding,
    type: SimilarityType,
): number {
    if (type === SimilarityType.Cosine) {
        return vector.cosineSimilarityLoop(x, y, vector.euclideanLength(y));
    }
    return vector.dotProduct(x, y);
}

/**
 * Returns the nearest neighbor to target from the given list of embeddings
 * @param list
 * @param other
 * @param type
 * @returns
 */
export function indexOfNearest(
    list: Embedding[],
    other: Embedding,
    type: SimilarityType,
): ScoredItem {
    let best: ScoredItem = { score: Number.MIN_VALUE, item: -1 };
    if (type === SimilarityType.Dot) {
        for (let i = 0; i < list.length; ++i) {
            const score: number = vector.dotProduct(list[i], other);
            if (score > best.score) {
                best.score = score;
                best.item = i;
            }
        }
    } else {
        const otherLen = vector.euclideanLength(other);
        for (let i = 0; i < list.length; ++i) {
            const score: number = vector.cosineSimilarityLoop(
                list[i],
                other,
                otherLen,
            );
            if (score > best.score) {
                best.score = score;
                best.item = i;
            }
        }
    }
    return best;
}

/**
 * Given a list of embeddings and a test embedding, return at most maxMatches ordinals
 * of the nearest items that meet the provided minScore threshold
 * @param list
 * @param other
 * @param maxMatches
 * @param type Note: Most of our embeddings are *normalized* which will run significantly faster with Dot
 * @returns
 */
export function indexesOfNearest(
    list: Embedding[],
    other: Embedding,
    maxMatches: number,
    type: SimilarityType,
    minScore: number = 0,
): ScoredItem[] {
    const matches = new TopNCollection(maxMatches, -1);
    if (type === SimilarityType.Dot) {
        for (let i = 0; i < list.length; ++i) {
            const score: number = vector.dotProduct(list[i], other);
            if (score >= minScore) {
                matches.push(i, score);
            }
        }
    } else {
        const otherLen = vector.euclideanLength(other);
        for (let i = 0; i < list.length; ++i) {
            const score: number = vector.cosineSimilarityLoop(
                list[i],
                other,
                otherLen,
            );
            if (score >= minScore) {
                matches.push(i, score);
            }
        }
    }
    return matches.byRank();
}

/**
 * Given a list of embeddings and a test embedding, return ordinals
 * of the nearest items that meet the provided minScore threshold
 * @param list
 * @param other
 * @param similarityType
 * @param minScore
 * @returns
 */
export function indexesOfAllNearest(
    list: Embedding[],
    other: Embedding,
    similarityType: SimilarityType,
    minScore?: number,
): ScoredItem[] {
    minScore ??= 0;
    const matches: ScoredItem[] = [];
    for (let i = 0; i < list.length; ++i) {
        const score: number = similarity(list[i], other, similarityType);
        if (score >= minScore) {
            matches.push({ item: i, score });
        }
    }
    matches.sort((x, y) => y.score! - x.score!);
    return matches;
}

export interface TopNList<T> {
    push(item: T, score: number): void;
    byRank(): ScoredItem<T>[];
    valuesByRank(): T[];
    reset(): void;
}

export function createTopNList<T>(maxMatches: number): TopNList<T> {
    const topN = new TopNCollection<T | undefined>(maxMatches, undefined);
    return {
        push: (item: T, score: number) => topN.push(item, score),
        byRank: () => <ScoredItem<T>[]>topN.byRank(),
        reset: () => topN.reset(),
        valuesByRank: () => <T[]>topN.valuesByRank(),
    };
}

export function getTopK<T>(
    items: IterableIterator<ScoredItem<T>>,
    topK: number,
): ScoredItem<T>[] {
    const topNList = new TopNCollection<T | undefined>(topK, undefined);
    for (const scoredItem of items) {
        topNList.push(scoredItem.item, scoredItem.score);
    }
    return <ScoredItem<T>[]>topNList.byRank();
}

/**
 * Uses a minHeap to maintain only the TopN matches - by rank - in memory at any time.
 * Automatically purges matches that no longer meet the bar
 * This allows us to iterate over very large collections without having to retain every score for a final rank sort
 */
export class TopNCollection<T = number> {
    private _items: ScoredItem<T>[];
    private _count: number;
    private _maxCount: number;

    constructor(maxCount: number, nullValue: T) {
        this._items = [];
        this._count = 0;
        this._maxCount = maxCount;
        // The first item is a sentinel, always
        this._items.push({
            score: Number.MIN_VALUE,
            item: nullValue,
        });
    }

    public get length() {
        return this._count;
    }

    public reset(): void {
        this._count = 0;
    }

    // Returns the lowest scoring item in the collection
    public get pop(): ScoredItem<T> {
        return this.removeTop();
    }

    public get top(): ScoredItem<T> {
        return this._items[1];
    }

    public push(item: T, score: number): void {
        if (this._count === this._maxCount) {
            if (score < this.top.score) {
                return;
            }
            const scoredValue = this.removeTop();
            scoredValue.item = item;
            scoredValue.score = score;
            this._count++;
            this._items[this._count] = scoredValue;
        } else {
            this._count++;
            this._items.push({
                item: item,
                score: score,
            });
        }
        this.upHeap(this._count);
    }

    public byRank(): ScoredItem<T>[] {
        this.sortDescending();
        this._items.shift();
        return this._items;
    }

    public valuesByRank(): T[] {
        this.sortDescending();
        this._items.shift();
        return this._items.map((v) => v.item);
    }

    // Heap sort in place
    private sortDescending(): void {
        const count = this._count;
        let i = count;
        while (this._count > 0) {
            // this de-queues the item with the current LOWEST relevancy
            // We take that and place it at the 'back' of the array - thus inverting it
            const item = this.removeTop();
            this._items[i--] = item;
        }
        this._count = count;
    }

    private removeTop(): ScoredItem<T> {
        if (this._count === 0) {
            throw new Error("Empty queue");
        }
        // At the top
        const item = this._items[1];
        this._items[1] = this._items[this._count];
        this._count--;
        this.downHeap(1);
        return item;
    }

    private upHeap(startAt: number): void {
        let i = startAt;
        const item = this._items[i];
        let parent = i >> 1;
        // As long as child has a lower score than the parent, keep moving the child up
        while (parent > 0 && this._items[parent].score > item.score) {
            this._items[i] = this._items[parent];
            i = parent;
            parent = i >> 1;
        }
        // Found our slot
        this._items[i] = item;
    }

    private downHeap(startAt: number): void {
        let i: number = startAt;
        const maxParent = this._count >> 1;
        const item = this._items[i];
        while (i <= maxParent) {
            let iChild = i + i;
            let childScore = this._items[iChild].score;
            // Exchange the item with the smaller of its two children - if one is smaller, i.e.
            // First, find the smaller child
            if (
                iChild < this._count &&
                childScore > this._items[iChild + 1].score
            ) {
                iChild++;
                childScore = this._items[iChild].score;
            }
            if (item.score <= childScore) {
                // Heap condition is satisfied. Parent <= both its children
                break;
            }
            // Else, swap parent with the smallest child
            this._items[i] = this._items[iChild];
            i = iChild;
        }
        this._items[i] = item;
    }
}
