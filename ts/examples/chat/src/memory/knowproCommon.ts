// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export function getTimeRangeForConversation(
    conversation: kp.IConversation,
): kp.DateRange | undefined {
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

export function textLocationToString(location: kp.TextLocation): string {
    let text = `MessageIndex: ${location.messageIndex}`;
    if (location.chunkIndex) {
        text += `\nChunkIndex: ${location.chunkIndex}`;
    }
    if (location.charIndex) {
        text += `\nCharIndex: ${location.charIndex}`;
    }
    return text;
}
