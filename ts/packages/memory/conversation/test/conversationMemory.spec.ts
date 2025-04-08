// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys, readTestFile } from "test-lib";
import {
    ConversationMemory,
    ConversationMessage,
    parseConversationMemoryTranscript,
} from "../src/conversationMemory.js";
import { getTestTranscriptDialog, TestTranscriptInfo } from "./testCommon.js";

describeIf(
    "conversationMemory.online",
    () => hasTestKeys(),
    () => {
        test("addMessage", async () => {
            const [messages, _] = loadConversationTranscript(
                getTestTranscriptDialog(),
            );
            const cm = new ConversationMemory();
            for (const message of messages) {
                await cm.addMessage(message);
            }
        });
    },
);

export function loadConversationTranscript(
    testTranscript: TestTranscriptInfo,
): [ConversationMessage[], Set<string>] {
    const transcriptText = readTestFile(testTranscript.filePath);
    const [messages, participants] =
        parseConversationMemoryTranscript(transcriptText);
    return [messages, participants];
}
