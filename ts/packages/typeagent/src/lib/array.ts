// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Binary search an array
 * @param array
 * @param value
 * @param compareFn
 * @returns index if found, < 0 if not
 */
export function binarySearch(
    array: any[],
    value: any,
    compareFn: (x: any, y: any) => number,
) {
    let lo = 0;
    let hi = array.length - 1;

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = compareFn(array[mid], value);
        if (cmp === 0) {
            return mid;
        } else if (cmp < 0) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ~lo;
}

// Finds the first location of value... i.e. handles duplicates in the array
export function binarySearchFirst(
    array: any[],
    value: any,
    compareFn: (x: any, y: any) => number,
) {
    let lo: number = 0;
    let hi: number = array.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = compareFn(array[mid], value);
        if (cmp < 0) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return lo;
}

// Finds the last location of value... i.e. handles duplicates in the array
export function binarySearchLast(
    array: any[],
    value: any,
    compareFn: (x: any, y: any) => number,
) {
    let lo: number = 0;
    let hi: number = array.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = compareFn(array[mid], value);
        if (cmp <= 0) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return lo;
}

/**
 * Insert a new item into a sorted array in order.
 * @param sorted
 * @param value
 */
export function insertIntoSorted(
    sorted: any[],
    value: any,
    compareFn: (x: any, y: any) => number,
): any[] {
    let pos = binarySearch(sorted, value, compareFn);
    if (pos < 0) {
        pos = ~pos;
    }
    sorted.splice(pos, 0, value);
    return sorted;
}

/**
 * Array concatenation that handles (ignores) undefined arrays. The caller has to do fewer checks
 * @param arrays 
 */
export function concatArrays<T>(...arrays: (Array<T> | undefined)[]): T[] {
    const result: T[] = [];
    for (const array of arrays) {
        if(array) {
            result.push(...array);
        }
    }
    return result;
}

export function removeItemFromArray<T>(array: T[], items: T | T[]): T[] {
    if (Array.isArray(items)) {
        for (const item of items) {
            const pos = array.indexOf(item);
            if (pos >= 0) {
                array.splice(pos, 1);
            }        
        }
    }
    else {
        const pos = array.indexOf(items);
        if (pos >= 0) {
            array.splice(pos, 1);
        }    
    }
    return array;
}

export class CircularArray<T> implements Iterable<T> {
    private buffer: T[];
    private count: number;
    private head: number;
    private tail: number;

    constructor(capacity: number) {
        this.buffer = new Array<T>(capacity);
        this.count = 0;
        this.head = 0;
        this.tail = this.count;
    }

    public get length(): number {
        return this.count;
    }

    public get(index: number): T {
        if (index >= this.count) {
            throw new Error(`${index} is out of range`);
        }
        return this.buffer[this.relativeToHead(index)];
    }

    // Method to set an item at a given index
    public set(index: number, value: T): void {
        this.buffer[this.relativeToHead(index)] = value;
    }

    public push(item: T): void {
        if (this.isFull()) {
            // Queue is full. Drop the oldest item
            this.dropHead();
        }

        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.buffer.length;
        this.count++;
    }

    public pop(): T | undefined {
        if (this.count == 0) {
            return undefined;
        }

        const item = this.buffer[this.head];
        this.dropHead();
        return item;
    }

    public *[Symbol.iterator](): Iterator<T> {
        const count = this.count;
        for (let i = 0; i < count; ++i) {
            yield this.get(i);
        }
    }

    public *itemsReverse(): IterableIterator<T> {
        for (let i = this.count - 1; i >= 0; --i) {
            const item = this.get(i);
            if (item) {
                yield item;
            }
        }
    }

    public last(): T | undefined {
        return this.buffer[this.count - 1];
    }

    private isFull() {
        return this.count == this.buffer.length;
    }

    private relativeToHead(index: number): number {
        return (this.head + index) % this.buffer.length;
    }

    private dropHead(): void {
        this.head = (this.head + 1) % this.buffer.length;
        --this.count;
    }
}
