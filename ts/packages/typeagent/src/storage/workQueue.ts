// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import fs from "fs";
import { ensureDir, Path } from "../objStream";
import { slices } from "../lib/array";
import { asyncArray } from "..";

export interface WorkQueue {
    run(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
    ): Promise<void>;
}

export async function createWorkQueueFolder(
    rootPath: string,
    queueFolderName?: string,
): Promise<WorkQueue> {
    const queuePath = await ensureDir(
        path.join(rootPath, (queueFolderName ??= "queue")),
    );
    const completedPath = await ensureDir(path.join(rootPath, "completed"));
    const skippedPath = await ensureDir(path.join(rootPath, "skipped"));
    const errorPath = await ensureDir(path.join(rootPath, "error"));

    return {
        run,
    };

    async function run(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
    ) {
        const fileNames = await fs.promises.readdir(queuePath);
        const total = fileNames.length;
        let startAt = 0;
        for (let slice of slices(fileNames, batchSize)) {
            startAt = slice.startAt;
            try {
                await asyncArray.forEachAsync(
                    slice.value,
                    concurrency,
                    processFile,
                );
            } catch (err) {}
        }

        async function processFile(fileName: string, index: number) {
            const filePath = path.join(queuePath, fileName);
            const completedFilePath = path.join(completedPath, fileName);
            try {
                if (fs.existsSync(completedFilePath)) {
                    await moveFileAsync(
                        filePath,
                        path.join(skippedPath, fileName),
                    );
                } else {
                    await processor(filePath, startAt + index, total);
                    await moveFileAsync(filePath, completedFilePath);
                }
                return;
            } catch {}
            // Move to the error folder
            await moveFileAsync(filePath, path.join(errorPath, fileName));
        }
    }

    function moveFileAsync(filePath: string, targetDirPath: string) {
        return fs.promises.rename(filePath, targetDirPath);
    }
}
