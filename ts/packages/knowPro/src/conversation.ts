// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversation, DateRange } from "./interfaces.js";

/**
 * Returns the time range for a conversation: the timestamps of the first and last messages
 * If messages have no timestamps (which are optional), returns undefined
 * @param conversation
 * @returns {DateRange}
 */
export function getTimeRangeForConversation(
    conversation: IConversation,
): DateRange | undefined {
    const messages = conversation.messages;
    const start = messages[0].timestamp;
    const end = messages[messages.length - 1].timestamp;
    if (start !== undefined) {
        return {
            start: new Date(start),
            end: end ? new Date(end) : undefined,
        };
    }
    return undefined;
}
