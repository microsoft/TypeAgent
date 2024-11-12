// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import fs from "fs";
import {
    ensureDir,
    Path,
    readJsonFile,
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
    onError?: (err: any) => void;

    count(): Promise<number>;
    addTask(obj: any): Promise<void>;
    drain(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
        maxItems?: number,
    ): Promise<number>;
    drainTask(
        batchSize: number,
        concurrency: number,
        processor: (task: any, index: number, total: number) => Promise<void>,
        maxItems?: number,
    ): Promise<number>;
    requeue(): Promise<boolean>;
    requeueErrors(): Promise<boolean>;
}

export async function createWorkQueueFolder(
    rootPath: string,
    queueFolderName?: string,
): Promise<WorkQueue> {
    queueFolderName ??= "queue";
    let queuePath = await ensureDir(path.join(rootPath, queueFolderName));
    queueFolderName ??= "";
    let completedPath = await ensureDir(
        path.join(rootPath, queueFolderName + "_completed"),
    );
    let skippedPath = await ensureDir(
        path.join(rootPath, queueFolderName + "_skipped"),
    );
    let errorPath = await ensureDir(
        path.join(rootPath, queueFolderName + "_error"),
    );
    const namedGenerator = createFileNameGenerator(
        generateTimestampString,
        (name: string) => {
            return !fs.existsSync(taskFilePath(name));
        },
    );
    const thisQueue: WorkQueue = {
        count,
        addTask,
        drainTask,
        drain,
        requeue,
        requeueErrors,
    };
    return thisQueue;

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
        maxItems?: number,
    ) {
        return drain(
            batchSize,
            concurrency,
            async (item, index, total) => {
                const task = await readJsonFile(item);
                processor(task, index, total);
            },
            maxItems,
        );
    }

    async function drain(
        batchSize: number,
        concurrency: number,
        processor: (item: Path, index: number, total: number) => Promise<void>,
        maxItems?: number,
    ): Promise<number> {
        let fileNames = await fs.promises.readdir(queuePath);
        if (maxItems && maxItems > 0) {
            fileNames = fileNames.slice(0, maxItems);
        }
        const total = fileNames.length;
        let startAt = 0;
        let successCount = 0;
        for (let slice of slices(fileNames, batchSize)) {
            startAt = slice.startAt;
            await asyncArray.forEachAsync(
                slice.value,
                concurrency,
                processFile,
            );
        }
        return successCount;

        async function processFile(fileName: string, index: number) {
            const filePath = taskFilePath(fileName);
            try {
                if (isAlreadyProcessed(fileName)) {
                    await moveFileTo(fileName, skippedPath);
                } else {
                    await processor(filePath, startAt + index, total);
                    await moveFileTo(fileName, completedPath);
                }
                ++successCount;
                return;
            } catch (err) {
                if (thisQueue.onError) {
                    thisQueue.onError(err);
                }
            }
            // Move to the error folder
            await moveFileTo(fileName, errorPath);
        }
    }

    async function requeue(): Promise<boolean> {
        const completedFiles = await fs.promises.readdir(completedPath);
        for (const fileName of completedFiles) {
            await moveFileTo(fileName, queuePath, completedPath);
        }
        return completedFiles.length > 0;
    }

    async function requeueErrors(): Promise<boolean> {
        const errorFiles = await fs.promises.readdir(errorPath);
        for (const fileName of errorFiles) {
            await moveFileTo(fileName, queuePath, errorPath);
        }
        return errorFiles.length > 0;
    }

    function isAlreadyProcessed(fileName: string) {
        return fs.existsSync(path.join(completedPath, fileName));
    }

    async function moveFileTo(
        fileName: string,
        targetDirPath: string,
        fromDirPath?: string,
    ): Promise<void> {
        const targetFilePath = path.join(targetDirPath, fileName);
        await removeFile(targetFilePath);
        await fs.promises.rename(
            fromDirPath
                ? path.join(fromDirPath, fileName)
                : taskFilePath(fileName),
            targetFilePath,
        );
    }

    function taskFilePath(name: string): string {
        return path.join(queuePath, name);
    }
}
