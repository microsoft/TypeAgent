// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function randomInt() {
    return randomIntInRange(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

export function randomIntInRange(min: number, max: number): number {
    // range is inclusive
    // Given range of numbers, the random # takes a fraction of that range and then offsets it by min
    return Math.floor(Math.random() * (max - min + 1) + min);
}

export function max<T = any>(items: IterableIterator<T>, getter: (value: T) => number): T | undefined {
    let maxValue = Number.MIN_VALUE;
    let maxItem: T | undefined;
    for (const item of items) {
        const cmpValue = getter(item);
        if (cmpValue > maxValue) {
            maxValue = cmpValue;
            maxItem = item;
        }
    }
    return maxItem;
}

export function angleDegreesFromCosine(cos: number) {
    const radians = Math.acos(cos);
    return radians * (180 / Math.PI);
}