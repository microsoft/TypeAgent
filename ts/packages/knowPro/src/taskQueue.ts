// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { queue, QueueObject, AsyncResultCallback } from "async";
import { error, Result } from "typechat";

function createQueue<TTask = any, TResult = void>(
    worker: (task: TTask) => Result<TResult>,
    concurrency: number = 2,
) {
    return queue(
        async (task: TTask, callback: AsyncResultCallback<Result<TResult>>) => {
            try {
                const result = await worker(task);
                if (callback) {
                    callback(null, result);
                }
            } catch (ex: any) {
                const result = error(`${ex}`);
                if (callback) {
                    callback(ex, result);
                }
            }
        },
        concurrency,
    );
}

export class TaskQueue<TTask = any, TResult = void> {
    private taskQueue: QueueObject<TTask>;

    constructor(worker: (task: TTask) => Result<TResult>, concurrency: number) {
        this.taskQueue = createQueue<TTask, TResult>(worker, concurrency);
    }

    public async runBatch(tasks: TTask[]): Promise<Result<TResult>[]> {
        const results: Result<TResult>[] =
            await this.taskQueue.pushAsync(tasks);
        return results;
    }
}
