// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ListEntry, createLinkedList, createListEntry } from "./linkedList";

/**
 * Classic Queue
 */
export interface Queue<T> {
    readonly length: number;
    entries(): IterableIterator<T>;
    enqueue(item: T): void;
    dequeue(): T | undefined;
}

/**
 * Creates a simple linked list based queue
 * @returns
 */
export function createQueue<T>(): Queue<T> {
    const list = createLinkedList();

    return {
        length: list.length,
        enqueue,
        dequeue,
        entries,
    };

    function enqueue(item: T): void {
        list.pushTail(createListEntry(item));
    }

    function dequeue(): T | undefined {
        const entry = <ListEntry<T>>list.popHead();
        return entry ? entry.value : undefined;
    }

    function* entries(): IterableIterator<T> {
        for (const node of list.entries()) {
            yield (<ListEntry<T>>node).value;
        }
    }
}
