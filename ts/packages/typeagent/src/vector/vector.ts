// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Ultra vanilla, non-accelerated (currently), non-unrolled vector operations

export type Vector = number[] | Float32Array;

/**
 * Vanilla dot product, implemented as a simple loop
 * @param x
 * @param y
 * @returns
 */
export function dotProductSimple(x: Vector, y: Vector): number {
    if (x.length != y.length) {
        throw new Error("Array length mismatch");
    }

    let sum = 0;
    for (let i = 0; i < x.length; ++i) {
        sum += x[i] * y[i];
    }
    return sum;
}

/**
 * Return the dot product of two vectors
 * @param x
 * @param y
 * @returns
 */
export function dotProduct(x: Vector, y: Vector): number {
    if (x.length != y.length) {
        throw new Error("Array length mismatch");
    }
    const len = x.length;
    const unrolledLength = len - (len % 4);
    let sum = 0;
    let i = 0;
    while (i < unrolledLength) {
        sum += x[i] * y[i];

        let j = i + 1;
        sum += x[j] * y[j];
        j = i + 2;
        sum += x[j] * y[j];
        j = i + 3;
        sum += x[j] * y[j];
        i += 4;
    }

    while (i < len) {
        sum += x[i] * y[i];
        ++i;
    }
    return sum;
}

export function euclideanLength(x: Vector): number {
    return Math.sqrt(dotProduct(x, x));
}

export function normalizeInPlace(v: Vector): void {
    divideInPlace(v, euclideanLength(v));
}

/**
 * Extremely vanilla implementation.
 * When possible, use Normalized Embeddings and dotProduct.
 * Use cosineSimilarityLoop for loops
 * @param x
 * @param y
 * @returns
 */
export function cosineSimilarity(x: Vector, y: Vector): number {
    if (x.length != y.length) {
        throw new Error("Array length mismatch");
    }

    let dotSum = 0;
    let lenXSum = 0;
    let lenYSum = 0;
    for (let i = 0; i < x.length; ++i) {
        const xVal: number = x[i];
        const yVal: number = y[i];

        dotSum += xVal * yVal; // Dot product
        lenXSum += xVal * xVal; // For magnitude of x
        lenYSum += yVal * yVal; // For magnitude of y
    }

    // Cosine Similarity of X, Y
    // Sum(X * Y) / |X| * |Y|
    return dotSum / (Math.sqrt(lenXSum) * Math.sqrt(lenYSum));
}

/**
 * A faster unrolled version of cosine similarity designed to run in a loop
 * When possible, use NormalizedEmbeddings and Dot products instead.
 * To normalize your embedding, call createNormalized(...)
 * @param x
 * @param other
 * @param otherLen Magnitude of other
 * @returns
 */
export function cosineSimilarityLoop(
    x: Vector,
    other: Vector,
    otherLen: number,
): number {
    if (x.length != other.length) {
        throw new Error("Array length mismatch");
    }

    const len = x.length;
    const unrolledLength = len - (len % 4);
    let dotSum = 0;
    let lenXSum = 0;
    let i = 0;
    while (i < unrolledLength) {
        const xVal0 = x[i];
        const yVal0 = other[i];
        const xVal1 = x[i + 1];
        const yVal1 = other[i + 1];
        const xVal2 = x[i + 2];
        const yVal2 = other[i + 2];
        const xVal3 = x[i + 3];
        const yVal3 = other[i + 3];

        dotSum += xVal0 * yVal0;
        dotSum += xVal1 * yVal1;
        dotSum += xVal2 * yVal2;
        dotSum += xVal3 * yVal3;

        lenXSum += xVal0 * xVal0;
        lenXSum += xVal1 * xVal1;
        lenXSum += xVal2 * xVal2;
        lenXSum += xVal3 * xVal3;

        i += 4;
    }

    while (i < len) {
        const xVal = x[i];
        const yVal = other[i];

        dotSum += xVal * yVal;
        lenXSum += xVal * xVal;

        ++i;
    }

    // Cosine Similarity of X, Y
    // Sum(X * Y) / |X| * |Y|
    return dotSum / (Math.sqrt(lenXSum) * otherLen);
}

function divideInPlace(x: Vector, divisor: number): void {
    for (let i = 0; i < x.length; ++i) {
        x[i] /= divisor;
    }
}

export function createMatrix(rowCount: number, colCount: number): number[][] {
    const matrix: Array<number[]> = new Array<number[]>(rowCount);
    for (let i = 0; i < rowCount; ++i) {
        matrix[i] = new Array<number>(colCount);
    }
    return matrix;
}
