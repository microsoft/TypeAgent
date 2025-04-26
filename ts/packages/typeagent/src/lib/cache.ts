// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NameValue } from "../memory.js";
import {
    LinkedList,
    ListNode,
    allNodes,
    createLinkedList,
} from "./linkedList.js";

/**
 * A Cache of V, where N is the key for V
 */
export interface Cache<N, V> {
    readonly size: number;
    has(name: N): boolean;
    get(name: N): V | undefined;
    put(name: N, value: V): void;
    remove(name: N): void;
    removeLRU(): V | undefined;
    purge(): void;
    all(): NameValue<V, N>[];
}

/**
 * Create an LRU cache
 * @param maxEntries max entries in the cache
 * @param entries initial entries, if any
 * @param onPurged callback when an entry is purged
 * @returns
 */
export function createLRUCache<N, V>(
    maxEntries: number,
    entries?: NameValue<V, N>[],
    onPurged?: (key: N, v: V) => void,
): Cache<N, V> {
    const kvTable = new Map<N, CacheEntry>();
    const mruList: LinkedList = createLinkedList();
    if (entries) {
        for (const entry of entries) {
            put(entry.name, entry.value);
        }
    }
    return {
        get size() {
            return kvTable.size;
        },
        has: (key) => kvTable.has(key),
        all,
        get,
        put,
        remove,
        removeLRU,
        purge,
    };

    function all(): NameValue<V, N>[] {
        const all: NameValue<V, N>[] = [];
        for (const node of allNodes(mruList.head)) {
            const entry = <CacheEntry>node;
            all.push({ name: entry.name, value: entry.value });
        }
        return all;
    }

    function get(name: N): V | undefined {
        const entry = kvTable.get(name);
        if (entry) {
            mruList.makeMRU(entry);
            return entry.value;
        }
        return undefined;
    }

    function put(name: N, value: V): void {
        let entry = kvTable.get(name);
        if (entry !== undefined) {
            mruList.makeMRU(entry);
            entry.value = value;
        } else {
            purge();
            entry = createListEntry(name, value);
            kvTable.set(name, entry);
            mruList.pushHead(entry);
        }
    }

    function remove(name: N): void {
        const entry = kvTable.get(name);
        if (entry) {
            removeNode(entry);
        }
    }

    function removeLRU(): V | undefined {
        if (kvTable.size >= maxEntries) {
            const lru = <CacheEntry>mruList.tail;
            if (lru) {
                removeNode(lru);
                if (onPurged) {
                    onPurged(lru.name, lru.value);
                }
                return lru.value;
            }
        }
        return undefined;
    }

    function removeNode(entry: CacheEntry): void {
        kvTable.delete(entry.name);
        mruList.removeNode(entry);
    }

    function purge(): void {
        while (kvTable.size >= maxEntries) {
            const tail = <CacheEntry>mruList.tail;
            if (tail) {
                removeNode(tail);
                if (onPurged) {
                    onPurged(tail.name, tail.value);
                }
            }
        }
    }

    interface CacheEntry extends NameValue<V, N>, ListNode {}

    function createListEntry(name: N, value: V): CacheEntry {
        return {
            next: undefined,
            prev: undefined,
            name,
            value,
        };
    }
}

export interface Lazy<T> {
    readonly value: T | undefined;
    get(): Promise<T>;
}

export function createLazy<T extends object>(
    initializer: () => Promise<T>,
    cache: boolean,
    useWeakRef: boolean,
): Lazy<T> {
    let lazyValue: Value | WeakValue | undefined;
    let pendingInit: Promise<T> | undefined;

    return {
        get value() {
            return getSync();
        },
        get,
    };

    function getSync(): T | undefined {
        if (lazyValue !== undefined) {
            return lazyValue.isWeak ? lazyValue.value.deref() : lazyValue.value;
        }
        return undefined;
    }

    function get(): Promise<T> {
        const value = getSync();
        if (value !== undefined) {
            return Promise.resolve(value);
        }

        if (pendingInit === undefined) {
            // Wrapper promise to prevent 'herding cats'
            pendingInit = new Promise<T>((resolve, reject) => {
                try {
                    initializer()
                        .then((v) => {
                            setValue(v);
                            resolve(v);
                        })
                        .catch((e) => reject(e));
                } catch (e) {
                    reject(e);
                }
            }).finally(() => {
                pendingInit = undefined;
            });
        }
        return pendingInit;
    }

    function setValue(v: T): T {
        if (cache) {
            lazyValue = useWeakRef
                ? { isWeak: true, value: new WeakRef(v) }
                : { isWeak: false, value: v };
        }
        return v;
    }

    type Value = {
        isWeak: false;
        value: T;
    };
    type WeakValue = {
        isWeak: true;
        value: WeakRef<T>;
    };
}
