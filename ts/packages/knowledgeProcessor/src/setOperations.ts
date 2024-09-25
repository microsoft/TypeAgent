// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib } from "typeagent";

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

export function* intersect<T>(
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
): T[] {
    // We can to do this more optimally...
    let combined = createFrequencyTable<T>();
    for (const array of arrays) {
        if (array) {
            combined.addMultiple(array);
        }
    }
    const topKItems = combined.getTop();
    return topKItems;
}

export function* union<T>(
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

export function unionArrays(x?: any[], y?: any[]): any[] | undefined {
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
    let combined = createFrequencyTable<T>();
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

export type WithFrequency<T = any> = {
    value: T;
    count: number;
};

export interface FrequencyTable<T> {
    get(value: T): WithFrequency<T> | undefined;
    getFrequency(value: T): number;
    add(value: T): number;
    addMultiple(values: Iterator<T> | IterableIterator<T> | Array<T>): void;
    keys(): IterableIterator<T>;
    byFrequency(): WithFrequency<T>[];
    getTop(): T[];
    getTopK(k: number): T[];
}

export function createFrequencyTable<T>(
    keyAccessor?: (value: T) => any,
): FrequencyTable<T> {
    const map = new Map<any, WithFrequency<T>>();
    return {
        get,
        getFrequency,
        add,
        addMultiple,
        keys: () => map.keys(),
        byFrequency,
        getTop,
        getTopK,
    };

    function get(value: T): WithFrequency<T> | undefined {
        const key = getKey(value);
        return map.get(key);
    }

    function getFrequency(value: T): number {
        const key = getKey(value);
        const freq = map.get(key);
        return freq ? freq.count : 0;
    }

    function add(value: T): number {
        const key = getKey(value);
        let freq = map.get(key);
        if (freq) {
            freq.count++;
        } else {
            freq = { value, count: 1 };
            map.set(key, freq);
        }
        return freq.count;
    }

    function addMultiple(
        values: Iterator<T> | IterableIterator<T> | Array<T>,
    ): void {
        const x: Iterator<T> = Array.isArray(values) ? values.values() : values;
        let xValue = x.next();
        while (!xValue.done) {
            add(xValue.value);
            xValue = x.next();
        }
    }

    function byFrequency(): WithFrequency<T>[] {
        if (map.size === 0) {
            return [];
        }
        // Descending order
        return [...map.values()].sort((x, y) => y.count - x.count);
    }

    // TODO: Optimize.
    function getTop(): T[] {
        if (map.size === 0) {
            return [];
        }
        let maxFreq = mathLib.max(map.values(), (v) => v.count)!.count;
        let top: T[] = [];
        for (const value of map.values()) {
            if (value.count === maxFreq) {
                top.push(value.value);
            }
        }
        return top;
    }

    // TODO: Optimize.
    function getTopK(k: number): T[] {
        const byFreq = byFrequency();
        const topK: T[] = [];
        if (k < 1 || byFreq.length === 0) {
            return topK;
        }
        // Find the k'th lowest hit count
        let prevFreq = byFreq[0].count;
        let kCount = 1;
        for (let i = 0; i < byFreq.length; ++i) {
            if (byFreq[i].count < prevFreq) {
                kCount++;
                if (kCount > k) {
                    break;
                }
                prevFreq = byFreq[i].count;
            }
            topK.push(byFreq[i].value);
        }
        return topK;
    }

    function getKey(value: T): any {
        return keyAccessor ? keyAccessor(value) : value;
    }
}
