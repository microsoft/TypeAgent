// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IMessage, IMessageCollection, MessageOrdinal } from "./interfaces.js";

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

/**
 * Given a set of message ordinals, returns the count of messages whose cumulative
 * text length is < than the given character budget
 * @param messages messageOrdinals reference messages in this collection
 * @param messageOrdinals Can be in arbitrary sort order (often in rank order)
 * @param maxCharsInBudget
 * @returns
 */
export function getCountOfMessagesInCharBudget(
    messages: IMessageCollection,
    messageOrdinals: MessageOrdinal[],
    maxCharsInBudget: number,
): number {
    let i = 0;
    let totalCharCount = 0;
    for (; i < messageOrdinals.length; ++i) {
        const messageOrdinal = messageOrdinals[i];
        const message = messages.get(messageOrdinal);
        const messageCharCount = getMessageCharCount(message);
        if (messageCharCount + totalCharCount > maxCharsInBudget) {
            break;
        }
        totalCharCount += messageCharCount;
    }
    return i;
}
