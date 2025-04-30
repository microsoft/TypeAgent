// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createEmailMemory, EmailMemory } from "../src/emailMemory.js";
import { EmailMeta, EmailMessage } from "../src/emailMessage.js";
import { IndexFileSettings } from "../src/memory.js";
import { verifyMessagesEqual } from "./verify.js";
import { describeIf, ensureOutputDir, hasTestKeys } from "test-lib";

describeIf(
    "email.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        let storeRoot;
        beforeAll(() => {
            storeRoot = ensureOutputDir("emailMemory");
        });
        test(
            "create",
            async () => {
                const em = createEmailMemory(
                    { dirPath: storeRoot!, baseFileName: "createTest" },
                    true,
                );
                try {
                    const messageCount = 4;
                    const messages = createEmails(messageCount);
                    // Test direct add to collection
                    em.messages.append(...messages);
                    expect(em.messages.length).toEqual(messageCount);
                    // Test enumeration
                    const messages2 = [...em.messages];
                    verifyMessagesEqual(messages, messages2);
                } finally {
                    em.close();
                }
            },
            testTimeout,
        );
        test(
            "indexing",
            async () => {
                const fileSettings: IndexFileSettings = {
                    dirPath: storeRoot!,
                    baseFileName: "indexingTest",
                };
                const messageCount = 4;
                const messages = createEmails(messageCount);
                let semanticRefCount = 0;
                let em = createEmailMemory(fileSettings, true);
                try {
                    await addToIndex(em, messages);
                    await em.writeToFile();
                    expect(em.messages.length).toEqual(messageCount);
                    semanticRefCount = em.semanticRefs.length;
                } finally {
                    em.close();
                }
                const em2 = await EmailMemory.readFromFile(fileSettings);
                expect(em2).toBeDefined();
                if (em2) {
                    verifyMessagesEqual(messages, [...em2!.messages]);
                    expect(em2.messages.length).toEqual(messages.length);
                    expect(em2.indexingState.lastMessageOrdinal).toEqual(
                        messages.length - 1,
                    );
                    expect(em2.semanticRefs.length).toEqual(semanticRefCount);
                    expect(em2.indexingState.lastSemanticRefOrdinal).toEqual(
                        semanticRefCount - 1,
                    );
                }
            },
            testTimeout,
        );

        async function addToIndex(em: EmailMemory, messages: EmailMessage[]) {
            for (const message of messages) {
                const result = await em.addMessage(message);
                expect(result.success).toBeTruthy();
            }
        }
    },
);

function createEmails(count: number, from?: string): EmailMessage[] {
    const messages: EmailMessage[] = [];
    for (let i = 0; i < count; ++i) {
        let fromAlias = from ?? `alias${i}@xyz.pqr`;
        messages.push(
            createEmail(fromAlias, `BookName_${i} is a book by Author_${i}`),
        );
    }
    return messages;
}

function createEmail(from: string, body: string): EmailMessage {
    return new EmailMessage(new EmailMeta({ address: from }), body);
}
