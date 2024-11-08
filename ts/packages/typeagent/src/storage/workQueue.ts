// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import fs from "fs";
import {
    ensureDir,
    Path,
    readJsonFile,
    removeDir,
    removeFile,
    writeJsonFile,
} from "../objStream";
import { slices } from "../lib/array";
import { asyncArray } from "..";
import {
    createFileNameGenerator,
    generateTimestampString,
} from "./objectFolder";

export interface WorkQueue {
    count(): Promise<number>;
    addTask(obj: any): Promise<void>;
    drain(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
    ): Promise<void>;
    drainTask(
        batchSize: number,
        concurrency: number,
        processor: (task: any, index: number, total: number) => Promise<void>,
    ): Promise<void>;
    replay(): Promise<void>;
}

export async function createWorkQueueFolder(
    rootPath: string,
    queueFolderName?: string,
): Promise<WorkQueue> {
    let queuePath = await ensureDir(
        path.join(rootPath, (queueFolderName ??= "queue")),
    );
    let completedPath = await ensureDir(path.join(rootPath, "completed"));
    let skippedPath = await ensureDir(path.join(rootPath, "skipped"));
    let errorPath = await ensureDir(path.join(rootPath, "error"));
    const namedGenerator = createFileNameGenerator(
        generateTimestampString,
        (name: string) => {
            return !fs.existsSync(taskFilePath(name));
        },
    );
    return {
        count,
        addTask,
        drainTask,
        drain,
        replay,
    };

    async function count(): Promise<number> {
        const fileNames = await fs.promises.readdir(queuePath);
        return fileNames.length;
    }

    async function addTask(task: any): Promise<void> {
        const fileName = namedGenerator.next().value;
        await writeJsonFile(taskFilePath(fileName), task);
    }

    async function drainTask(
        batchSize: number,
        concurrency: number,
        processor: (task: any, index: number, total: number) => Promise<void>,
    ) {
        return drain(batchSize, concurrency, async (item, index, total) => {
            const task = await readJsonFile(item);
            processor(task, index, total);
        });
    }

    async function drain(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
    ) {
        const fileNames = await fs.promises.readdir(queuePath);
        const total = fileNames.length;
        let startAt = 0;
        for (let slice of slices(fileNames, batchSize)) {
            startAt = slice.startAt;
            await asyncArray.forEachAsync(
                slice.value,
                concurrency,
                processFile,
            );
        }

        async function processFile(fileName: string, index: number) {
            const filePath = taskFilePath(fileName);
            try {
                if (isAlreadyProcessed(fileName)) {
                    await moveFileAsync(fileName, skippedPath);
                } else {
                    await processor(filePath, startAt + index, total);
                    await moveFileAsync(fileName, completedPath);
                }
                return;
            } catch {}
            // Move to the error folder
            await moveFileAsync(fileName, errorPath);
        }
    }

    async function replay(): Promise<void> {
        await removeDir(queuePath);
        await fs.promises.rename(completedPath, queuePath);
        await ensureDir(completedPath);
    }

    function isAlreadyProcessed(fileName: string) {
        return fs.existsSync(path.join(completedPath, fileName));
    }

    async function moveFileAsync(
        fileName: string,
        targetDirPath: string,
    ): Promise<void> {
        const targetFilePath = path.join(targetDirPath, fileName);
        await removeFile(targetFilePath);
        await fs.promises.rename(taskFilePath(fileName), targetFilePath);
    }

    function taskFilePath(name: string): string {
        return path.join(queuePath, name);
    }
}
