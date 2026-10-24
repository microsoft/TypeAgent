// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections } from "@typeagent/agent-runtime";
import {
    DateRange,
    IConversation,
    ListIndexingResult,
    MessageOrdinal,
} from "./interfaces.js";
import { matchesTemporalRange, parseTemporalValue } from "./temporal.js";
import type {
    MessageTemporalContext,
    TemporalQueryRange,
} from "./temporalSchema.js";
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
    private temporal = new Map<
        number,
        Pick<
            MessageTemporalContext,
            "messageTime" | "eventMentions" | "discoveredDateEvidence"
        >
    >();

    constructor() {}

    public addTemporalContext(
        ordinal: number,
        context: MessageTemporalContext,
    ): void {
        this.temporal.set(ordinal, context);
    }

    public lookupTemporalRange(range: TemporalQueryRange) {
        return [...this.temporal]
            .filter(([, context]) => matchesTemporalRange(context, range))
            .map(([ordinal]) => textRangeFromMessageChunk(ordinal));
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
        if (!this.temporal.has(messageOrdinal))
            this.temporal.set(messageOrdinal, {
                messageTime: parseTemporalValue(timestamp),
            });
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
        this.temporal.clear();
    }

    private compareTimestampedRange(
        x: TimestampedTextRange,
        y: TimestampedTextRange,
    ) {
        return x.timestamp.localeCompare(y.timestamp);
    }

    private dateToTimestamp(date: Date) {
        return date.toISOString();
    }
}

export function buildTimestampIndex(
    conversation: IConversation,
): ListIndexingResult {
    return addToTimestampIndex(conversation, 0);
}

export function addToTimestampIndex(
    conversation: IConversation,
    startAtOrdinal: MessageOrdinal,
): ListIndexingResult {
    if (conversation.secondaryIndexes) {
        conversation.secondaryIndexes.timestampIndex ??=
            new TimestampToTextRangeIndex();

        const messages = conversation.messages;
        const messageCount = messages.length;
        const timestampIndex = conversation.secondaryIndexes.timestampIndex;
        const messageTimestamps: [MessageOrdinal, string][] = [];
        for (
            let messageOrdinal = startAtOrdinal;
            messageOrdinal < messageCount;
            ++messageOrdinal
        ) {
            const message = messages.get(messageOrdinal);
            const timestamp = message.timestamp;
            if (message.metadata?.temporalContext)
                timestampIndex.addTemporalContext?.(
                    messageOrdinal,
                    message.metadata.temporalContext,
                );
            if (timestamp) {
                messageTimestamps.push([messageOrdinal, timestamp]);
            }
        }
        return timestampIndex.addTimestamps(messageTimestamps);
    }
    return { numberCompleted: 0 };
}
