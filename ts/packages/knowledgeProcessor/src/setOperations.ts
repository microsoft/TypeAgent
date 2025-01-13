// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib, ScoredItem } from "typeagent";

export enum SetOp {
    Union,
    Intersect,
    IntersectUnion,
}

export type Postings = Uint32Array;

export function createPostings(ids: number[] | Iterable<number>): Postings {
    const postings = new Uint32Array(ids);
    postings.sort();
    return postings;
}

export function* intersectMerge<T>(
    xArray: Iterator<T> | Array<T>,
    yArray: Iterator<T> | Array<T>,
): IterableIterator<T> {
    const x: Iterator<T> = Array.isArray(xArray) ? xArray.values() : xArray;
    const y: Iterator<T> = Array.isArray(yArray) ? yArray.values() : yArray;
    let xVal = x.next();
    let yVal = y.next();
    while (!xVal.done && !yVal.done) {
        if (xVal.value === yVal.value) {
            yield xVal.value;
            xVal = x.next();
            yVal = y.next();
        } else if (xVal.value < yVal.value) {
            xVal = x.next();
        } else {
            yVal = y.next();
        }
    }
}

export function* intersect<T>(
    xArray: Iterator<T> | Array<T>,
    yArray: Iterator<T> | Array<T>,
): IterableIterator<T> {
    const x: Iterator<T> = Array.isArray(xArray) ? xArray.values() : xArray;
    const y: Iterator<T> = Array.isArray(yArray) ? yArray.values() : yArray;
    const xSet = new Set<T>();
    let xVal = x.next();
    while (!xVal.done) {
        xSet.add(xVal.value);
        xVal = x.next();
    }
    let yVal = y.next();
    while (!yVal.done) {
        if (xSet.has(yVal.value)) {
            yield yVal.value;
        }
        yVal = y.next();
    }
}

export function intersectMultiple<T>(
    ...arrays: (Iterator<T> | IterableIterator<T> | Array<T> | undefined)[]
): IterableIterator<T> {
    let combined: any | undefined;
    for (const array of arrays) {
        if (array) {
            combined = combined ? intersect(combined, array) : array;
        }
    }
    return combined ?? [];
}

export function intersectUnionMultiple<T>(
    ...arrays: (Iterator<T> | IterableIterator<T> | Array<T> | undefined)[]
): T[] | undefined {
    // We can to do this more optimally...
    let combined: HitTable<T> | undefined;
    for (const array of arrays) {
        if (array) {
            combined ??= createHitTable<T>();
            combined.addMultiple(array);
        }
    }
    if (!combined || combined.size === 0) {
        return undefined;
    }

    const topKItems = combined.getTop();
    return topKItems.sort();
}

export function* unionMerge<T>(
    xArray: Iterator<T> | Array<T>,
    yArray: Iterator<T> | Array<T>,
): IterableIterator<T> {
    const x: Iterator<T> = Array.isArray(xArray) ? xArray.values() : xArray;
    const y: Iterator<T> = Array.isArray(yArray) ? yArray.values() : yArray;
    let xVal = x.next();
    let yVal = y.next();

    while (!xVal.done && !yVal.done) {
        if (xVal.value === yVal.value) {
            yield xVal.value;
            xVal = x.next();
            yVal = y.next();
        } else if (xVal.value < yVal.value) {
            yield xVal.value;
            xVal = x.next();
        } else {
            yield yVal.value;
            yVal = y.next();
        }
    }
    while (!xVal.done) {
        yield xVal.value;
        xVal = x.next();
    }
    while (!yVal.done) {
        yield yVal.value;
        yVal = y.next();
    }
}

export function* union<T>(
    xArray: Iterator<T> | Array<T>,
    yArray: Iterator<T> | Array<T>,
): IterableIterator<T> {
    const x: Iterator<T> = Array.isArray(xArray) ? xArray.values() : xArray;
    const y: Iterator<T> = Array.isArray(yArray) ? yArray.values() : yArray;
    let unionSet = new Set<T>();
    let xVal = x.next();
    while (!xVal.done) {
        unionSet.add(xVal.value);
        xVal = x.next();
    }
    let yVal = y.next();
    while (!yVal.done) {
        unionSet.add(yVal.value);
        yVal = y.next();
    }
    /*
    const unionArray = [...unionSet.values()].sort();
    for (const item of unionArray) {
        yield item;
    }
        */
    for (const value of unionSet.values()) {
        yield value;
    }
}

export function unionMultiple<T>(
    ...arrays: (Iterator<T> | IterableIterator<T> | Array<T> | undefined)[]
): IterableIterator<T> {
    let combined: any | undefined;
    for (const array of arrays) {
        if (array) {
            combined = combined ? union(combined, array) : array;
        }
    }
    return combined ?? [];
}

export function* unionScored<T>(
    xArray: Iterator<ScoredItem<T>> | Array<ScoredItem<T>>,
    yArray: Iterator<ScoredItem<T>> | Array<ScoredItem<T>>,
): IterableIterator<ScoredItem<T>> {
    const x: Iterator<ScoredItem<T>> = Array.isArray(xArray)
        ? xArray.values()
        : xArray;
    const y: Iterator<ScoredItem<T>> = Array.isArray(yArray)
        ? yArray.values()
        : yArray;
    let xVal = x.next();
    let yVal = y.next();

    while (!xVal.done && !yVal.done) {
        if (xVal.value.item === yVal.value.item) {
            // If both are equal, yield the one with a higher score
            yield xVal.value.score >= yVal.value.score
                ? xVal.value
                : yVal.value;
            xVal = x.next();
            yVal = y.next();
        } else if (xVal.value < yVal.value) {
            yield xVal.value;
            xVal = x.next();
        } else {
            yield yVal.value;
            yVal = y.next();
        }
    }
    while (!xVal.done) {
        yield xVal.value;
        xVal = x.next();
    }
    while (!yVal.done) {
        yield yVal.value;
        yVal = y.next();
    }
}

export function* unionScoredHash(
    xArray: Iterator<ScoredItem<number>> | Array<ScoredItem<number>>,
    yArray: Iterator<ScoredItem<number>> | Array<ScoredItem<number>>,
): IterableIterator<ScoredItem<number>> {
    const x: Iterator<ScoredItem<number>> = Array.isArray(xArray)
        ? xArray.values()
        : xArray;
    const y: Iterator<ScoredItem<number>> = Array.isArray(yArray)
        ? yArray.values()
        : yArray;

    const unionSet = new Map<number, ScoredItem<number>>();
    let xVal = x.next();
    while (!xVal.done) {
        unionSet.set(xVal.value.item, xVal.value);
        xVal = x.next();
    }

    let yVal = y.next();
    while (!yVal.done) {
        const existing = unionSet.get(yVal.value.item);
        if (!existing || existing.score < yVal.value.score) {
            unionSet.set(yVal.value.item, yVal.value);
        }
        yVal = y.next();
    }

    return [...unionSet.values()].sort();
}

export function unionMultipleScored<T>(
    ...arrays: (
        | Iterator<ScoredItem<T>>
        | IterableIterator<ScoredItem<T>>
        | Array<ScoredItem<T>>
        | undefined
    )[]
): IterableIterator<ScoredItem<T>> {
    let combined: any | undefined;
    for (const array of arrays) {
        if (array) {
            combined = combined ? unionScored(combined, array) : array;
        }
    }
    return combined ?? [];
}

export function* unique<T>(x: Iterator<T>): IterableIterator<T> {
    let last: T | undefined;
    let xVal = x.next();
    while (!xVal.done) {
        if (xVal.value !== last) {
            yield xVal.value;
            last = xVal.value;
        }
        xVal = x.next();
    }
}

export function* window<T>(
    x: Iterator<T>,
    windowSize: number,
): IterableIterator<T[]> {
    const window: T[] = [];
    let xVal = x.next();
    while (!xVal.done) {
        if (window.length === windowSize) {
            yield window;
            window.length = 0;
        }
        window.push(xVal.value);
        xVal = x.next();
    }
    if (window.length > 0) {
        yield window;
    }
}

export function unionArrays<T = any>(
    x: T[] | undefined,
    y: T[] | undefined,
): T[] | undefined {
    if (x) {
        if (y) {
            return [...union(x.values(), y.values())];
        }
        return x;
    }
    return y;
}

export function intersectArrays(x?: any[], y?: any[]): any[] | undefined {
    if (x && y) {
        return [...intersect(x.values(), y.values())];
    }
    return undefined;
}

export function setFrom<T>(
    src: Iterable<T>,
    callback?: (value: T) => any | undefined,
): Set<any> {
    const set = new Set();
    for (const item of src) {
        const itemValue = callback ? callback(item) : item;
        if (itemValue) {
            if (Array.isArray(itemValue)) {
                for (const value of itemValue) {
                    set.add(value);
                }
            } else {
                set.add(itemValue);
            }
        }
    }
    return set;
}

export function uniqueFrom<T, TRetVal = any>(
    src: Iterable<T>,
    callback?: (value: T) => TRetVal | undefined,
    sort: boolean = true,
): TRetVal[] | undefined {
    const set = setFrom<T>(src, callback);
    if (set.size > 0) {
        const items = [...set.values()];
        return sort ? items.sort() : items;
    }
    return undefined;
}

export function addToSet(set: Set<any>, values?: Iterable<any>) {
    if (values) {
        for (const value of values) {
            set.add(value);
        }
    }
}

export function intersectSets<T = any>(
    x?: Set<T>,
    y?: Set<T>,
): Set<T> | undefined {
    if (x && y) {
        // xValue is smaller than yValues in size
        let xValues = x.size < y.size ? x : y;
        let yValues = x.size < y.size ? y : x;
        let result: Set<T> | undefined;
        for (const val of xValues) {
            if (yValues.has(val)) {
                result ??= new Set<T>();
                result.add(val);
            }
        }
        return result;
    } else if (x) {
        return x;
    }
    return y;
}

export function unionSets<T = any>(x?: Set<T>, y?: Set<T>): Set<T> | undefined {
    if (x && y) {
        // xValue is smaller than yValues in size
        let xValues = x.size < y.size ? x : y;
        let yValues = x.size < y.size ? y : x;
        let result = new Set<T>(yValues);
        addToSet(result, xValues);
        return result;
    } else if (x) {
        return x;
    }
    return y;
}

export function intersectUnionSets<T = any>(
    x?: Set<T>,
    y?: Set<T>,
): Set<T> | undefined {
    // We can to do this more optimally...
    let combined = createHitTable<T>();
    if (x) {
        combined.addMultiple(x.values());
    }
    if (y) {
        combined.addMultiple(y.values());
    }
    return new Set<T>(combined.getTop());
}

export function flatten<T>(
    src: Iterable<T>,
    callback?: (value: T) => any | undefined,
    sort: boolean = true,
): any[] {
    const flat = [];
    for (const item of src) {
        const itemValue = callback ? callback(item) : item;
        if (itemValue) {
            if (Array.isArray(itemValue)) {
                for (const value of itemValue) {
                    if (value) {
                        flat.push(value);
                    }
                }
            } else {
                flat.push(itemValue);
            }
        }
    }
    return sort ? flat.sort() : flat;
}

export function removeUndefined<T = any>(src: Array<T | undefined>): T[] {
    return src.filter((item) => item !== undefined) as T[];
}

export function removeDuplicates<T = any>(
    src: T[] | undefined,
    comparer: (x: T, y: T) => number,
): T[] | undefined {
    if (src === undefined || src.length <= 1) {
        return src;
    }

    src.sort(comparer);
    let prev = src[0];
    let i = 1;
    while (i < src.length) {
        if (comparer(prev, src[i]) === 0) {
            src.splice(i, 1);
        } else {
            prev = src[i];
            i++;
        }
    }
    return src;
}

export type WithFrequency<T = any> = {
    value: T;
    count: number;
};

export interface HitTable<T = any> {
    readonly size: number;

    get(value: T): ScoredItem<T> | undefined;
    getScore(value: T): number;
    add(value: T, score?: number | undefined): number;
    addMultiple(
        values: Iterator<T> | IterableIterator<T> | Array<T>,
        score?: number | undefined,
    ): void;
    addMultipleScored(
        values:
            | Iterator<ScoredItem<T>>
            | IterableIterator<ScoredItem<T>>
            | Array<ScoredItem<T>>,
    ): void;
    keys(): IterableIterator<any>;
    values(): IterableIterator<ScoredItem<T>>;
    /**
     * Return all hits sorted by score
     */
    byHighestScore(): ScoredItem<T>[];
    /**
     * Return top scoring hits
     */
    getTop(): T[];
    /**
     * Return hits with the 'k' highest scores
     * getTopK(3) will return all items whose scores put them in the top 3
     * @param k k highest scores
     */
    getTopK(k: number): T[];

    getByKey(key: any): ScoredItem<T> | undefined;
    set(key: any, value: ScoredItem<T>): void;

    clear(): void;

    roundScores(decimalPlace: number): void;
}

/**
 * Tracks the # of hits on an object of arbitrary type T
 * Internally uses the Map object
 * @param keyAccessor (optional) By default, when T is a non-primitive type, the map object uses object identity as the 'key'.
 * This is not always what we want, as we may want to treat different object with different identities as the same..
 * @param fixedScore (optional) Overrides an supplied scores. E.g. set this to 1.0 to get a hit *counter*
 * @returns
 */
export function createHitTable<T>(
    keyAccessor?: (value: T) => any,
    fixedScore?: number | undefined,
): HitTable<T> {
    const map = new Map<any, ScoredItem<T>>();
    return {
        get size() {
            return map.size;
        },
        keys: () => map.keys(),
        values: () => map.values(),
        get,
        set,
        getScore,
        add,
        addMultiple,
        addMultipleScored,
        byHighestScore,
        getTop,
        getTopK,
        getByKey,
        clear: () => map.clear(),
        roundScores,
    };

    function get(value: T): ScoredItem<T> | undefined {
        const key = getKey(value);
        return map.get(key);
    }

    function set(key: any, value: ScoredItem<T>): void {
        map.set(key, value);
    }

    function getScore(value: T): number {
        const key = getKey(value);
        const scoredItem = map.get(key);
        return scoredItem ? scoredItem.score : 0;
    }

    function add(value: T, score?: number | undefined): number {
        score = fixedScore ? fixedScore : score ?? 1.0;
        const key = getKey(value);
        let scoredItem = map.get(key);
        if (scoredItem) {
            scoredItem.score += score;
        } else {
            scoredItem = { item: value, score };
            map.set(key, scoredItem);
        }
        return scoredItem.score;
    }

    function addMultiple(
        values: Iterator<T> | IterableIterator<T> | Array<T>,
        score?: number | undefined,
    ): void {
        const x: Iterator<T> = Array.isArray(values) ? values.values() : values;
        let xValue = x.next();
        while (!xValue.done) {
            add(xValue.value, score);
            xValue = x.next();
        }
    }

    function addMultipleScored(
        values:
            | Iterator<ScoredItem<T>>
            | IterableIterator<ScoredItem<T>>
            | Array<ScoredItem<T>>,
    ): void {
        const x: Iterator<ScoredItem<T>> = Array.isArray(values)
            ? values.values()
            : values;
        let xValue = x.next();
        while (!xValue.done) {
            add(xValue.value.item, xValue.value.score);
            xValue = x.next();
        }
    }

    function byHighestScore(): ScoredItem<T>[] {
        if (map.size === 0) {
            return [];
        }
        // Descending order
        let valuesByScore = [...map.values()].sort((x, y) => y.score - x.score);
        return valuesByScore;
    }

    // TODO: Optimize.
    /**
     * Get the top scoring items
     * @returns
     */
    function getTop(): T[] {
        if (map.size === 0) {
            return [];
        }
        let maxScore = mathLib.max(map.values(), (v) => v.score)!.score;
        let top: T[] = [];
        for (const value of map.values()) {
            if (value.score === maxScore) {
                top.push(value.item);
            }
        }
        return top;
    }

    // TODO: Optimize.
    /**
     * Return the items with the 'k' highest scores
     * @param k if <= 0, returns all
     * @returns array of items
     */
    function getTopK(k: number): T[] {
        const topItems = byHighestScore();
        if (k === map.size || k <= 0) {
            return topItems.map((i) => i.item);
        }

        const topK: T[] = [];
        if (k < 1 || topItems.length === 0) {
            return topK;
        }
        // Stop when we have matched k highest scores
        let prevScore = topItems[0].score;
        let kCount = 1;
        for (let i = 0; i < topItems.length; ++i) {
            const score = topItems[i].score;
            if (score < prevScore) {
                kCount++;
                if (kCount > k) {
                    break;
                }
                prevScore = score;
            }
            topK.push(topItems[i].item);
        }
        return topK;
    }

    function getByKey(key: any): ScoredItem<T> | undefined {
        return map.get(key);
    }

    function getKey(value: T): any {
        return keyAccessor ? keyAccessor(value) : value;
    }

    function roundScores(decimalPlace: number): void {
        let roundUnit = Math.pow(10, decimalPlace);
        if (roundUnit > 0) {
            for (const scoredItem of map.values()) {
                scoredItem.score =
                    Math.round(scoredItem.score * roundUnit) / roundUnit;
            }
        }
    }
}
