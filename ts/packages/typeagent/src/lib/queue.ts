// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ListEntry, createLinkedList, createListEntry } from "./linkedList.js";
import { queue, QueueObject } from "async";

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

export interface TaskQueue<T = any> {
    length(): number;
    push(item: T): boolean;
    drain(): Promise<void>;
}

export function createTaskQueue<T = any>(
    worker: (item: T) => Promise<void>,
    maxLength: number,
    concurrency: number = 1,
): TaskQueue<T> {
    let taskQueue: QueueObject<T> | undefined;
    return {
        length,
        push,
        drain,
    };

    function ensureQueue() {
        if (!taskQueue) {
            taskQueue = queue(async (item: T, callback) => {
                try {
                    await worker(item);
                    if (callback) {
                        callback();
                    }
                } catch (error: any) {
                    if (callback) {
                        callback(error);
                    }
                }
            }, concurrency);
        }
        return taskQueue;
    }

    function length() {
        return taskQueue ? taskQueue.length() : 0;
    }

    function push(item: T): boolean {
        if (length() === maxLength) {
            return false;
        }
        ensureQueue().pushAsync(item);
        return true;
    }

    async function drain(): Promise<void> {
        return taskQueue ? taskQueue.drain() : Promise.resolve();
    }
}
