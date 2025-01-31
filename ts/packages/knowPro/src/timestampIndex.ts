// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime } from "typeagent";
import {
    DateRange,
    IMessage,
    ITimestampToMessageIndex,
    MessageIndex,
} from "./dataFormat.js";

export class TimestampToMessageIndex implements ITimestampToMessageIndex {
    private messageIndex: Timestamped<MessageIndex>[];
    constructor(messages: IMessage[]) {
        this.messageIndex = [];
        for (let i = 0; i < messages.length; ++i) {
            this.addMessage(messages[i], i);
        }
        this.messageIndex.sort(compareTimestamped);
    }

    public getMessagesInDateRange(dateRange: DateRange): MessageIndex[] {
        return collections.getInRange(
            this.messageIndex,
            dateTime.timestampString(dateRange.start),
            dateRange.end ? dateTime.timestampString(dateRange.end) : undefined,
            compareTimestamped,
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
        const date = new Date(message.timestamp);
        // This string is formatted to be searchable
        const entry: Timestamped<MessageIndex> = makeTimestamped(
            date,
            messageIndex,
        );
        if (inOrder) {
            collections.insertIntoSorted(
                this.messageIndex,
                entry,
                compareTimestamped,
            );
        } else {
            this.messageIndex.push(entry);
        }
        return true;
    }
}

type Timestamped<T = any> = {
    timestamp: string;
    value: T;
};

function compareTimestamped(x: Timestamped, y: Timestamped) {
    return x.timestamp.localeCompare(y.timestamp);
}

function makeTimestamped(timestamp: Date, value: any): Timestamped {
    return {
        value,
        timestamp: dateTime.timestampString(timestamp, false),
    };
}
