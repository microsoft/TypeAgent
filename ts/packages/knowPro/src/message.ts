// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IMessage, TextRange } from "./interfaces.js";

/**
 * Given a budget of maxCharsPerChunk
 * @param messages
 * @param maxCharsPerChunk
 * @param autoTruncate
 */
export function* getMessageChunks(
    messages: IMessage[],
    maxCharsPerChunk: number,
    autoTruncate: boolean,
): IterableIterator<TextRange> {
    for (let i = 0; i < messages.length; ++i) {}
}
