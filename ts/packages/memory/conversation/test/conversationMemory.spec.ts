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
import { createKnowledgeResponse } from "knowpro";
import { conversation as kpLib } from "knowledge-processor";

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
                    const result = await cm.addMessage(message, true, true);
                    expect(result.success).toBeTruthy();
                }
                verifyMemory(cm, messages.length);
                for (const message of messages) {
                    expect(message.knowledge).toBeDefined();
                }
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
            "autoExtractFalse",
            async () => {
                const maxMessages = 4;
                const messages = loadTestMessages(maxMessages);
                const cm = new ConversationMemory();
                for (const message of messages) {
                    const result = await cm.addMessage(message, false, true);
                    expect(result.success).toBeTruthy();
                }
                verifyMemory(cm, messages.length);
                for (const message of messages) {
                    expect(message.knowledge).toBeUndefined();
                }
            },
            testTimeout,
        );

        test(
            "caseSensitive",
            async () => {
                const maxMessages = 4;
                const messages = loadTestMessages(maxMessages);
                const idLabel = "Message_ID";
                const idFacetName = "ID";
                const idType = "__id";
                for (let i = 0; i < messages.length; ++i) {
                    const message = messages[i];
                    message.knowledge = createKnowledgeResponse();
                    message.knowledge.entities.push({
                        name: idLabel,
                        type: [idType],
                        facets: [
                            { name: idFacetName, value: `${idLabel} ${i}` },
                        ],
                    });
                }
                const cm = new ConversationMemory();
                for (const message of messages) {
                    const result = await cm.addMessage(message, true, true);
                    expect(result.success).toBeTruthy();
                }
                const refs = cm.semanticRefs;
                for (const sr of refs) {
                    if (sr.knowledgeType === "entity") {
                        const entity = sr.knowledge as kpLib.ConcreteEntity;
                        if (entity.type.some((t) => t === idType)) {
                            expect(entity.name).toEqual(idLabel);
                            if (entity.facets) {
                                for (const f of entity.facets) {
                                    expect(f.name).toEqual(idFacetName);
                                    expect(
                                        f.value.toString().startsWith(idLabel),
                                    );
                                }
                            }
                        }
                    }
                }
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
                    cm.queueAddMessage(
                        message,
                        (error) => {
                            expect(error).toBeUndefined();
                        },
                        true,
                        true,
                    );
                }
                await cm.waitForPendingTasks();
                verifyMemory(cm, messages.length);
                for (const message of messages) {
                    expect(message.knowledge).toBeDefined();
                }
            },
            testTimeout,
        );

        test(
            "queueMessage.autoExtractFalse",
            async () => {
                const maxMessages = 3;
                const messages = loadTestMessages(maxMessages);
                const cm = new ConversationMemory();
                for (const message of messages) {
                    cm.queueAddMessage(
                        message,
                        (error) => {
                            expect(error).toBeUndefined();
                        },
                        false,
                        true,
                    );
                }
                await cm.waitForPendingTasks();
                verifyMemory(cm, messages.length);
                for (const message of messages) {
                    expect(message.knowledge).toBeUndefined();
                }
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
