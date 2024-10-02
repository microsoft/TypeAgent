// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextBlock } from "knowledge-processor";
import { dateTime } from "typeagent";

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
