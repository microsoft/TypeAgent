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
        const testTimeout = 5 * 60 * 1000;
        test(
            "addMessage",
            async () => {
                let [messages, _] = loadConversationTranscript(
                    getTestTranscriptDialog(),
                );
                const maxMessages = 4;
                messages = messages.slice(0, maxMessages);
                const cm = new ConversationMemory();
                for (const message of messages) {
                    await cm.addMessage(message);
                }
            },
            testTimeout,
        );
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
