// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo, runExe } from "interactive-app";
import { TextBlock } from "knowledge-processor";
import { dateTime, getAbsolutePath } from "typeagent";

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
): Promise<void> {
    await runExe(
        getAbsolutePath(
            `../../../../../dotnet/email/bin/Debug/net8.0-windows7.0/outlookEmail.exe`,
            import.meta.url,
        ),
        [sourcePath],
        io,
    );
}
