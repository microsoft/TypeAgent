// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IMessage,
    ITimestampToTextRangeIndex,
    MessageIndex,
    TextRange,
} from "./dataFormat.js";

/**
 * An index of timestamp => TextRanges
 * TextRanges need not be contiguous.
 */
export class TimestampToTextRangeIndex implements ITimestampToTextRangeIndex {
    // Maintains ranges sorted by timestamp
    private ranges: TimestampedTextRange[];

    constructor(messages: IMessage[]) {
        this.ranges = [];
        for (let i = 0; i < messages.length; ++i) {
            this.addMessage(messages[i], i);
        }
        this.ranges.sort(compareTimestampedRange);
    }

    /**
     * Looks up text ranges in given date range.
     * Text ranges need not be contiguous
     * @param dateRange
     * @returns
     */
    public lookupRange(dateRange: DateRange): TextRange[] {
        const startAt = dateTime.timestampString(dateRange.start);
        const stopAt = dateRange.end
            ? dateTime.timestampString(dateRange.end)
            : undefined;
        const ranges: TimestampedTextRange[] = collections.getInRange(
            this.ranges,
            startAt,
            stopAt,
            compareTimestampedRange,
        );
        return ranges.map((r) => r.range);
    }

    private addMessage(
        message: IMessage,
        messageIndex: MessageIndex,
        inOrder = false,
    ): boolean {
        if (!message.timestamp) {
            return false;
        }
        const date = new Date(message.timestamp);
        // This string is formatted to be searchable
        const entry = this.makeTimestamped(date, messageIndex);
        if (inOrder) {
            collections.insertIntoSorted(
                this.ranges,
                entry,
                compareTimestampedRange,
            );
        } else {
            this.ranges.push(entry);
        }
        return true;
    }

    private makeTimestamped(
        timestamp: Date,
        messageIndex: MessageIndex,
    ): TimestampedTextRange {
        return {
            range: { start: { messageIndex } },
            timestamp: dateTime.timestampString(timestamp, false),
        };
    }
}

type TimestampedTextRange = {
    timestamp: string;
    range: TextRange;
};

function compareTimestampedRange(
    x: TimestampedTextRange,
    y: TimestampedTextRange,
) {
    return x.timestamp.localeCompare(y.timestamp);
}
