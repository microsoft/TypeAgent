// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    describeIf,
    ensureOutputDir,
    hasTestKeys,
    readTestFile,
} from "test-lib";
import {
    ConversationMemory,
    ConversationMessage,
    parseConversationMemoryTranscript,
} from "../src/conversationMemory.js";
import { getTestTranscriptDialog, TestTranscriptInfo } from "./testCommon.js";
import { verifyConversationBasic } from "./verify.js";

describeIf(
    "conversationMemory.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        test(
            "endToEnd",
            async () => {
                const maxMessages = 4;
                const messages = loadTestMessages(maxMessages);
                const cm = new ConversationMemory();
                const dirPath = ensureOutputDir(
                    "conversationMemory.online.endToEnd",
                );
                // Set up for auto-save
                cm.settings.fileSaveSettings = {
                    dirPath,
                    baseFileName: "endToEnd",
                };
                for (const message of messages) {
                    const result = await cm.addMessage(message);
                    expect(result.success).toBeTruthy();
                }
                verifyMemory(cm, messages.length);
                const cm2 = await ConversationMemory.readFromFile(
                    cm.settings.fileSaveSettings.dirPath,
                    cm.settings.fileSaveSettings.baseFileName,
                );
                expect(cm2).toBeDefined();
                verifyMemory(cm2!, cm.messages.length, cm.semanticRefs.length);
            },
            testTimeout,
        );

        test(
            "queueMessage",
            async () => {
                const maxMessages = 3;
                const messages = loadTestMessages(maxMessages);
                const cm = new ConversationMemory();
                for (const message of messages) {
                    cm.queueAddMessage(message, (error) => {
                        expect(error).toBeUndefined();
                    });
                }
                await cm.waitForPendingTasks();
                verifyMemory(cm, messages.length);
            },
            testTimeout,
        );

        // This will obviously grow...
        function verifyMemory(
            cm: ConversationMemory,
            expectedMessageCount: number,
            expectedSemanticRefCount?: number,
        ) {
            verifyConversationBasic(
                cm,
                expectedMessageCount,
                expectedSemanticRefCount,
            );
        }

        function loadTestMessages(maxMessages: number) {
            let [messages, _] = loadConversationTranscript(
                getTestTranscriptDialog(),
            );
            if (maxMessages > 0) {
                messages = messages.slice(0, maxMessages);
            }
            return messages;
        }
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
