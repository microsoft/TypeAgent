// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextBlock } from "knowledge-processor";
import { dateTime } from "typeagent";
import { conversation } from "knowledge-processor";
import { ChatPrinter } from "../chatPrinter.js";

export function* timestampBlocks(
    blocks: Iterable<TextBlock>,
    startDate: Date,
    minMsOffset: number,
    maxMsOffset: number,
): IterableIterator<dateTime.Timestamped<TextBlock>> {
    const timestampGenerator = dateTime.generateRandomDates(
        startDate,
        minMsOffset,
        maxMsOffset,
    );
    for (let value of blocks) {
        const timestamp = timestampGenerator.next().value;
        yield {
            timestamp,
            value,
        };
    }
}

export async function importMessageIntoConversation(
    cm: conversation.ConversationManager,
    message: string | TextBlock,
    ensureUnique: boolean,
    printer: ChatPrinter,
) {
    const messageText = typeof message === "string" ? message : message.value;
    if (ensureUnique) {
        if ((await cm.conversation.findMessage(messageText)) !== undefined) {
            printer.writeError("Message already in index");
            return;
        }
    }
    printer.writeLine("Importing...");
    await cm.addMessage(message);
}
