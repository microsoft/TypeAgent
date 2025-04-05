// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { queue, QueueObject } from "async";

export interface Task {
    run(): Promise<void>;
}

export function createQueue(concurrency: number = 2): QueueObject<Task> {
    return queue(async (task: Task, callback) => {
        try {
            await task.run();
            callback();
        } catch (ex: any) {
            callback(ex);
        }
    }, concurrency);
}
