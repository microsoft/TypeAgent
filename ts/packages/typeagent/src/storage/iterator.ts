// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ChunkedIterator<T = any> {
    next(): IteratorResult<T>;
    loadNext(): Promise<boolean>;
}

export function createChunkedIterator<T = any>(
    loader: () => Promise<Iterator<T> | Array<T>>,
): ChunkedIterator<T> {
    let chunk: Iterator<T> | undefined;

    return {
        next,
        loadNext,
    };

    function next(): IteratorResult<T> {
        return chunk ? chunk.next() : { value: null, done: true };
    }

    async function loadNext(): Promise<boolean> {
        const newChunk = await loader();
        if (newChunk === undefined) {
            return false;
        }
        chunk = Array.isArray(newChunk) ? newChunk.values() : newChunk;
        return true;
    }
}
