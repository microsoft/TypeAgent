// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections } from "@typeagent/agent-runtime";
import {
    DateRange,
    IConversation,
    ListIndexingResult,
    MessageOrdinal,
} from "./interfaces.js";
import {
    matchesTemporalRange,
    parseTemporalValue,
    temporalValues,
    validateTemporalValue,
} from "./temporal.js";
import { timeSearchStage } from "./searchTiming.js";
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
    private candidates = new Map<string, { ordinal: number; key: string }[]>();
    private candidatesDirty = false;
    private contextOrder = new Map<number, number>();

    constructor() {}

    public addTemporalContext(
        ordinal: number,
        context: MessageTemporalContext,
    ): void {
        for (const dimension of ["message", "event"] as const)
            for (const value of temporalValues(context, dimension))
                if (value) validateTemporalValue(value);
        if (!this.contextOrder.has(ordinal))
            this.contextOrder.set(ordinal, this.contextOrder.size);
        this.temporal.set(ordinal, structuredClone(context));
        this.candidatesDirty = true;
    }

    public lookupTemporalRange(range: TemporalQueryRange) {
        // Validate even an empty index, using the authoritative query contract.
        matchesTemporalRange(undefined, range);
        this.ensureCandidates();
        const entries =
            this.candidates.get(`${range.dimension}:${range.domain}`) ?? [];
        const boundKey = (raw: string) => {
            const value = parseTemporalValue(raw);
            return range.domain === "instant"
                ? value.instantUtc!
                : value.localDateTime;
        };
        const start = boundKey(range.start);
        const end = range.end === undefined ? undefined : boundKey(range.end);
        // Use the matcher's lexical ordering, including extended UTC years.
        const upper = end === undefined ? undefined : `${end}\uffff`;
        const from = this.lowerBound(entries, start);
        const to =
            upper === undefined
                ? entries.length
                : this.lowerBound(entries, upper);
        const ordinals = new Set(
            entries.slice(from, to).map((entry) => entry.ordinal),
        );
        return timeSearchStage(
            "query.temporal.exact",
            () =>
                [...ordinals]
                    .sort(
                        (a, b) =>
                            this.contextOrder.get(a)! -
                            this.contextOrder.get(b)!,
                    )
                    .filter((ordinal) =>
                        matchesTemporalRange(this.temporal.get(ordinal), range),
                    )
                    .map((ordinal) => textRangeFromMessageChunk(ordinal)),
            {
                candidateContexts: ordinals.size,
                totalContexts: this.temporal.size,
            },
        );
    }

    private lowerBound(entries: { key: string }[], key: string): number {
        let low = 0;
        let high = entries.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (entries[middle].key < key) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    private ensureCandidates(): void {
        if (!this.candidatesDirty) return;
        this.candidates.clear();
        for (const [ordinal, context] of this.temporal)
            for (const dimension of ["message", "event"] as const)
                for (const value of temporalValues(context, dimension)) {
                    if (!value) continue;
                    for (const domain of ["instant", "calendar"] as const) {
                        const key =
                            domain === "instant"
                                ? value.instantUtc
                                : value.localDateTime;
                        if (key === undefined) continue;
                        const name = `${dimension}:${domain}`;
                        const entries = this.candidates.get(name) ?? [];
                        entries.push({ ordinal, key });
                        this.candidates.set(name, entries);
                    }
                }
        for (const entries of this.candidates.values())
            entries.sort((a, b) =>
                a.key < b.key ? -1 : a.key > b.key ? 1 : a.ordinal - b.ordinal,
            );
        this.candidatesDirty = false;
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
        if (!this.temporal.has(messageOrdinal)) {
            this.contextOrder.set(messageOrdinal, this.contextOrder.size);
            this.temporal.set(messageOrdinal, {
                messageTime: parseTemporalValue(timestamp),
            });
            this.candidatesDirty = true;
        }
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
        this.candidates.clear();
        this.candidatesDirty = false;
        this.contextOrder.clear();
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
