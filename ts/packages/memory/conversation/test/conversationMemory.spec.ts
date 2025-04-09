// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys, readTestFile } from "test-lib";
import {
    ConversationMemory,
    ConversationMessage,
    parseConversationMemoryTranscript,
} from "../src/conversationMemory.js";
import {
    ensureOutputDir,
    getTestTranscriptDialog,
    TestTranscriptInfo,
} from "./testCommon.js";
import { verifyConversationBasic } from "./verify.js";

describeIf(
    "conversationMemory.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        test(
            "endToEnd",
            async () => {
                let [messages, _] = loadConversationTranscript(
                    getTestTranscriptDialog(),
                );
                const maxMessages = 4;
                messages = messages.slice(0, maxMessages);
                const cm = new ConversationMemory();
                const dirPath = await ensureOutputDir(
                    "conversationMemory.online.endToEnd",
                );
                // Set up for auto-save
                cm.fileSaveSettings = {
                    dirPath,
                    baseFileName: "endToEnd",
                };
                for (const message of messages) {
                    await cm.addMessage(message);
                }
                verifyMemory(cm, maxMessages);
                const cm2 = await ConversationMemory.readFromFile(
                    cm.fileSaveSettings.dirPath,
                    cm.fileSaveSettings.baseFileName,
                );
                expect(cm2).toBeDefined();
                verifyMemory(cm2!, cm.messages.length, cm.semanticRefs.length);
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
