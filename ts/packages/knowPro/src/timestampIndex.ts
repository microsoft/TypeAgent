// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IConversation,
    IMessage,
    ListIndexingResult,
    MessageOrdinal,
} from "./interfaces.js";
import { textRangeFromMessageChunk } from "./message.js";
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
        messageOrdinal: MessageOrdinal,
        timestamp: string,
    ): boolean {
        return this.insertTimestamp(messageOrdinal, timestamp, true);
    }

    public addTimestamps(
        messageTimestamps: [MessageOrdinal, string][],
    ): ListIndexingResult {
        for (let i = 0; i < messageTimestamps.length; ++i) {
            const [messageOrdinal, timestamp] = messageTimestamps[i];
            this.insertTimestamp(messageOrdinal, timestamp, false);
        }
        this.ranges.sort(this.compareTimestampedRange);
        return { numberCompleted: messageTimestamps.length };
    }

    private insertTimestamp(
        messageOrdinal: MessageOrdinal,
        timestamp: string | undefined,
        inOrder: boolean,
    ): boolean {
        if (!timestamp) {
            return false;
        }
        const timestampDate = new Date(timestamp);
        const entry: TimestampedTextRange = {
            range: textRangeFromMessageChunk(messageOrdinal),
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

export function buildTimestampIndex(
    conversation: IConversation,
): ListIndexingResult {
    if (conversation.messages && conversation.secondaryIndexes) {
        conversation.secondaryIndexes.timestampIndex ??=
            new TimestampToTextRangeIndex();
        // TODO: do ths using slices/batch so we don't have to load all messages
        return addToTimestampIndex(
            conversation.secondaryIndexes.timestampIndex,
            conversation.messages,
            0,
        );
    }
    return {
        numberCompleted: 0,
    };
}

export function addToTimestampIndex(
    timestampIndex: ITimestampToTextRangeIndex,
    messages: IMessage[],
    baseMessageOrdinal: MessageOrdinal,
): ListIndexingResult {
    const messageTimestamps: [MessageOrdinal, string][] = [];
    for (let i = 0; i < messages.length; ++i) {
        const timestamp = messages[i].timestamp;
        if (timestamp) {
            messageTimestamps.push([i + baseMessageOrdinal, timestamp]);
        }
    }
    return timestampIndex.addTimestamps(messageTimestamps);
}
