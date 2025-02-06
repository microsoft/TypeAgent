// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MultiMap is a map of key => value[]
 * Includes functions that let you work with such structures
 * Very useful for building things like one to many indices, inverted indices etc.
 */
export class MultiMap<K, V> extends Map<K, V[]> {
    constructor(iterable?: Iterable<readonly [K, V[]]>) {
        super(iterable);
    }

    /**
     * Push a new value for the give key
     * @param key
     * @param value
     * @returns
     */
    public add(key: K, value: V): this {
        let values = super.get(key);
        if (values === undefined) {
            values = [value];
            super.set(key, values);
        } else {
            values.push(value);
        }
        return this;
    }

    /**
     * Push a new value for the given key if it does not already exist
     * @param key
     * @param value
     * @returns
     */
    public addUnique(
        key: K,
        value: V,
        comparer?: (value: V, other: V) => boolean,
    ): this {
        let values = super.get(key);
        if (values === undefined) {
            values = [value];
            super.set(key, values);
            return this;
        }
        if (comparer) {
            for (let i = 0; i < values.length; ++i) {
                if (comparer(value, values[i])) {
                    return this;
                }
            }
            values.push(value);
        } else if (values.includes(value)) {
            return this;
        }
        values.push(value);
        return this;
    }

    /**
     * Remove a value from the give key
     * @param key
     * @param value
     * @returns
     */
    public removeValue(key: K, value: V): boolean {
        const values = super.get(key);
        if (values && values.length > 0) {
            return this.removeValueAt(key, values, values.indexOf(value));
        }
        return false;
    }

    public remove(
        key: K,
        predicate: (value: V, index: number, obj: V[]) => boolean,
    ): boolean {
        const values = super.get(key);
        if (values) {
            return this.removeValueAt(key, values, values.findIndex(predicate));
        }
        return false;
    }

    public removeAt(key: K, pos: number): boolean {
        const values = super.get(key);
        if (values) {
            return this.removeValueAt(key, values, pos);
        }
        return false;
    }

    public find(
        key: K,
        predicate: (value: V, index: number, obj: V[]) => boolean,
    ): V | undefined {
        const values = super.get(key);
        if (values) {
            return values.find(predicate);
        }
        return undefined;
    }

    public indexOfValue(key: K, value: V): number {
        const values = super.get(key);
        if (values) {
            return values.indexOf(value);
        }
        return -1;
    }

    public indexOf(
        key: K,
        predicate: (value: V, index: number, obj: V[]) => boolean,
    ): number {
        const values = super.get(key);
        if (values) {
            return values.findIndex(predicate);
        }
        return -1;
    }

    private removeValueAt(key: K, values: V[], pos: number): boolean {
        if (pos >= 0) {
            values.splice(pos, 1);
            if (values.length === 0) {
                super.delete(key);
            }
            return true;
        }
        return false;
    }
}
