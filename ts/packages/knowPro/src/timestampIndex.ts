// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IConversation,
    IMessage,
    MessageIndex,
} from "./interfaces.js";
import { textRangeFromLocation } from "./conversationIndex.js";
import {
    ITimestampToTextRangeIndex,
    TimestampedTextRange,
} from "./interfaces.js";

/**
 * An index of timestamp => TextRanges.
 * * Timestamps must be unique.
 * *TextRanges need not be contiguous.
 */
export class TimestampToTextRangeIndex implements ITimestampToTextRangeIndex {
    // Maintains ranges sorted by timestamp
    private ranges: TimestampedTextRange[] = [];

    constructor() {}

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

    public addTimestamp(
        messageIndex: MessageIndex,
        timestamp: string,
    ): boolean {
        return this.insertTimestamp(messageIndex, timestamp, true);
    }

    public addTimestamps(messageTimestamps: [MessageIndex, string][]) {
        for (let i = 0; i < messageTimestamps.length; ++i) {
            const [messageIndex, timestamp] = messageTimestamps[i];
            this.insertTimestamp(messageIndex, timestamp, false);
        }
        this.ranges.sort(this.compareTimestampedRange);
    }

    private insertTimestamp(
        messageIndex: MessageIndex,
        timestamp: string | undefined,
        inOrder: boolean,
    ) {
        if (!timestamp) {
            return false;
        }
        const timestampDate = new Date(timestamp);
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

    public clear(): void {
        this.ranges = [];
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

export function buildTimestampIndex(conversation: IConversation): void {
    if (conversation.messages && conversation.secondaryIndexes) {
        conversation.secondaryIndexes.timestampIndex ??=
            new TimestampToTextRangeIndex();
        addToTimestampIndex(
            conversation.secondaryIndexes.timestampIndex,
            conversation.messages,
            0,
        );
    }
}

export function addToTimestampIndex(
    timestampIndex: ITimestampToTextRangeIndex,
    messages: IMessage[],
    baseMessageIndex: MessageIndex,
) {
    const messageTimestamps: [MessageIndex, string][] = [];
    for (let i = 0; i < messages.length; ++i) {
        const timestamp = messages[i].timestamp;
        if (timestamp) {
            messageTimestamps.push([i + baseMessageIndex, timestamp]);
        }
    }
    timestampIndex.addTimestamps(messageTimestamps);
}
