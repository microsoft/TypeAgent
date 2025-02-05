// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IMessage,
    ITimestampToTextRangeIndex,
    MessageIndex,
    TimestampedTextRange,
} from "./dataFormat.js";
import { textRangeFromLocation } from "./conversationIndex.js";

/**
 * An index of timestamp => TextRanges.
 * * Timestamps must be unique.
 * *TextRanges need not be contiguous.
 */
export class TimestampToTextRangeIndex implements ITimestampToTextRangeIndex {
    // Maintains ranges sorted by timestamp
    private ranges: TimestampedTextRange[];

    constructor(messages: IMessage[]) {
        this.ranges = [];
        for (let i = 0; i < messages.length; ++i) {
            this.addMessage(messages[i], i);
        }
        this.ranges.sort(this.compareTimestampedRange);
    }

    /**
     * Looks up text ranges in given date range.
     * Text ranges need not be contiguous
     * @param dateRange
     * @returns
     */
    public lookupRange(dateRange: DateRange): TimestampedTextRange[] {
        const startAt = this.dateToTimestamp(dateRange.start);
        const stopAt = dateRange.end
            ? this.dateToTimestamp(dateRange.end)
            : undefined;
        return collections.getInRange(
            this.ranges,
            startAt,
            stopAt,
            (x: TimestampedTextRange, y: string) =>
                x.timestamp.localeCompare(y),
        );
    }

    private addMessage(
        message: IMessage,
        messageIndex: MessageIndex,
        inOrder = false,
    ): boolean {
        if (!message.timestamp) {
            return false;
        }
        const timestampDate = new Date(message.timestamp);
        const entry: TimestampedTextRange = {
            range: textRangeFromLocation(messageIndex),
            // This string is formatted to be lexically sortable
            timestamp: this.dateToTimestamp(timestampDate),
        };
        if (inOrder) {
            collections.insertIntoSorted(
                this.ranges,
                entry,
                this.compareTimestampedRange,
            );
        } else {
            this.ranges.push(entry);
        }
        return true;
    }

    private compareTimestampedRange(
        x: TimestampedTextRange,
        y: TimestampedTextRange,
    ) {
        return x.timestamp.localeCompare(y.timestamp);
    }

    private dateToTimestamp(date: Date) {
        return dateTime.timestampString(date, false);
    }
}
