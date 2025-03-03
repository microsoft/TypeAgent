// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IMessage } from "./interfaces.js";
import {
    createTextEmbeddingIndexSettings,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { RelatedTermIndexSettings } from "./relatedTermsIndex.js";

export type ConversationSettings = {
    relatedTermIndexSettings: RelatedTermIndexSettings;
    threadSettings: TextEmbeddingIndexSettings;
};

export function createConversationSettings(): ConversationSettings {
    const embeddingIndexSettings = createTextEmbeddingIndexSettings();
    return {
        relatedTermIndexSettings: {
            embeddingIndexSettings,
        },
        threadSettings: embeddingIndexSettings,
    };
}

/**
 * Text (such as a transcript) can be collected over a time range.
 * This text can be partitioned into blocks. However, timestamps for individual blocks are not available.
 * Assigns individual timestamps to blocks proportional to their lengths.
 * @param turns Transcript turns to assign timestamps to
 * @param startDate starting
 * @param endDate
 */
export function timestampMessages(
    messages: IMessage[],
    startDate: Date,
    endDate: Date,
): void {
    let startTicks = startDate.getTime();
    const ticksLength = endDate.getTime() - startTicks;
    if (ticksLength <= 0) {
        throw new Error(`${startDate} is not < ${endDate}`);
    }
    let messageLengths = messages.map((m) => messageLength(m));
    const textLength: number = messageLengths.reduce(
        (total: number, l) => total + l,
        0,
    );
    const ticksPerChar = ticksLength / textLength;
    for (let i = 0; i < messages.length; ++i) {
        messages[i].timestamp = new Date(startTicks).toISOString();
        // Now, we will 'elapse' time .. proportional to length of the text
        // This assumes that each speaker speaks equally fast...
        startTicks += ticksPerChar * messageLengths[i];
    }

    function messageLength(message: IMessage): number {
        return message.textChunks.reduce(
            (total: number, chunk) => total + chunk.length,
            0,
        );
    }
}
