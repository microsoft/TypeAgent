// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Ultra vanilla, non-accelerated (currently), non-unrolled vector operations

export type Vector = number[] | Float32Array;

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
 * Faster version that unrolls the dot product
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
        sum += x[i + 1] * y[i + 1];
        sum += x[i + 2] * y[i + 2];
        sum += x[i + 3] * y[i + 3];
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
 * @param x
 * @param y
 * @returns
 */
export function cosineSimilaritySimple(x: Vector, y: Vector): number {
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

function divideInPlace(x: Vector, divisor: number): void {
    for (let i = 0; i < x.length; ++i) {
        x[i] /= divisor;
    }
}
