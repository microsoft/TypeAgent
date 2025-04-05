// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { queue, QueueObject } from "async";
import { Result, error } from "typechat";

export function createQueue<T>(
    worker: (task: T) => void,
    concurrency?: number,
): QueueObject<T> {
    return queue(async (task: T, callback) => {
        try {
            await worker(task);
            callback();
        } catch (ex: any) {
            callback(ex);
        }
    }, concurrency);
}

export interface BatchTask<TTask, TResult> {
    task: TTask;
    result?: Result<TResult> | undefined;
}

export function createBatchQueue<TTask, TResult>(
    taskHandler: (task: TTask) => Promise<Result<TResult>>,
    batchSize: number,
) {
    const queue = createQueue<BatchTask<TTask, TResult>>(runTask, batchSize);
    return queue;

    async function runTask(task: BatchTask<TTask, TResult>): Promise<void> {
        try {
            task.result = await taskHandler(task.task);
        } catch (ex) {
            task.result = error(`${ex}`);
            throw ex;
        }
    }
}

export async function runInBatches<TTask, TResult>(
    tasks: BatchTask<TTask, TResult>[],
    taskHandler: (task: TTask) => Promise<Result<TResult>>,
    batchSize: number,
    taskQueue?: QueueObject<BatchTask<TTask, TResult>>,
): Promise<void> {
    taskQueue ??= createBatchQueue<TTask, TResult>(taskHandler, batchSize);
    taskQueue.push(tasks);
    await taskQueue.drain();
}
