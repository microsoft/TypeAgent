// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo, runExe, StopWatch } from "interactive-app";
import {
    loadIndexingStats,
    saveIndexingStats,
    TextBlock,
} from "knowledge-processor";
import { dateTime, getAbsolutePath, WorkQueue } from "typeagent";
import { ChatMemoryPrinter } from "./chatMemoryPrinter.js";
import { existsSync } from "node:fs";
import { error, Result, success } from "typechat";

export function* timestampBlocks(
    blocks: Iterable<TextBlock>,
    startDate: Date,
    minMsOffset: number,
    maxMsOffset: number,
): IterableIterator<dateTime.Timestamped<TextBlock>> {
    const timestampGenerator = dateTime.generateRandomDates(
        startDate,
        minMsOffset,
        maxMsOffset,
    );
    for (let value of blocks) {
        const timestamp = timestampGenerator.next().value;
        yield {
            timestamp,
            value,
        };
    }
}

export async function convertMsgFiles(
    sourcePath: string,
    io: InteractiveIo,
): Promise<Result<boolean>> {
    const converterPath = getAbsolutePath(
        `../../../../../dotnet/email/bin/Debug/net8.0-windows7.0/outlookEmail.exe`,
        import.meta.url,
    );
    if (!existsSync(converterPath)) {
        return error(
            "Please compile dotnet/email solution on Windows before running this command",
        );
    }

    await runExe(converterPath, [sourcePath], io);
    return success(true);
}

export async function runImportQueue(
    queue: WorkQueue,
    statsFilePath: string,
    clean: boolean,
    maxItems: number,
    pauseMs: number,
    printer: ChatMemoryPrinter,
    itemProcessor: (
        filePath: string,
        index: number,
        total: number,
    ) => Promise<number>,
) {
    queue.onError = (err) => printer.writeError(err);
    let attempts = 1;
    const timing = new StopWatch();
    const maxAttempts = 2;
    let stats = await loadIndexingStats(statsFilePath, clean);
    let grandTotal = stats.itemStats.length;
    while (attempts <= maxAttempts) {
        const successCount = await queue.drain(
            1,
            async (filePath, index, total) => {
                printer.writeProgress(index + 1, total);
                stats!.startItem();
                timing.start();
                const itemCharCount = await itemProcessor(
                    filePath,
                    index,
                    total,
                );
                timing.stop();
                stats!.updateCurrent(timing.elapsedMs, itemCharCount);
                await saveIndexingStats(stats, statsFilePath, clean);

                grandTotal++;
                printer.writeLine();
                printer.writeIndexingMetrics(stats, grandTotal, timing);
                printer.writeLine();
            },
            maxItems,
            pauseMs,
        );
        // Replay any errors
        if (!(await queue.requeueErrors())) {
            break;
        }
        if (maxItems) {
            maxItems -= successCount;
        }
        ++attempts;
        if (attempts <= maxAttempts) {
            printer.writeHeading("Retrying errors");
        }
    }
    printer.writeHeading("Indexing Stats");
    printer.writeIndexingStats(stats);
}
