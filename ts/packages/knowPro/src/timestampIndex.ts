// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IMessage,
    ITimestampToMessageIndex,
    MessageIndex,
    TextRange,
} from "./dataFormat.js";

export class TimestampToMessageIndex implements ITimestampToMessageIndex {
    private messageIndex: TimestampedTextRange[];
    constructor(messages: IMessage[]) {
        this.messageIndex = [];
        for (let i = 0; i < messages.length; ++i) {
            this.addMessage(messages[i], i);
        }
        this.messageIndex.sort(compareTimestampedRange);
    }

    public getTextRange(dateRange: DateRange): TextRange[] {
        const startAt = dateTime.timestampString(dateRange.start);
        const stopAt = dateRange.end
            ? dateTime.timestampString(dateRange.end)
            : undefined;
        const ranges: TimestampedTextRange[] = collections.getInRange(
            this.messageIndex,
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
                this.messageIndex,
                entry,
                compareTimestampedRange,
            );
        } else {
            this.messageIndex.push(entry);
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
