// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { removeDir } from "../src/objStream";
import { createWorkQueueFolder } from "../src/storage/workQueue";
import { testDirectoryPath } from "./common";

describe("storage.workQueue", () => {
    const timeoutMs = 1000 * 60 * 5;
    test(
        "end2end",
        async () => {
            const queuePath = testDirectoryPath("workQueue");
            await removeDir(queuePath);
            const queue = await createWorkQueueFolder(queuePath, "tasks");
            const tasks = ["One", "Two", "Three"];
            for (const task of tasks) {
                await queue.addTask(task);
            }
            for (let i = 0; i < 2; ++i) {
                expect(await queue.count()).toBe(tasks.length);
                const completed: string[] = [];
                await queue.drainTask(1, 1, async (task) => {
                    completed.push(task);
                });
                expect(completed).toHaveLength(tasks.length);
                expect(await queue.count()).toBe(0);

                await queue.requeue();
            }
        },
        timeoutMs,
    );
});
