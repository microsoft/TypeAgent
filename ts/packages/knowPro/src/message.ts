// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IMessage,
    MessageOrdinal,
    TextLocation,
    TextRange,
} from "./interfaces.js";

/**
 * INTERNAL LIBRARY
 */

/**
 * Returns the text range represented by a message (and an optional chunk ordinal)
 * @param messageOrdinal
 * @param chunkOrdinal
 * @returns {TextRange}
 */
export function textRangeFromMessageChunk(
    messageOrdinal: MessageOrdinal,
    chunkOrdinal = 0,
): TextRange {
    return {
        start: { messageOrdinal: messageOrdinal, chunkOrdinal: chunkOrdinal },
        end: undefined,
    };
}

export function textRangeFromMessageRange(
    start: MessageOrdinal,
    end: MessageOrdinal,
): TextRange {
    if (start === end) {
        // Point location
        return { start: { messageOrdinal: start } };
    } else if (start < end) {
        return {
            start: { messageOrdinal: start },
            end: { messageOrdinal: end },
        };
    } else {
        throw new Error(`Expect message ordinal range: ${start} <= ${end}`);
    }
}

/**
 * Get the total number of a characters in a message.
 * A message can contain multiple text chunks
 * @param {IMessage} message
 * @returns
 */
export function getMessageCharCount(message: IMessage): number {
    let total = 0;
    for (let i = 0; i < message.textChunks.length; ++i) {
        total += message.textChunks[i].length;
    }
    return total;
}

export function getCountOfChunksInMessages(messages: IMessage[]): number {
    return messages.reduce<number>(
        (total, message) => total + message.textChunks.length,
        0,
    );
}

/**
 * Given a set of message ordinals, returns the count of messages whose cumulative
 * text length is < than the given character budget
 * @param messages messageOrdinals reference messages in this collection
 * @param messageOrdinals Can be in arbitrary sort order (often in rank order)
 * @param maxCharsInBudget
 * @returns
 */
export function getCountOfMessagesInCharBudget(
    messages: IMessage[],
    messageOrdinals: MessageOrdinal[],
    maxCharsInBudget: number,
): number {
    let i = 0;
    let totalCharCount = 0;
    // TODO: use batches
    for (; i < messageOrdinals.length; ++i) {
        const messageOrdinal = messageOrdinals[i];
        const message = messages[messageOrdinal];
        const messageCharCount = getMessageCharCount(message);
        if (messageCharCount + totalCharCount > maxCharsInBudget) {
            break;
        }
        totalCharCount += messageCharCount;
    }
    return i;
}

/**
 * Turn message ordinals into text ranges.. building longest contiguous ranges
 * @param messageOrdinals
 * @returns
 */
export function textRangesFromMessageOrdinals(
    messageOrdinals: MessageOrdinal[],
): TextRange[] {
    if (messageOrdinals.length === 0) {
        return [];
    }
    // Sort ordinals in ascending order
    messageOrdinals.sort((x, y) => x - y);
    let ranges: TextRange[] = [];
    let startOrdinal: MessageOrdinal | undefined = messageOrdinals[0];
    let endOrdinal = startOrdinal;
    for (let i = 1; i < messageOrdinals.length; ++i) {
        const messageOrdinal = messageOrdinals[i];
        if (messageOrdinal - endOrdinal > 1) {
            // Non-contiguous range
            ranges.push(textRangeFromMessageRange(startOrdinal, endOrdinal));
            startOrdinal = messageOrdinal;
        }
        endOrdinal = messageOrdinal;
    }
    ranges.push(textRangeFromMessageRange(startOrdinal, endOrdinal));
    return ranges;
}

export function* getMessageChunkBatch(
    messages: IMessage[],
    ordinalStartAt: MessageOrdinal,
    batchSize: number,
): IterableIterator<TextLocation[]> {
    let batch: TextLocation[] = [];
    for (
        let messageOrdinal = ordinalStartAt;
        messageOrdinal < messages.length;
        ++messageOrdinal
    ) {
        const message = messages[messageOrdinal];
        for (
            let chunkOrdinal = 0;
            chunkOrdinal < message.textChunks.length;
            ++chunkOrdinal
        ) {
            batch.push({
                messageOrdinal,
                chunkOrdinal,
            });
            if (batch.length === batchSize) {
                yield batch;
                batch = [];
            }
        }
    }
    if (batch.length > 0) {
        yield batch;
    }
}

export function getEnclosingTextRange(
    messageOrdinals: Iterable<MessageOrdinal>,
): TextRange | undefined {
    let start: MessageOrdinal | undefined;
    let end = start;
    for (const ordinal of messageOrdinals) {
        if (start === undefined || ordinal < start) {
            start = ordinal;
        }
        if (end === undefined || end < ordinal) {
            end = ordinal;
        }
    }
    if (start === undefined || end === undefined) {
        return undefined;
    }
    return textRangeFromMessageRange(start, end);
}

export function getEnclosingDateRangeForMessages(
    messages: IMessage[],
    messageOrdinals: Iterable<MessageOrdinal>,
): DateRange | undefined {
    const textRange = getEnclosingTextRange(messageOrdinals);
    if (!textRange) {
        return undefined;
    }
    return getEnclosingDateRangeForTextRange(messages, textRange);
}

export function getEnclosingDateRangeForTextRange(
    messages: IMessage[],
    range: TextRange,
): DateRange | undefined {
    const startTimestamp = messages[range.start.messageOrdinal].timestamp;
    if (!startTimestamp) {
        return undefined;
    }
    const endTimestamp = range.end
        ? messages[range.end.messageOrdinal].timestamp
        : undefined;
    return {
        start: new Date(startTimestamp),
        end: endTimestamp ? new Date(endTimestamp) : undefined,
    };
}
