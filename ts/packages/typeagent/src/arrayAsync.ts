// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Slice, slices } from "./lib";

export type ProcessAsync<T, TResult> = (
    item: T,
    index: number,
) => Promise<TResult>;

export type ProcessProgress<T, TResult> = (
    item: T,
    index: number,
    result: TResult,
) => void | boolean;

/**
 * Any async version of map that supports concurrency
 * @param array chunks to process
 * @param concurrency how many to run in parallel
 * @param processor function to process chunks
 * @returns
 */
export async function mapAsync<T, TResult>(
    array: T[],
    concurrency: number,
    processor: ProcessAsync<T, TResult>,
    progress?: ProcessProgress<T, TResult>,
): Promise<TResult[]> {
    if (concurrency <= 1) {
        return sequential();
    }
    return concurrent();

    async function sequential() {
        const results: TResult[] = [];
        for (let i = 0; i < array.length; i++) {
            const result = await processor(array[i], i);
            results.push(result);
            if (progress) {
                const progressResult = progress(array[i], i, result);
                if (shouldStop(progressResult)) {
                    break;
                }
            }
        }
        return results;
    }

    async function concurrent() {
        const results: TResult[] = [];
        // Concurrent version
        for (let i = 0; i < array.length; i += concurrency) {
            const slice = array.slice(i, i + concurrency);
            if (slice.length === 0) {
                break;
            }
            const sliceResults = await Promise.all<TResult>(
                slice.map((item, index) => processor(item, i + index)),
            );
            results.push(...sliceResults);
            if (progress) {
                let stop = false;
                for (let s = 0; s < sliceResults.length; ++s) {
                    let index = s + i;
                    let r = progress(array[index], index, results[index]);
                    if (shouldStop(r)) {
                        stop = true;
                    }
                }
                if (stop) {
                    return results;
                }
            }
        }
        return results;
    }
}

/**
 * Any async version of map that supports concurrency
 * @param array chunks to process
 * @param concurrency how many to run in parallel
 * @param processor function to process chunks
 * @returns
 */
export async function forEachAsync<T>(
    array: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<void>,
    progress?: (item: T, index: number) => void | boolean,
): Promise<void> {
    if (array.length === 0) {
        return;
    }
    if (concurrency <= 1) {
        return sequential();
    }
    return concurrent();

    async function sequential() {
        for (let i = 0; i < array.length; i++) {
            await processor(array[i], i);
            if (progress) {
                const progressResult = progress(array[i], i);
                if (shouldStop(progressResult)) {
                    break;
                }
            }
        }
        return;
    }

    async function concurrent() {
        // Concurrent version
        for (let i = 0; i < array.length; i += concurrency) {
            const slice = array.slice(i, i + concurrency);
            if (slice.length === 0) {
                break;
            }
            await Promise.all(
                slice.map((item, index) => processor(item, i + index)),
            );
            if (progress) {
                let stop = false;
                for (let s = 0; s < slice.length; ++s) {
                    let index = s + i;
                    let r = progress(array[index], index);
                    if (shouldStop(r)) {
                        stop = true;
                    }
                }
                if (stop) {
                    return;
                }
            }
        }
    }
}

export type ProcessBatch<T, TResult> = (slice: Slice<T>) => Promise<TResult>[];
export type ProgressBatch<T, TResult> = (
    slice: Slice<T>,
    results: TResult[],
) => void | boolean;

export async function forEachBatch<T = any, TResult = any>(
    array: T[],
    sliceSize: number,
    processor: ProcessBatch<T, TResult>,
    progress?: (slice: Slice<T>, results: TResult[]) => void,
): Promise<void> {
    for (const batch of slices(array, sliceSize)) {
        const results = await Promise.all(processor(batch));
        if (progress) {
            const stop = progress(batch, results);
            if (shouldStop(stop)) {
                break;
            }
        }
    }
}

/**
 * Turn an async iterator into an array
 * @param iter
 * @param maxLength (Optional) Read at most these many items
 * @returns
 */
export async function toArray(
    iter: AsyncIterableIterator<any>,
    maxLength?: number,
): Promise<any[]> {
    const items = [];
    for await (const item of iter) {
        items.push(item);
        if (maxLength && items.length === maxLength) {
            break;
        }
    }
    return items;
}

function shouldStop(progressResult: boolean | void): boolean {
    return typeof progressResult === "boolean" && !progressResult;
}
